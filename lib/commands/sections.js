/**
 * Section commands: import, extract, split, sync, merge
 *
 * Commands for importing Word documents, splitting/syncing section files.
 */

import {
  chalk,
  fs,
  path,
  fmt,
  findFiles,
  countAnnotations,
  loadConfig,
  extractSectionsFromText,
  splitAnnotatedPaper,
  buildRegistry,
  convertHardcodedRefs,
  inlineDiffPreview,
} from './context.js';

/**
 * Detect sections from Word document text
 * Looks for common academic paper section headers
 */
function detectSectionsFromWord(text) {
  const lines = text.split('\n');
  const sections = [];

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

  const numberedHeaderPattern = /^(\d+\.?\s+)(Abstract|Introduction|Background|Methods?|Materials|Results?|Discussion|Conclusions?|References|Acknowledgements?|Appendix)/i;

  let currentSection = null;
  let currentContent = [];
  let preambleContent = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (currentSection) {
        currentContent.push(line);
      } else {
        preambleContent.push(line);
      }
      continue;
    }

    let isHeader = false;
    let headerText = trimmed;

    for (const pattern of headerPatterns) {
      if (pattern.test(trimmed)) {
        isHeader = true;
        break;
      }
    }

    if (!isHeader) {
      const match = trimmed.match(numberedHeaderPattern);
      if (match) {
        isHeader = true;
        headerText = trimmed.replace(/^\d+\.?\s+/, '');
      }
    }

    if (isHeader) {
      if (currentSection) {
        sections.push({
          header: currentSection,
          content: currentContent.join('\n'),
          file: headerToFilename(currentSection),
        });
      } else if (preambleContent.some(l => l.trim())) {
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

  if (currentSection) {
    sections.push({
      header: currentSection,
      content: currentContent.join('\n'),
      file: headerToFilename(currentSection),
    });
  }

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

/**
 * Bootstrap a new project from a Word document
 */
async function bootstrapFromWord(docx, options) {
  const outputDir = path.resolve(options.output);

  console.log(chalk.cyan(`Bootstrapping project from ${path.basename(docx)}...\n`));

  try {
    const mammoth = await import('mammoth');
    const { default: YAML } = await import('yaml');

    const result = await mammoth.extractRawText({ path: docx });
    const text = result.value;

    const sections = detectSectionsFromWord(text);

    if (sections.length === 0) {
      console.error(chalk.yellow('No sections detected. Creating single content.md file.'));
      sections.push({ header: 'Content', content: text, file: 'content.md' });
    }

    console.log(chalk.green(`Detected ${sections.length} section(s):\n`));

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

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

    const docxName = path.basename(docx, '.docx');
    const title = docxName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

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
      fs.writeFileSync(configPath, YAML.stringify(config), 'utf-8');
    }

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
 * Register section commands with the program
 * @param {import('commander').Command} program
 */
export function register(program) {
  // ==========================================================================
  // IMPORT command - Import from Word (bootstrap or diff mode)
  // ==========================================================================

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

      if (!original) {
        await bootstrapFromWord(docx, options);
        return;
      }

      if (!fs.existsSync(original)) {
        console.error(chalk.red(`Error: Original MD not found: ${original}`));
        process.exit(1);
      }

      console.log(chalk.cyan(`Comparing ${path.basename(docx)} against ${path.basename(original)}...`));

      try {
        const { importFromWord } = await import('../import.js');
        const { annotated, stats } = await importFromWord(docx, original, {
          author: options.author,
        });

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

  // ==========================================================================
  // EXTRACT command - Just extract text from Word
  // ==========================================================================

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

  // ==========================================================================
  // SPLIT command - Split annotated paper.md back to section files
  // ==========================================================================

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

  // ==========================================================================
  // SYNC command - Import with section awareness
  // ==========================================================================

  program
    .command('sync')
    .alias('sections')
    .description('Sync feedback from Word/PDF back to section files')
    .argument('[file]', 'Word (.docx) or PDF file from reviewer (default: most recent)')
    .argument('[sections...]', 'Specific sections to sync (default: all)')
    .option('-c, --config <file>', 'Sections config file', 'sections.yaml')
    .option('-d, --dir <directory>', 'Directory with section files', '.')
    .option('--no-crossref', 'Skip converting hardcoded figure/table refs')
    .option('--no-diff', 'Skip showing diff preview')
    .option('--force', 'Overwrite files without conflict warning')
    .option('--dry-run', 'Preview without writing files')
    .action(async (docx, sections, options) => {
      // Auto-detect most recent docx or pdf if not provided
      if (!docx) {
        const docxFiles = findFiles('.docx');
        const pdfFiles = findFiles('.pdf');
        const allFiles = [...docxFiles, ...pdfFiles];

        if (allFiles.length === 0) {
          console.error(fmt.status('error', 'No .docx or .pdf files found in current directory.'));
          process.exit(1);
        }
        const sorted = allFiles
          .map(f => ({ name: f, mtime: fs.statSync(f).mtime }))
          .sort((a, b) => b.mtime - a.mtime);
        docx = sorted[0].name;
        console.log(fmt.status('info', `Using most recent: ${docx}`));
        console.log();
      }

      if (!fs.existsSync(docx)) {
        console.error(fmt.status('error', `File not found: ${docx}`));
        process.exit(1);
      }

      // Handle PDF files
      if (docx.toLowerCase().endsWith('.pdf')) {
        const { extractPdfComments, formatPdfComments, getPdfCommentStats } = await import('../pdf-import.js');

        const spin = fmt.spinner(`Extracting comments from ${path.basename(docx)}...`).start();

        try {
          const comments = await extractPdfComments(docx);
          spin.stop();

          if (comments.length === 0) {
            console.log(fmt.status('info', 'No comments found in PDF.'));
            return;
          }

          const stats = getPdfCommentStats(comments);
          console.log(fmt.header(`PDF Comments from ${path.basename(docx)}`));
          console.log();
          console.log(formatPdfComments(comments));
          console.log();

          const authorList = Object.entries(stats.byAuthor)
            .map(([author, count]) => `${author} (${count})`)
            .join(', ');
          console.log(chalk.dim(`Total: ${stats.total} comments from ${authorList}`));
          console.log();

          const configPath = path.resolve(options.dir, options.config);
          if (fs.existsSync(configPath) && !options.dryRun) {
            const config = loadConfig(configPath);
            const mainSection = config.sections?.[0];

            if (mainSection) {
              const mainPath = path.join(options.dir, mainSection);
              if (fs.existsSync(mainPath)) {
                console.log(chalk.dim(`Use 'rev pdf-comments ${docx} --append ${mainSection}' to add comments to markdown.`));
              }
            }
          }
        } catch (err) {
          spin.stop();
          console.error(fmt.status('error', `Failed to extract PDF comments: ${err.message}`));
          if (process.env.DEBUG) console.error(err.stack);
          process.exit(1);
        }
        return;
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
        const { importFromWord, extractWordComments, extractCommentAnchors, insertCommentsIntoMarkdown } = await import('../import.js');

        let registry = null;
        let totalRefConversions = 0;
        if (options.crossref !== false) {
          registry = buildRegistry(options.dir);
        }

        const comments = await extractWordComments(docx);
        const anchors = await extractCommentAnchors(docx);

        const wordResult = await mammoth.extractRawText({ path: docx });
        const wordText = wordResult.value;

        let wordSections = extractSectionsFromText(wordText, config.sections);

        if (wordSections.length === 0) {
          spin.stop();
          console.error(fmt.status('warning', 'No sections detected in Word document.'));
          console.error(chalk.dim('  Check that headings match sections.yaml'));
          process.exit(1);
        }

        if (sections && sections.length > 0) {
          const onlyList = sections.map(s => s.trim().toLowerCase());
          wordSections = wordSections.filter(section => {
            const fileName = section.file.replace(/\.md$/i, '').toLowerCase();
            const header = section.header.toLowerCase();
            return onlyList.some(name => fileName === name || fileName.includes(name) || header.includes(name));
          });
          if (wordSections.length === 0) {
            spin.stop();
            console.error(fmt.status('error', `No sections matched: ${sections.join(', ')}`));
            console.error(chalk.dim(`  Available: ${extractSectionsFromText(wordText, config.sections).map(s => s.file.replace(/\.md$/i, '')).join(', ')}`));
            process.exit(1);
          }
        }

        spin.stop();
        console.log(fmt.header(`Import from ${path.basename(docx)}`));
        console.log();

        // Conflict detection
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

          const result = await importFromWord(docx, sectionPath, {
            sectionContent: section.content,
            author: 'Reviewer',
          });

          let { annotated, stats } = result;

          let refConversions = [];
          if (registry && options.crossref !== false) {
            const crossrefResult = convertHardcodedRefs(annotated, registry);
            annotated = crossrefResult.converted;
            refConversions = crossrefResult.conversions;
            totalRefConversions += refConversions.length;
          }

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

        if (options.diff !== false && totalChanges > 0) {
          console.log(fmt.header('Changes Preview'));
          console.log();
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

  // ==========================================================================
  // MERGE command - Combine feedback from multiple reviewers
  // ==========================================================================

  program
    .command('merge')
    .description('Merge feedback from multiple Word documents')
    .argument('<original>', 'Original markdown file')
    .argument('<docx...>', 'Word documents from reviewers')
    .option('-o, --output <file>', 'Output file (default: original-merged.md)')
    .option('--names <names>', 'Reviewer names (comma-separated, in order of docx files)')
    .option('--auto', 'Auto-resolve conflicts by taking first change')
    .option('--dry-run', 'Show conflicts without writing')
    .action(async (original, docxFiles, options) => {
      const { mergeReviewerDocs, formatConflict, resolveConflict } = await import('../merge.js');

      if (!fs.existsSync(original)) {
        console.error(fmt.status('error', `Original file not found: ${original}`));
        process.exit(1);
      }

      for (const docx of docxFiles) {
        if (!fs.existsSync(docx)) {
          console.error(fmt.status('error', `Reviewer file not found: ${docx}`));
          process.exit(1);
        }
      }

      const names = options.names
        ? options.names.split(',').map(n => n.trim())
        : docxFiles.map((f, i) => `Reviewer ${i + 1}`);

      if (names.length < docxFiles.length) {
        for (let i = names.length; i < docxFiles.length; i++) {
          names.push(`Reviewer ${i + 1}`);
        }
      }

      const reviewerDocs = docxFiles.map((p, i) => ({
        path: p,
        name: names[i],
      }));

      console.log(fmt.header('Multi-Reviewer Merge'));
      console.log();
      console.log(chalk.dim(`  Original: ${original}`));
      console.log(chalk.dim(`  Reviewers: ${names.join(', ')}`));
      console.log();

      const spin = fmt.spinner('Analyzing changes...').start();

      try {
        const { merged, conflicts, stats, originalText } = await mergeReviewerDocs(original, reviewerDocs, {
          autoResolve: options.auto,
        });

        spin.stop();

        console.log(fmt.table(['Metric', 'Count'], [
          ['Total changes', stats.totalChanges.toString()],
          ['Non-conflicting', stats.nonConflicting.toString()],
          ['Conflicts', stats.conflicts.toString()],
          ['Comments', stats.comments.toString()],
        ]));
        console.log();

        if (conflicts.length > 0) {
          console.log(chalk.yellow(`Found ${conflicts.length} conflict(s):\n`));

          let resolvedMerged = merged;

          for (let i = 0; i < conflicts.length; i++) {
            const conflict = conflicts[i];
            console.log(chalk.bold(`Conflict ${i + 1}/${conflicts.length}:`));
            console.log(formatConflict(conflict, originalText));
            console.log();

            if (options.auto) {
              console.log(chalk.dim(`  Auto-resolved: using ${conflict.changes[0].reviewer}'s change`));
              resolvedMerged = resolveConflict(resolvedMerged, conflict, 0, originalText);
            } else if (!options.dryRun) {
              const rl = await import('readline');
              const readline = rl.createInterface({
                input: process.stdin,
                output: process.stdout,
              });

              const answer = await new Promise((resolve) =>
                readline.question(chalk.cyan(`  Choose (1-${conflict.changes.length}, s=skip): `), resolve)
              );
              readline.close();

              if (answer.toLowerCase() !== 's' && !isNaN(parseInt(answer))) {
                const choice = parseInt(answer) - 1;
                if (choice >= 0 && choice < conflict.changes.length) {
                  resolvedMerged = resolveConflict(resolvedMerged, conflict, choice, originalText);
                  console.log(chalk.green(`  Applied: ${conflict.changes[choice].reviewer}'s change`));
                }
              } else {
                console.log(chalk.dim('  Skipped'));
              }
              console.log();
            }
          }

          if (!options.dryRun) {
            const outPath = options.output || original.replace(/\.md$/, '-merged.md');
            fs.writeFileSync(outPath, resolvedMerged, 'utf-8');
            console.log(fmt.status('success', `Merged output written to ${outPath}`));
          }
        } else {
          if (!options.dryRun) {
            const outPath = options.output || original.replace(/\.md$/, '-merged.md');
            fs.writeFileSync(outPath, merged, 'utf-8');
            console.log(fmt.status('success', `Merged output written to ${outPath}`));
          } else {
            console.log(fmt.status('info', 'Dry run - no output written'));
          }
        }

        if (!options.dryRun && stats.nonConflicting > 0) {
          console.log();
          console.log(chalk.dim('Next steps:'));
          console.log(chalk.dim('  1. rev review <merged.md>  - Review all changes'));
          console.log(chalk.dim('  2. rev comments <merged.md> - Address comments'));
        }
      } catch (err) {
        spin.stop();
        console.error(fmt.status('error', err.message));
        if (process.env.DEBUG) console.error(err.stack);
        process.exit(1);
      }
    });
}
