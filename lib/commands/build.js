/**
 * Build commands: build, install, doctor, refs, migrate
 *
 * Commands for building documents and managing dependencies.
 */

import {
  chalk,
  fs,
  path,
  fmt,
  findFiles,
  stripAnnotations,
  buildRegistry,
  detectHardcodedRefs,
  convertHardcodedRefs,
  getRefStatus,
  formatRegistry,
  build,
  loadBuildConfig,
  hasPandoc,
  hasPandocCrossref,
  formatBuildResults,
  getUserName,
} from './context.js';

/**
 * Register build commands with the program
 * @param {import('commander').Command} program
 * @param {object} pkg - Package.json object for version info
 */
export function register(program, pkg) {
  // ==========================================================================
  // REFS command - Show figure/table reference status
  // ==========================================================================

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

      console.log(chalk.bold('Registry:'));
      console.log(formatRegistry(registry));

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

  // ==========================================================================
  // MIGRATE command - Convert hardcoded refs to dynamic
  // ==========================================================================

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

        const sortedRefs = [...refs].sort((a, b) => b.position - a.position);

        for (const ref of sortedRefs) {
          const num = ref.numbers[0];
          const { numberToLabel } = await import('../crossref.js');
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
            result = result.slice(0, ref.position) + replacement + result.slice(ref.position + ref.match.length);
            converted++;

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

  // ==========================================================================
  // INSTALL command - Install dependencies
  // ==========================================================================

  program
    .command('install')
    .description('Check and install dependencies (pandoc-crossref)')
    .option('--check', 'Only check, don\'t install')
    .action(async (options) => {
      const os = await import('os');
      const { execSync } = await import('child_process');
      const platform = os.platform();

      console.log(chalk.cyan('Checking dependencies...\n'));

      let hasPandocInstalled = false;
      try {
        const version = execSync('pandoc --version', { encoding: 'utf-8' }).split('\n')[0];
        console.log(chalk.green(`  ✓ ${version}`));
        hasPandocInstalled = true;
      } catch {
        console.log(chalk.red('  ✗ pandoc not found'));
      }

      let hasCrossref = false;
      try {
        const version = execSync('pandoc-crossref --version', { encoding: 'utf-8' }).split('\n')[0];
        console.log(chalk.green(`  ✓ pandoc-crossref ${version}`));
        hasCrossref = true;
      } catch {
        console.log(chalk.yellow('  ✗ pandoc-crossref not found'));
      }

      try {
        await import('mammoth');
        console.log(chalk.green('  ✓ mammoth (Word parsing)'));
      } catch {
        console.log(chalk.red('  ✗ mammoth not found - run: npm install'));
      }

      console.log('');

      if (hasPandocInstalled && hasCrossref) {
        console.log(chalk.green('All dependencies installed!'));
        return;
      }

      if (options.check) {
        if (!hasCrossref) {
          console.log(chalk.yellow('pandoc-crossref is optional but recommended for @fig: references.'));
        }
        return;
      }

      if (!hasPandocInstalled || !hasCrossref) {
        console.log(chalk.cyan('Installation options:\n'));

        if (platform === 'darwin') {
          console.log(chalk.bold('macOS (Homebrew):'));
          if (!hasPandocInstalled) console.log(chalk.dim('  brew install pandoc'));
          if (!hasCrossref) console.log(chalk.dim('  brew install pandoc-crossref'));
          console.log('');
        } else if (platform === 'win32') {
          console.log(chalk.bold('Windows (Chocolatey):'));
          if (!hasPandocInstalled) console.log(chalk.dim('  choco install pandoc'));
          if (!hasCrossref) console.log(chalk.dim('  choco install pandoc-crossref'));
          console.log('');
          console.log(chalk.bold('Windows (Scoop):'));
          if (!hasPandocInstalled) console.log(chalk.dim('  scoop install pandoc'));
          if (!hasCrossref) console.log(chalk.dim('  scoop install pandoc-crossref'));
          console.log('');
        } else {
          console.log(chalk.bold('Linux (apt):'));
          if (!hasPandocInstalled) console.log(chalk.dim('  sudo apt install pandoc'));
          console.log('');
        }

        console.log(chalk.bold('Cross-platform (conda):'));
        if (!hasPandocInstalled) console.log(chalk.dim('  conda install -c conda-forge pandoc'));
        if (!hasCrossref) console.log(chalk.dim('  conda install -c conda-forge pandoc-crossref'));
        console.log('');

        if (!hasCrossref) {
          console.log(chalk.bold('Manual download:'));
          console.log(chalk.dim('  https://github.com/lierdakil/pandoc-crossref/releases'));
          console.log('');
        }

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
                if (!hasPandocInstalled) {
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

  // ==========================================================================
  // DOCTOR command - Diagnose setup and configuration issues
  // ==========================================================================

  program
    .command('doctor')
    .description('Diagnose setup and configuration issues')
    .action(async () => {
      const os = await import('os');
      const { execSync } = await import('child_process');

      const version = pkg?.version || 'unknown';
      console.log(chalk.bold.cyan(`\n  rev doctor`) + chalk.dim(` v${version}\n`));
      console.log(chalk.dim(`  ${os.platform()} ${os.release()} | Node ${process.version}\n`));

      let issues = 0;
      let warnings = 0;

      console.log(chalk.bold('  Environment'));
      console.log(chalk.dim('  ─────────────────────────────────'));

      const nodeVer = parseInt(process.version.slice(1).split('.')[0], 10);
      if (nodeVer >= 18) {
        console.log(chalk.green('  ✓') + ` Node.js ${process.version}`);
      } else {
        console.log(chalk.red('  ✗') + ` Node.js ${process.version} (requires >=18)`);
        issues++;
      }

      try {
        const pandocVer = execSync('pandoc --version', { encoding: 'utf-8' }).split('\n')[0];
        console.log(chalk.green('  ✓') + ` ${pandocVer}`);
      } catch {
        console.log(chalk.red('  ✗') + ' pandoc not found');
        issues++;
      }

      try {
        const crossrefVer = execSync('pandoc-crossref --version', { encoding: 'utf-8' }).split('\n')[0];
        console.log(chalk.green('  ✓') + ` pandoc-crossref ${crossrefVer}`);
      } catch {
        console.log(chalk.yellow('  !') + ' pandoc-crossref not found (optional)');
        warnings++;
      }

      console.log();
      console.log(chalk.bold('  Project'));
      console.log(chalk.dim('  ─────────────────────────────────'));

      const configPath = path.join(process.cwd(), 'rev.yaml');
      if (fs.existsSync(configPath)) {
        console.log(chalk.green('  ✓') + ' rev.yaml found');

        try {
          const { default: YAML } = await import('yaml');
          const config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));

          if (config.title) {
            console.log(chalk.green('  ✓') + ` Title: ${config.title}`);
          } else {
            console.log(chalk.yellow('  !') + ' No title in rev.yaml');
            warnings++;
          }

          if (config.sections && config.sections.length > 0) {
            console.log(chalk.green('  ✓') + ` Sections: ${config.sections.length} defined`);

            let missing = 0;
            for (const sec of config.sections) {
              const secFile = typeof sec === 'string' ? sec : sec.file;
              if (!fs.existsSync(secFile)) missing++;
            }
            if (missing > 0) {
              console.log(chalk.yellow('  !') + ` ${missing} section file(s) missing`);
              warnings++;
            }
          }

          if (config.bibliography) {
            if (fs.existsSync(config.bibliography)) {
              console.log(chalk.green('  ✓') + ` Bibliography: ${config.bibliography}`);
            } else {
              console.log(chalk.yellow('  !') + ` Bibliography file not found: ${config.bibliography}`);
              warnings++;
            }
          }
        } catch (e) {
          console.log(chalk.red('  ✗') + ` rev.yaml parse error: ${e.message}`);
          issues++;
        }
      } else {
        console.log(chalk.dim('  ·') + ' No rev.yaml (not a rev project)');
      }

      const mdFiles = findFiles('.md');
      if (mdFiles.length > 0) {
        console.log(chalk.green('  ✓') + ` Markdown files: ${mdFiles.length}`);
      } else {
        console.log(chalk.dim('  ·') + ' No markdown files');
      }

      console.log();
      if (issues === 0 && warnings === 0) {
        console.log(chalk.green.bold('  All checks passed! ✓\n'));
      } else if (issues === 0) {
        console.log(chalk.yellow(`  ${warnings} warning(s), no critical issues\n`));
      } else {
        console.log(chalk.red(`  ${issues} issue(s), ${warnings} warning(s)\n`));
        console.log(chalk.dim('  Run "rev install" to fix missing dependencies.\n'));
      }
    });

  // ==========================================================================
  // BUILD command - Combine sections and run pandoc
  // ==========================================================================

  program
    .command('build')
    .alias('b')
    .description('Build PDF/DOCX/TEX from sections')
    .argument('[formats...]', 'Output formats: pdf, docx, tex, all', ['pdf', 'docx'])
    .option('-d, --dir <directory>', 'Project directory', '.')
    .option('--no-crossref', 'Skip pandoc-crossref filter')
    .option('--toc', 'Include table of contents')
    .option('--show-changes', 'Export DOCX with visible track changes (audit mode)')
    .option('--dual', 'Output both clean version and annotated version (with comments)')
    .option('--reference <docx>', 'Reference DOCX for comment position alignment (use with --dual)')
    .action(async (formats, options) => {
      const dir = path.resolve(options.dir);

      if (!fs.existsSync(dir)) {
        console.error(chalk.red(`Directory not found: ${dir}`));
        process.exit(1);
      }

      if (!hasPandoc()) {
        console.error(chalk.red('pandoc not found.'));
        console.error(chalk.dim('Run "rev install" to install dependencies.'));
        process.exit(1);
      }

      const config = loadBuildConfig(dir);

      if (!config._configPath) {
        console.error(chalk.yellow('No rev.yaml found.'));
        console.error(chalk.dim('Run "rev new" to create a project, or "rev init" for existing files.'));
        process.exit(1);
      }

      console.log(fmt.header(`Building ${config.title || 'document'}`));
      console.log();

      const targetFormats = formats.length > 0 ? formats : ['pdf', 'docx'];
      const tocEnabled = options.toc || config.pdf?.toc || config.docx?.toc;
      console.log(chalk.dim(`  Formats: ${targetFormats.join(', ')}`));
      console.log(chalk.dim(`  Crossref: ${hasPandocCrossref() && options.crossref !== false ? 'enabled' : 'disabled'}`));
      if (tocEnabled) console.log(chalk.dim(`  TOC: enabled`));
      if (options.showChanges) console.log(chalk.dim(`  Track changes: visible`));
      if (options.dual) console.log(chalk.dim(`  Dual output: clean + with comments`));
      console.log('');

      if (options.toc) {
        config.pdf.toc = true;
        config.docx.toc = true;
      }

      if (options.dual) {
        config.docx.keepComments = false;
      }

      if (options.showChanges) {
        if (!targetFormats.includes('docx') && !targetFormats.includes('all')) {
          console.error(fmt.status('error', '--show-changes only applies to DOCX output'));
          process.exit(1);
        }

        const { combineSections } = await import('../build.js');
        const { buildWithTrackChanges } = await import('../trackchanges.js');

        const spin = fmt.spinner('Building with track changes...').start();

        try {
          const paperPath = combineSections(dir, config);
          spin.stop();
          console.log(chalk.cyan('Combined sections → paper.md'));
          console.log(chalk.dim(`  ${paperPath}\n`));

          const baseName = config.title
            ? config.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)
            : 'paper';
          const outputPath = path.join(dir, `${baseName}-changes.docx`);

          const spinTc = fmt.spinner('Applying track changes...').start();
          const result = await buildWithTrackChanges(paperPath, outputPath, {
            author: getUserName() || 'Author',
          });
          spinTc.stop();

          if (result.success) {
            console.log(chalk.cyan('Output (with track changes):'));
            console.log(`  DOCX: ${path.basename(outputPath)}`);
            if (result.stats) {
              console.log(chalk.dim(`    ${result.stats.insertions} insertions, ${result.stats.deletions} deletions, ${result.stats.substitutions} substitutions`));
            }
            console.log(chalk.green('\nBuild complete!'));
          } else {
            console.error(fmt.status('error', result.message));
            process.exit(1);
          }
        } catch (err) {
          spin.stop();
          console.error(fmt.status('error', err.message));
          if (process.env.DEBUG) console.error(err.stack);
          process.exit(1);
        }
        return;
      }

      const spin = fmt.spinner('Building...').start();

      try {
        const { results, paperPath, forwardRefsResolved, refsAutoInjected } = await build(dir, targetFormats, {
          crossref: options.crossref,
          config,
        });

        spin.stop();

        console.log(chalk.cyan('Combined sections → paper.md'));
        console.log(chalk.dim(`  ${paperPath}`));
        if (forwardRefsResolved > 0) {
          console.log(chalk.dim(`  ${forwardRefsResolved} forward reference(s) pre-resolved`));
        }
        if (refsAutoInjected) {
          console.log(chalk.dim(`  References section auto-injected before supplementary`));
        }
        console.log('');

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

        // Handle --dual mode
        if (options.dual) {
          const docxResult = results.find(r => r.format === 'docx' && r.success);
          if (docxResult) {
            const { prepareMarkdownWithMarkers, injectCommentsAtMarkers } = await import('../wordcomments.js');
            const { runPandoc } = await import('../build.js');

            let markdown = fs.readFileSync(paperPath, 'utf-8');

            if (options.reference) {
              const refPath = path.resolve(dir, options.reference);
              if (fs.existsSync(refPath)) {
                const spinRealign = fmt.spinner('Realigning comments from reference...').start();
                const { realignMarkdown } = await import('../comment-realign.js');
                const realigned = await realignMarkdown(refPath, markdown);
                if (realigned.success) {
                  markdown = realigned.markdown;
                  spinRealign.stop();
                  console.log(chalk.dim(`  Realigned ${realigned.insertions} comments from reference`));
                } else {
                  spinRealign.stop();
                  console.log(chalk.yellow(`  Warning: Could not realign comments: ${realigned.error}`));
                }
              } else {
                console.log(chalk.yellow(`  Warning: Reference not found: ${options.reference}`));
              }
            }

            markdown = stripAnnotations(markdown, { keepComments: true });

            const spinMarkers = fmt.spinner('Preparing markers...').start();
            const { markedMarkdown, comments } = prepareMarkdownWithMarkers(markdown);
            spinMarkers.stop();

            if (comments.length === 0) {
              console.log(chalk.yellow('\nNo comments found - skipping comments DOCX'));
            } else {
              const markedPath = path.join(dir, '.paper-marked.md');
              fs.writeFileSync(markedPath, markedMarkdown, 'utf-8');

              const spinBuild = fmt.spinner('Building marked DOCX...').start();
              const markedDocxPath = path.join(dir, '.paper-marked.docx');
              const pandocResult = await runPandoc(markedPath, 'docx', config, { ...options, outputPath: markedDocxPath });
              spinBuild.stop();

              if (!pandocResult.success) {
                console.error(chalk.yellow(`\nWarning: Could not build marked DOCX: ${pandocResult.error}`));
              } else {
                const commentsDocxPath = docxResult.outputPath.replace(/\.docx$/, '_comments.docx');
                const spinInject = fmt.spinner('Injecting comments at markers...').start();
                const commentResult = await injectCommentsAtMarkers(markedDocxPath, comments, commentsDocxPath);
                spinInject.stop();

                if (!process.env.DEBUG) {
                  try {
                    fs.unlinkSync(markedPath);
                    fs.unlinkSync(markedDocxPath);
                  } catch { /* ignore */ }
                }

                if (commentResult.success) {
                  console.log(chalk.cyan('\nDual output:'));
                  console.log(`  Clean:    ${path.basename(docxResult.outputPath)}`);
                  console.log(`  Comments: ${path.basename(commentsDocxPath)} (${commentResult.commentCount} comments)`);
                  if (commentResult.skippedComments > 0) {
                    console.log(chalk.yellow(`  Warning: ${commentResult.skippedComments} comments could not be anchored (markers not found)`));
                  }
                } else {
                  console.error(chalk.yellow(`\nWarning: Could not create comments DOCX: ${commentResult.error}`));
                }
              }
            }
          }

          const pdfResult = results.find(r => r.format === 'pdf' && r.success);
          if (pdfResult) {
            const { prepareMarkdownForAnnotatedPdf } = await import('../pdf-comments.js');
            const { runPandoc } = await import('../build.js');

            let markdown = fs.readFileSync(paperPath, 'utf-8');
            markdown = stripAnnotations(markdown, { keepComments: true });

            const spinPdf = fmt.spinner('Preparing annotated PDF...').start();
            const { markdown: annotatedMd, preamble, commentCount } = prepareMarkdownForAnnotatedPdf(markdown, {
              useTodonotes: true,
              stripResolved: true,
            });

            if (commentCount === 0) {
              spinPdf.stop();
              console.log(chalk.yellow('\nNo comments found - skipping annotated PDF'));
            } else {
              const annotatedPath = path.join(dir, '.paper-annotated.md');
              fs.writeFileSync(annotatedPath, annotatedMd, 'utf-8');

              const annotatedConfig = JSON.parse(JSON.stringify(config));
              annotatedConfig.pdf = annotatedConfig.pdf || {};
              annotatedConfig.pdf['header-includes'] = (annotatedConfig.pdf['header-includes'] || '') + preamble;
              annotatedConfig.pdf.geometry = 'left=2.5cm,right=4.5cm,top=2.5cm,bottom=2.5cm,marginparwidth=3.5cm';

              const annotatedPdfPath = pdfResult.outputPath.replace(/\.pdf$/, '_comments.pdf');
              spinPdf.text = 'Building annotated PDF...';
              const pandocResult = await runPandoc(annotatedPath, 'pdf', annotatedConfig, { ...options, outputPath: annotatedPdfPath });
              spinPdf.stop();

              if (!process.env.DEBUG) {
                try { fs.unlinkSync(annotatedPath); } catch { /* ignore */ }
              }

              if (pandocResult.success) {
                console.log(chalk.cyan('\nPDF dual output:'));
                console.log(`  Clean:    ${path.basename(pdfResult.outputPath)}`);
                console.log(`  Comments: ${path.basename(annotatedPdfPath)} (${commentCount} margin notes)`);
              } else {
                console.error(chalk.yellow(`\nWarning: Could not create annotated PDF: ${pandocResult.error}`));
              }
            }
          }
        }

        console.log(chalk.green('\nBuild complete!'));
      } catch (err) {
        spin.stop();
        console.error(fmt.status('error', err.message));
        if (process.env.DEBUG) console.error(err.stack);
        process.exit(1);
      }
    });
}
