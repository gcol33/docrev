/**
 * File operation commands: backup, archive, export, clean
 *
 * Commands that create, move, or delete project files.
 */

import type { Command } from 'commander';
import {
  chalk,
  fs,
  path,
  fmt,
  findFiles,
  loadBuildConfig,
} from './context.js';

// Use the actual BuildConfig from build.ts which allows string|Author[]
type BuildConfig = ReturnType<typeof loadBuildConfig>;

interface ZipLike {
  addLocalFile(localPath: string, zipPath?: string): void;
}

/**
 * Recursively add directory contents to a zip archive, filtering by predicate
 */
function addDirToZip(
  zip: ZipLike,
  dir: string,
  shouldInclude: (name: string) => boolean,
  zipPath = '',
): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const entryZipPath = path.join(zipPath, entry.name);

    if (!shouldInclude(entry.name)) continue;

    if (entry.isDirectory()) {
      addDirToZip(zip, fullPath, shouldInclude, entryZipPath);
    } else {
      zip.addLocalFile(fullPath, zipPath || undefined);
    }
  }
}

// Options interfaces
interface BackupOptions {
  name?: string;
  output?: string;
}

interface ArchiveOptions {
  dir?: string;
  by?: string;
  rename?: boolean;
  dryRun?: boolean;
}

interface ExportOptions {
  output?: string;
  includeOutput?: boolean;
}

interface CleanOptions {
  dryRun?: boolean;
  all?: boolean;
}

/**
 * Register file-ops commands with the program
 */
export function register(program: Command): void {
  // ==========================================================================
  // BACKUP command - Timestamped project backup
  // ==========================================================================

  program
    .command('backup')
    .description('Create timestamped project backup')
    .option('-n, --name <name>', 'Custom backup name')
    .option('-o, --output <dir>', 'Output directory', '.')
    .action(async (options: BackupOptions) => {
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip();

      const date = new Date().toISOString().slice(0, 10);
      const name = options.name || `backup-${date}`;
      const outputPath = path.join(options.output || '.', `${name}.zip`);

      // Files to exclude
      const excludePatterns = [
        'node_modules', '.git', '.DS_Store', '*.zip',
        'paper.md' // Generated file
      ];

      const shouldInclude = (file: string): boolean => {
        for (const pattern of excludePatterns) {
          if (file.includes(pattern.replace('*', ''))) return false;
        }
        return true;
      };

      addDirToZip(zip, '.', shouldInclude);

      zip.writeZip(outputPath);
      console.log(fmt.status('success', `Backup created: ${outputPath}`));
    });

  // ==========================================================================
  // ARCHIVE command - Archive reviewer docx files
  // ==========================================================================

  program
    .command('archive')
    .description('Move reviewer .docx files to archive folder')
    .argument('[files...]', 'Specific files to archive (default: all .docx)')
    .option('-d, --dir <folder>', 'Archive folder name', 'archive')
    .option('--by <name>', 'Reviewer name (auto-detected if single commenter)')
    .option('--no-rename', 'Keep original filenames')
    .option('--dry-run', 'Preview without moving files')
    .action(async (files: string[] | undefined, options: ArchiveOptions) => {
      const { extractWordComments } = await import('../import.js');
      const { default: YAML } = await import('yaml');

      // Find docx files to archive
      let docxFiles = files && files.length > 0
        ? files.filter(f => f.endsWith('.docx') && fs.existsSync(f))
        : findFiles('.docx');

      // Exclude our own build outputs
      let projectSlug: string | null = null;
      const configPath = path.join(process.cwd(), 'rev.yaml');
      if (fs.existsSync(configPath)) {
        try {
          const config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
          if (config.title) {
            projectSlug = config.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '')
              .slice(0, 50);
          }
        } catch (e) {
          // Ignore config errors
        }
      }

      // Filter out build outputs
      if (projectSlug && (!files || files.length === 0)) {
        const buildPatterns = [
          `${projectSlug}.docx`,
          `${projectSlug}_comments.docx`,
          `${projectSlug}-changes.docx`,
          'paper.docx',
          'paper_comments.docx',
          'paper-changes.docx',
        ];
        const excluded: string[] = [];
        docxFiles = docxFiles.filter(f => {
          const base = path.basename(f).toLowerCase();
          const isBuilt = buildPatterns.includes(base);
          if (isBuilt) excluded.push(f);
          return !isBuilt;
        });
        if (excluded.length > 0) {
          console.log(chalk.dim(`  Skipping build outputs: ${excluded.join(', ')}`));
          console.log();
        }
      }

      if (docxFiles.length === 0) {
        console.log(fmt.status('info', 'No .docx files to archive.'));
        return;
      }

      const projectTitle = projectSlug;

      // Create archive folder
      const archiveDir = path.resolve(options.dir || 'archive');
      if (!options.dryRun && !fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }

      console.log(fmt.header('Archive'));
      console.log();

      const moved: string[] = [];
      for (const file of docxFiles) {
        const stat = fs.statSync(file);
        const mtime = stat.mtime;
        const timestamp = mtime.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');

        // Determine reviewer name
        let reviewer: string | null = options.by || null;
        if (!reviewer && options.rename !== false) {
          try {
            const comments = await extractWordComments(file);
            const authors = [...new Set(comments.map(c => c.author).filter(a => a && a !== 'Unknown'))];
            if (authors.length === 1) {
              reviewer = authors[0].replace(/[^a-zA-Z0-9]/g, '-').replace(/^-|-$/g, '');
            }
          } catch (e) {
            // Ignore extraction errors
          }
        }

        // Generate new name
        let newName: string;
        if (options.rename === false) {
          newName = path.basename(file);
        } else {
          const base = path.basename(file, '.docx');
          if (/^\d{8}_\d{6}_/.test(base)) {
            newName = path.basename(file);
          } else {
            const namePart = projectTitle || base;
            if (reviewer) {
              newName = `${timestamp}_${reviewer}_${namePart}.docx`;
            } else {
              newName = `${timestamp}_${namePart}.docx`;
            }
          }
        }

        const destPath = path.join(archiveDir, newName);

        if (options.dryRun) {
          console.log(`  ${chalk.dim(file)} → ${chalk.cyan(path.join(options.dir || 'archive', newName))}`);
        } else {
          // Handle name collision
          let finalPath = destPath;
          let counter = 1;
          while (fs.existsSync(finalPath)) {
            const ext = path.extname(newName);
            const base = path.basename(newName, ext);
            finalPath = path.join(archiveDir, `${base}_${counter}${ext}`);
            counter++;
          }
          fs.renameSync(file, finalPath);
          console.log(`  ${chalk.dim(file)} → ${chalk.green(path.relative(process.cwd(), finalPath))}`);
        }
        moved.push(file);
      }

      console.log();
      if (options.dryRun) {
        console.log(fmt.status('info', `Would archive ${moved.length} file(s). Run without --dry-run to proceed.`));
      } else {
        console.log(fmt.status('success', `Archived ${moved.length} file(s) to ${options.dir || 'archive'}/`));
      }
    });

  // ==========================================================================
  // EXPORT command - Export project as distributable zip
  // ==========================================================================

  program
    .command('export')
    .description('Export project as distributable zip')
    .option('-o, --output <file>', 'Output filename')
    .option('--include-output', 'Include built PDF/DOCX files')
    .action(async (options: ExportOptions) => {
      const { default: AdmZip } = await import('adm-zip');
      const { build } = await import('../build.js');

      let config: Partial<BuildConfig> = {};
      try {
        config = loadBuildConfig('.') || {};
      } catch {
        // Not in a rev project, that's ok
      }

      // Build first if including output
      if (options.includeOutput) {
        console.log(chalk.dim('Building documents...'));
        await build('.', ['pdf', 'docx']);
      }

      const zip = new AdmZip();
      const projectName = config.title?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'project';
      const outputPath = options.output || `${projectName}-export.zip`;

      const exclude = ['node_modules', '.git', '.DS_Store', '*.zip'];

      const shouldInclude = (name: string): boolean => {
        if (!options.includeOutput && (name.endsWith('.pdf') || name.endsWith('.docx'))) {
          return false;
        }
        for (const pattern of exclude) {
          if (name === pattern || name.includes(pattern.replace('*', ''))) return false;
        }
        return true;
      };

      addDirToZip(zip, '.', shouldInclude);

      zip.writeZip(outputPath);
      console.log(fmt.status('success', `Exported: ${outputPath}`));
    });

  // ==========================================================================
  // CLEAN command - Remove generated files
  // ==========================================================================

  program
    .command('clean')
    .description('Remove generated files (paper.md, PDFs, DOCXs)')
    .option('-n, --dry-run', 'Show what would be deleted without deleting')
    .option('--all', 'Also remove backup and export zips')
    .action((options: CleanOptions) => {
      let config: Partial<BuildConfig> = {};
      try {
        config = loadBuildConfig('.') || {};
      } catch {
        // Not in a rev project, that's ok
      }

      const projectName = config.title?.toLowerCase().replace(/\s+/g, '-') || 'paper';

      // Files to clean
      const patterns = [
        'paper.md',
        '*.pdf',
        `${projectName}.docx`,
        `${projectName}.pdf`,
        `${projectName}.tex`,
        '.paper-*.md', // Temp build files
      ];

      if (options.all) {
        patterns.push('*.zip', 'backup-*.zip', '*-export.zip');
      }

      const toDelete: string[] = [];

      for (const pattern of patterns) {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
          const files = fs.readdirSync('.').filter(f => regex.test(f));
          toDelete.push(...files);
        } else if (fs.existsSync(pattern)) {
          toDelete.push(pattern);
        }
      }

      if (toDelete.length === 0) {
        console.log(chalk.dim('No generated files to clean.'));
        return;
      }

      console.log(fmt.header('Clean'));
      console.log();

      for (const file of toDelete) {
        if (options.dryRun) {
          console.log(chalk.dim(`  Would delete: ${file}`));
        } else {
          fs.unlinkSync(file);
          console.log(chalk.red(`  Deleted: ${file}`));
        }
      }

      console.log();
      if (options.dryRun) {
        console.log(chalk.dim(`Would delete ${toDelete.length} file(s). Run without --dry-run to delete.`));
      } else {
        console.log(fmt.status('success', `Cleaned ${toDelete.length} file(s)`));
      }
    });
}
