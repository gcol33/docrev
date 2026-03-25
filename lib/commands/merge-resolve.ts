/**
 * MERGE, CONFLICTS, and MERGE-RESOLVE commands
 *
 * Commands for three-way merge of reviewer feedback and conflict resolution.
 * Split from sections.ts for maintainability.
 */

import {
  chalk,
  fs,
  path,
  fmt,
} from './context.js';
import type { Command } from 'commander';
import * as readline from 'readline';

interface MergeOptions {
  base?: string;
  output?: string;
  names?: string;
  strategy: string;
  diffLevel: 'sentence' | 'word';
  dryRun?: boolean;
  sections?: boolean;
}

/**
 * Register merge, conflicts, and merge-resolve commands with the program
 */
export function register(program: Command): void {
  // ==========================================================================
  // MERGE command - Combine feedback from multiple reviewers (three-way merge)
  // ==========================================================================

  program
    .command('merge')
    .description('Merge feedback from multiple Word documents using three-way merge')
    .argument('<docx...>', 'Word documents from reviewers')
    .option('-b, --base <file>', 'Base document (original sent to reviewers). Auto-detected if not specified.')
    .option('-o, --output <file>', 'Output file (default: writes to section files)')
    .option('--names <names>', 'Reviewer names (comma-separated, in order of docx files)')
    .option('--strategy <strategy>', 'Conflict resolution: first, latest, or interactive (default)', 'interactive')
    .option('--diff-level <level>', 'Diff granularity: sentence or word (default: sentence)', 'sentence')
    .option('--dry-run', 'Show conflicts without writing')
    .option('--sections', 'Split merged output back to section files')
    .action(async (docxFiles: string[], options: MergeOptions) => {
      const {
        mergeThreeWay,
        formatConflict,
        resolveConflict,
        getBaseDocument,
        checkBaseMatch,
        saveConflicts,
      } = await import('../merge.js');

      // Validate reviewer files exist
      for (const docx of docxFiles) {
        if (!fs.existsSync(docx)) {
          console.error(fmt.status('error', `Reviewer file not found: ${docx}`));
          process.exit(1);
        }
      }

      // Determine base document
      let basePath = options.base;
      let baseSource = 'specified';

      if (!basePath) {
        // Try to use .rev/base.docx
        const projectDir = process.cwd();
        basePath = getBaseDocument(projectDir) ?? undefined;

        if (basePath) {
          baseSource = 'auto (.rev/base.docx)';
        } else {
          console.log(chalk.yellow('\n  No base document found in .rev/base.docx'));
          console.log(chalk.dim('  Tip: Run "rev build docx" to automatically save the base document.\n'));
          console.error(fmt.status('error', 'Base document required. Use --base <file.docx>'));
          process.exit(1);
        }
      }

      if (!fs.existsSync(basePath)) {
        console.error(fmt.status('error', `Base document not found: ${basePath}`));
        process.exit(1);
      }

      // Check similarity between base and reviewer docs
      const { matches, similarity } = await checkBaseMatch(basePath, docxFiles[0]);
      if (!matches) {
        console.log(chalk.yellow(`\n  Warning: Base document may not match reviewer file (${Math.round(similarity * 100)}% similar)`));
        console.log(chalk.dim('  If this is wrong, use --base to specify the correct original document.\n'));
      }

      // Parse reviewer names
      const names = options.names
        ? options.names.split(',').map(n => n.trim())
        : docxFiles.map((f, i) => {
          // Try to extract name from filename (e.g., paper_reviewer_A.docx)
          const basename = path.basename(f, '.docx');
          const match = basename.match(/_([A-Za-z]+)$/);
          return match ? match[1] : `Reviewer ${i + 1}`;
        });

      // Pad names if needed
      while (names.length < docxFiles.length) {
        names.push(`Reviewer ${names.length + 1}`);
      }

      const reviewerDocs = docxFiles.map((p, i) => ({
        path: p,
        name: names[i],
      }));

      console.log(fmt.header('Three-Way Merge'));
      console.log();
      console.log(chalk.dim(`  Base: ${path.basename(basePath)} (${baseSource})`));
      console.log(chalk.dim(`  Reviewers: ${names.join(', ')}`));
      console.log(chalk.dim(`  Diff level: ${options.diffLevel}`));
      console.log();

      const spin = fmt.spinner('Analyzing changes...').start();

      try {
        const { merged, conflicts, stats, baseText } = await mergeThreeWay(basePath, reviewerDocs, {
          diffLevel: options.diffLevel,
        });

        spin.stop();

        // Display stats
        console.log(fmt.table(['Metric', 'Count'], [
          ['Total changes', stats.totalChanges.toString()],
          ['Non-conflicting', stats.nonConflicting.toString()],
          ['Conflicts', stats.conflicts.toString()],
          ['Comments', stats.comments.toString()],
        ]));
        console.log();

        let finalMerged = merged;

        // Handle conflicts
        if (conflicts.length > 0) {
          console.log(chalk.yellow(`Found ${conflicts.length} conflict(s):\n`));

          if (options.strategy === 'first') {
            // Auto-resolve: take first reviewer's change
            for (const conflict of conflicts) {
              console.log(chalk.dim(`  Conflict ${conflict.id}: using ${conflict.changes[0].reviewer}'s change`));
              resolveConflict(conflict, 0);
            }
          } else if (options.strategy === 'latest') {
            // Auto-resolve: take last reviewer's change
            for (const conflict of conflicts) {
              const lastIdx = conflict.changes.length - 1;
              console.log(chalk.dim(`  Conflict ${conflict.id}: using ${conflict.changes[lastIdx].reviewer}'s change`));
              resolveConflict(conflict, lastIdx);
            }
          } else if (!options.dryRun) {
            // Interactive resolution
            for (let i = 0; i < conflicts.length; i++) {
              const conflict = conflicts[i];
              console.log(chalk.bold(`\nConflict ${i + 1}/${conflicts.length} (${conflict.id}):`));
              console.log(formatConflict(conflict, baseText));
              console.log();

              const rl = readline.createInterface({
                input: process.stdin,
                output: process.stdout,
              });

              const answer = await new Promise<string>((resolve) =>
                rl.question(chalk.cyan(`  Choose (1-${conflict.changes.length}, s=skip): `), resolve)
              );
              rl.close();

              if (answer.toLowerCase() !== 's' && !isNaN(parseInt(answer))) {
                const choice = parseInt(answer) - 1;
                if (choice >= 0 && choice < conflict.changes.length) {
                  resolveConflict(conflict, choice);
                  console.log(chalk.green(`  ✓ Applied: ${conflict.changes[choice].reviewer}'s change`));
                }
              } else {
                console.log(chalk.dim('  Skipped (will need manual resolution)'));
              }
            }
          }

          // Save unresolved conflicts for later
          const unresolved = conflicts.filter(c => c.resolved === null);
          if (unresolved.length > 0) {
            saveConflicts(process.cwd(), conflicts, basePath);
            console.log(chalk.yellow(`\n  ${unresolved.length} unresolved conflict(s) saved to .rev/conflicts.json`));
            console.log(chalk.dim('  Run "rev conflicts" to view, "rev merge-resolve" to resolve'));
          }
        }

        // Write output
        if (!options.dryRun) {
          if (options.output) {
            // Write to single file
            fs.writeFileSync(options.output, finalMerged, 'utf-8');
            console.log(fmt.status('success', `Merged output written to ${options.output}`));
          } else if (options.sections) {
            // Split to section files (TODO: implement section splitting)
            console.log(chalk.yellow('  Section splitting not yet implemented'));
            console.log(chalk.dim('  Use -o to specify output file'));
          } else {
            // Default: write to merged.md
            const outPath = 'merged.md';
            fs.writeFileSync(outPath, finalMerged, 'utf-8');
            console.log(fmt.status('success', `Merged output written to ${outPath}`));
          }

          console.log();
          console.log(chalk.dim('Next steps:'));
          console.log(chalk.dim('  1. rev review merged.md     - Accept/reject changes'));
          console.log(chalk.dim('  2. rev comments merged.md   - Address comments'));
          if (conflicts.some(c => c.resolved === null)) {
            console.log(chalk.dim('  3. rev merge-resolve        - Resolve remaining conflicts'));
          }
        } else {
          console.log(fmt.status('info', 'Dry run - no output written'));
        }
      } catch (err) {
        spin.stop();
        const error = err as Error;
        console.error(fmt.status('error', error.message));
        if (process.env.DEBUG) console.error(error.stack);
        process.exit(1);
      }
    });

  // ==========================================================================
  // CONFLICTS command - List unresolved conflicts
  // ==========================================================================

  program
    .command('conflicts')
    .description('List unresolved merge conflicts')
    .action(async () => {
      const { loadConflicts, formatConflict } = await import('../merge.js');
      const projectDir = process.cwd();
      const data = loadConflicts(projectDir);

      if (!data) {
        console.log(fmt.status('info', 'No conflicts file found'));
        return;
      }

      const unresolved = data.conflicts.filter((c: any) => c.resolved === null);

      if (unresolved.length === 0) {
        console.log(fmt.status('success', 'All conflicts resolved!'));
        return;
      }

      console.log(fmt.header(`Unresolved Conflicts (${unresolved.length})`));
      console.log();
      console.log(chalk.dim(`  Base: ${data.base}`));
      console.log(chalk.dim(`  Merged: ${data.merged}`));
      console.log();

      for (const conflict of unresolved) {
        console.log(chalk.bold(`Conflict ${conflict.id}:`));
        // Show abbreviated info
        console.log(chalk.dim(`  Original: "${conflict.original.slice(0, 50)}${conflict.original.length > 50 ? '...' : ''}"`));
        console.log(chalk.dim(`  Options: ${conflict.changes.map((c: any) => c.reviewer).join(', ')}`));
        console.log();
      }

      console.log(chalk.dim('Run "rev merge-resolve" to resolve conflicts interactively'));
    });

  // ==========================================================================
  // MERGE-RESOLVE command - Interactively resolve merge conflicts
  // ==========================================================================

  program
    .command('merge-resolve')
    .alias('mresolve')
    .description('Resolve merge conflicts interactively')
    .option('--theirs', 'Accept all changes from last reviewer')
    .option('--ours', 'Accept all changes from first reviewer')
    .action(async (options: { theirs?: boolean; ours?: boolean }) => {
      const { loadConflicts, saveConflicts, clearConflicts, resolveConflict, formatConflict } = await import('../merge.js');
      const projectDir = process.cwd();
      const data = loadConflicts(projectDir);

      if (!data) {
        console.log(fmt.status('info', 'No conflicts to resolve'));
        return;
      }

      const unresolved = data.conflicts.filter((c: any) => c.resolved === null);

      if (unresolved.length === 0) {
        console.log(fmt.status('success', 'All conflicts already resolved!'));
        clearConflicts(projectDir);
        return;
      }

      console.log(fmt.header(`Resolving ${unresolved.length} Conflict(s)`));
      console.log();

      if (options.theirs) {
        // Accept all from last reviewer
        for (const conflict of unresolved) {
          const lastIdx = conflict.changes.length - 1;
          resolveConflict(conflict, lastIdx);
          console.log(chalk.dim(`  ${conflict.id}: accepted ${conflict.changes[lastIdx].reviewer}'s change`));
        }
        saveConflicts(projectDir, data.conflicts, data.base);
        console.log(fmt.status('success', `Resolved ${unresolved.length} conflicts (--theirs)`));
      } else if (options.ours) {
        // Accept all from first reviewer
        for (const conflict of unresolved) {
          resolveConflict(conflict, 0);
          console.log(chalk.dim(`  ${conflict.id}: accepted ${conflict.changes[0].reviewer}'s change`));
        }
        saveConflicts(projectDir, data.conflicts, data.base);
        console.log(fmt.status('success', `Resolved ${unresolved.length} conflicts (--ours)`));
      } else {
        // Interactive resolution
        // Read base text for context display
        let baseText = '';
        try {
          const { extractFromWord } = await import('../import.js');
          const { text } = await extractFromWord(data.base);
          baseText = text;
        } catch {
          // Can't read base, show without context
        }

        for (let i = 0; i < unresolved.length; i++) {
          const conflict = unresolved[i];
          console.log(chalk.bold(`\nConflict ${i + 1}/${unresolved.length} (${conflict.id}):`));
          console.log(formatConflict(conflict, baseText));
          console.log();

          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const answer = await new Promise<string>((resolve) =>
            rl.question(chalk.cyan(`  Choose (1-${conflict.changes.length}, s=skip, q=quit): `), resolve)
          );
          rl.close();

          if (answer.toLowerCase() === 'q') {
            console.log(chalk.dim('\n  Saving progress...'));
            break;
          }

          if (answer.toLowerCase() !== 's' && !isNaN(parseInt(answer))) {
            const choice = parseInt(answer) - 1;
            if (choice >= 0 && choice < conflict.changes.length) {
              resolveConflict(conflict, choice);
              console.log(chalk.green(`  ✓ Applied: ${conflict.changes[choice].reviewer}'s change`));
            }
          } else {
            console.log(chalk.dim('  Skipped'));
          }
        }

        saveConflicts(projectDir, data.conflicts, data.base);

        const remaining = data.conflicts.filter((c: any) => c.resolved === null).length;
        if (remaining === 0) {
          console.log(fmt.status('success', '\nAll conflicts resolved!'));
          clearConflicts(projectDir);
        } else {
          console.log(chalk.yellow(`\n  ${remaining} conflict(s) remaining`));
        }
      }
    });
}
