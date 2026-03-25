/**
 * Preview commands: preview, watch
 *
 * Commands for building and viewing documents with live reload.
 */

import type { Command } from 'commander';
import {
  chalk,
  fs,
  path,
  fmt,
  loadBuildConfig,
} from './context.js';

// Use the actual BuildConfig from build.ts which allows string|Author[]
type BuildConfig = ReturnType<typeof loadBuildConfig>;

// Options interfaces
interface PreviewOptions {
  // No options currently
}

interface WatchOptions {
  open?: boolean;
}

/**
 * Register preview commands with the program
 */
export function register(program: Command): void {
  // ==========================================================================
  // PREVIEW command - Build and open document
  // ==========================================================================

  program
    .command('preview')
    .description('Build and open document in default app')
    .argument('[format]', 'Format to preview: pdf, docx', 'pdf')
    .action(async (format: string, _options: PreviewOptions) => {
      const { exec } = await import('child_process');
      const { build } = await import('../build.js');

      let config: Partial<BuildConfig> = {};
      try {
        config = loadBuildConfig('.') || {};
      } catch (err) {
        console.error(chalk.red('Not in a rev project directory (no rev.yaml found)'));
        process.exit(1);
      }

      console.log(chalk.dim(`Building ${format}...`));
      const result = await build('.', [format]);

      const buildResult = result.results.find(r => r.format === format);
      if (!buildResult?.success) {
        const errorMsg = buildResult?.error || 'Unknown error';
        console.error(chalk.red(`Build failed: ${errorMsg}`));
        process.exit(1);
      }

      const outputFile = buildResult.outputPath;
      if (!outputFile || !fs.existsSync(outputFile)) {
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
    .action(async (format: string, options: WatchOptions) => {
      const { exec } = await import('child_process');
      const { build } = await import('../build.js');

      let config: Partial<BuildConfig> = {};
      try {
        config = loadBuildConfig('.') || {};
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

      const doBuild = async (): Promise<void> => {
        if (building) {
          pendingBuild = true;
          return;
        }

        building = true;
        console.log(chalk.dim(`\n[${new Date().toLocaleTimeString()}] Rebuilding...`));

        try {
          const formats = format === 'all' ? ['pdf', 'docx'] : [format];
          const result = await build('.', formats);

          for (const r of result.results) {
            if (r.success) {
              console.log(chalk.green(`  ✓ ${r.format}: ${r.outputPath}`));
            } else {
              console.log(chalk.red(`  ✗ ${r.format}: ${r.error}`));
            }
          }
        } catch (err) {
          console.error(chalk.red(`  Build error: ${(err as Error).message}`));
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
}
