#!/usr/bin/env node

/**
 * rev - Revision workflow for Word ↔ Markdown round-trips
 *
 * Handles track changes and comments when collaborating on academic papers.
 * Preserves reviewer feedback through the Markdown editing workflow.
 */

import { program } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import {
  parseAnnotations,
  stripAnnotations,
  countAnnotations,
  getComments,
} from '../lib/annotations.js';
import { interactiveReview, listComments } from '../lib/review.js';
import {
  generateConfig,
  loadConfig,
  saveConfig,
  matchHeading,
  extractSectionsFromText,
  splitAnnotatedPaper,
  getOrderedSections,
} from '../lib/sections.js';
import {
  buildRegistry,
  detectHardcodedRefs,
  convertHardcodedRefs,
  getRefStatus,
  formatRegistry,
} from '../lib/crossref.js';

program
  .name('rev')
  .description('Revision workflow for Word ↔ Markdown round-trips')
  .version('0.1.0');

// ============================================================================
// REVIEW command - Interactive track change review
// ============================================================================

program
  .command('review')
  .description('Interactively review and accept/reject track changes')
  .argument('<file>', 'Markdown file to review')
  .action(async (file) => {
    if (!fs.existsSync(file)) {
      console.error(chalk.red(`Error: File not found: ${file}`));
      process.exit(1);
    }

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

// ============================================================================
// STRIP command - Remove annotations
// ============================================================================

program
  .command('strip')
  .description('Strip annotations, outputting clean Markdown')
  .argument('<file>', 'Markdown file to strip')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .option('-c, --keep-comments', 'Keep comment annotations')
  .action((file, options) => {
    if (!fs.existsSync(file)) {
      console.error(chalk.red(`Error: File not found: ${file}`));
      process.exit(1);
    }

    const text = fs.readFileSync(file, 'utf-8');
    const clean = stripAnnotations(text, { keepComments: options.keepComments });

    if (options.output) {
      fs.writeFileSync(options.output, clean, 'utf-8');
      console.error(chalk.green(`Written to ${options.output}`));
    } else {
      process.stdout.write(clean);
    }
  });

// ============================================================================
// STATUS command - Show annotation statistics
// ============================================================================

program
  .command('status')
  .description('Show annotation statistics')
  .argument('<file>', 'Markdown file to analyze')
  .action((file) => {
    if (!fs.existsSync(file)) {
      console.error(chalk.red(`Error: File not found: ${file}`));
      process.exit(1);
    }

    const text = fs.readFileSync(file, 'utf-8');
    const counts = countAnnotations(text);

    if (counts.total === 0) {
      console.log(chalk.green('No annotations found.'));
      return;
    }

    console.log(chalk.cyan(`\nAnnotations in ${path.basename(file)}:\n`));

    if (counts.inserts > 0) {
      console.log(chalk.green(`  + Insertions:    ${counts.inserts}`));
    }
    if (counts.deletes > 0) {
      console.log(chalk.red(`  - Deletions:     ${counts.deletes}`));
    }
    if (counts.substitutes > 0) {
      console.log(chalk.yellow(`  ~ Substitutions: ${counts.substitutes}`));
    }
    if (counts.comments > 0) {
      console.log(chalk.blue(`  # Comments:      ${counts.comments}`));
    }

    console.log(chalk.dim(`\n  Total: ${counts.total}`));

    // List comments with authors
    const comments = getComments(text);
    if (comments.length > 0) {
      console.log(chalk.cyan('\nComments:'));
      for (const c of comments) {
        const author = c.author ? `[${c.author}]` : '';
        const preview = c.content.length > 50 ? c.content.slice(0, 50) + '...' : c.content;
        console.log(chalk.dim(`  Line ${c.line}:`) + ` ${author} ${preview}`);
      }
    }
  });

// ============================================================================
// COMMENTS command - List all comments
// ============================================================================

program
  .command('comments')
  .description('List all comments in the document')
  .argument('<file>', 'Markdown file')
  .action((file) => {
    if (!fs.existsSync(file)) {
      console.error(chalk.red(`Error: File not found: ${file}`));
      process.exit(1);
    }

    const text = fs.readFileSync(file, 'utf-8');
    listComments(text);
  });

// ============================================================================
// IMPORT command - Import from Word with diff against original
// ============================================================================

program
  .command('import')
  .description('Import changes from Word by comparing against original Markdown')
  .argument('<docx>', 'Word document from reviewer')
  .argument('<original>', 'Original Markdown file to compare against')
  .option('-o, --output <file>', 'Output file (default: overwrites original)')
  .option('-a, --author <name>', 'Author name for changes', 'Reviewer')
  .option('--dry-run', 'Show diff without saving')
  .action(async (docx, original, options) => {
    if (!fs.existsSync(docx)) {
      console.error(chalk.red(`Error: Word file not found: ${docx}`));
      process.exit(1);
    }
    if (!fs.existsSync(original)) {
      console.error(chalk.red(`Error: Original MD not found: ${original}`));
      process.exit(1);
    }

    console.log(chalk.cyan(`Comparing ${path.basename(docx)} against ${path.basename(original)}...`));

    try {
      const { importFromWord } = await import('../lib/import.js');
      const { annotated, stats } = await importFromWord(docx, original, {
        author: options.author,
      });

      // Show stats
      console.log(chalk.cyan('\nChanges detected:'));
      if (stats.insertions > 0) console.log(chalk.green(`  + Insertions:    ${stats.insertions}`));
      if (stats.deletions > 0) console.log(chalk.red(`  - Deletions:     ${stats.deletions}`));
      if (stats.substitutions > 0) console.log(chalk.yellow(`  ~ Substitutions: ${stats.substitutions}`));
      if (stats.comments > 0) console.log(chalk.blue(`  # Comments:      ${stats.comments}`));

      if (stats.total === 0) {
        console.log(chalk.green('\nNo changes detected.'));
        return;
      }

      console.log(chalk.dim(`\n  Total: ${stats.total}`));

      if (options.dryRun) {
        console.log(chalk.cyan('\n--- Preview (first 1000 chars) ---\n'));
        console.log(annotated.slice(0, 1000));
        if (annotated.length > 1000) console.log(chalk.dim('\n... (truncated)'));
        return;
      }

      // Save
      const outputPath = options.output || original;
      fs.writeFileSync(outputPath, annotated, 'utf-8');
      console.log(chalk.green(`\nSaved annotated version to ${outputPath}`));
      console.log(chalk.cyan('\nNext steps:'));
      console.log(`  1. ${chalk.bold('rev review ' + outputPath)}  - Accept/reject track changes`);
      console.log(`  2. Work with Claude to address comments`);
      console.log(`  3. ${chalk.bold('./build.sh docx')}  - Rebuild Word doc`);

    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

// ============================================================================
// EXTRACT command - Just extract text from Word (simple mode)
// ============================================================================

program
  .command('extract')
  .description('Extract plain text from Word document (no diff)')
  .argument('<docx>', 'Word document')
  .option('-o, --output <file>', 'Output file (default: stdout)')
  .action(async (docx, options) => {
    if (!fs.existsSync(docx)) {
      console.error(chalk.red(`Error: File not found: ${docx}`));
      process.exit(1);
    }

    try {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({ path: docx });

      if (options.output) {
        fs.writeFileSync(options.output, result.value, 'utf-8');
        console.error(chalk.green(`Extracted to ${options.output}`));
      } else {
        process.stdout.write(result.value);
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
  });

// ============================================================================
// INIT command - Generate sections.yaml config
// ============================================================================

program
  .command('init')
  .description('Generate sections.yaml from existing .md files')
  .option('-d, --dir <directory>', 'Directory to scan', '.')
  .option('-o, --output <file>', 'Output config file', 'sections.yaml')
  .option('--force', 'Overwrite existing config')
  .action((options) => {
    const dir = path.resolve(options.dir);

    if (!fs.existsSync(dir)) {
      console.error(chalk.red(`Directory not found: ${dir}`));
      process.exit(1);
    }

    const outputPath = path.resolve(options.dir, options.output);

    if (fs.existsSync(outputPath) && !options.force) {
      console.error(chalk.yellow(`Config already exists: ${outputPath}`));
      console.error(chalk.dim('Use --force to overwrite'));
      process.exit(1);
    }

    console.log(chalk.cyan(`Scanning ${dir} for .md files...`));

    const config = generateConfig(dir);
    const sectionCount = Object.keys(config.sections).length;

    if (sectionCount === 0) {
      console.error(chalk.yellow('No .md files found (excluding paper.md, README.md)'));
      process.exit(1);
    }

    saveConfig(outputPath, config);

    console.log(chalk.green(`\nCreated ${outputPath} with ${sectionCount} sections:\n`));

    for (const [file, section] of Object.entries(config.sections)) {
      console.log(`  ${chalk.bold(file)}`);
      console.log(chalk.dim(`    header: "${section.header}"`));
      if (section.aliases?.length > 0) {
        console.log(chalk.dim(`    aliases: ${JSON.stringify(section.aliases)}`));
      }
    }

    console.log(chalk.cyan('\nEdit this file to:'));
    console.log(chalk.dim('  • Add aliases for header variations'));
    console.log(chalk.dim('  • Adjust order if needed'));
    console.log(chalk.dim('  • Update headers if they change'));
  });

// ============================================================================
// SPLIT command - Split annotated paper.md back to section files
// ============================================================================

program
  .command('split')
  .description('Split annotated paper.md back to section files')
  .argument('<file>', 'Annotated paper.md file')
  .option('-c, --config <file>', 'Sections config file', 'sections.yaml')
  .option('-d, --dir <directory>', 'Output directory for section files', '.')
  .option('--dry-run', 'Preview without writing files')
  .action((file, options) => {
    if (!fs.existsSync(file)) {
      console.error(chalk.red(`File not found: ${file}`));
      process.exit(1);
    }

    const configPath = path.resolve(options.dir, options.config);
    if (!fs.existsSync(configPath)) {
      console.error(chalk.red(`Config not found: ${configPath}`));
      console.error(chalk.dim('Run "rev init" first to generate sections.yaml'));
      process.exit(1);
    }

    console.log(chalk.cyan(`Splitting ${file} using ${options.config}...`));

    const config = loadConfig(configPath);
    const paperContent = fs.readFileSync(file, 'utf-8');
    const sections = splitAnnotatedPaper(paperContent, config.sections);

    if (sections.size === 0) {
      console.error(chalk.yellow('No sections detected.'));
      console.error(chalk.dim('Check that headers match sections.yaml'));
      process.exit(1);
    }

    console.log(chalk.green(`\nFound ${sections.size} sections:\n`));

    for (const [sectionFile, content] of sections) {
      const outputPath = path.join(options.dir, sectionFile);
      const lines = content.split('\n').length;
      const annotations = countAnnotations(content);

      console.log(`  ${chalk.bold(sectionFile)} (${lines} lines)`);
      if (annotations.total > 0) {
        const parts = [];
        if (annotations.inserts > 0) parts.push(chalk.green(`+${annotations.inserts}`));
        if (annotations.deletes > 0) parts.push(chalk.red(`-${annotations.deletes}`));
        if (annotations.substitutes > 0) parts.push(chalk.yellow(`~${annotations.substitutes}`));
        if (annotations.comments > 0) parts.push(chalk.blue(`#${annotations.comments}`));
        console.log(chalk.dim(`    Annotations: ${parts.join(' ')}`));
      }

      if (!options.dryRun) {
        fs.writeFileSync(outputPath, content, 'utf-8');
      }
    }

    if (options.dryRun) {
      console.log(chalk.yellow('\n(Dry run - no files written)'));
    } else {
      console.log(chalk.green('\nSection files updated.'));
      console.log(chalk.cyan('\nNext: rev review <section.md> for each section'));
    }
  });

// ============================================================================
// SECTIONS command - Import with section awareness
// ============================================================================

program
  .command('sections')
  .description('Import Word doc directly to section files')
  .argument('<docx>', 'Word document from reviewer')
  .option('-c, --config <file>', 'Sections config file', 'sections.yaml')
  .option('-d, --dir <directory>', 'Directory with section files', '.')
  .option('--no-crossref', 'Skip converting hardcoded figure/table refs')
  .option('--dry-run', 'Preview without writing files')
  .action(async (docx, options) => {
    if (!fs.existsSync(docx)) {
      console.error(chalk.red(`File not found: ${docx}`));
      process.exit(1);
    }

    const configPath = path.resolve(options.dir, options.config);
    if (!fs.existsSync(configPath)) {
      console.error(chalk.red(`Config not found: ${configPath}`));
      console.error(chalk.dim('Run "rev init" first to generate sections.yaml'));
      process.exit(1);
    }

    console.log(chalk.cyan(`Importing ${path.basename(docx)} with section awareness...\n`));

    try {
      const config = loadConfig(configPath);
      const mammoth = await import('mammoth');
      const { importFromWord } = await import('../lib/import.js');

      // Build crossref registry for converting hardcoded refs
      let registry = null;
      let totalRefConversions = 0;
      if (options.crossref !== false) {
        registry = buildRegistry(options.dir);
      }

      // Extract text from Word
      const wordResult = await mammoth.extractRawText({ path: docx });
      const wordText = wordResult.value;

      // Extract sections from Word text
      const wordSections = extractSectionsFromText(wordText, config.sections);

      if (wordSections.length === 0) {
        console.error(chalk.yellow('No sections detected in Word document.'));
        console.error(chalk.dim('Check that headings match sections.yaml'));
        process.exit(1);
      }

      console.log(chalk.green(`Detected ${wordSections.length} sections in Word doc:\n`));

      let totalChanges = 0;

      for (const section of wordSections) {
        const sectionPath = path.join(options.dir, section.file);

        if (!fs.existsSync(sectionPath)) {
          console.log(chalk.yellow(`  ${section.file} - not found, skipping`));
          continue;
        }

        // Import this section
        const result = await importFromWord(docx, sectionPath, {
          sectionContent: section.content,
          author: 'Reviewer',
        });

        let { annotated, stats } = result;

        // Convert hardcoded refs to dynamic refs
        let refConversions = [];
        if (registry && options.crossref !== false) {
          const crossrefResult = convertHardcodedRefs(annotated, registry);
          annotated = crossrefResult.converted;
          refConversions = crossrefResult.conversions;
          totalRefConversions += refConversions.length;
        }

        totalChanges += stats.total;

        console.log(`  ${chalk.bold(section.file)}`);
        console.log(chalk.dim(`    Word heading: "${section.header}"`));

        if (stats.total > 0 || refConversions.length > 0) {
          const parts = [];
          if (stats.insertions > 0) parts.push(chalk.green(`+${stats.insertions}`));
          if (stats.deletions > 0) parts.push(chalk.red(`-${stats.deletions}`));
          if (stats.substitutions > 0) parts.push(chalk.yellow(`~${stats.substitutions}`));
          if (stats.comments > 0) parts.push(chalk.blue(`#${stats.comments}`));
          if (refConversions.length > 0) parts.push(chalk.magenta(`@${refConversions.length} refs`));
          console.log(`    Changes: ${parts.join(' ')}`);

          if (!options.dryRun) {
            fs.writeFileSync(sectionPath, annotated, 'utf-8');
          }
        } else {
          console.log(chalk.dim('    No changes'));
        }
      }

      console.log('');

      if (options.dryRun) {
        console.log(chalk.yellow('(Dry run - no files written)'));
      } else if (totalChanges > 0 || totalRefConversions > 0) {
        console.log(chalk.green(`Updated section files with ${totalChanges} annotations.`));
        if (totalRefConversions > 0) {
          console.log(chalk.magenta(`Converted ${totalRefConversions} hardcoded refs to @-syntax.`));
        }
        console.log(chalk.cyan('\nNext steps:'));
        console.log(chalk.dim('  1. rev review <section.md>  - Accept/reject changes'));
        console.log(chalk.dim('  2. Address comments with Claude'));
        console.log(chalk.dim('  3. ./build.sh docx  - Rebuild'));
      } else {
        console.log(chalk.green('No changes detected.'));
      }
    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

// ============================================================================
// REFS command - Show figure/table reference status
// ============================================================================

program
  .command('refs')
  .description('Show figure/table reference registry and status')
  .argument('[file]', 'Optional file to analyze for references')
  .option('-d, --dir <directory>', 'Directory to scan for anchors', '.')
  .action((file, options) => {
    const dir = path.resolve(options.dir);

    if (!fs.existsSync(dir)) {
      console.error(chalk.red(`Directory not found: ${dir}`));
      process.exit(1);
    }

    console.log(chalk.cyan('Building figure/table registry...\n'));

    const registry = buildRegistry(dir);

    // Show registry
    console.log(chalk.bold('Registry:'));
    console.log(formatRegistry(registry));

    // If file provided, analyze it
    if (file) {
      if (!fs.existsSync(file)) {
        console.error(chalk.red(`\nFile not found: ${file}`));
        process.exit(1);
      }

      const text = fs.readFileSync(file, 'utf-8');
      const status = getRefStatus(text, registry);

      console.log(chalk.cyan(`\nReferences in ${path.basename(file)}:\n`));

      if (status.dynamic.length > 0) {
        console.log(chalk.green(`  Dynamic (@fig:, @tbl:): ${status.dynamic.length}`));
        for (const ref of status.dynamic.slice(0, 5)) {
          console.log(chalk.dim(`    ${ref.match}`));
        }
        if (status.dynamic.length > 5) {
          console.log(chalk.dim(`    ... and ${status.dynamic.length - 5} more`));
        }
      }

      if (status.hardcoded.length > 0) {
        console.log(chalk.yellow(`\n  Hardcoded (Figure 1, Table 2): ${status.hardcoded.length}`));
        for (const ref of status.hardcoded.slice(0, 5)) {
          console.log(chalk.dim(`    "${ref.match}"`));
        }
        if (status.hardcoded.length > 5) {
          console.log(chalk.dim(`    ... and ${status.hardcoded.length - 5} more`));
        }
        console.log(chalk.cyan(`\n  Run ${chalk.bold(`rev migrate ${file}`)} to convert to dynamic refs`));
      }

      if (status.dynamic.length === 0 && status.hardcoded.length === 0) {
        console.log(chalk.dim('  No figure/table references found.'));
      }
    }
  });

// ============================================================================
// MIGRATE command - Convert hardcoded refs to dynamic
// ============================================================================

program
  .command('migrate')
  .description('Convert hardcoded figure/table refs to dynamic @-syntax')
  .argument('<file>', 'Markdown file to migrate')
  .option('-d, --dir <directory>', 'Directory for registry', '.')
  .option('--auto', 'Auto-convert without prompting')
  .option('--dry-run', 'Preview without saving')
  .action(async (file, options) => {
    if (!fs.existsSync(file)) {
      console.error(chalk.red(`File not found: ${file}`));
      process.exit(1);
    }

    const dir = path.resolve(options.dir);
    console.log(chalk.cyan('Building figure/table registry...\n'));

    const registry = buildRegistry(dir);
    const text = fs.readFileSync(file, 'utf-8');
    const refs = detectHardcodedRefs(text);

    if (refs.length === 0) {
      console.log(chalk.green('No hardcoded references found.'));
      return;
    }

    console.log(chalk.yellow(`Found ${refs.length} hardcoded reference(s):\n`));

    if (options.auto) {
      // Auto-convert all
      const { converted, conversions, warnings } = convertHardcodedRefs(text, registry);

      for (const w of warnings) {
        console.log(chalk.yellow(`  Warning: ${w}`));
      }

      for (const c of conversions) {
        console.log(chalk.green(`  "${c.from}" → ${c.to}`));
      }

      if (options.dryRun) {
        console.log(chalk.yellow('\n(Dry run - no changes saved)'));
      } else if (conversions.length > 0) {
        fs.writeFileSync(file, converted, 'utf-8');
        console.log(chalk.green(`\nConverted ${conversions.length} reference(s) in ${file}`));
      }
    } else {
      // Interactive mode
      const rl = await import('readline');
      const readline = rl.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      let result = text;
      let converted = 0;
      let skipped = 0;

      const askQuestion = (prompt) =>
        new Promise((resolve) => readline.question(prompt, resolve));

      // Process in reverse to preserve positions
      const sortedRefs = [...refs].sort((a, b) => b.position - a.position);

      for (const ref of sortedRefs) {
        // Try to find the label for this reference
        const num = ref.numbers[0];
        const { numberToLabel } = await import('../lib/crossref.js');
        const label = numberToLabel(ref.type, num.num, num.isSupp, registry);

        if (!label) {
          console.log(chalk.yellow(`  "${ref.match}" - no matching anchor found, skipping`));
          skipped++;
          continue;
        }

        const replacement = `@${ref.type}:${label}`;
        console.log(`\n  ${chalk.yellow(`"${ref.match}"`)} → ${chalk.green(replacement)}`);

        const answer = await askQuestion(chalk.cyan('  Convert? [y/n/a/q] '));

        if (answer.toLowerCase() === 'q') {
          console.log(chalk.dim('  Quitting...'));
          break;
        } else if (answer.toLowerCase() === 'a') {
          // Accept all remaining
          result = result.slice(0, ref.position) + replacement + result.slice(ref.position + ref.match.length);
          converted++;

          // Convert remaining without asking
          for (const remaining of sortedRefs.slice(sortedRefs.indexOf(ref) + 1)) {
            const rNum = remaining.numbers[0];
            const rLabel = numberToLabel(remaining.type, rNum.num, rNum.isSupp, registry);
            if (rLabel) {
              const rReplacement = `@${remaining.type}:${rLabel}`;
              result = result.slice(0, remaining.position) + rReplacement + result.slice(remaining.position + remaining.match.length);
              converted++;
              console.log(chalk.green(`  "${remaining.match}" → ${rReplacement}`));
            }
          }
          break;
        } else if (answer.toLowerCase() === 'y') {
          result = result.slice(0, ref.position) + replacement + result.slice(ref.position + ref.match.length);
          converted++;
        } else {
          skipped++;
        }
      }

      readline.close();

      console.log(chalk.cyan(`\nConverted: ${converted}, Skipped: ${skipped}`));

      if (converted > 0 && !options.dryRun) {
        fs.writeFileSync(file, result, 'utf-8');
        console.log(chalk.green(`Saved ${file}`));
      } else if (options.dryRun) {
        console.log(chalk.yellow('(Dry run - no changes saved)'));
      }
    }
  });

// ============================================================================
// INSTALL command - Install dependencies (pandoc-crossref)
// ============================================================================

program
  .command('install')
  .description('Check and install dependencies (pandoc-crossref)')
  .option('--check', 'Only check, don\'t install')
  .action(async (options) => {
    const os = await import('os');
    const { execSync, spawn } = await import('child_process');
    const platform = os.platform();

    console.log(chalk.cyan('Checking dependencies...\n'));

    // Check pandoc
    let hasPandoc = false;
    try {
      const version = execSync('pandoc --version', { encoding: 'utf-8' }).split('\n')[0];
      console.log(chalk.green(`  ✓ ${version}`));
      hasPandoc = true;
    } catch {
      console.log(chalk.red('  ✗ pandoc not found'));
    }

    // Check pandoc-crossref
    let hasCrossref = false;
    try {
      const version = execSync('pandoc-crossref --version', { encoding: 'utf-8' }).split('\n')[0];
      console.log(chalk.green(`  ✓ pandoc-crossref ${version}`));
      hasCrossref = true;
    } catch {
      console.log(chalk.yellow('  ✗ pandoc-crossref not found'));
    }

    // Check mammoth (Node dep - should always be there)
    try {
      await import('mammoth');
      console.log(chalk.green('  ✓ mammoth (Word parsing)'));
    } catch {
      console.log(chalk.red('  ✗ mammoth not found - run: npm install'));
    }

    console.log('');

    if (hasPandoc && hasCrossref) {
      console.log(chalk.green('All dependencies installed!'));
      return;
    }

    if (options.check) {
      if (!hasCrossref) {
        console.log(chalk.yellow('pandoc-crossref is optional but recommended for @fig: references.'));
      }
      return;
    }

    // Provide installation instructions
    if (!hasPandoc || !hasCrossref) {
      console.log(chalk.cyan('Installation options:\n'));

      if (platform === 'darwin') {
        // macOS
        console.log(chalk.bold('macOS (Homebrew):'));
        if (!hasPandoc) console.log(chalk.dim('  brew install pandoc'));
        if (!hasCrossref) console.log(chalk.dim('  brew install pandoc-crossref'));
        console.log('');
      } else if (platform === 'win32') {
        // Windows
        console.log(chalk.bold('Windows (Chocolatey):'));
        if (!hasPandoc) console.log(chalk.dim('  choco install pandoc'));
        if (!hasCrossref) console.log(chalk.dim('  choco install pandoc-crossref'));
        console.log('');
        console.log(chalk.bold('Windows (Scoop):'));
        if (!hasPandoc) console.log(chalk.dim('  scoop install pandoc'));
        if (!hasCrossref) console.log(chalk.dim('  scoop install pandoc-crossref'));
        console.log('');
      } else {
        // Linux
        console.log(chalk.bold('Linux (apt):'));
        if (!hasPandoc) console.log(chalk.dim('  sudo apt install pandoc'));
        console.log('');
      }

      // Cross-platform conda option
      console.log(chalk.bold('Cross-platform (conda):'));
      if (!hasPandoc) console.log(chalk.dim('  conda install -c conda-forge pandoc'));
      if (!hasCrossref) console.log(chalk.dim('  conda install -c conda-forge pandoc-crossref'));
      console.log('');

      // Manual download
      if (!hasCrossref) {
        console.log(chalk.bold('Manual download:'));
        console.log(chalk.dim('  https://github.com/lierdakil/pandoc-crossref/releases'));
        console.log('');
      }

      // Ask to auto-install via conda if available
      try {
        execSync('conda --version', { encoding: 'utf-8', stdio: 'pipe' });
        console.log(chalk.cyan('Conda detected. Install missing dependencies? [y/N] '));

        const rl = (await import('readline')).createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        rl.question('', (answer) => {
          rl.close();
          if (answer.toLowerCase() === 'y') {
            console.log(chalk.cyan('\nInstalling via conda...'));
            try {
              if (!hasPandoc) {
                console.log(chalk.dim('  Installing pandoc...'));
                execSync('conda install -y -c conda-forge pandoc', { stdio: 'inherit' });
              }
              if (!hasCrossref) {
                console.log(chalk.dim('  Installing pandoc-crossref...'));
                execSync('conda install -y -c conda-forge pandoc-crossref', { stdio: 'inherit' });
              }
              console.log(chalk.green('\nDone! Run "rev install --check" to verify.'));
            } catch (err) {
              console.log(chalk.red(`\nInstallation failed: ${err.message}`));
              console.log(chalk.dim('Try installing manually with the commands above.'));
            }
          }
        });
      } catch {
        // Conda not available
      }
    }
  });

// ============================================================================
// HELP command - Comprehensive help
// ============================================================================

program
  .command('help')
  .description('Show detailed help and workflow guide')
  .argument('[topic]', 'Help topic: workflow, syntax, commands')
  .action((topic) => {
    if (!topic || topic === 'all') {
      showFullHelp();
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

function showFullHelp() {
  console.log(`
${chalk.bold.cyan('rev')} - Revision workflow for Word ↔ Markdown round-trips

${chalk.bold('DESCRIPTION')}
  Handle reviewer feedback when collaborating on academic papers.
  Import changes from Word, review them interactively, and preserve
  comments for discussion with Claude.

${chalk.bold('TYPICAL WORKFLOW')}

  ${chalk.dim('1.')} You send ${chalk.yellow('paper.docx')} to reviewers
  ${chalk.dim('2.')} They return ${chalk.yellow('reviewed.docx')} with edits and comments
  ${chalk.dim('3.')} Import their changes:

     ${chalk.green('rev import reviewed.docx paper.md')}

  ${chalk.dim('4.')} Review track changes interactively:

     ${chalk.green('rev review paper.md')}

     Use: ${chalk.dim('[a]ccept [r]eject [s]kip [A]ccept-all [q]uit')}

  ${chalk.dim('5.')} Address comments with Claude:

     ${chalk.dim('"Go through each comment in paper.md and help me address them"')}

  ${chalk.dim('6.')} Rebuild:

     ${chalk.green('./build.sh docx')}

${chalk.bold('ANNOTATION SYNTAX')} ${chalk.dim('(CriticMarkup)')}

  ${chalk.green('{++inserted text++}')}     Text that was added
  ${chalk.red('{--deleted text--}')}       Text that was removed
  ${chalk.yellow('{~~old~>new~~}')}           Text that was changed
  ${chalk.blue('{>>Author: comment<<}')}   Reviewer comment

${chalk.bold('COMMANDS')}

  ${chalk.bold('rev import')} <docx> <md>    Import changes from Word document
      ${chalk.dim('-o, --output <file>')}    Output to different file
      ${chalk.dim('-a, --author <name>')}    Set author name for changes
      ${chalk.dim('--dry-run')}              Preview without saving

  ${chalk.bold('rev review')} <file>         Interactive accept/reject TUI
  ${chalk.bold('rev status')} <file>         Show annotation statistics
  ${chalk.bold('rev comments')} <file>       List all comments with context
  ${chalk.bold('rev strip')} <file>          Output clean text (no annotations)
      ${chalk.dim('-o, --output <file>')}    Write to file instead of stdout
      ${chalk.dim('-c, --keep-comments')}    Keep comments, strip track changes

  ${chalk.bold('rev extract')} <docx>        Extract plain text from Word
  ${chalk.bold('rev help')} [topic]          Show help (topics: workflow, syntax, commands)

${chalk.bold('EXAMPLES')}

  ${chalk.dim('# Import reviewer feedback')}
  rev import reviewed.docx methods.md

  ${chalk.dim('# Preview changes without saving')}
  rev import reviewed.docx methods.md --dry-run

  ${chalk.dim('# See what needs attention')}
  rev status paper.md

  ${chalk.dim('# Accept/reject changes one by one')}
  rev review paper.md

  ${chalk.dim('# List all pending comments')}
  rev comments paper.md

  ${chalk.dim('# Get clean text for PDF build')}
  rev strip paper.md -o paper_clean.md

${chalk.bold('BUILD INTEGRATION')}

  The build scripts automatically handle annotations:
  ${chalk.dim('•')} ${chalk.bold('PDF build:')} Strips all annotations (clean output)
  ${chalk.dim('•')} ${chalk.bold('DOCX build:')} Keeps comments visible for tracking

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

${chalk.bold('STEP 1: SEND TO REVIEWERS')}

  Build your Word document and send it:

  ${chalk.green('./build.sh docx')}
  ${chalk.dim('# Send paper.docx to reviewers')}

${chalk.bold('STEP 2: RECEIVE FEEDBACK')}

  Reviewers edit the document, adding:
  ${chalk.dim('•')} Track changes (insertions, deletions)
  ${chalk.dim('•')} Comments (questions, suggestions)

${chalk.bold('STEP 3: IMPORT CHANGES')}

  Compare their version against your original:

  ${chalk.green('rev import reviewed.docx paper.md')}

  This generates annotated markdown showing all differences:
  ${chalk.dim('•')} ${chalk.green('{++new text++}')} - Reviewer added this
  ${chalk.dim('•')} ${chalk.red('{--old text--}')} - Reviewer deleted this
  ${chalk.dim('•')} ${chalk.yellow('{~~old~>new~~}')} - Reviewer changed this
  ${chalk.dim('•')} ${chalk.blue('{>>comment<<}')} - Reviewer comment

${chalk.bold('STEP 4: REVIEW TRACK CHANGES')}

  Go through changes interactively:

  ${chalk.green('rev review paper.md')}

  For each change, choose:
  ${chalk.dim('•')} ${chalk.bold('a')} - Accept (apply the change)
  ${chalk.dim('•')} ${chalk.bold('r')} - Reject (keep original)
  ${chalk.dim('•')} ${chalk.bold('s')} - Skip (decide later)
  ${chalk.dim('•')} ${chalk.bold('A')} - Accept all remaining
  ${chalk.dim('•')} ${chalk.bold('q')} - Quit

${chalk.bold('STEP 5: ADDRESS COMMENTS')}

  Comments remain in your file as ${chalk.blue('{>>Author: text<<}')}

  Work with Claude to address them:

  ${chalk.dim('"Go through each reviewer comment in methods.md')}
  ${chalk.dim(' and help me address them one by one"')}

  Delete comment annotations as you resolve them.

${chalk.bold('STEP 6: REBUILD')}

  Generate new Word document:

  ${chalk.green('./build.sh docx')}

  ${chalk.dim('•')} Remaining comments stay visible in output
  ${chalk.dim('•')} PDF build strips all annotations
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

${chalk.bold('COMBINING ANNOTATIONS')}

  Annotations can appear together:

    We found ${chalk.yellow('{~~a~>the~~}')} ${chalk.green('{++significant++}')} effect.
    ${chalk.blue('{>>Reviewer: Is this the right word?<<}')}

${chalk.bold('IN YOUR MARKDOWN FILES')}

  Annotations work alongside normal Markdown:

    ## Results

    Species richness ${chalk.yellow('{~~increased~>showed a significant increase~~}')}
    in disturbed habitats (p < 0.001). ${chalk.blue('{>>Add effect size<<}')}

${chalk.bold('ESCAPING')}

  If you need literal {++ in your text, there's no escape mechanism.
  This is rarely an issue in academic writing.
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

  ${chalk.bold('Examples:')}
    rev import reviewed.docx paper.md
    rev import reviewed.docx paper.md -o paper_annotated.md
    rev import reviewed.docx paper.md --dry-run

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

${chalk.bold('rev status')} <file>

  Show annotation statistics: counts of insertions, deletions,
  substitutions, and comments. Lists comments with authors.

${chalk.bold('rev comments')} <file>

  List all comments with context. Shows surrounding text
  to help locate each comment.

${chalk.bold('rev strip')} <file>

  Remove annotations, outputting clean Markdown.
  Track changes are applied (insertions kept, deletions removed).

  ${chalk.bold('Options:')}
    -o, --output <file>   Write to file (default: stdout)
    -c, --keep-comments   Keep comment annotations

  ${chalk.bold('Examples:')}
    rev strip paper.md                    # Clean text to stdout
    rev strip paper.md -o clean.md        # Clean text to file
    rev strip paper.md -c                 # Strip changes, keep comments

${chalk.bold('rev extract')} <docx>

  Extract plain text from a Word document.
  Simpler than import - no diffing, just text extraction.

  ${chalk.bold('Options:')}
    -o, --output <file>   Write to file (default: stdout)

${chalk.bold('rev help')} [topic]

  Show help. Optional topics:
    workflow    Step-by-step workflow guide
    syntax      Annotation syntax reference
    commands    This command reference
`);
}

program.parse();
