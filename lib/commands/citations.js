/**
 * Citation commands: citations, figures, equations, pdf-comments
 *
 * Commands for validating citations, managing figures/tables, and equation handling.
 */

import {
  chalk,
  fs,
  path,
  fmt,
} from './context.js';

/**
 * Register citation commands with the program
 * @param {import('commander').Command} program
 */
export function register(program) {
  // ==========================================================================
  // CITATIONS command - Validate citations against .bib file
  // ==========================================================================

  program
    .command('citations')
    .alias('cite')
    .description('Validate citations against bibliography')
    .argument('[files...]', 'Markdown files to check (default: all section files)')
    .option('-b, --bib <file>', 'Bibliography file', 'references.bib')
    .action(async (files, options) => {
      const { getCitationStats } = await import('../citations.js');

      // If no files specified, find all .md files
      let mdFiles = files;
      if (!mdFiles || mdFiles.length === 0) {
        mdFiles = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md'].includes(f)
        );
      }

      if (!fs.existsSync(options.bib)) {
        console.error(fmt.status('error', `Bibliography not found: ${options.bib}`));
        process.exit(1);
      }

      const stats = getCitationStats(mdFiles, options.bib);

      console.log(fmt.header('Citation Check'));
      console.log();

      // Summary table
      const rows = [
        ['Total citations', stats.totalCitations.toString()],
        ['Unique keys cited', stats.uniqueCited.toString()],
        ['Bib entries', stats.bibEntries.toString()],
        [chalk.green('Valid'), chalk.green(stats.valid.toString())],
        [stats.missing > 0 ? chalk.red('Missing') : 'Missing', stats.missing > 0 ? chalk.red(stats.missing.toString()) : '0'],
        [chalk.dim('Unused in bib'), chalk.dim(stats.unused.toString())],
      ];
      console.log(fmt.table(['Metric', 'Count'], rows));

      // Show missing keys
      if (stats.missingKeys.length > 0) {
        console.log();
        console.log(fmt.status('error', 'Missing citations:'));
        for (const key of stats.missingKeys) {
          console.log(chalk.red(`  - ${key}`));
        }
      }

      // Show unused (if verbose)
      if (stats.unusedKeys.length > 0 && stats.unusedKeys.length <= 10) {
        console.log();
        console.log(chalk.dim('Unused bib entries:'));
        for (const key of stats.unusedKeys.slice(0, 10)) {
          console.log(chalk.dim(`  - ${key}`));
        }
        if (stats.unusedKeys.length > 10) {
          console.log(chalk.dim(`  ... and ${stats.unusedKeys.length - 10} more`));
        }
      }

      console.log();
      if (stats.missing === 0) {
        console.log(fmt.status('success', 'All citations valid'));
      } else {
        console.log(fmt.status('warning', `${stats.missing} citation(s) missing from ${options.bib}`));
        process.exit(1);
      }
    });

  // ==========================================================================
  // FIGURES command - Figure/table inventory
  // ==========================================================================

  program
    .command('figures')
    .alias('figs')
    .description('List all figures and tables with reference counts')
    .argument('[files...]', 'Markdown files to scan')
    .action(async (files) => {
      const { buildRegistry } = await import('../crossref.js');

      // If no files specified, find all .md files
      let mdFiles = files;
      if (!mdFiles || mdFiles.length === 0) {
        mdFiles = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md'].includes(f)
        );
      }

      // Build registry
      const registry = buildRegistry('.');

      // Count references in files
      const refCounts = new Map();
      for (const file of mdFiles) {
        if (!fs.existsSync(file)) continue;
        const text = fs.readFileSync(file, 'utf-8');

        // Count @fig: and @tbl: references
        const figRefs = text.matchAll(/@fig:([a-zA-Z0-9_-]+)/g);
        for (const match of figRefs) {
          const key = `fig:${match[1]}`;
          refCounts.set(key, (refCounts.get(key) || 0) + 1);
        }

        const tblRefs = text.matchAll(/@tbl:([a-zA-Z0-9_-]+)/g);
        for (const match of tblRefs) {
          const key = `tbl:${match[1]}`;
          refCounts.set(key, (refCounts.get(key) || 0) + 1);
        }
      }

      console.log(fmt.header('Figure & Table Inventory'));
      console.log();

      // Figures
      if (registry.figures.size > 0) {
        const figRows = [...registry.figures.entries()].map(([label, info]) => {
          const key = `fig:${label}`;
          const refs = refCounts.get(key) || 0;
          const num = info.isSupp ? `S${info.num}` : info.num.toString();
          return [
            `Figure ${num}`,
            chalk.cyan(`@fig:${label}`),
            info.file,
            refs > 0 ? chalk.green(refs.toString()) : chalk.yellow('0'),
          ];
        });
        console.log(fmt.table(['#', 'Label', 'File', 'Refs'], figRows));
        console.log();
      }

      // Tables
      if (registry.tables.size > 0) {
        const tblRows = [...registry.tables.entries()].map(([label, info]) => {
          const key = `tbl:${label}`;
          const refs = refCounts.get(key) || 0;
          const num = info.isSupp ? `S${info.num}` : info.num.toString();
          return [
            `Table ${num}`,
            chalk.cyan(`@tbl:${label}`),
            info.file,
            refs > 0 ? chalk.green(refs.toString()) : chalk.yellow('0'),
          ];
        });
        console.log(fmt.table(['#', 'Label', 'File', 'Refs'], tblRows));
        console.log();
      }

      if (registry.figures.size === 0 && registry.tables.size === 0) {
        console.log(chalk.dim('No figures or tables found.'));
        console.log(chalk.dim('Add anchors like {#fig:label} to your figures.'));
      }

      // Warn about unreferenced
      const unreferenced = [];
      for (const [label] of registry.figures) {
        if (!refCounts.get(`fig:${label}`)) unreferenced.push(`@fig:${label}`);
      }
      for (const [label] of registry.tables) {
        if (!refCounts.get(`tbl:${label}`)) unreferenced.push(`@tbl:${label}`);
      }

      if (unreferenced.length > 0) {
        console.log(fmt.status('warning', `${unreferenced.length} unreferenced figure(s)/table(s)`));
      }
    });

  // ==========================================================================
  // EQUATIONS command - Extract and convert equations
  // ==========================================================================

  program
    .command('equations')
    .alias('eq')
    .description('Extract equations or convert to Word')
    .argument('<action>', 'Action: list, extract, convert, from-word')
    .argument('[input]', 'Input file (.md for extract/convert, .docx for from-word)')
    .option('-o, --output <file>', 'Output file')
    .action(async (action, input, options) => {
      const { extractEquations, getEquationStats, createEquationsDoc, extractEquationsFromWord, getWordEquationStats } = await import('../equations.js');

      if (action === 'from-word') {
        // Extract equations from Word document
        if (!input) {
          console.error(fmt.status('error', 'Word document required'));
          process.exit(1);
        }

        if (!input.endsWith('.docx')) {
          console.error(fmt.status('error', 'Input must be a .docx file'));
          process.exit(1);
        }

        const spin = fmt.spinner(`Extracting equations from ${path.basename(input)}...`).start();

        const result = await extractEquationsFromWord(input);

        if (!result.success) {
          spin.error(result.error);
          process.exit(1);
        }

        spin.stop();
        console.log(fmt.header('Equations from Word'));
        console.log();

        if (result.equations.length === 0) {
          console.log(chalk.dim('No equations found in document.'));
          return;
        }

        const display = result.equations.filter(e => e.type === 'display');
        const inline = result.equations.filter(e => e.type === 'inline');

        console.log(chalk.dim(`Found ${result.equations.length} equations (${display.length} display, ${inline.length} inline)`));
        console.log();

        // Show equations
        for (let i = 0; i < result.equations.length; i++) {
          const eq = result.equations[i];
          const typeLabel = eq.type === 'display' ? chalk.cyan('[display]') : chalk.yellow('[inline]');

          if (eq.latex) {
            console.log(`${chalk.bold(i + 1)}. ${typeLabel}`);
            console.log(chalk.dim('   LaTeX:'), eq.latex.length > 80 ? eq.latex.substring(0, 77) + '...' : eq.latex);
          } else {
            console.log(`${chalk.bold(i + 1)}. ${typeLabel} ${chalk.red('[conversion failed]')}`);
          }
        }

        // Optionally save to file
        if (options.output) {
          const latex = result.equations
            .filter(e => e.latex)
            .map((e, i) => `%% Equation ${i + 1} (${e.type})\n${e.type === 'display' ? '$$' : '$'}${e.latex}${e.type === 'display' ? '$$' : '$'}`)
            .join('\n\n');

          fs.writeFileSync(options.output, latex, 'utf-8');
          console.log();
          console.log(fmt.status('success', `Saved ${result.equations.filter(e => e.latex).length} equations to ${options.output}`));
        }

      } else if (action === 'list') {
        // List equations in all section files
        const mdFiles = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md'].includes(f)
        );

        const stats = getEquationStats(mdFiles);

        console.log(fmt.header('Equations'));
        console.log();

        if (stats.byFile.length === 0) {
          console.log(chalk.dim('No equations found.'));
          return;
        }

        const rows = stats.byFile.map(f => [
          f.file,
          f.display > 0 ? chalk.cyan(f.display.toString()) : chalk.dim('-'),
          f.inline > 0 ? chalk.yellow(f.inline.toString()) : chalk.dim('-'),
        ]);
        rows.push([
          chalk.bold('Total'),
          chalk.bold.cyan(stats.display.toString()),
          chalk.bold.yellow(stats.inline.toString()),
        ]);

        console.log(fmt.table(['File', 'Display', 'Inline'], rows));

      } else if (action === 'extract') {
        if (!input) {
          console.error(fmt.status('error', 'Input file required'));
          process.exit(1);
        }

        const output = options.output || input.replace('.md', '-equations.md');
        const result = await createEquationsDoc(input, output);

        if (result.success) {
          console.log(fmt.status('success', result.message));
          console.log(chalk.dim(`  ${result.stats.display} display, ${result.stats.inline} inline equations`));
        } else {
          console.error(fmt.status('error', result.message));
          process.exit(1);
        }

      } else if (action === 'convert') {
        if (!input) {
          console.error(fmt.status('error', 'Input file required'));
          process.exit(1);
        }

        const output = options.output || input.replace('.md', '.docx');

        const spin = fmt.spinner(`Converting ${path.basename(input)} to Word...`).start();

        try {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);

          await execAsync(`pandoc "${input}" -o "${output}" --mathml`);
          spin.success(`Created ${output}`);
        } catch (err) {
          spin.error(err.message);
          process.exit(1);
        }
      } else {
        console.error(fmt.status('error', `Unknown action: ${action}`));
        console.log(chalk.dim('Actions: list, extract, convert, from-word'));
        process.exit(1);
      }
    });

  // ==========================================================================
  // PDF-COMMENTS command - Extract comments from PDF
  // ==========================================================================

  program
    .command('pdf-comments')
    .alias('pdf')
    .description('Extract and manage comments from annotated PDFs')
    .argument('<pdf>', 'PDF file with annotations')
    .option('-a, --append <file>', 'Append comments to markdown file')
    .option('--json', 'Output as JSON')
    .option('--by-page', 'Group comments by page')
    .option('--by-author', 'Group comments by author')
    .option('--with-text', 'Extract highlighted text (slower but shows what was highlighted)')
    .action(async (pdf, options) => {
      if (!fs.existsSync(pdf)) {
        console.error(fmt.status('error', `File not found: ${pdf}`));
        process.exit(1);
      }

      if (!pdf.toLowerCase().endsWith('.pdf')) {
        console.error(fmt.status('error', 'File must be a PDF'));
        process.exit(1);
      }

      const {
        extractPdfComments,
        extractPdfAnnotationsWithText,
        formatPdfComments,
        getPdfCommentStats,
        insertPdfCommentsIntoMarkdown,
        formatAnnotationWithText,
      } = await import('../pdf-import.js');

      const spin = fmt.spinner(`Extracting comments from ${path.basename(pdf)}...`).start();

      try {
        let comments;

        if (options.withText) {
          // Use the new text extraction feature
          const annotations = await extractPdfAnnotationsWithText(pdf);
          spin.stop();

          if (annotations.length === 0) {
            console.log(fmt.status('info', 'No annotations found in PDF.'));
            return;
          }

          // Convert to comment format with highlighted text
          comments = annotations.map(a => ({
            author: a.author || 'Reviewer',
            text: a.highlightedText
              ? `"${a.highlightedText}"${a.contents ? ' → ' + a.contents : ''}`
              : a.contents,
            page: a.page,
            type: a.type,
            date: a.date,
            highlightedText: a.highlightedText,
          })).filter(c => c.text);
        } else {
          comments = await extractPdfComments(pdf);
          spin.stop();
        }

        if (comments.length === 0) {
          console.log(fmt.status('info', 'No comments found in PDF.'));
          return;
        }

        const stats = getPdfCommentStats(comments);

        // JSON output
        if (options.json) {
          console.log(JSON.stringify({ comments, stats }, null, 2));
          return;
        }

        // Append to markdown file
        if (options.append) {
          if (!fs.existsSync(options.append)) {
            console.error(fmt.status('error', `Markdown file not found: ${options.append}`));
            process.exit(1);
          }

          const markdown = fs.readFileSync(options.append, 'utf-8');
          const updated = insertPdfCommentsIntoMarkdown(markdown, comments);
          fs.writeFileSync(options.append, updated, 'utf-8');

          console.log(fmt.status('success', `Added ${comments.length} comments to ${options.append}`));
          return;
        }

        // Display comments
        console.log(fmt.header(`PDF Comments: ${path.basename(pdf)}`));
        console.log();

        if (options.byAuthor) {
          // Group by author
          const byAuthor = {};
          for (const c of comments) {
            const author = c.author || 'Unknown';
            if (!byAuthor[author]) byAuthor[author] = [];
            byAuthor[author].push(c);
          }

          for (const [author, authorComments] of Object.entries(byAuthor)) {
            console.log(chalk.bold(`${author} (${authorComments.length}):`));
            for (const c of authorComments) {
              if (c.highlightedText) {
                console.log(`  [p.${c.page}] ${chalk.yellow(`"${c.highlightedText}"`)}${c.text !== c.highlightedText ? ` → ${c.text.replace(`"${c.highlightedText}" → `, '')}` : ''}`);
              } else {
                console.log(`  [p.${c.page}] ${c.text}`);
              }
            }
            console.log();
          }
        } else {
          // Default: by page
          if (options.withText) {
            let currentPage = 0;
            for (const c of comments) {
              if (c.page !== currentPage) {
                if (currentPage > 0) console.log();
                console.log(`Page ${c.page}:`);
                currentPage = c.page;
              }
              if (c.highlightedText) {
                console.log(`  ${chalk.yellow(`"${c.highlightedText}"`)} → ${c.text.replace(`"${c.highlightedText}" → `, '')}`);
              } else {
                console.log(`  ${c.text}`);
              }
            }
            console.log();
          } else {
            console.log(formatPdfComments(comments));
            console.log();
          }
        }

        // Summary
        const authorList = Object.entries(stats.byAuthor)
          .map(([author, count]) => `${author} (${count})`)
          .join(', ');
        console.log(chalk.dim(`Total: ${stats.total} comments from ${authorList}`));
        console.log();
        if (!options.withText) {
          console.log(chalk.dim(`Tip: Use --with-text to extract the highlighted text content`));
        }
        console.log(chalk.dim(`Tip: Use --append <file.md> to add comments to your markdown`));

      } catch (err) {
        spin.stop();
        console.error(fmt.status('error', `Failed to extract PDF comments: ${err.message}`));
        if (process.env.DEBUG) console.error(err.stack);
        process.exit(1);
      }
    });
}
