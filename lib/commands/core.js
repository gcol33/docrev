/**
 * Core commands: review, strip, status
 *
 * Basic annotation operations for track changes workflow.
 */

import {
  chalk,
  fs,
  path,
  fmt,
  quietMode,
  jsonMode,
  jsonOutput,
  findFiles,
  parseAnnotations,
  stripAnnotations,
  countAnnotations,
  getComments,
  interactiveReview,
  exitWithError,
  getFileNotFoundSuggestions,
  requireFile,
} from './context.js';

/**
 * Register core commands with the program
 * @param {import('commander').Command} program
 */
export function register(program) {
  // ==========================================================================
  // REVIEW command - Interactive track change review
  // ==========================================================================

  program
    .command('review')
    .description('Interactively review and accept/reject track changes')
    .argument('<file>', 'Markdown file to review')
    .action(async (file) => {
      requireFile(file, 'Markdown file');

      const text = fs.readFileSync(file, 'utf-8');
      const result = await interactiveReview(text);

      if (result.accepted > 0 || result.rejected > 0) {
        // Confirm save
        const rl = await import('readline');
        const readline = rl.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        readline.question(chalk.cyan(`\nSave changes to ${file}? [y/N] `), (answer) => {
          readline.close();
          if (answer.toLowerCase() === 'y') {
            fs.writeFileSync(file, result.text, 'utf-8');
            console.log(chalk.green(`Saved ${file}`));
          } else {
            console.log(chalk.yellow('Changes not saved.'));
          }
        });
      }
    });

  // ==========================================================================
  // STRIP command - Remove annotations
  // ==========================================================================

  program
    .command('strip')
    .description('Strip annotations, outputting clean Markdown')
    .argument('<file>', 'Markdown file to strip')
    .option('-o, --output <file>', 'Output file (default: stdout)')
    .option('-c, --keep-comments', 'Keep comment annotations')
    .action((file, options) => {
      requireFile(file, 'Markdown file');

      const text = fs.readFileSync(file, 'utf-8');
      const clean = stripAnnotations(text, { keepComments: options.keepComments });

      if (options.output) {
        fs.writeFileSync(options.output, clean, 'utf-8');
        console.error(chalk.green(`Written to ${options.output}`));
      } else {
        process.stdout.write(clean);
      }
    });

  // ==========================================================================
  // STATUS command - Show annotation statistics
  // ==========================================================================

  program
    .command('status')
    .alias('s')
    .description('Show project overview or file annotation statistics')
    .argument('[file]', 'Markdown file to analyze (default: project overview)')
    .action(async (file) => {
      // If a specific file is given, show its annotations
      if (file) {
        if (!fs.existsSync(file)) {
          if (jsonMode) {
            jsonOutput({ error: `File not found: ${file}` });
          } else {
            exitWithError(`File not found: ${file}`, getFileNotFoundSuggestions(file));
          }
        }

        const text = fs.readFileSync(file, 'utf-8');
        const counts = countAnnotations(text);
        const comments = getComments(text);

        if (jsonMode) {
          jsonOutput({
            file: path.basename(file),
            annotations: counts,
            comments: comments.map(c => ({
              author: c.author || null,
              content: c.content,
              line: c.line,
              resolved: c.resolved || false,
            })),
          });
          return;
        }

        if (counts.total === 0) {
          console.log(fmt.status('success', 'No annotations found.'));
          return;
        }

        console.log(fmt.header(`Annotations in ${path.basename(file)}`));
        console.log();

        // Build stats table
        const rows = [];
        if (counts.inserts > 0) rows.push([chalk.green('+'), 'Insertions', chalk.green(counts.inserts)]);
        if (counts.deletes > 0) rows.push([chalk.red('-'), 'Deletions', chalk.red(counts.deletes)]);
        if (counts.substitutes > 0) rows.push([chalk.yellow('~'), 'Substitutions', chalk.yellow(counts.substitutes)]);
        if (counts.comments > 0) rows.push([chalk.blue('#'), 'Comments', chalk.blue(counts.comments)]);
        rows.push([chalk.dim('Σ'), chalk.dim('Total'), chalk.dim(counts.total)]);

        console.log(fmt.table(['', 'Type', 'Count'], rows, { align: ['center', 'left', 'right'] }));

        // List comments with authors in a table
        if (comments.length > 0) {
          console.log();
          console.log(fmt.header('Comments'));
          console.log();

          const commentRows = comments.map((c, i) => [
            chalk.dim(i + 1),
            c.author ? chalk.blue(c.author) : chalk.dim('Anonymous'),
            c.content.length > 45 ? c.content.slice(0, 45) + '...' : c.content,
            chalk.dim(`L${c.line}`),
          ]);

          console.log(fmt.table(['#', 'Author', 'Comment', 'Line'], commentRows, {
            align: ['right', 'left', 'left', 'right'],
          }));
        }
        return;
      }

      // Project overview mode
      // Find all markdown files
      const mdFiles = findFiles('.md');
      if (mdFiles.length === 0) {
        if (jsonMode) {
          jsonOutput({ error: 'No markdown files found', files: [] });
        } else {
          console.log(fmt.status('warning', 'No markdown files found in current directory.'));
        }
        return;
      }

      // Gather stats across all files
      let totalWords = 0;
      let totalComments = 0;
      let pendingComments = 0;
      let totalInserts = 0;
      let totalDeletes = 0;
      let totalSubstitutes = 0;
      const fileStats = [];

      for (const f of mdFiles) {
        const text = fs.readFileSync(f, 'utf-8');
        const counts = countAnnotations(text);
        const comments = getComments(text);
        const pending = comments.filter(c => !c.resolved).length;

        // Simple word count (excluding annotations)
        const stripped = stripAnnotations(text);
        const words = stripped.split(/\s+/).filter(w => w.length > 0).length;

        totalWords += words;
        totalComments += comments.length;
        pendingComments += pending;
        totalInserts += counts.inserts;
        totalDeletes += counts.deletes;
        totalSubstitutes += counts.substitutes;

        if (counts.total > 0 || words > 0) {
          fileStats.push({
            file: f,
            words,
            inserts: counts.inserts,
            deletes: counts.deletes,
            substitutions: counts.substitutes,
            comments: comments.length,
            pending,
          });
        }
      }

      // JSON output
      if (jsonMode) {
        const docxFiles = findFiles('.docx');
        const latestDocx = docxFiles.length > 0
          ? docxFiles
              .map(f => ({ name: f, mtime: fs.statSync(f).mtime }))
              .sort((a, b) => b.mtime - a.mtime)[0]
          : null;

        jsonOutput({
          summary: {
            words: totalWords,
            files: mdFiles.length,
            comments: totalComments,
            pendingComments,
            insertions: totalInserts,
            deletions: totalDeletes,
            substitutions: totalSubstitutes,
          },
          files: fileStats,
          latestDocx: latestDocx ? { name: latestDocx.name, mtime: latestDocx.mtime.toISOString() } : null,
        });
        return;
      }

      // Normal output
      console.log(fmt.header('Project Status'));
      console.log();

      // Summary
      console.log(`  ${chalk.bold(totalWords.toLocaleString())} words across ${mdFiles.length} files`);

      if (totalComments > 0) {
        console.log(`  ${chalk.blue(totalComments)} comments (${chalk.yellow(pendingComments)} pending)`);
      }

      const totalChanges = totalInserts + totalDeletes + totalSubstitutes;
      if (totalChanges > 0) {
        console.log(`  ${chalk.green(`+${totalInserts}`)} insertions, ${chalk.red(`-${totalDeletes}`)} deletions, ${chalk.yellow(`~${totalSubstitutes}`)} substitutions`);
      }

      // Per-file breakdown if there are annotations
      if (totalChanges > 0 || totalComments > 0) {
        console.log();
        const rows = fileStats
          .filter(f => f.inserts + f.deletes + f.substitutions + f.comments > 0)
          .map(f => [
            f.file,
            f.words.toLocaleString(),
            f.inserts > 0 ? chalk.green(`+${f.inserts}`) : chalk.dim('-'),
            f.deletes > 0 ? chalk.red(`-${f.deletes}`) : chalk.dim('-'),
            f.substitutions > 0 ? chalk.yellow(`~${f.substitutions}`) : chalk.dim('-'),
            f.pending > 0 ? chalk.yellow(f.pending) : (f.comments > 0 ? chalk.dim(f.comments) : chalk.dim('-')),
          ]);

        if (rows.length > 0) {
          console.log(fmt.table(
            ['File', 'Words', 'Ins', 'Del', 'Sub', 'Cmt'],
            rows,
            { align: ['left', 'right', 'right', 'right', 'right', 'right'] }
          ));
        }
      }

      // Check for recent docx files
      const docxFiles = findFiles('.docx');
      if (docxFiles.length > 0) {
        const sorted = docxFiles
          .map(f => ({ name: f, mtime: fs.statSync(f).mtime }))
          .sort((a, b) => b.mtime - a.mtime);
        const latest = sorted[0];
        const age = Date.now() - latest.mtime.getTime();
        const ageStr = age < 3600000 ? `${Math.round(age / 60000)}m ago` :
                       age < 86400000 ? `${Math.round(age / 3600000)}h ago` :
                       `${Math.round(age / 86400000)}d ago`;
        console.log();
        console.log(chalk.dim(`  Latest DOCX: ${latest.name} (${ageStr})`));
      }
    });
}
