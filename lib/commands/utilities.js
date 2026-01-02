/**
 * Utility commands: help, completions, word-count, stats, search, backup, archive,
 * export, preview, watch, lint, grammar, annotate, apply, comment, clean, check,
 * open, spelling, upgrade, batch, install-cli-skill, uninstall-cli-skill
 *
 * Miscellaneous utility commands for project management.
 */

import {
  chalk,
  fs,
  path,
  fmt,
  findFiles,
  loadBuildConfig,
  getComments,
  setCommentStatus,
  countAnnotations,
  stripAnnotations,
  parseAnnotations,
  getUserName,
} from './context.js';

/**
 * Register utility commands with the program
 * @param {import('commander').Command} program
 * @param {object} [pkg] - Package.json object for version info
 */
export function register(program, pkg) {
  // ==========================================================================
  // HELP command - Comprehensive help
  // ==========================================================================

  program
    .command('help')
    .description('Show detailed help and workflow guide')
    .argument('[topic]', 'Help topic: workflow, syntax, commands')
    .action((topic) => {
      if (!topic || topic === 'all') {
        showFullHelp(pkg);
      } else if (topic === 'workflow') {
        showWorkflowHelp();
      } else if (topic === 'syntax') {
        showSyntaxHelp();
      } else if (topic === 'commands') {
        showCommandsHelp();
      } else {
        console.log(chalk.yellow(`Unknown topic: ${topic}`));
        console.log(chalk.dim('Available topics: workflow, syntax, commands'));
      }
    });

  // ==========================================================================
  // COMPLETIONS command - Shell completions
  // ==========================================================================

  program
    .command('completions')
    .description('Output shell completions')
    .argument('<shell>', 'Shell type: bash, zsh, powershell')
    .action((shell) => {
      const completionsDir = path.join(import.meta.dirname, '..', '..', 'completions');

      if (shell === 'bash') {
        const bashFile = path.join(completionsDir, 'rev.bash');
        if (fs.existsSync(bashFile)) {
          console.log(fs.readFileSync(bashFile, 'utf-8'));
        } else {
          console.error(chalk.red('Bash completions not found'));
          process.exit(1);
        }
      } else if (shell === 'zsh') {
        const zshFile = path.join(completionsDir, 'rev.zsh');
        if (fs.existsSync(zshFile)) {
          console.log(fs.readFileSync(zshFile, 'utf-8'));
        } else {
          console.error(chalk.red('Zsh completions not found'));
          process.exit(1);
        }
      } else if (shell === 'powershell' || shell === 'pwsh') {
        const psFile = path.join(completionsDir, 'rev.ps1');
        if (fs.existsSync(psFile)) {
          console.log(fs.readFileSync(psFile, 'utf-8'));
        } else {
          console.error(chalk.red('PowerShell completions not found'));
          process.exit(1);
        }
      } else {
        console.error(chalk.red(`Unknown shell: ${shell}`));
        console.log(chalk.dim('Supported shells: bash, zsh, powershell'));
        process.exit(1);
      }
    });

  // ==========================================================================
  // WORD-COUNT command - Per-section word counts
  // ==========================================================================

  program
    .command('word-count')
    .alias('wc')
    .description('Show word counts per section')
    .option('-l, --limit <number>', 'Warn if total exceeds limit', parseInt)
    .option('-j, --journal <name>', 'Use journal word limit')
    .action(async (options) => {
      let config = {};
      try {
        config = loadBuildConfig() || {};
      } catch {
        // Not in a rev project, that's ok
      }
      const sections = config.sections || [];

      if (sections.length === 0) {
        // Try to find .md files
        const mdFiles = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f)
        );
        if (mdFiles.length === 0) {
          console.error(chalk.red('No section files found. Run from a rev project directory.'));
          process.exit(1);
        }
        sections.push(...mdFiles);
      }

      const countWords = (text) => {
        return text
          .replace(/^---[\s\S]*?---/m, '')
          .replace(/!\[.*?\]\(.*?\)/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/#+\s*/g, '')
          .replace(/\*\*|__|[*_`]/g, '')
          .replace(/```[\s\S]*?```/g, '')
          .replace(/\{[^}]+\}/g, '')
          .replace(/@\w+:\w+/g, '')
          .replace(/@\w+/g, '')
          .replace(/\|[^|]+\|/g, ' ')
          .replace(/\n+/g, ' ')
          .trim()
          .split(/\s+/)
          .filter(w => w.length > 0).length;
      };

      let total = 0;
      const rows = [];

      for (const section of sections) {
        if (!fs.existsSync(section)) continue;
        const text = fs.readFileSync(section, 'utf-8');
        const words = countWords(text);
        total += words;
        rows.push([section, words.toLocaleString()]);
      }

      rows.push(['', '']);
      rows.push([chalk.bold('Total'), chalk.bold(total.toLocaleString())]);

      console.log(fmt.header('Word Count'));
      console.log(fmt.table(['Section', 'Words'], rows));

      // Check limit
      let limit = options.limit;
      if (options.journal) {
        const { getJournalProfile } = await import('../journals.js');
        const profile = getJournalProfile(options.journal);
        if (profile?.requirements?.wordLimit?.main) {
          limit = profile.requirements.wordLimit.main;
          console.log(chalk.dim(`\nUsing ${profile.name} word limit: ${limit.toLocaleString()}`));
        }
      }

      if (limit && total > limit) {
        console.log(chalk.red(`\n⚠ Over limit by ${(total - limit).toLocaleString()} words`));
      } else if (limit) {
        console.log(chalk.green(`\n✓ Within limit (${(limit - total).toLocaleString()} words remaining)`));
      }
    });

  // ==========================================================================
  // STATS command - Project dashboard
  // ==========================================================================

  program
    .command('stats')
    .description('Show project statistics dashboard')
    .action(async () => {
      let config = {};
      try {
        config = loadBuildConfig() || {};
      } catch {
        // Not in a rev project, that's ok
      }
      let sections = config.sections || [];

      if (sections.length === 0) {
        sections = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f)
        );
      }

      const countWords = (text) => {
        return text
          .replace(/^---[\s\S]*?---/m, '')
          .replace(/!\[.*?\]\(.*?\)/g, '')
          .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
          .replace(/[#*_`]/g, '')
          .replace(/\{[^}]+\}/g, '')
          .replace(/@\w+/g, '')
          .replace(/\n+/g, ' ')
          .trim()
          .split(/\s+/)
          .filter(w => w.length > 0).length;
      };

      let totalWords = 0;
      let totalFigures = 0;
      let totalTables = 0;
      let totalComments = 0;
      let pendingComments = 0;
      const citations = new Set();

      for (const section of sections) {
        if (!fs.existsSync(section)) continue;
        const text = fs.readFileSync(section, 'utf-8');

        totalWords += countWords(text);
        totalFigures += (text.match(/!\[.*?\]\(.*?\)/g) || []).length;
        totalTables += (text.match(/^\|[^|]+\|/gm) || []).length / 5; // Approximate

        const comments = getComments(text);
        totalComments += comments.length;
        pendingComments += comments.filter(c => !c.resolved).length;

        const cites = text.match(/@(\w+)(?![:\w])/g) || [];
        cites.forEach(c => citations.add(c.slice(1)));
      }

      console.log(fmt.header('Project Statistics'));
      console.log();

      const stats = [
        ['Sections', sections.length],
        ['Words', totalWords.toLocaleString()],
        ['Figures', Math.round(totalFigures)],
        ['Tables', Math.round(totalTables)],
        ['Citations', citations.size],
        ['Comments', `${totalComments} (${pendingComments} pending)`],
      ];

      for (const [label, value] of stats) {
        console.log(`  ${chalk.dim(label.padEnd(12))} ${chalk.bold(value)}`);
      }

      // Bibliography stats
      const bibPath = config.bibliography || 'references.bib';
      if (fs.existsSync(bibPath)) {
        const bibContent = fs.readFileSync(bibPath, 'utf-8');
        const bibEntries = (bibContent.match(/@\w+\s*\{/g) || []).length;
        console.log(`  ${chalk.dim('Bib entries'.padEnd(12))} ${chalk.bold(bibEntries)}`);
      }

      console.log();
    });

  // ==========================================================================
  // SEARCH command - Search across section files
  // ==========================================================================

  program
    .command('search')
    .description('Search across all section files')
    .argument('<query>', 'Search query (supports regex)')
    .option('-i, --ignore-case', 'Case-insensitive search')
    .option('-c, --context <lines>', 'Show context lines', parseInt, 1)
    .action((query, options) => {
      let config = {};
      try {
        config = loadBuildConfig() || {};
      } catch {
        // Not in a rev project, that's ok
      }
      let sections = config.sections || [];

      if (sections.length === 0) {
        sections = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md'].includes(f)
        );
      }

      const flags = options.ignoreCase ? 'gi' : 'g';
      let pattern;
      try {
        pattern = new RegExp(query, flags);
      } catch {
        pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      }

      let totalMatches = 0;

      for (const section of sections) {
        if (!fs.existsSync(section)) continue;
        const text = fs.readFileSync(section, 'utf-8');
        const lines = text.split('\n');

        const matches = [];
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            matches.push({ line: i + 1, text: lines[i] });
            pattern.lastIndex = 0;
          }
        }

        if (matches.length > 0) {
          console.log(chalk.cyan.bold(`\n${section}`));
          for (const match of matches) {
            const highlighted = match.text.replace(pattern, (m) => chalk.yellow.bold(m));
            console.log(`  ${chalk.dim(match.line + ':')} ${highlighted}`);
          }
          totalMatches += matches.length;
        }
      }

      if (totalMatches === 0) {
        console.log(chalk.yellow(`No matches found for "${query}"`));
      } else {
        console.log(chalk.dim(`\n${totalMatches} match${totalMatches === 1 ? '' : 'es'} found`));
      }
    });

  // ==========================================================================
  // BACKUP command - Timestamped project backup
  // ==========================================================================

  program
    .command('backup')
    .description('Create timestamped project backup')
    .option('-n, --name <name>', 'Custom backup name')
    .option('-o, --output <dir>', 'Output directory', '.')
    .action(async (options) => {
      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip();

      const date = new Date().toISOString().slice(0, 10);
      const name = options.name || `backup-${date}`;
      const outputPath = path.join(options.output, `${name}.zip`);

      // Files to exclude
      const excludePatterns = [
        'node_modules', '.git', '.DS_Store', '*.zip',
        'paper.md' // Generated file
      ];

      const shouldInclude = (file) => {
        for (const pattern of excludePatterns) {
          if (file.includes(pattern.replace('*', ''))) return false;
        }
        return true;
      };

      const addDir = (dir, zipPath = '') => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const entryZipPath = path.join(zipPath, entry.name);

          if (!shouldInclude(entry.name)) continue;

          if (entry.isDirectory()) {
            addDir(fullPath, entryZipPath);
          } else {
            zip.addLocalFile(fullPath, zipPath || undefined);
          }
        }
      };

      // Add current directory
      const entries = fs.readdirSync('.', { withFileTypes: true });
      for (const entry of entries) {
        if (!shouldInclude(entry.name)) continue;

        if (entry.isDirectory()) {
          addDir(entry.name, entry.name);
        } else if (entry.isFile()) {
          zip.addLocalFile(entry.name);
        }
      }

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
    .action(async (files, options) => {
      const { extractWordComments } = await import('../import.js');
      const { default: YAML } = await import('yaml');

      // Find docx files to archive
      let docxFiles = files && files.length > 0
        ? files.filter(f => f.endsWith('.docx') && fs.existsSync(f))
        : findFiles('.docx');

      // Exclude our own build outputs
      let projectSlug = null;
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
      if (projectSlug && files.length === 0) {
        const buildPatterns = [
          `${projectSlug}.docx`,
          `${projectSlug}_comments.docx`,
          `${projectSlug}-changes.docx`,
          'paper.docx',
          'paper_comments.docx',
          'paper-changes.docx',
        ];
        const excluded = [];
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
      const archiveDir = path.resolve(options.dir);
      if (!options.dryRun && !fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }

      console.log(fmt.header('Archive'));
      console.log();

      const moved = [];
      for (const file of docxFiles) {
        const stat = fs.statSync(file);
        const mtime = stat.mtime;
        const timestamp = mtime.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '_');

        // Determine reviewer name
        let reviewer = options.by || null;
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
        let newName;
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
          console.log(`  ${chalk.dim(file)} → ${chalk.cyan(path.join(options.dir, newName))}`);
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
        console.log(fmt.status('success', `Archived ${moved.length} file(s) to ${options.dir}/`));
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
    .action(async (options) => {
      const { default: AdmZip } = await import('adm-zip');
      const { build } = await import('../build.js');

      let config = {};
      try {
        config = loadBuildConfig() || {};
      } catch {
        // Not in a rev project, that's ok
      }

      // Build first if including output
      if (options.includeOutput) {
        console.log(chalk.dim('Building documents...'));
        await build(['pdf', 'docx']);
      }

      const zip = new AdmZip();
      const projectName = config.title?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'project';
      const outputPath = options.output || `${projectName}-export.zip`;

      const exclude = ['node_modules', '.git', '.DS_Store', '*.zip'];

      const shouldInclude = (name) => {
        if (!options.includeOutput && (name.endsWith('.pdf') || name.endsWith('.docx'))) {
          return false;
        }
        for (const pattern of exclude) {
          if (name === pattern || name.includes(pattern.replace('*', ''))) return false;
        }
        return true;
      };

      const addDir = (dir, zipPath = '') => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const entryZipPath = path.join(zipPath, entry.name);

          if (!shouldInclude(entry.name)) continue;

          if (entry.isDirectory()) {
            addDir(fullPath, entryZipPath);
          } else {
            zip.addLocalFile(fullPath, zipPath || undefined);
          }
        }
      };

      const entries = fs.readdirSync('.', { withFileTypes: true });
      for (const entry of entries) {
        if (!shouldInclude(entry.name)) continue;

        if (entry.isDirectory()) {
          addDir(entry.name, entry.name);
        } else if (entry.isFile()) {
          zip.addLocalFile(entry.name);
        }
      }

      zip.writeZip(outputPath);
      console.log(fmt.status('success', `Exported: ${outputPath}`));
    });

  // ==========================================================================
  // PREVIEW command - Build and open document
  // ==========================================================================

  program
    .command('preview')
    .description('Build and open document in default app')
    .argument('[format]', 'Format to preview: pdf, docx', 'pdf')
    .action(async (format) => {
      const { exec } = await import('child_process');
      const { build } = await import('../build.js');

      let config = {};
      try {
        config = loadBuildConfig() || {};
      } catch (err) {
        console.error(chalk.red('Not in a rev project directory (no rev.yaml found)'));
        process.exit(1);
      }

      console.log(chalk.dim(`Building ${format}...`));
      const results = await build([format]);

      const result = results.find(r => r.format === format);
      if (!result?.success) {
        console.error(chalk.red(`Build failed: ${result?.error || 'Unknown error'}`));
        process.exit(1);
      }

      const outputFile = result.output;
      if (!fs.existsSync(outputFile)) {
        console.error(chalk.red(`Output file not found: ${outputFile}`));
        process.exit(1);
      }

      // Open with system default
      const openCmd = process.platform === 'darwin' ? 'open' :
                      process.platform === 'win32' ? 'start' : 'xdg-open';

      exec(`${openCmd} "${outputFile}"`, (err) => {
        if (err) {
          console.error(chalk.red(`Could not open file: ${err.message}`));
        } else {
          console.log(fmt.status('success', `Opened ${outputFile}`));
        }
      });
    });

  // ==========================================================================
  // WATCH command - Auto-rebuild on changes
  // ==========================================================================

  program
    .command('watch')
    .description('Watch files and auto-rebuild on changes')
    .argument('[format]', 'Format to build: pdf, docx, all', 'pdf')
    .option('--no-open', 'Do not open after first build')
    .action(async (format, options) => {
      const { exec } = await import('child_process');
      const { build } = await import('../build.js');

      let config = {};
      try {
        config = loadBuildConfig() || {};
      } catch (err) {
        console.error(chalk.red('Not in a rev project directory (no rev.yaml found)'));
        process.exit(1);
      }
      let sections = config.sections || [];

      if (sections.length === 0) {
        sections = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f)
        );
      }

      const filesToWatch = [
        ...sections,
        'rev.yaml',
        config.bibliography || 'references.bib'
      ].filter(f => fs.existsSync(f));

      console.log(fmt.header('Watch Mode'));
      console.log(chalk.dim(`Watching: ${filesToWatch.join(', ')}`));
      console.log(chalk.dim('Press Ctrl+C to stop\n'));

      let building = false;
      let pendingBuild = false;

      const doBuild = async () => {
        if (building) {
          pendingBuild = true;
          return;
        }

        building = true;
        console.log(chalk.dim(`\n[${new Date().toLocaleTimeString()}] Rebuilding...`));

        try {
          const formats = format === 'all' ? ['pdf', 'docx'] : [format];
          const results = await build(formats);

          for (const r of results) {
            if (r.success) {
              console.log(chalk.green(`  ✓ ${r.format}: ${r.output}`));
            } else {
              console.log(chalk.red(`  ✗ ${r.format}: ${r.error}`));
            }
          }
        } catch (err) {
          console.error(chalk.red(`  Build error: ${err.message}`));
        }

        building = false;
        if (pendingBuild) {
          pendingBuild = false;
          doBuild();
        }
      };

      // Initial build
      await doBuild();

      // Open after first build
      if (options.open) {
        const outputFile = format === 'docx' ?
          (config.title?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'paper') + '.docx' :
          (config.title?.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase() || 'paper') + '.pdf';

        if (fs.existsSync(outputFile)) {
          const openCmd = process.platform === 'darwin' ? 'open' :
                          process.platform === 'win32' ? 'start' : 'xdg-open';
          exec(`${openCmd} "${outputFile}"`);
        }
      }

      // Watch files
      for (const file of filesToWatch) {
        fs.watch(file, { persistent: true }, (eventType) => {
          if (eventType === 'change') {
            doBuild();
          }
        });
      }
    });

  // ==========================================================================
  // LINT command - Check for common issues
  // ==========================================================================

  program
    .command('lint')
    .description('Check for common issues in the project')
    .option('--fix', 'Auto-fix issues where possible')
    .action(async (options) => {
      let config = {};
      try {
        config = loadBuildConfig() || {};
      } catch {
        // Not in a rev project, that's ok
      }
      let sections = config.sections || [];

      if (sections.length === 0) {
        sections = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f)
        );
      }

      const issues = [];
      const warnings = [];

      // Collect all content
      let allText = '';
      for (const section of sections) {
        if (fs.existsSync(section)) {
          allText += fs.readFileSync(section, 'utf-8') + '\n';
        }
      }

      // Check 1: Broken cross-references
      const figAnchors = new Set();
      const tblAnchors = new Set();
      const eqAnchors = new Set();

      const anchorPattern = /\{#(fig|tbl|eq):([^}]+)\}/g;
      let match;
      while ((match = anchorPattern.exec(allText)) !== null) {
        if (match[1] === 'fig') figAnchors.add(match[2]);
        else if (match[1] === 'tbl') tblAnchors.add(match[2]);
        else if (match[1] === 'eq') eqAnchors.add(match[2]);
      }

      const refPattern = /@(fig|tbl|eq):([a-zA-Z0-9_-]+)/g;
      while ((match = refPattern.exec(allText)) !== null) {
        const type = match[1];
        const label = match[2];
        const anchors = type === 'fig' ? figAnchors : type === 'tbl' ? tblAnchors : eqAnchors;

        if (!anchors.has(label)) {
          issues.push({
            type: 'error',
            message: `Broken reference: @${type}:${label}`,
            fix: null
          });
        }
      }

      // Check 2: Orphaned figures
      for (const label of figAnchors) {
        if (!allText.includes(`@fig:${label}`)) {
          warnings.push({
            type: 'warning',
            message: `Unreferenced figure: {#fig:${label}}`,
          });
        }
      }

      // Check 3: Missing citations
      const bibPath = config.bibliography || 'references.bib';
      if (fs.existsSync(bibPath)) {
        const bibContent = fs.readFileSync(bibPath, 'utf-8');
        const bibKeys = new Set();
        const bibPattern = /@\w+\s*\{\s*([^,]+)/g;
        while ((match = bibPattern.exec(bibContent)) !== null) {
          bibKeys.add(match[1].trim());
        }

        const citePattern = /@([a-zA-Z][a-zA-Z0-9_-]*)(?![:\w])/g;
        while ((match = citePattern.exec(allText)) !== null) {
          const key = match[1];
          if (!bibKeys.has(key) && !['fig', 'tbl', 'eq'].includes(key)) {
            issues.push({
              type: 'error',
              message: `Missing citation: @${key}`,
            });
          }
        }
      }

      // Check 4: Unresolved comments
      const comments = getComments(allText);
      const pending = comments.filter(c => !c.resolved);
      if (pending.length > 0) {
        warnings.push({
          type: 'warning',
          message: `${pending.length} unresolved comment${pending.length === 1 ? '' : 's'}`,
        });
      }

      // Check 5: Empty sections
      for (const section of sections) {
        if (fs.existsSync(section)) {
          const content = fs.readFileSync(section, 'utf-8').trim();
          if (content.length < 50) {
            warnings.push({
              type: 'warning',
              message: `Section appears empty: ${section}`,
            });
          }
        }
      }

      // Output results
      console.log(fmt.header('Lint Results'));
      console.log();

      if (issues.length === 0 && warnings.length === 0) {
        console.log(chalk.green('✓ No issues found'));
        return;
      }

      for (const issue of issues) {
        console.log(chalk.red(`  ✗ ${issue.message}`));
      }

      for (const warning of warnings) {
        console.log(chalk.yellow(`  ⚠ ${warning.message}`));
      }

      console.log();
      console.log(chalk.dim(`${issues.length} error${issues.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`));

      if (issues.length > 0) {
        process.exit(1);
      }
    });

  // ==========================================================================
  // GRAMMAR command - Check grammar and style
  // ==========================================================================

  program
    .command('grammar')
    .description('Check grammar and style issues')
    .argument('[files...]', 'Markdown files to check')
    .option('--learn <word>', 'Add word to custom dictionary')
    .option('--forget <word>', 'Remove word from custom dictionary')
    .option('--list', 'List custom dictionary words')
    .option('--rules', 'List available grammar rules')
    .option('--no-scientific', 'Disable scientific writing rules')
    .option('-s, --severity <level>', 'Minimum severity: error, warning, info', 'info')
    .action(async (files, options) => {
      const {
        checkGrammar,
        getGrammarSummary,
        loadDictionary,
        addToDictionary,
        removeFromDictionary,
        listRules,
      } = await import('../grammar.js');

      // Handle dictionary management
      if (options.learn) {
        const added = addToDictionary(options.learn);
        if (added) {
          console.log(fmt.status('success', `Added "${options.learn}" to dictionary`));
        } else {
          console.log(chalk.dim(`"${options.learn}" already in dictionary`));
        }
        return;
      }

      if (options.forget) {
        const removed = removeFromDictionary(options.forget);
        if (removed) {
          console.log(fmt.status('success', `Removed "${options.forget}" from dictionary`));
        } else {
          console.log(chalk.yellow(`"${options.forget}" not in dictionary`));
        }
        return;
      }

      if (options.list) {
        const words = loadDictionary();
        console.log(fmt.header('Custom Dictionary'));
        console.log();
        if (words.size === 0) {
          console.log(chalk.dim('  No custom words defined'));
          console.log(chalk.dim('  Use --learn <word> to add words'));
        } else {
          const sorted = [...words].sort();
          for (const word of sorted) {
            console.log(`  ${word}`);
          }
          console.log();
          console.log(chalk.dim(`${words.size} word(s)`));
        }
        return;
      }

      if (options.rules) {
        const rules = listRules(options.scientific);
        console.log(fmt.header('Grammar Rules'));
        console.log();
        for (const rule of rules) {
          const icon = rule.severity === 'error' ? chalk.red('●') :
                       rule.severity === 'warning' ? chalk.yellow('●') :
                       chalk.blue('●');
          console.log(`  ${icon} ${chalk.bold(rule.id)}`);
          console.log(chalk.dim(`     ${rule.message}`));
        }
        return;
      }

      // Get files to check
      let mdFiles = files;
      if (!mdFiles || mdFiles.length === 0) {
        let config = {};
        try {
          config = loadBuildConfig() || {};
        } catch {
          // Not in a rev project
        }
        mdFiles = config.sections || [];

        if (mdFiles.length === 0) {
          mdFiles = fs.readdirSync('.').filter(f =>
            f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f)
          );
        }
      }

      if (mdFiles.length === 0) {
        console.error(chalk.red('No markdown files found'));
        process.exit(1);
      }

      console.log(fmt.header('Grammar Check'));
      console.log();

      const severityLevels = { error: 3, warning: 2, info: 1 };
      const minSeverity = severityLevels[options.severity] || 1;

      let allIssues = [];

      for (const file of mdFiles) {
        if (!fs.existsSync(file)) continue;

        const text = fs.readFileSync(file, 'utf-8');
        const issues = checkGrammar(text, { scientific: options.scientific });

        // Filter by severity
        const filtered = issues.filter(i => severityLevels[i.severity] >= minSeverity);

        if (filtered.length > 0) {
          console.log(chalk.cyan.bold(file));

          for (const issue of filtered) {
            const icon = issue.severity === 'error' ? chalk.red('●') :
                         issue.severity === 'warning' ? chalk.yellow('●') :
                         chalk.blue('●');

            console.log(`  ${chalk.dim(`L${issue.line}:`)} ${icon} ${issue.message}`);
            console.log(chalk.dim(`      "${issue.match}" in: ${issue.context.slice(0, 60)}...`));
          }
          console.log();
          allIssues.push(...filtered.map(i => ({ ...i, file })));
        }
      }

      const summary = getGrammarSummary(allIssues);

      if (summary.total === 0) {
        console.log(chalk.green('✓ No issues found'));
      } else {
        console.log(chalk.dim(`Found ${summary.total} issue(s): ${summary.errors} errors, ${summary.warnings} warnings, ${summary.info} info`));
        console.log();
        console.log(chalk.dim('Tip: Use --learn <word> to add words to dictionary'));
      }
    });

  // ==========================================================================
  // ANNOTATE command - Add comments to Word document
  // ==========================================================================

  program
    .command('annotate')
    .description('Add comment to Word document')
    .argument('<docx>', 'Word document')
    .option('-m, --message <text>', 'Comment text')
    .option('-s, --search <text>', 'Text to attach comment to')
    .option('-a, --author <name>', 'Comment author')
    .action(async (docxPath, options) => {
      if (!fs.existsSync(docxPath)) {
        console.error(chalk.red(`File not found: ${docxPath}`));
        process.exit(1);
      }

      if (!options.message) {
        console.error(chalk.red('Comment message required (-m)'));
        process.exit(1);
      }

      const { default: AdmZip } = await import('adm-zip');
      const zip = new AdmZip(docxPath);

      // Read document.xml
      const docEntry = zip.getEntry('word/document.xml');
      if (!docEntry) {
        console.error(chalk.red('Invalid Word document'));
        process.exit(1);
      }

      let docXml = zip.readAsText(docEntry);

      // Read or create comments.xml
      let commentsEntry = zip.getEntry('word/comments.xml');
      let commentsXml;
      let nextCommentId = 1;

      if (commentsEntry) {
        commentsXml = zip.readAsText(commentsEntry);
        const idMatches = commentsXml.match(/w:id="(\d+)"/g) || [];
        for (const m of idMatches) {
          const id = parseInt(m.match(/\d+/)[0]);
          if (id >= nextCommentId) nextCommentId = id + 1;
        }
      } else {
        commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
</w:comments>`;
      }

      const author = options.author || getUserName() || 'Claude';
      const date = new Date().toISOString();
      const commentId = nextCommentId;

      // Add comment to comments.xml
      const newComment = `<w:comment w:id="${commentId}" w:author="${author}" w:date="${date}">
  <w:p><w:r><w:t>${options.message}</w:t></w:r></w:p>
</w:comment>`;

      commentsXml = commentsXml.replace('</w:comments>', `${newComment}\n</w:comments>`);

      // Find text and add comment markers
      if (options.search) {
        const searchText = options.search;
        const textPattern = new RegExp(`(<w:t[^>]*>)([^<]*${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*)(<\/w:t>)`, 'i');

        if (textPattern.test(docXml)) {
          docXml = docXml.replace(textPattern, (match, start, text, end) => {
            return `<w:commentRangeStart w:id="${commentId}"/>${start}${text}${end}<w:commentRangeEnd w:id="${commentId}"/><w:r><w:commentReference w:id="${commentId}"/></w:r>`;
          });
        } else {
          console.log(chalk.yellow(`Text "${searchText}" not found in document. Comment added without anchor.`));
        }
      }

      // Update zip
      zip.updateFile('word/document.xml', Buffer.from(docXml));

      if (commentsEntry) {
        zip.updateFile('word/comments.xml', Buffer.from(commentsXml));
      } else {
        zip.addFile('word/comments.xml', Buffer.from(commentsXml));

        // Update [Content_Types].xml
        const ctEntry = zip.getEntry('[Content_Types].xml');
        if (ctEntry) {
          let ctXml = zip.readAsText(ctEntry);
          if (!ctXml.includes('comments.xml')) {
            ctXml = ctXml.replace('</Types>',
              '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>\n</Types>');
            zip.updateFile('[Content_Types].xml', Buffer.from(ctXml));
          }
        }

        // Update document.xml.rels
        const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
        if (relsEntry) {
          let relsXml = zip.readAsText(relsEntry);
          if (!relsXml.includes('comments.xml')) {
            const newRelId = `rId${Date.now()}`;
            relsXml = relsXml.replace('</Relationships>',
              `<Relationship Id="${newRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>\n</Relationships>`);
            zip.updateFile('word/_rels/document.xml.rels', Buffer.from(relsXml));
          }
        }
      }

      // Write back
      zip.writeZip(docxPath);
      console.log(fmt.status('success', `Added comment to ${docxPath}`));
    });

  // ==========================================================================
  // APPLY command - Apply MD annotations as Word track changes
  // ==========================================================================

  program
    .command('apply')
    .description('Apply markdown annotations to Word document as track changes')
    .argument('<md>', 'Markdown file with annotations')
    .argument('<docx>', 'Output Word document')
    .option('-a, --author <name>', 'Author name for track changes')
    .action(async (mdPath, docxPath, options) => {
      if (!fs.existsSync(mdPath)) {
        console.error(chalk.red(`File not found: ${mdPath}`));
        process.exit(1);
      }

      const mdContent = fs.readFileSync(mdPath, 'utf-8');
      const annotations = parseAnnotations(mdContent);

      if (annotations.length === 0) {
        console.log(chalk.yellow('No annotations found in markdown file'));
      }

      const author = options.author || getUserName() || 'Author';

      // Build document with track changes
      const { buildWithTrackChanges } = await import('../trackchanges.js');

      try {
        const result = await buildWithTrackChanges(mdPath, docxPath, { author });

        if (result.success) {
          console.log(fmt.status('success', result.message));
          console.log(chalk.dim(`  ${annotations.length} annotations applied as track changes`));
        } else {
          console.error(chalk.red(result.message));
          process.exit(1);
        }
      } catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // ==========================================================================
  // COMMENT command - Interactive comment addition to DOCX
  // ==========================================================================

  program
    .command('comment')
    .description('Add comments to Word document interactively')
    .argument('<docx>', 'Word document')
    .option('-a, --author <name>', 'Comment author')
    .action(async (docxPath, options) => {
      if (!fs.existsSync(docxPath)) {
        console.error(chalk.red(`File not found: ${docxPath}`));
        process.exit(1);
      }

      const { default: AdmZip } = await import('adm-zip');
      const rl = (await import('readline')).createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const ask = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

      const author = options.author || getUserName() || 'Reviewer';

      console.log(fmt.header('Interactive Comment Mode'));
      console.log(chalk.dim(`  Document: ${docxPath}`));
      console.log(chalk.dim(`  Author: ${author}`));
      console.log(chalk.dim('  Type your comment, then the text to attach it to.'));
      console.log(chalk.dim('  Enter empty comment to quit.\n'));

      let commentsAdded = 0;

      while (true) {
        const message = await ask(chalk.cyan('Comment: '));

        if (!message.trim()) {
          break;
        }

        const searchText = await ask(chalk.cyan('Attach to text: '));

        // Load document fresh each time
        const zip = new AdmZip(docxPath);
        const docEntry = zip.getEntry('word/document.xml');

        if (!docEntry) {
          console.error(chalk.red('Invalid Word document'));
          rl.close();
          process.exit(1);
        }

        let docXml = zip.readAsText(docEntry);

        // Read or create comments.xml
        let commentsEntry = zip.getEntry('word/comments.xml');
        let commentsXml;
        let nextCommentId = 1;

        if (commentsEntry) {
          commentsXml = zip.readAsText(commentsEntry);
          const idMatches = commentsXml.match(/w:id="(\d+)"/g) || [];
          for (const m of idMatches) {
            const id = parseInt(m.match(/\d+/)[0]);
            if (id >= nextCommentId) nextCommentId = id + 1;
          }
        } else {
          commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
</w:comments>`;
        }

        const date = new Date().toISOString();
        const commentId = nextCommentId;

        // Add comment to comments.xml
        const newComment = `<w:comment w:id="${commentId}" w:author="${author}" w:date="${date}">
  <w:p><w:r><w:t>${message}</w:t></w:r></w:p>
</w:comment>`;

        commentsXml = commentsXml.replace('</w:comments>', `${newComment}\n</w:comments>`);

        // Find text and add comment markers
        if (searchText.trim()) {
          const escapedSearch = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const textPattern = new RegExp(`(<w:t[^>]*>)([^<]*${escapedSearch}[^<]*)(<\/w:t>)`, 'i');

          if (textPattern.test(docXml)) {
            docXml = docXml.replace(textPattern, (match, start, text, end) => {
              return `<w:commentRangeStart w:id="${commentId}"/>${start}${text}${end}<w:commentRangeEnd w:id="${commentId}"/><w:r><w:commentReference w:id="${commentId}"/></w:r>`;
            });
            console.log(chalk.green(`  ✓ Comment added at "${searchText}"`));
          } else {
            console.log(chalk.yellow(`  Text not found. Comment added without anchor.`));
          }
        } else {
          console.log(chalk.dim(`  Comment added without anchor.`));
        }

        // Update zip
        zip.updateFile('word/document.xml', Buffer.from(docXml));

        if (commentsEntry) {
          zip.updateFile('word/comments.xml', Buffer.from(commentsXml));
        } else {
          zip.addFile('word/comments.xml', Buffer.from(commentsXml));

          // Update [Content_Types].xml
          const ctEntry = zip.getEntry('[Content_Types].xml');
          if (ctEntry) {
            let ctXml = zip.readAsText(ctEntry);
            if (!ctXml.includes('comments.xml')) {
              ctXml = ctXml.replace('</Types>',
                '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>\n</Types>');
              zip.updateFile('[Content_Types].xml', Buffer.from(ctXml));
            }
          }

          // Update document.xml.rels
          const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
          if (relsEntry) {
            let relsXml = zip.readAsText(relsEntry);
            if (!relsXml.includes('comments.xml')) {
              const newRelId = `rId${Date.now()}`;
              relsXml = relsXml.replace('</Relationships>',
                `<Relationship Id="${newRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>\n</Relationships>`);
              zip.updateFile('word/_rels/document.xml.rels', Buffer.from(relsXml));
            }
          }
        }

        zip.writeZip(docxPath);
        commentsAdded++;
        console.log();
      }

      rl.close();
      console.log();

      if (commentsAdded > 0) {
        console.log(fmt.status('success', `Added ${commentsAdded} comment(s) to ${docxPath}`));
      } else {
        console.log(chalk.dim('No comments added.'));
      }
    });

  // ==========================================================================
  // CLEAN command - Remove generated files
  // ==========================================================================

  program
    .command('clean')
    .description('Remove generated files (paper.md, PDFs, DOCXs)')
    .option('-n, --dry-run', 'Show what would be deleted without deleting')
    .option('--all', 'Also remove backup and export zips')
    .action((options) => {
      let config = {};
      try {
        config = loadBuildConfig() || {};
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

      const toDelete = [];

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

  // ==========================================================================
  // CHECK command - Pre-submission check
  // ==========================================================================

  program
    .command('check')
    .description('Run all checks before submission (lint + grammar + citations)')
    .option('--fix', 'Auto-fix issues where possible')
    .option('-s, --severity <level>', 'Minimum grammar severity', 'warning')
    .action(async (options) => {
      const { validateCitations } = await import('../citations.js');
      const { checkGrammar, getGrammarSummary } = await import('../grammar.js');

      console.log(fmt.header('Pre-Submission Check'));
      console.log();

      let hasErrors = false;
      let totalIssues = 0;

      // 1. Run lint
      console.log(chalk.cyan.bold('1. Linting...'));
      let config = {};
      try {
        config = loadBuildConfig() || {};
      } catch {
        // Not in a rev project
      }

      let sections = config.sections || [];
      if (sections.length === 0) {
        sections = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f)
        );
      }

      const lintIssues = [];
      const lintWarnings = [];

      for (const file of sections) {
        if (!fs.existsSync(file)) continue;
        const content = fs.readFileSync(file, 'utf-8');

        // Check for broken cross-references
        const refs = content.match(/@(fig|tbl|eq|sec):\w+/g) || [];
        const anchors = content.match(/\{#(fig|tbl|eq|sec):[^}]+\}/g) || [];
        const anchorLabels = anchors.map(a => a.match(/#([^}]+)/)[1]);

        for (const ref of refs) {
          const label = ref.slice(1);
          if (!anchorLabels.includes(label)) {
            lintIssues.push({ file, message: `Broken reference: ${ref}` });
          }
        }

        // Check for unresolved comments
        const unresolvedComments = (content.match(/\{>>[^<]*<<\}/g) || [])
          .filter(c => !c.includes('[RESOLVED]'));
        if (unresolvedComments.length > 0) {
          lintWarnings.push({ file, message: `${unresolvedComments.length} unresolved comment(s)` });
        }
      }

      if (lintIssues.length > 0) {
        for (const issue of lintIssues) {
          console.log(chalk.red(`   ✗ ${issue.file}: ${issue.message}`));
        }
        hasErrors = true;
        totalIssues += lintIssues.length;
      }
      for (const warning of lintWarnings) {
        console.log(chalk.yellow(`   ⚠ ${warning.file}: ${warning.message}`));
        totalIssues++;
      }
      if (lintIssues.length === 0 && lintWarnings.length === 0) {
        console.log(chalk.green('   ✓ No lint issues'));
      }
      console.log();

      // 2. Run grammar check
      console.log(chalk.cyan.bold('2. Grammar check...'));

      const severityLevels = { error: 3, warning: 2, info: 1 };
      const minSeverity = severityLevels[options.severity] || 2;
      let grammarIssues = [];

      for (const file of sections) {
        if (!fs.existsSync(file)) continue;
        const text = fs.readFileSync(file, 'utf-8');
        const issues = checkGrammar(text, { scientific: true });
        const filtered = issues.filter(i => severityLevels[i.severity] >= minSeverity);
        grammarIssues.push(...filtered.map(i => ({ ...i, file })));
      }

      const grammarSummary = getGrammarSummary(grammarIssues);
      if (grammarSummary.errors > 0) {
        hasErrors = true;
      }
      totalIssues += grammarSummary.total;

      if (grammarSummary.total > 0) {
        console.log(chalk.yellow(`   ⚠ ${grammarSummary.total} grammar issue(s): ${grammarSummary.errors} errors, ${grammarSummary.warnings} warnings`));
      } else {
        console.log(chalk.green('   ✓ No grammar issues'));
      }
      console.log();

      // 3. Run citation check
      console.log(chalk.cyan.bold('3. Citation check...'));
      const bibFile = config.bibliography || 'references.bib';
      if (fs.existsSync(bibFile)) {
        const allContent = sections
          .filter(f => fs.existsSync(f))
          .map(f => fs.readFileSync(f, 'utf-8'))
          .join('\n');
        const bibContent = fs.readFileSync(bibFile, 'utf-8');

        const result = validateCitations(allContent, bibContent);

        if (result.missing.length > 0) {
          console.log(chalk.red(`   ✗ ${result.missing.length} missing citation(s): ${result.missing.slice(0, 3).join(', ')}${result.missing.length > 3 ? '...' : ''}`));
          hasErrors = true;
          totalIssues += result.missing.length;
        }
        if (result.unused.length > 0) {
          console.log(chalk.yellow(`   ⚠ ${result.unused.length} unused citation(s)`));
          totalIssues += result.unused.length;
        }
        if (result.missing.length === 0 && result.unused.length === 0) {
          console.log(chalk.green('   ✓ All citations valid'));
        }
      } else {
        console.log(chalk.dim('   - No bibliography file found'));
      }
      console.log();

      // Summary
      console.log(chalk.bold('Summary'));
      if (hasErrors) {
        console.log(chalk.red(`   ${totalIssues} issue(s) found. Please fix before submission.`));
        process.exit(1);
      } else if (totalIssues > 0) {
        console.log(chalk.yellow(`   ${totalIssues} warning(s). Review before submission.`));
      } else {
        console.log(chalk.green('   ✓ All checks passed! Ready for submission.'));
      }
    });

  // ==========================================================================
  // OPEN command - Open project folder or file
  // ==========================================================================

  program
    .command('open')
    .description('Open project folder or file in default app')
    .argument('[file]', 'File to open (default: project folder)')
    .action(async (file) => {
      const { exec } = await import('child_process');
      const target = file || '.';

      if (!fs.existsSync(target)) {
        console.error(chalk.red(`File not found: ${target}`));
        process.exit(1);
      }

      const platform = process.platform;
      let command;

      if (platform === 'darwin') {
        command = `open "${target}"`;
      } else if (platform === 'win32') {
        command = `start "" "${target}"`;
      } else {
        command = `xdg-open "${target}"`;
      }

      exec(command, (err) => {
        if (err) {
          console.error(chalk.red(`Failed to open: ${err.message}`));
          process.exit(1);
        }
        console.log(fmt.status('success', `Opened ${target}`));
      });
    });

  // ==========================================================================
  // INSTALL-CLI-SKILL command - Install Claude Code skill
  // ==========================================================================

  program
    .command('install-cli-skill')
    .description('Install docrev skill for Claude Code')
    .action(() => {
      const homedir = process.env.HOME || process.env.USERPROFILE;
      const skillDir = path.join(homedir, '.claude', 'skills', 'docrev');
      const sourceDir = path.join(import.meta.dirname, '..', '..', 'skill');

      // Check if source skill files exist
      const skillFile = path.join(sourceDir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) {
        console.error(chalk.red('Skill files not found in package'));
        process.exit(1);
      }

      // Create skill directory
      fs.mkdirSync(skillDir, { recursive: true });

      // Copy skill files
      const files = ['SKILL.md', 'REFERENCE.md'];
      for (const file of files) {
        const src = path.join(sourceDir, file);
        const dest = path.join(skillDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }

      console.log(fmt.status('success', 'Installed docrev skill for Claude Code'));
      console.log(chalk.dim(`  Location: ${skillDir}`));
      console.log(chalk.dim('  Restart Claude Code to activate'));
    });

  program
    .command('uninstall-cli-skill')
    .description('Remove docrev skill from Claude Code')
    .action(() => {
      const homedir = process.env.HOME || process.env.USERPROFILE;
      const skillDir = path.join(homedir, '.claude', 'skills', 'docrev');

      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true });
        console.log(fmt.status('success', 'Removed docrev skill from Claude Code'));
      } else {
        console.log(chalk.yellow('Skill not installed'));
      }
    });

  // ==========================================================================
  // SPELLING command - Spellcheck with global dictionary
  // ==========================================================================

  program
    .command('spelling')
    .description('Check spelling in markdown files')
    .argument('[files...]', 'Files to check (default: section files)')
    .option('--learn <word>', 'Add word to global dictionary')
    .option('--learn-project <word>', 'Add word to project dictionary')
    .option('--forget <word>', 'Remove word from global dictionary')
    .option('--forget-project <word>', 'Remove word from project dictionary')
    .option('--list', 'List global dictionary words')
    .option('--list-project', 'List project dictionary words')
    .option('--list-all', 'List all custom words (global + project)')
    .option('--british', 'Use British English dictionary')
    .option('--add-names', 'Add detected names to global dictionary')
    .action(async (files, options) => {
      const spelling = await import('../spelling.js');

      // Handle dictionary management
      if (options.learn) {
        const added = spelling.addWord(options.learn, true);
        if (added) {
          console.log(fmt.status('success', `Added "${options.learn}" to global dictionary`));
        } else {
          console.log(chalk.yellow(`"${options.learn}" already in dictionary`));
        }
        return;
      }

      if (options.learnProject) {
        const added = spelling.addWord(options.learnProject, false);
        if (added) {
          console.log(fmt.status('success', `Added "${options.learnProject}" to project dictionary`));
        } else {
          console.log(chalk.yellow(`"${options.learnProject}" already in dictionary`));
        }
        return;
      }

      if (options.forget) {
        const removed = spelling.removeWord(options.forget, true);
        if (removed) {
          console.log(fmt.status('success', `Removed "${options.forget}" from global dictionary`));
        } else {
          console.log(chalk.yellow(`"${options.forget}" not in dictionary`));
        }
        return;
      }

      if (options.forgetProject) {
        const removed = spelling.removeWord(options.forgetProject, false);
        if (removed) {
          console.log(fmt.status('success', `Removed "${options.forgetProject}" from project dictionary`));
        } else {
          console.log(chalk.yellow(`"${options.forgetProject}" not in dictionary`));
        }
        return;
      }

      if (options.list) {
        const words = spelling.listWords(true);
        console.log(fmt.header('Global Dictionary'));
        if (words.length === 0) {
          console.log(chalk.dim('  No custom words'));
          console.log(chalk.dim('  Use --learn <word> to add words'));
        } else {
          for (const word of words) {
            console.log(`  ${word}`);
          }
          console.log(chalk.dim(`\n${words.length} word(s)`));
        }
        return;
      }

      if (options.listProject) {
        const words = spelling.listWords(false);
        console.log(fmt.header('Project Dictionary'));
        if (words.length === 0) {
          console.log(chalk.dim('  No custom words'));
          console.log(chalk.dim('  Use --learn-project <word> to add words'));
        } else {
          for (const word of words) {
            console.log(`  ${word}`);
          }
          console.log(chalk.dim(`\n${words.length} word(s)`));
        }
        return;
      }

      if (options.listAll) {
        const globalWords = spelling.listWords(true);
        const projectWords = spelling.listWords(false);

        console.log(fmt.header('Global Dictionary'));
        if (globalWords.length === 0) {
          console.log(chalk.dim('  No custom words'));
        } else {
          for (const word of globalWords) {
            console.log(`  ${word}`);
          }
        }

        console.log(fmt.header('Project Dictionary'));
        if (projectWords.length === 0) {
          console.log(chalk.dim('  No custom words'));
        } else {
          for (const word of projectWords) {
            console.log(`  ${word}`);
          }
        }

        console.log(chalk.dim(`\nTotal: ${globalWords.length + projectWords.length} word(s)`));
        return;
      }

      // Check spelling in files
      let filesToCheck = files;

      if (filesToCheck.length === 0) {
        if (fs.existsSync('rev.yaml')) {
          const { getSectionFiles } = await import('../sections.js');
          filesToCheck = getSectionFiles('.');
        } else {
          filesToCheck = fs.readdirSync('.')
            .filter(f => f.endsWith('.md') && !f.startsWith('.'));
        }
      }

      if (filesToCheck.length === 0) {
        console.log(chalk.yellow('No markdown files found'));
        return;
      }

      const lang = options.british ? 'en-gb' : 'en';
      console.log(fmt.header(`Spelling Check (${options.british ? 'British' : 'US'} English)`));
      let totalMisspelled = 0;
      const allNames = new Set();

      for (const file of filesToCheck) {
        if (!fs.existsSync(file)) {
          console.log(chalk.yellow(`File not found: ${file}`));
          continue;
        }

        const result = await spelling.checkFile(file, { projectDir: '.', lang });
        const { misspelled, possibleNames } = result;

        // Collect names
        for (const n of possibleNames) {
          allNames.add(n.word);
        }

        if (misspelled.length > 0) {
          console.log(chalk.cyan(`\n${file}:`));
          for (const issue of misspelled) {
            const suggestions = issue.suggestions.length > 0
              ? chalk.dim(` → ${issue.suggestions.join(', ')}`)
              : '';
            console.log(`  ${chalk.yellow(issue.word)} ${chalk.dim(`(line ${issue.line})`)}${suggestions}`);
          }
          totalMisspelled += misspelled.length;
        }
      }

      // Show possible names separately
      if (allNames.size > 0) {
        const nameList = [...allNames].sort();

        if (options.addNames) {
          console.log(fmt.header('Adding Names to Dictionary'));
          for (const name of nameList) {
            spelling.addWord(name, true);
            console.log(chalk.green(`  ✓ ${name}`));
          }
          console.log(chalk.dim(`\nAdded ${nameList.length} name(s) to global dictionary`));
        } else {
          console.log(fmt.header('Possible Names'));
          console.log(chalk.dim(`  ${nameList.join(', ')}`));
          console.log(chalk.dim(`\n  Run with --add-names to add all to dictionary`));
        }
      }

      if (totalMisspelled === 0 && allNames.size === 0) {
        console.log(fmt.status('success', 'No spelling errors found'));
      } else {
        if (totalMisspelled > 0) {
          console.log(chalk.yellow(`\n${totalMisspelled} spelling error(s)`));
        }
        if (allNames.size > 0) {
          console.log(chalk.blue(`${allNames.size} possible name(s)`));
        }
        console.log(chalk.dim('Use --learn <word> to add words to dictionary'));
      }
    });

  // ==========================================================================
  // UPGRADE command - Self-update via npm
  // ==========================================================================

  program
    .command('upgrade')
    .description('Check for updates and upgrade docrev')
    .option('--check', 'Only check for updates, do not install')
    .action(async (options) => {
      const { execSync, spawn } = await import('child_process');

      console.log(chalk.cyan('Checking for updates...'));

      try {
        // Get current version
        const currentVersion = pkg?.version || 'unknown';

        // Get latest version from npm
        let latestVersion;
        try {
          latestVersion = execSync('npm view docrev version', { encoding: 'utf-8' }).trim();
        } catch {
          console.error(chalk.red('Failed to check npm registry'));
          console.error(chalk.dim('Check your internet connection'));
          process.exit(1);
        }

        if (currentVersion === latestVersion) {
          console.log(fmt.status('success', `Already on latest version (${currentVersion})`));
          return;
        }

        console.log(`  Current: ${chalk.yellow(currentVersion)}`);
        console.log(`  Latest:  ${chalk.green(latestVersion)}`);
        console.log();

        if (options.check) {
          console.log(chalk.cyan('Run "rev upgrade" to install the update'));
          return;
        }

        console.log(chalk.cyan('Upgrading...'));

        // Run npm update
        const child = spawn('npm', ['install', '-g', 'docrev@latest'], {
          stdio: 'inherit',
          shell: true,
        });

        child.on('close', (code) => {
          if (code === 0) {
            console.log();
            console.log(fmt.status('success', `Upgraded to ${latestVersion}`));
          } else {
            console.error(chalk.red('Upgrade failed'));
            console.error(chalk.dim('Try running: npm install -g docrev@latest'));
            process.exit(1);
          }
        });

        child.on('error', (err) => {
          console.error(chalk.red(`Upgrade failed: ${err.message}`));
          console.error(chalk.dim('Try running: npm install -g docrev@latest'));
          process.exit(1);
        });
      } catch (err) {
        console.error(chalk.red(`Error: ${err.message}`));
        process.exit(1);
      }
    });

  // ==========================================================================
  // BATCH command - Run operations on multiple documents
  // ==========================================================================

  program
    .command('batch')
    .description('Run operations on multiple documents')
    .argument('<command>', 'Command to run (status, strip, resolve)')
    .argument('[pattern]', 'File pattern (default: *.md)')
    .option('--parallel', 'Run operations in parallel')
    .option('--dry-run', 'Preview files without running')
    .option('-a, --all', 'Include all .md files (not just sections)')
    .action(async (command, pattern, options) => {
      const validCommands = ['status', 'strip', 'resolve', 'comments'];

      if (!validCommands.includes(command)) {
        console.error(fmt.status('error', `Unknown batch command: ${command}`));
        console.error(chalk.dim(`Available: ${validCommands.join(', ')}`));
        process.exit(1);
      }

      // Find files
      let files = [];
      if (pattern) {
        if (pattern.includes('*')) {
          files = fs.readdirSync('.').filter(f =>
            f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f)
          );
        } else {
          files = [pattern];
        }
      } else {
        files = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') &&
          (options.all || !['README.md', 'CLAUDE.md', 'paper.md'].includes(f))
        );
      }

      if (files.length === 0) {
        console.error(fmt.status('error', 'No files found'));
        process.exit(1);
      }

      console.log(fmt.header(`Batch ${command} on ${files.length} file(s)`));
      console.log();

      if (options.dryRun) {
        console.log(chalk.dim('Dry run - files that would be processed:'));
        for (const file of files) {
          console.log(chalk.dim(`  ${file}`));
        }
        return;
      }

      // Process files
      const results = [];
      const progressBar = fmt.progressBar(files.length, 'Processing');
      progressBar.update(0);

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        progressBar.update(i + 1);

        if (!fs.existsSync(file)) {
          results.push({ file, status: 'not found' });
          continue;
        }

        try {
          const text = fs.readFileSync(file, 'utf-8');
          let result = { file, status: 'ok' };

          switch (command) {
            case 'status': {
              const counts = countAnnotations(text);
              const comments = getComments(text);
              result.annotations = counts.total;
              result.comments = comments.length;
              result.pending = comments.filter(c => !c.resolved).length;
              break;
            }

            case 'comments': {
              const comments = getComments(text);
              result.total = comments.length;
              result.pending = comments.filter(c => !c.resolved).length;
              result.resolved = comments.filter(c => c.resolved).length;
              break;
            }

            case 'resolve': {
              const comments = getComments(text);
              const pending = comments.filter(c => !c.resolved);
              if (pending.length > 0) {
                let newText = text;
                for (const c of pending) {
                  newText = setCommentStatus(newText, c, true);
                }
                fs.writeFileSync(file, newText, 'utf-8');
                result.resolved = pending.length;
              } else {
                result.resolved = 0;
              }
              break;
            }

            case 'strip': {
              const clean = stripAnnotations(text, { keepComments: false });
              const hasChanges = clean !== text;
              if (hasChanges) {
                fs.writeFileSync(file, clean, 'utf-8');
                result.stripped = true;
              } else {
                result.stripped = false;
              }
              break;
            }
          }

          results.push(result);
        } catch (err) {
          results.push({ file, status: 'error', error: err.message });
        }
      }

      progressBar.done();
      console.log();

      // Show results
      console.log(fmt.header('Results'));
      console.log();

      for (const r of results) {
        const statusIcon = r.status === 'ok'
          ? chalk.green('✓')
          : r.status === 'error'
            ? chalk.red('✗')
            : chalk.yellow('?');

        let details = '';
        switch (command) {
          case 'status':
            details = chalk.dim(`${r.annotations || 0} annotations, ${r.pending || 0} pending comments`);
            break;
          case 'comments':
            details = chalk.dim(`${r.total || 0} total, ${r.pending || 0} pending`);
            break;
          case 'resolve':
            details = r.resolved > 0
              ? chalk.green(`${r.resolved} resolved`)
              : chalk.dim('no pending');
            break;
          case 'strip':
            details = r.stripped
              ? chalk.green('cleaned')
              : chalk.dim('no changes');
            break;
        }

        console.log(`  ${statusIcon} ${r.file} ${details}`);
        if (r.error) {
          console.log(chalk.red(`    ${r.error}`));
        }
      }

      // Summary
      console.log();
      const successful = results.filter(r => r.status === 'ok').length;
      const failed = results.filter(r => r.status === 'error').length;
      console.log(chalk.dim(`${successful} succeeded, ${failed} failed`));
    });
}

// Helper functions for help text

function showFullHelp(pkg) {
  console.log(`
${chalk.bold.cyan('rev')} ${chalk.dim(`v${pkg?.version || 'unknown'}`)} - Revision workflow for Word ↔ Markdown round-trips

${chalk.bold('DESCRIPTION')}
  Handle reviewer feedback when collaborating on academic papers.
  Import changes from Word, review them interactively, and preserve
  comments for discussion with Claude.

${chalk.bold('GLOBAL OPTIONS')}

  ${chalk.bold('--no-color')}               Disable colored output
  ${chalk.bold('-q, --quiet')}              Suppress non-essential output
  ${chalk.bold('--json')}                   Output in JSON format (for scripting)

${chalk.bold('TYPICAL WORKFLOW')}

  ${chalk.dim('1.')} Build and send: ${chalk.green('rev build docx')} ${chalk.dim('(or rev b docx)')}
  ${chalk.dim('2.')} Reviewers return ${chalk.yellow('reviewed.docx')} with edits and comments
  ${chalk.dim('3.')} Sync their feedback: ${chalk.green('rev sync reviewed.docx')}
  ${chalk.dim('4.')} Work through comments: ${chalk.green('rev next')} ${chalk.dim('(n)')} / ${chalk.green('rev todo')} ${chalk.dim('(t)')}
  ${chalk.dim('5.')} Accept/reject changes: ${chalk.green('rev accept -a')} ${chalk.dim('(a)')} or ${chalk.green('rev review')}
  ${chalk.dim('6.')} Rebuild: ${chalk.green('rev build docx')}
  ${chalk.dim('7.')} Archive old files: ${chalk.green('rev archive')}

${chalk.bold('MORE HELP')}

  rev help workflow    Detailed workflow guide
  rev help syntax      Annotation syntax reference
  rev help commands    All commands with options
`);
}

function showWorkflowHelp() {
  console.log(`
${chalk.bold.cyan('rev')} ${chalk.dim('- Workflow Guide')}

${chalk.bold('OVERVIEW')}

  The rev workflow solves a common problem: you write in Markdown,
  but collaborators review in Word. When they return edited documents,
  you need to merge their changes back into your source files.

${chalk.bold('STEP 1: BUILD & SEND')}

  ${chalk.green('rev build docx')}
  ${chalk.dim('# Send the .docx to reviewers')}

${chalk.bold('STEP 2: RECEIVE FEEDBACK')}

  Reviewers edit the document, adding:
  ${chalk.dim('•')} Track changes (insertions, deletions)
  ${chalk.dim('•')} Comments (questions, suggestions)

${chalk.bold('STEP 3: SYNC CHANGES')}

  ${chalk.green('rev sync reviewed.docx')}
  ${chalk.dim('# Or just: rev sync (auto-detects most recent .docx)')}

  Your markdown files now contain their feedback as annotations.

${chalk.bold('STEP 4: WORK THROUGH COMMENTS')}

  ${chalk.green('rev todo')}              ${chalk.dim('# See all pending comments')}
  ${chalk.green('rev next')}              ${chalk.dim('# Show next pending comment')}
  ${chalk.green('rev reply file.md -n 1 -m "Done"')}
  ${chalk.green('rev resolve file.md -n 1')}

${chalk.bold('STEP 5: ACCEPT/REJECT CHANGES')}

  ${chalk.green('rev accept file.md -a')} ${chalk.dim('# Accept all changes')}
  ${chalk.green('rev reject file.md -n 2')} ${chalk.dim('# Reject specific change')}
  ${chalk.dim('# Or use interactive mode:')}
  ${chalk.green('rev review file.md')}

${chalk.bold('STEP 6: REBUILD')}

  ${chalk.green('rev build docx')}
  ${chalk.green('rev build docx --dual')} ${chalk.dim('# Clean + comments version')}

${chalk.bold('STEP 7: ARCHIVE & REPEAT')}

  ${chalk.green('rev archive')}           ${chalk.dim('# Move reviewer files to archive/')}
  ${chalk.dim('# Send new .docx, repeat cycle')}
`);
}

function showSyntaxHelp() {
  console.log(`
${chalk.bold.cyan('rev')} ${chalk.dim('- Annotation Syntax (CriticMarkup)')}

${chalk.bold('INSERTIONS')}

  Syntax:  ${chalk.green('{++inserted text++}')}
  Meaning: This text was added by the reviewer

  Example:
    We ${chalk.green('{++specifically++}')} focused on neophytes.
    → Reviewer added the word "specifically"

${chalk.bold('DELETIONS')}

  Syntax:  ${chalk.red('{--deleted text--}')}
  Meaning: This text was removed by the reviewer

  Example:
    We focused on ${chalk.red('{--recent--}')} neophytes.
    → Reviewer removed the word "recent"

${chalk.bold('SUBSTITUTIONS')}

  Syntax:  ${chalk.yellow('{~~old text~>new text~~}')}
  Meaning: Text was changed from old to new

  Example:
    The effect was ${chalk.yellow('{~~significant~>substantial~~}')}.
    → Reviewer changed "significant" to "substantial"

${chalk.bold('COMMENTS')}

  Syntax:  ${chalk.blue('{>>Author: comment text<<}')}
  Meaning: Reviewer left a comment at this location

  Example:
    The results were significant. ${chalk.blue('{>>Dr. Smith: Add p-value<<}')}
    → Dr. Smith commented asking for a p-value

  Comments are placed ${chalk.bold('after')} the text they reference.
`);
}

function showCommandsHelp() {
  console.log(`
${chalk.bold.cyan('rev')} ${chalk.dim('- Command Reference')}

${chalk.bold('rev import')} <docx> <original-md>

  Import changes from a Word document by comparing against your
  original Markdown source.

  ${chalk.bold('Arguments:')}
    docx          Word document from reviewer
    original-md   Your original Markdown file

  ${chalk.bold('Options:')}
    -o, --output <file>   Write to different file (default: overwrites original)
    -a, --author <name>   Author name for changes (default: "Reviewer")
    --dry-run             Preview changes without saving

${chalk.bold('rev review')} <file>

  Interactively review and accept/reject track changes.
  Comments are preserved; only track changes are processed.

  ${chalk.bold('Keys:')}
    a   Accept this change
    r   Reject this change
    s   Skip (decide later)
    A   Accept all remaining changes
    L   Reject all remaining changes
    q   Quit without saving

${chalk.bold('rev strip')} <file>

  Remove annotations, outputting clean Markdown.
  Track changes are applied (insertions kept, deletions removed).

  ${chalk.bold('Options:')}
    -o, --output <file>   Write to file (default: stdout)
    -c, --keep-comments   Keep comment annotations

${chalk.bold('rev help')} [topic]

  Show help. Optional topics:
    workflow    Step-by-step workflow guide
    syntax      Annotation syntax reference
    commands    This command reference
`);
}
