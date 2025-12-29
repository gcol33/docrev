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
  setCommentStatus,
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
import {
  build,
  loadConfig as loadBuildConfig,
  hasPandoc,
  hasPandocCrossref,
  formatBuildResults,
} from '../lib/build.js';
import { getTemplate, listTemplates } from '../lib/templates.js';
import { getUserName, setUserName, getConfigPath } from '../lib/config.js';
import * as fmt from '../lib/format.js';
import { inlineDiffPreview } from '../lib/format.js';
import { parseCommentsWithReplies, collectComments, generateResponseLetter, groupByReviewer } from '../lib/response.js';
import { validateCitations, getCitationStats } from '../lib/citations.js';
import { extractEquations, getEquationStats, createEquationsDoc, extractEquationsFromWord, getWordEquationStats } from '../lib/equations.js';
import { parseBibEntries, checkBibDois, fetchBibtex, addToBib, isValidDoiFormat, lookupDoi, lookupMissingDois } from '../lib/doi.js';

program
  .name('rev')
  .description('Revision workflow for Word ↔ Markdown round-trips')
  .version('0.2.0');

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
    const comments = getComments(text);
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
  });

// ============================================================================
// COMMENTS command - List all comments
// ============================================================================

program
  .command('comments')
  .description('List all comments in the document')
  .argument('<file>', 'Markdown file')
  .option('-p, --pending', 'Show only pending (unresolved) comments')
  .option('-r, --resolved', 'Show only resolved comments')
  .action((file, options) => {
    if (!fs.existsSync(file)) {
      console.error(chalk.red(`Error: File not found: ${file}`));
      process.exit(1);
    }

    const text = fs.readFileSync(file, 'utf-8');
    const comments = getComments(text, {
      pendingOnly: options.pending,
      resolvedOnly: options.resolved,
    });

    if (comments.length === 0) {
      if (options.pending) {
        console.log(fmt.status('success', 'No pending comments'));
      } else if (options.resolved) {
        console.log(fmt.status('info', 'No resolved comments'));
      } else {
        console.log(fmt.status('info', 'No comments found'));
      }
      return;
    }

    const filter = options.pending ? ' (pending)' : options.resolved ? ' (resolved)' : '';
    console.log(fmt.header(`Comments in ${path.basename(file)}${filter}`));
    console.log();

    for (let i = 0; i < comments.length; i++) {
      const c = comments[i];
      const statusIcon = c.resolved ? chalk.green('✓') : chalk.yellow('○');
      const authorLabel = c.author ? chalk.blue(`[${c.author}]`) : chalk.dim('[Anonymous]');
      const preview = c.content.length > 60 ? c.content.slice(0, 60) + '...' : c.content;

      console.log(`  ${chalk.bold(`#${i + 1}`)} ${statusIcon} ${authorLabel} ${chalk.dim(`L${c.line}`)}`);
      console.log(`     ${preview}`);
      if (c.before) {
        console.log(chalk.dim(`     "${c.before.trim().slice(-40)}..."`));
      }
      console.log();
    }

    // Summary
    const allComments = getComments(text);
    const pending = allComments.filter((c) => !c.resolved).length;
    const resolved = allComments.filter((c) => c.resolved).length;
    console.log(chalk.dim(`  Total: ${allComments.length} | Pending: ${pending} | Resolved: ${resolved}`));
  });

// ============================================================================
// RESOLVE command - Mark comments as resolved/pending
// ============================================================================

program
  .command('resolve')
  .description('Mark comments as resolved or pending')
  .argument('<file>', 'Markdown file')
  .option('-n, --number <n>', 'Comment number to toggle', parseInt)
  .option('-a, --all', 'Mark all comments as resolved')
  .option('-u, --unresolve', 'Mark as pending (unresolve)')
  .action((file, options) => {
    if (!fs.existsSync(file)) {
      console.error(chalk.red(`Error: File not found: ${file}`));
      process.exit(1);
    }

    let text = fs.readFileSync(file, 'utf-8');
    const comments = getComments(text);

    if (comments.length === 0) {
      console.log(fmt.status('info', 'No comments found'));
      return;
    }

    const resolveStatus = !options.unresolve;

    if (options.all) {
      // Mark all comments
      let count = 0;
      for (const comment of comments) {
        if (comment.resolved !== resolveStatus) {
          text = setCommentStatus(text, comment, resolveStatus);
          count++;
        }
      }
      fs.writeFileSync(file, text, 'utf-8');
      console.log(fmt.status('success', `Marked ${count} comment(s) as ${resolveStatus ? 'resolved' : 'pending'}`));
      return;
    }

    if (options.number !== undefined) {
      const idx = options.number - 1;
      if (idx < 0 || idx >= comments.length) {
        console.error(chalk.red(`Invalid comment number. File has ${comments.length} comments.`));
        process.exit(1);
      }
      const comment = comments[idx];
      text = setCommentStatus(text, comment, resolveStatus);
      fs.writeFileSync(file, text, 'utf-8');
      console.log(fmt.status('success', `Comment #${options.number} marked as ${resolveStatus ? 'resolved' : 'pending'}`));
      return;
    }

    // No options: show current status
    console.log(fmt.header(`Comment Status in ${path.basename(file)}`));
    console.log();

    for (let i = 0; i < comments.length; i++) {
      const c = comments[i];
      const statusIcon = c.resolved ? chalk.green('✓') : chalk.yellow('○');
      const preview = c.content.length > 50 ? c.content.slice(0, 50) + '...' : c.content;
      console.log(`  ${statusIcon} #${i + 1} ${preview}`);
    }

    console.log();
    const pending = comments.filter((c) => !c.resolved).length;
    const resolved = comments.filter((c) => c.resolved).length;
    console.log(chalk.dim(`  Pending: ${pending} | Resolved: ${resolved}`));
    console.log();
    console.log(chalk.dim('  Usage: rev resolve <file> -n <number>    Mark specific comment'));
    console.log(chalk.dim('         rev resolve <file> -a             Mark all as resolved'));
    console.log(chalk.dim('         rev resolve <file> -n 1 -u        Unresolve comment #1'));
  });

// ============================================================================
// IMPORT command - Import from Word (bootstrap or diff mode)
// ============================================================================

program
  .command('import')
  .description('Import from Word: creates sections from scratch, or diffs against existing MD')
  .argument('<docx>', 'Word document')
  .argument('[original]', 'Optional: original Markdown file to compare against')
  .option('-o, --output <dir>', 'Output directory for bootstrap mode', '.')
  .option('-a, --author <name>', 'Author name for changes (diff mode)', 'Reviewer')
  .option('--dry-run', 'Preview without saving')
  .action(async (docx, original, options) => {
    if (!fs.existsSync(docx)) {
      console.error(chalk.red(`Error: Word file not found: ${docx}`));
      process.exit(1);
    }

    // If no original provided, bootstrap mode: create sections from Word
    if (!original) {
      await bootstrapFromWord(docx, options);
      return;
    }

    // Diff mode: compare against original
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
      console.log(`  3. ${chalk.bold('rev build docx')}  - Rebuild Word doc`);

    } catch (err) {
      console.error(chalk.red(`Error: ${err.message}`));
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

/**
 * Bootstrap a new project from a Word document
 * Creates section files and rev.yaml
 */
async function bootstrapFromWord(docx, options) {
  const outputDir = path.resolve(options.output);

  console.log(chalk.cyan(`Bootstrapping project from ${path.basename(docx)}...\n`));

  try {
    const mammoth = await import('mammoth');
    const yaml = (await import('js-yaml')).default;

    // Extract text from Word
    const result = await mammoth.extractRawText({ path: docx });
    const text = result.value;

    // Detect sections by finding headers (lines that look like section titles)
    const sections = detectSectionsFromWord(text);

    if (sections.length === 0) {
      console.error(chalk.yellow('No sections detected. Creating single content.md file.'));
      sections.push({ header: 'Content', content: text, file: 'content.md' });
    }

    console.log(chalk.green(`Detected ${sections.length} section(s):\n`));

    // Create output directory if needed
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Write section files
    const sectionFiles = [];
    for (const section of sections) {
      const filePath = path.join(outputDir, section.file);
      const content = `# ${section.header}\n\n${section.content.trim()}\n`;

      console.log(`  ${chalk.bold(section.file)} - "${section.header}" (${section.content.split('\n').length} lines)`);

      if (!options.dryRun) {
        fs.writeFileSync(filePath, content, 'utf-8');
      }
      sectionFiles.push(section.file);
    }

    // Extract title from first line or filename
    const docxName = path.basename(docx, '.docx');
    const title = docxName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    // Create rev.yaml
    const config = {
      title: title,
      authors: [],
      sections: sectionFiles,
      bibliography: null,
      crossref: {
        figureTitle: 'Figure',
        tableTitle: 'Table',
        figPrefix: ['Fig.', 'Figs.'],
        tblPrefix: ['Table', 'Tables'],
      },
      pdf: {
        documentclass: 'article',
        fontsize: '12pt',
        geometry: 'margin=1in',
        linestretch: 1.5,
      },
      docx: {
        keepComments: true,
      },
    };

    const configPath = path.join(outputDir, 'rev.yaml');
    console.log(`\n  ${chalk.bold('rev.yaml')} - project configuration`);

    if (!options.dryRun) {
      fs.writeFileSync(configPath, yaml.dump(config), 'utf-8');
    }

    // Create figures directory
    const figuresDir = path.join(outputDir, 'figures');
    if (!fs.existsSync(figuresDir) && !options.dryRun) {
      fs.mkdirSync(figuresDir, { recursive: true });
      console.log(`  ${chalk.dim('figures/')} - image directory`);
    }

    if (options.dryRun) {
      console.log(chalk.yellow('\n(Dry run - no files written)'));
    } else {
      console.log(chalk.green('\nProject created!'));
      console.log(chalk.cyan('\nNext steps:'));
      if (outputDir !== process.cwd()) {
        console.log(chalk.dim(`  cd ${path.relative(process.cwd(), outputDir) || '.'}`));
      }
      console.log(chalk.dim('  # Edit rev.yaml to add authors and adjust settings'));
      console.log(chalk.dim('  # Review and clean up section files'));
      console.log(chalk.dim('  rev build          # Build PDF and DOCX'));
    }
  } catch (err) {
    console.error(chalk.red(`Error: ${err.message}`));
    if (process.env.DEBUG) console.error(err.stack);
    process.exit(1);
  }
}

/**
 * Detect sections from Word document text
 * Looks for common academic paper section headers
 * Conservative: only detects well-known section names to avoid false positives
 */
function detectSectionsFromWord(text) {
  const lines = text.split('\n');
  const sections = [];

  // Only detect well-known academic section headers (conservative)
  const headerPatterns = [
    /^(Abstract|Summary)$/i,
    /^(Introduction|Background)$/i,
    /^(Methods?|Materials?\s*(and|&)\s*Methods?|Methodology|Experimental\s*Methods?)$/i,
    /^(Results?)$/i,
    /^(Results?\s*(and|&)\s*Discussion)$/i,
    /^(Discussion)$/i,
    /^(Conclusions?|Summary\s*(and|&)?\s*Conclusions?)$/i,
    /^(Acknowledgements?|Acknowledgments?)$/i,
    /^(References|Bibliography|Literature\s*Cited|Works\s*Cited)$/i,
    /^(Appendix|Appendices|Supplementary\s*(Materials?|Information)?|Supporting\s*Information)$/i,
    /^(Literature\s*Review|Related\s*Work|Previous\s*Work)$/i,
    /^(Study\s*Area|Study\s*Site|Site\s*Description)$/i,
    /^(Data\s*Analysis|Statistical\s*Analysis|Data\s*Collection)$/i,
    /^(Theoretical\s*Framework|Conceptual\s*Framework)$/i,
    /^(Case\s*Study|Case\s*Studies)$/i,
    /^(Limitations?)$/i,
    /^(Future\s*Work|Future\s*Directions?)$/i,
    /^(Funding|Author\s*Contributions?|Conflict\s*of\s*Interest|Data\s*Availability)$/i,
  ];

  // Numbered sections: "1. Introduction", "2. Methods", etc.
  // Must have a number followed by a known section word
  const numberedHeaderPattern = /^(\d+\.?\s+)(Abstract|Introduction|Background|Methods?|Materials|Results?|Discussion|Conclusions?|References|Acknowledgements?|Appendix)/i;

  let currentSection = null;
  let currentContent = [];
  let preambleContent = []; // Content before first header (title, authors, etc.)

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      // Keep empty lines
      if (currentSection) {
        currentContent.push(line);
      } else {
        preambleContent.push(line);
      }
      continue;
    }

    // Check if this line is a section header
    let isHeader = false;
    let headerText = trimmed;

    // Check against known patterns
    for (const pattern of headerPatterns) {
      if (pattern.test(trimmed)) {
        isHeader = true;
        break;
      }
    }

    // Check numbered pattern (e.g., "1. Introduction")
    if (!isHeader) {
      const match = trimmed.match(numberedHeaderPattern);
      if (match) {
        isHeader = true;
        // Remove the number prefix for the header text
        headerText = trimmed.replace(/^\d+\.?\s+/, '');
      }
    }

    if (isHeader) {
      // Save previous section
      if (currentSection) {
        sections.push({
          header: currentSection,
          content: currentContent.join('\n'),
          file: headerToFilename(currentSection),
        });
      } else if (preambleContent.some(l => l.trim())) {
        // Save preamble as "preamble" section (title, authors, etc.)
        sections.push({
          header: 'Preamble',
          content: preambleContent.join('\n'),
          file: 'preamble.md',
        });
      }
      currentSection = headerText;
      currentContent = [];
    } else if (currentSection) {
      currentContent.push(line);
    } else {
      preambleContent.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    sections.push({
      header: currentSection,
      content: currentContent.join('\n'),
      file: headerToFilename(currentSection),
    });
  }

  // If no sections detected, create single content file
  if (sections.length === 0) {
    const allContent = [...preambleContent, ...currentContent].join('\n');
    if (allContent.trim()) {
      sections.push({
        header: 'Content',
        content: allContent,
        file: 'content.md',
      });
    }
  }

  return sections;
}

/**
 * Convert a section header to a filename
 */
function headerToFilename(header) {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30) + '.md';
}

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
  .option('--no-diff', 'Skip showing diff preview')
  .option('--force', 'Overwrite files without conflict warning')
  .option('--dry-run', 'Preview without writing files')
  .action(async (docx, options) => {
    if (!fs.existsSync(docx)) {
      console.error(fmt.status('error', `File not found: ${docx}`));
      process.exit(1);
    }

    const configPath = path.resolve(options.dir, options.config);
    if (!fs.existsSync(configPath)) {
      console.error(fmt.status('error', `Config not found: ${configPath}`));
      console.error(chalk.dim('  Run "rev init" first to generate sections.yaml'));
      process.exit(1);
    }

    const spin = fmt.spinner(`Importing ${path.basename(docx)}...`).start();

    try {
      const config = loadConfig(configPath);
      const mammoth = await import('mammoth');
      const { importFromWord, extractWordComments, extractCommentAnchors, insertCommentsIntoMarkdown } = await import('../lib/import.js');

      // Build crossref registry for converting hardcoded refs
      let registry = null;
      let totalRefConversions = 0;
      if (options.crossref !== false) {
        registry = buildRegistry(options.dir);
      }

      // Extract comments and anchors from Word doc
      const comments = await extractWordComments(docx);
      const anchors = await extractCommentAnchors(docx);

      // Extract text from Word
      const wordResult = await mammoth.extractRawText({ path: docx });
      const wordText = wordResult.value;

      // Extract sections from Word text
      const wordSections = extractSectionsFromText(wordText, config.sections);

      if (wordSections.length === 0) {
        spin.stop();
        console.error(fmt.status('warning', 'No sections detected in Word document.'));
        console.error(chalk.dim('  Check that headings match sections.yaml'));
        process.exit(1);
      }

      spin.stop();
      console.log(fmt.header(`Import from ${path.basename(docx)}`));
      console.log();

      // Conflict detection: check if files already have annotations
      if (!options.force && !options.dryRun) {
        const conflicts = [];
        for (const section of wordSections) {
          const sectionPath = path.join(options.dir, section.file);
          if (fs.existsSync(sectionPath)) {
            const existing = fs.readFileSync(sectionPath, 'utf-8');
            const existingCounts = countAnnotations(existing);
            if (existingCounts.total > 0) {
              conflicts.push({
                file: section.file,
                annotations: existingCounts.total,
              });
            }
          }
        }

        if (conflicts.length > 0) {
          console.log(fmt.status('warning', 'Files with existing annotations will be overwritten:'));
          for (const c of conflicts) {
            console.log(chalk.yellow(`  - ${c.file} (${c.annotations} annotations)`));
          }
          console.log();

          // Prompt for confirmation
          const rl = await import('readline');
          const readline = rl.createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const answer = await new Promise((resolve) =>
            readline.question(chalk.cyan('Continue and overwrite? [y/N] '), resolve)
          );
          readline.close();

          if (answer.toLowerCase() !== 'y') {
            console.log(chalk.dim('Aborted. Use --force to skip this check.'));
            process.exit(0);
          }
          console.log();
        }
      }

      // Collect results for summary table
      const sectionResults = [];
      let totalChanges = 0;

      for (const section of wordSections) {
        const sectionPath = path.join(options.dir, section.file);

        if (!fs.existsSync(sectionPath)) {
          sectionResults.push({
            file: section.file,
            header: section.header,
            status: 'skipped',
            stats: null,
          });
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

        // Insert Word comments into the annotated markdown (quiet mode - no warnings)
        let commentsInserted = 0;
        if (comments.length > 0 && anchors.size > 0) {
          annotated = insertCommentsIntoMarkdown(annotated, comments, anchors, { quiet: true });
          commentsInserted = (annotated.match(/\{>>/g) || []).length - (result.annotated?.match(/\{>>/g) || []).length;
          if (commentsInserted > 0) {
            stats.comments = (stats.comments || 0) + commentsInserted;
          }
        }

        totalChanges += stats.total;

        sectionResults.push({
          file: section.file,
          header: section.header,
          status: 'ok',
          stats,
          refs: refConversions.length,
        });

        if (!options.dryRun && (stats.total > 0 || refConversions.length > 0)) {
          fs.writeFileSync(sectionPath, annotated, 'utf-8');
        }
      }

      // Build summary table
      const tableRows = sectionResults.map((r) => {
        if (r.status === 'skipped') {
          return [
            chalk.dim(r.file),
            chalk.dim(r.header.slice(0, 25)),
            chalk.yellow('skipped'),
            '',
            '',
            '',
            '',
          ];
        }
        const s = r.stats;
        return [
          chalk.bold(r.file),
          r.header.length > 25 ? r.header.slice(0, 22) + '...' : r.header,
          s.insertions > 0 ? chalk.green(`+${s.insertions}`) : chalk.dim('-'),
          s.deletions > 0 ? chalk.red(`-${s.deletions}`) : chalk.dim('-'),
          s.substitutions > 0 ? chalk.yellow(`~${s.substitutions}`) : chalk.dim('-'),
          s.comments > 0 ? chalk.blue(`#${s.comments}`) : chalk.dim('-'),
          r.refs > 0 ? chalk.magenta(`@${r.refs}`) : chalk.dim('-'),
        ];
      });

      console.log(fmt.table(
        ['File', 'Section', 'Ins', 'Del', 'Sub', 'Cmt', 'Ref'],
        tableRows,
        { align: ['left', 'left', 'right', 'right', 'right', 'right', 'right'] }
      ));
      console.log();

      // Show diff preview if there are changes
      if (options.diff !== false && totalChanges > 0) {
        console.log(fmt.header('Changes Preview'));
        console.log();
        // Collect all annotated content for preview
        for (const result of sectionResults) {
          if (result.status === 'ok' && result.stats && result.stats.total > 0) {
            const sectionPath = path.join(options.dir, result.file);
            if (fs.existsSync(sectionPath)) {
              const content = fs.readFileSync(sectionPath, 'utf-8');
              const preview = inlineDiffPreview(content, { maxLines: 3 });
              if (preview) {
                console.log(chalk.bold(result.file) + ':');
                console.log(preview);
                console.log();
              }
            }
          }
        }
      }

      // Summary box
      if (options.dryRun) {
        console.log(fmt.box(chalk.yellow('Dry run - no files written'), { padding: 0 }));
      } else if (totalChanges > 0 || totalRefConversions > 0 || comments.length > 0) {
        const summaryLines = [];
        summaryLines.push(`${chalk.bold(wordSections.length)} sections processed`);
        if (totalChanges > 0) summaryLines.push(`${chalk.bold(totalChanges)} annotations imported`);
        if (comments.length > 0) summaryLines.push(`${chalk.bold(comments.length)} comments placed`);
        if (totalRefConversions > 0) summaryLines.push(`${chalk.bold(totalRefConversions)} refs converted to @-syntax`);

        console.log(fmt.box(summaryLines.join('\n'), { title: 'Summary', padding: 0 }));
        console.log();
        console.log(chalk.dim('Next steps:'));
        console.log(chalk.dim('  1. rev review <section.md>  - Accept/reject changes'));
        console.log(chalk.dim('  2. rev comments <section.md> - View/address comments'));
        console.log(chalk.dim('  3. rev build docx  - Rebuild Word doc'));
      } else {
        console.log(fmt.status('success', 'No changes detected.'));
      }
    } catch (err) {
      spin.stop();
      console.error(fmt.status('error', err.message));
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
// BUILD command - Combine sections and run pandoc
// ============================================================================

program
  .command('build')
  .description('Build PDF/DOCX/TEX from sections')
  .argument('[formats...]', 'Output formats: pdf, docx, tex, all', ['pdf', 'docx'])
  .option('-d, --dir <directory>', 'Project directory', '.')
  .option('--no-crossref', 'Skip pandoc-crossref filter')
  .action(async (formats, options) => {
    const dir = path.resolve(options.dir);

    if (!fs.existsSync(dir)) {
      console.error(chalk.red(`Directory not found: ${dir}`));
      process.exit(1);
    }

    // Check for pandoc
    if (!hasPandoc()) {
      console.error(chalk.red('pandoc not found.'));
      console.error(chalk.dim('Run "rev install" to install dependencies.'));
      process.exit(1);
    }

    // Load config
    const config = loadBuildConfig(dir);

    if (!config._configPath) {
      console.error(chalk.yellow('No rev.yaml found.'));
      console.error(chalk.dim('Run "rev new" to create a project, or "rev init" for existing files.'));
      process.exit(1);
    }

    console.log(fmt.header(`Building ${config.title || 'document'}`));
    console.log();

    // Show what we're building
    const targetFormats = formats.length > 0 ? formats : ['pdf', 'docx'];
    console.log(chalk.dim(`  Formats: ${targetFormats.join(', ')}`));
    console.log(chalk.dim(`  Crossref: ${hasPandocCrossref() && options.crossref !== false ? 'enabled' : 'disabled'}`));
    console.log('');

    const spin = fmt.spinner('Building...').start();

    try {
      const { results, paperPath } = await build(dir, targetFormats, {
        crossref: options.crossref,
      });

      spin.stop();

      // Report results
      console.log(chalk.cyan('Combined sections → paper.md'));
      console.log(chalk.dim(`  ${paperPath}\n`));

      console.log(chalk.cyan('Output:'));
      console.log(formatBuildResults(results));

      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        console.log('');
        for (const f of failed) {
          console.error(chalk.red(`\n${f.format} error:\n${f.error}`));
        }
        process.exit(1);
      }

      console.log(chalk.green('\nBuild complete!'));
    } catch (err) {
      spin.stop();
      console.error(fmt.status('error', err.message));
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(1);
    }
  });

// ============================================================================
// NEW command - Create new paper project
// ============================================================================

program
  .command('new')
  .description('Create a new paper project from template')
  .argument('[name]', 'Project directory name')
  .option('-t, --template <name>', 'Template: paper, minimal, thesis, review', 'paper')
  .option('--list', 'List available templates')
  .action(async (name, options) => {
    if (options.list) {
      console.log(chalk.cyan('Available templates:\n'));
      for (const t of listTemplates()) {
        console.log(`  ${chalk.bold(t.id)} - ${t.description}`);
      }
      return;
    }

    if (!name) {
      console.error(chalk.red('Error: project name is required'));
      console.error(chalk.dim('Usage: rev new <name>'));
      process.exit(1);
    }

    const template = getTemplate(options.template);
    if (!template) {
      console.error(chalk.red(`Unknown template: ${options.template}`));
      console.error(chalk.dim('Use --list to see available templates.'));
      process.exit(1);
    }

    const projectDir = path.resolve(name);

    if (fs.existsSync(projectDir)) {
      console.error(chalk.red(`Directory already exists: ${name}`));
      process.exit(1);
    }

    console.log(chalk.cyan(`Creating ${template.name} project in ${name}/...\n`));

    // Create directory
    fs.mkdirSync(projectDir, { recursive: true });

    // Create subdirectories
    for (const subdir of template.directories || []) {
      fs.mkdirSync(path.join(projectDir, subdir), { recursive: true });
      console.log(chalk.dim(`  Created ${subdir}/`));
    }

    // Create files
    for (const [filename, content] of Object.entries(template.files)) {
      const filePath = path.join(projectDir, filename);
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(chalk.dim(`  Created ${filename}`));
    }

    console.log(chalk.green(`\nProject created!`));
    console.log(chalk.cyan('\nNext steps:'));
    console.log(chalk.dim(`  cd ${name}`));
    console.log(chalk.dim('  # Edit rev.yaml with your paper details'));
    console.log(chalk.dim('  # Write your sections'));
    console.log(chalk.dim('  rev build          # Build PDF and DOCX'));
    console.log(chalk.dim('  rev build pdf      # Build PDF only'));
  });

// ============================================================================
// CONFIG command - Set user preferences
// ============================================================================

program
  .command('config')
  .description('Set user preferences')
  .argument('<key>', 'Config key: user')
  .argument('[value]', 'Value to set')
  .action((key, value) => {
    if (key === 'user') {
      if (value) {
        setUserName(value);
        console.log(chalk.green(`User name set to: ${value}`));
        console.log(chalk.dim(`Saved to ${getConfigPath()}`));
      } else {
        const name = getUserName();
        if (name) {
          console.log(`Current user: ${chalk.bold(name)}`);
        } else {
          console.log(chalk.yellow('No user name set.'));
          console.log(chalk.dim('Set with: rev config user "Your Name"'));
        }
      }
    } else {
      console.error(chalk.red(`Unknown config key: ${key}`));
      console.error(chalk.dim('Available keys: user'));
      process.exit(1);
    }
  });

// ============================================================================
// REPLY command - Reply to comments in a file
// ============================================================================

program
  .command('reply')
  .description('Reply to reviewer comments interactively')
  .argument('<file>', 'Markdown file with comments')
  .option('-m, --message <text>', 'Reply message (non-interactive)')
  .option('-n, --number <n>', 'Reply to specific comment number', parseInt)
  .option('-a, --author <name>', 'Override author name')
  .action(async (file, options) => {
    if (!fs.existsSync(file)) {
      console.error(chalk.red(`File not found: ${file}`));
      process.exit(1);
    }

    // Get author name
    let author = options.author || getUserName();
    if (!author) {
      console.error(chalk.yellow('No user name set.'));
      console.error(chalk.dim('Set with: rev config user "Your Name"'));
      console.error(chalk.dim('Or use: rev reply <file> --author "Your Name"'));
      process.exit(1);
    }

    const text = fs.readFileSync(file, 'utf-8');
    const comments = getComments(text);

    if (comments.length === 0) {
      console.log(chalk.green('No comments found in this file.'));
      return;
    }

    // Non-interactive mode: reply to specific comment
    if (options.message && options.number !== undefined) {
      const idx = options.number - 1;
      if (idx < 0 || idx >= comments.length) {
        console.error(chalk.red(`Invalid comment number. File has ${comments.length} comments.`));
        process.exit(1);
      }
      const result = addReply(text, comments[idx], author, options.message);
      fs.writeFileSync(file, result, 'utf-8');
      console.log(chalk.green(`Reply added to comment #${options.number}`));
      return;
    }

    // Interactive mode
    console.log(chalk.cyan(`\nComments in ${path.basename(file)} (replying as ${chalk.bold(author)}):\n`));

    const rl = (await import('readline')).createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const askQuestion = (prompt) =>
      new Promise((resolve) => rl.question(prompt, resolve));

    let result = text;
    let repliesAdded = 0;

    for (let i = 0; i < comments.length; i++) {
      const c = comments[i];
      const authorLabel = c.author ? chalk.blue(`[${c.author}]`) : chalk.dim('[Anonymous]');
      const preview = c.content.length > 100 ? c.content.slice(0, 100) + '...' : c.content;

      console.log(`\n${chalk.bold(`#${i + 1}`)} ${authorLabel}`);
      console.log(chalk.dim(`  Line ${c.line}: "${c.before?.trim().slice(-30) || ''}..."`));
      console.log(`  ${preview}`);

      const answer = await askQuestion(chalk.cyan('\n  Reply (or Enter to skip, q to quit): '));

      if (answer.toLowerCase() === 'q') {
        break;
      }

      if (answer.trim()) {
        result = addReply(result, c, author, answer.trim());
        repliesAdded++;
        console.log(chalk.green('  ✓ Reply added'));
      }
    }

    rl.close();

    if (repliesAdded > 0) {
      fs.writeFileSync(file, result, 'utf-8');
      console.log(chalk.green(`\nAdded ${repliesAdded} reply(ies) to ${file}`));
    } else {
      console.log(chalk.dim('\nNo replies added.'));
    }
  });

/**
 * Add a reply after a comment
 * @param {string} text - Full document text
 * @param {object} comment - Comment object with position and match
 * @param {string} author - Reply author name
 * @param {string} message - Reply message
 * @returns {string} Updated text
 */
function addReply(text, comment, author, message) {
  const replyAnnotation = `{>>${author}: ${message}<<}`;
  const insertPos = comment.position + comment.match.length;

  // Insert reply right after the original comment
  return text.slice(0, insertPos) + ' ' + replyAnnotation + text.slice(insertPos);
}

// ============================================================================
// RESPONSE command - Generate response letter for reviewers
// ============================================================================

program
  .command('response')
  .description('Generate response letter from reviewer comments')
  .argument('[files...]', 'Markdown files to process (default: all section files)')
  .option('-o, --output <file>', 'Output file (default: response-letter.md)')
  .option('-a, --author <name>', 'Author name for identifying replies')
  .option('--no-context', 'Omit context snippets')
  .option('--no-location', 'Omit file:line references')
  .action(async (files, options) => {
    // If no files specified, find all .md files
    let mdFiles = files;
    if (!mdFiles || mdFiles.length === 0) {
      const allFiles = fs.readdirSync('.').filter(f =>
        f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f)
      );
      mdFiles = allFiles;
    }

    if (mdFiles.length === 0) {
      console.error(fmt.status('error', 'No markdown files found'));
      process.exit(1);
    }

    const spin = fmt.spinner('Collecting comments...').start();

    const comments = collectComments(mdFiles);
    spin.stop();

    if (comments.length === 0) {
      console.log(fmt.status('info', 'No comments found in files'));
      return;
    }

    // Generate response letter
    const letter = generateResponseLetter(comments, {
      authorName: options.author || getUserName() || 'Author',
      includeContext: options.context !== false,
      includeLocation: options.location !== false,
    });

    const outputPath = options.output || 'response-letter.md';
    fs.writeFileSync(outputPath, letter, 'utf-8');

    // Show summary
    const grouped = groupByReviewer(comments);
    const reviewers = [...grouped.keys()].filter(r =>
      !r.toLowerCase().includes('claude') &&
      r.toLowerCase() !== (options.author || '').toLowerCase()
    );

    console.log(fmt.header('Response Letter Generated'));
    console.log();

    const rows = reviewers.map(r => [r, grouped.get(r).length.toString()]);
    console.log(fmt.table(['Reviewer', 'Comments'], rows));
    console.log();
    console.log(fmt.status('success', `Created ${outputPath}`));
  });

// ============================================================================
// CITATIONS command - Validate citations against .bib file
// ============================================================================

program
  .command('citations')
  .alias('cite')
  .description('Validate citations against bibliography')
  .argument('[files...]', 'Markdown files to check (default: all section files)')
  .option('-b, --bib <file>', 'Bibliography file', 'references.bib')
  .action((files, options) => {
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

// ============================================================================
// FIGURES command - Figure/table inventory
// ============================================================================

program
  .command('figures')
  .alias('figs')
  .description('List all figures and tables with reference counts')
  .argument('[files...]', 'Markdown files to scan')
  .action((files) => {
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

// ============================================================================
// EQUATIONS command - Extract and convert equations
// ============================================================================

program
  .command('equations')
  .alias('eq')
  .description('Extract equations or convert to Word')
  .argument('<action>', 'Action: list, extract, convert, from-word')
  .argument('[input]', 'Input file (.md for extract/convert, .docx for from-word)')
  .option('-o, --output <file>', 'Output file')
  .action(async (action, input, options) => {
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

// ============================================================================
// DOI command - Validate and fetch DOIs
// ============================================================================

program
  .command('doi')
  .description('Validate DOIs in bibliography or fetch citations from DOI')
  .argument('<action>', 'Action: check, fetch, add, lookup')
  .argument('[input]', 'DOI (for fetch/add) or .bib file (for check)')
  .option('-b, --bib <file>', 'Bibliography file', 'references.bib')
  .option('--strict', 'Fail on missing DOIs for articles')
  .option('--no-resolve', 'Only check format, skip resolution check')
  .option('--confidence <level>', 'Minimum confidence: high, medium, low (default: medium)', 'medium')
  .action(async (action, input, options) => {
    if (action === 'check') {
      const bibPath = input || options.bib;

      if (!fs.existsSync(bibPath)) {
        console.error(fmt.status('error', `File not found: ${bibPath}`));
        process.exit(1);
      }

      console.log(fmt.header(`DOI Check: ${path.basename(bibPath)}`));
      console.log();

      const spin = fmt.spinner('Validating DOIs...').start();

      try {
        const results = await checkBibDois(bibPath, {
          checkMissing: options.strict,
        });

        spin.stop();

        // Group results by status
        const valid = results.entries.filter(e => e.status === 'valid');
        const invalid = results.entries.filter(e => e.status === 'invalid');
        const missing = results.entries.filter(e => e.status === 'missing');
        const skipped = results.entries.filter(e => e.status === 'skipped');

        // Summary table
        const summaryRows = [
          [chalk.green('Valid'), chalk.green(valid.length.toString())],
          [invalid.length > 0 ? chalk.red('Invalid') : 'Invalid', invalid.length > 0 ? chalk.red(invalid.length.toString()) : '0'],
          [missing.length > 0 ? chalk.yellow('Missing (articles)') : 'Missing', missing.length > 0 ? chalk.yellow(missing.length.toString()) : '0'],
          [chalk.dim('Skipped'), chalk.dim(skipped.length.toString())],
        ];
        console.log(fmt.table(['Status', 'Count'], summaryRows));
        console.log();

        // Show invalid DOIs
        if (invalid.length > 0) {
          console.log(chalk.red('Invalid DOIs:'));
          for (const e of invalid) {
            console.log(`  ${chalk.bold(e.key)}: ${e.doi || 'N/A'}`);
            console.log(chalk.dim(`    ${e.message}`));
          }
          console.log();
        }

        // Show missing (articles without DOI)
        if (missing.length > 0) {
          console.log(chalk.yellow('Missing DOIs (should have DOI):'));
          for (const e of missing) {
            console.log(`  ${chalk.bold(e.key)} [${e.type}]`);
            if (e.title) console.log(chalk.dim(`    "${e.title}"`));
          }
          console.log();
        }

        // Show skipped breakdown
        if (skipped.length > 0) {
          // Count by reason
          const manualSkip = skipped.filter(e => e.message === 'Marked as no-doi');
          const bookTypes = skipped.filter(e => e.message?.includes('typically has no DOI'));
          const noField = skipped.filter(e => e.message === 'No DOI field');

          console.log(chalk.dim('Skipped entries:'));
          if (manualSkip.length > 0) {
            console.log(chalk.dim(`  ${manualSkip.length} marked with nodoi={true}`));
          }
          if (bookTypes.length > 0) {
            const types = [...new Set(bookTypes.map(e => e.type))].join(', ');
            console.log(chalk.dim(`  ${bookTypes.length} by type (${types})`));
          }
          if (noField.length > 0) {
            console.log(chalk.dim(`  ${noField.length} with no DOI field`));
          }
          console.log();
        }

        // Final status
        if (invalid.length === 0 && missing.length === 0) {
          console.log(fmt.status('success', 'All DOIs valid'));
        } else if (invalid.length > 0) {
          console.log(fmt.status('error', `${invalid.length} invalid DOI(s) found`));
          if (options.strict) process.exit(1);
        } else {
          console.log(fmt.status('warning', `${missing.length} article(s) missing DOI`));
        }

        // Hint about skipping
        console.log();
        console.log(chalk.dim('To skip DOI check for an entry, add: nodoi = {true}'));
        console.log(chalk.dim('Or add comment before entry: % no-doi'));

      } catch (err) {
        spin.stop();
        console.error(fmt.status('error', err.message));
        process.exit(1);
      }

    } else if (action === 'fetch') {
      if (!input) {
        console.error(fmt.status('error', 'DOI required'));
        console.log(chalk.dim('Usage: rev doi fetch 10.1234/example'));
        process.exit(1);
      }

      const spin = fmt.spinner(`Fetching BibTeX for ${input}...`).start();

      try {
        const result = await fetchBibtex(input);

        if (result.success) {
          spin.success('BibTeX retrieved');
          console.log();
          console.log(result.bibtex);
        } else {
          spin.error(result.error);
          process.exit(1);
        }
      } catch (err) {
        spin.error(err.message);
        process.exit(1);
      }

    } else if (action === 'add') {
      if (!input) {
        console.error(fmt.status('error', 'DOI required'));
        console.log(chalk.dim('Usage: rev doi add 10.1234/example'));
        process.exit(1);
      }

      const bibPath = options.bib;
      const spin = fmt.spinner(`Fetching and adding ${input}...`).start();

      try {
        const fetchResult = await fetchBibtex(input);

        if (!fetchResult.success) {
          spin.error(fetchResult.error);
          process.exit(1);
        }

        const addResult = addToBib(bibPath, fetchResult.bibtex);

        if (addResult.success) {
          spin.success(`Added @${addResult.key} to ${bibPath}`);
        } else {
          spin.error(addResult.error);
          process.exit(1);
        }
      } catch (err) {
        spin.error(err.message);
        process.exit(1);
      }

    } else if (action === 'lookup') {
      const bibPath = input || options.bib;

      if (!fs.existsSync(bibPath)) {
        console.error(fmt.status('error', `File not found: ${bibPath}`));
        process.exit(1);
      }

      console.log(fmt.header(`DOI Lookup: ${path.basename(bibPath)}`));
      console.log();

      const entries = parseBibEntries(bibPath);
      const missing = entries.filter(e => !e.doi && !e.skip && e.expectDoi);

      if (missing.length === 0) {
        console.log(fmt.status('success', 'No entries need DOI lookup'));
        return;
      }

      console.log(chalk.dim(`Found ${missing.length} entries without DOIs to search...\n`));

      let found = 0;
      let notFound = 0;
      let lowConfidence = 0;
      const results = [];

      for (let i = 0; i < missing.length; i++) {
        const entry = missing[i];

        // Extract first author last name
        let author = '';
        if (entry.authorRaw) {
          const firstAuthor = entry.authorRaw.split(' and ')[0];
          // Handle "Last, First" or "First Last" formats
          if (firstAuthor.includes(',')) {
            author = firstAuthor.split(',')[0].trim();
          } else {
            const parts = firstAuthor.trim().split(/\s+/);
            author = parts[parts.length - 1]; // Last word is usually surname
          }
        }

        process.stdout.write(`\r${chalk.dim(`[${i + 1}/${missing.length}]`)} ${entry.key}...`);

        const result = await lookupDoi(entry.title, author, entry.year, entry.journal);

        if (result.found) {
          if (result.confidence === 'high') {
            found++;
            results.push({ entry, result, status: 'found' });
          } else if (result.confidence === 'medium') {
            found++;
            results.push({ entry, result, status: 'found' });
          } else {
            lowConfidence++;
            results.push({ entry, result, status: 'low' });
          }
        } else {
          notFound++;
          results.push({ entry, result, status: 'not-found' });
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 200));
      }

      // Clear progress line
      process.stdout.write('\r\x1B[K');

      // Show results
      console.log(fmt.table(
        ['Status', 'Count'],
        [
          [chalk.green('Found (high/medium confidence)'), chalk.green(found.toString())],
          [chalk.yellow('Found (low confidence)'), chalk.yellow(lowConfidence.toString())],
          [chalk.dim('Not found'), chalk.dim(notFound.toString())],
        ]
      ));
      console.log();

      // Filter by confidence level
      const confLevel = options.confidence || 'medium';
      const confLevels = { high: 3, medium: 2, low: 1 };
      const minConf = confLevels[confLevel] || 2;

      const filteredResults = results.filter(r => {
        if (r.status === 'not-found') return false;
        const resultConf = confLevels[r.result.confidence] || 1;
        return resultConf >= minConf;
      });

      const hiddenCount = results.filter(r => {
        if (r.status === 'not-found') return false;
        const resultConf = confLevels[r.result.confidence] || 1;
        return resultConf < minConf;
      }).length;

      if (filteredResults.length > 0) {
        console.log(chalk.cyan(`Found DOIs (${confLevel}+ confidence):`));
        console.log();

        for (const { entry, result } of filteredResults) {
          const conf = result.confidence === 'high' ? chalk.green('●') :
                       result.confidence === 'medium' ? chalk.yellow('●') :
                       chalk.red('○');

          // Check year match
          const entryYear = entry.year;
          const foundYear = result.metadata?.year;
          const yearExact = entryYear && foundYear && entryYear === foundYear;
          const yearClose = entryYear && foundYear && Math.abs(entryYear - foundYear) === 1;
          const yearMismatch = entryYear && foundYear && Math.abs(entryYear - foundYear) > 1;

          console.log(`  ${conf} ${chalk.bold(entry.key)} (${entryYear || '?'})`);
          console.log(chalk.dim(`     Title: ${entry.title}`));
          console.log(chalk.cyan(`     DOI: ${result.doi}`));

          if (result.metadata?.journal) {
            let yearDisplay;
            if (yearExact) {
              yearDisplay = chalk.green(`(${foundYear})`);
            } else if (yearClose) {
              yearDisplay = chalk.yellow(`(${foundYear}) ≈`);
            } else if (yearMismatch) {
              yearDisplay = chalk.red.bold(`(${foundYear}) ⚠ YEAR MISMATCH`);
            } else {
              yearDisplay = chalk.dim(`(${foundYear || '?'})`);
            }
            console.log(`     ${chalk.dim('Found:')} ${result.metadata.journal} ${yearDisplay}`);
          }

          // Extra warning for year mismatch
          if (yearMismatch) {
            console.log(chalk.red(`     ⚠ Expected ${entryYear}, found ${foundYear} - verify this is correct!`));
          }

          console.log();
        }

        // Offer to add DOIs
        console.log(chalk.dim('To add a DOI to your .bib file:'));
        console.log(chalk.dim('  1. Open references.bib'));
        console.log(chalk.dim('  2. Add: doi = {10.xxxx/xxxxx}'));
        console.log();
        console.log(chalk.dim('Or use: rev doi add <doi> to fetch full BibTeX'));
      }

      // Show hidden count
      if (hiddenCount > 0) {
        console.log(chalk.yellow(`\n${hiddenCount} lower-confidence matches hidden.`));
        if (confLevel === 'high') {
          console.log(chalk.dim('Use --confidence medium or --confidence low to show more.'));
        } else if (confLevel === 'medium') {
          console.log(chalk.dim('Use --confidence low to show all matches.'));
        }
      }

      // Show not found
      if (notFound > 0) {
        console.log(chalk.dim(`${notFound} entries could not be matched. These may be:`));
        console.log(chalk.dim('  - Books, theses, or reports (often no DOI)'));
        console.log(chalk.dim('  - Very old papers (pre-DOI era)'));
        console.log(chalk.dim('  - Title mismatch (special characters, abbreviations)'));
      }

    } else {
      console.error(fmt.status('error', `Unknown action: ${action}`));
      console.log(chalk.dim('Actions: check, fetch, add, lookup'));
      process.exit(1);
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
  ${chalk.dim('3.')} Import their changes (extracts both track changes AND comments):

     ${chalk.green('rev sections reviewed.docx')}

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

${chalk.bold('IMPORT & BUILD')}

  ${chalk.bold('rev sections')} <docx>       Import Word doc to section files
  ${chalk.bold('rev import')} <docx> [md]    Import/diff Word against Markdown
  ${chalk.bold('rev extract')} <docx>        Extract plain text from Word
  ${chalk.bold('rev build')} [formats]       Build PDF/DOCX/TEX from sections
  ${chalk.bold('rev new')} [name]            Create new project from template

${chalk.bold('REVIEW & EDIT')}

  ${chalk.bold('rev review')} <file>         Interactive accept/reject TUI
  ${chalk.bold('rev status')} <file>         Show annotation statistics
  ${chalk.bold('rev comments')} <file>       List all comments with context
  ${chalk.bold('rev reply')} <file>          Reply to reviewer comments
  ${chalk.bold('rev strip')} <file>          Output clean text (no annotations)
  ${chalk.bold('rev resolve')} <file>        Mark comments resolved/pending

${chalk.bold('CROSS-REFERENCES')}

  ${chalk.bold('rev refs')} [file]           Show figure/table registry
  ${chalk.bold('rev migrate')} <file>        Convert "Fig. 1" to @fig:label
  ${chalk.bold('rev figures')} [files]       List figures with ref counts

${chalk.bold('CITATIONS & EQUATIONS')}

  ${chalk.bold('rev citations')} [files]     Validate citations against .bib
  ${chalk.bold('rev equations')} <action>    Extract/export LaTeX equations
  ${chalk.bold('rev response')} [files]      Generate response letter

${chalk.bold('CONFIGURATION')}

  ${chalk.bold('rev config')} <key> [value]  Set user preferences
  ${chalk.bold('rev init')}                  Generate sections.yaml
  ${chalk.bold('rev install')}               Check/install dependencies
  ${chalk.bold('rev help')} [topic]          Show help (workflow, syntax, commands)

${chalk.bold('BIBLIOGRAPHY & DOIs')}

  ${chalk.bold('rev doi check')} [file.bib]  Validate DOIs via Crossref + DataCite
      ${chalk.dim('--strict')}               Fail if articles missing DOIs

  ${chalk.bold('rev doi lookup')} [file.bib] Search for missing DOIs by title/author/year
      ${chalk.dim('--confidence <level>')}   Filter by: high, medium, low

  ${chalk.bold('rev doi fetch')} <doi>       Fetch BibTeX entry from DOI
  ${chalk.bold('rev doi add')} <doi>         Fetch and add entry to bibliography

  ${chalk.dim('Skip entries: add nodoi = {true} or % no-doi comment')}

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

  ${chalk.dim('# Validate DOIs in bibliography')}
  rev doi check references.bib

  ${chalk.dim('# Find missing DOIs')}
  rev doi lookup references.bib --confidence medium

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
