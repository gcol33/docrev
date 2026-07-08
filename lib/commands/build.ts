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
import type { Command } from 'commander';
import * as readline from 'readline';
import { getBuildSuggestions } from '../errors.js';

interface RefsOptions {
  dir: string;
}

interface MigrateOptions {
  dir: string;
  auto?: boolean;
  dryRun?: boolean;
}

interface InstallOptions {
  check?: boolean;
}

interface BuildOptions {
  dir: string;
  journal?: string;
  crossref?: boolean;
  toc?: boolean;
  showChanges?: boolean;
  dual?: boolean;
  reference?: string;
  theme?: string;
  colortheme?: string;
  aspectratio?: string;
  verbose?: boolean;
  pandocArg?: string[];
  output?: string;
}

/**
 * Register build commands with the program
 */
export function register(program: Command, pkg?: { version?: string }): void {
  // ==========================================================================
  // REFS command - Show figure/table reference status
  // ==========================================================================

  program
    .command('refs')
    .description('Show figure/table reference registry and status')
    .argument('[file]', 'Optional file to analyze for references')
    .option('-d, --dir <directory>', 'Directory to scan for anchors', '.')
    .action((file: string | undefined, options: RefsOptions) => {
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
    .action(async (file: string, options: MigrateOptions) => {
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
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        let result = text;
        let converted = 0;
        let skipped = 0;

        const askQuestion = (prompt: string): Promise<string> =>
          new Promise((resolve) => rl.question(prompt, resolve));

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

        rl.close();

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
    .action(async (options: InstallOptions) => {
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

          const rl = readline.createInterface({
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
                const error = err as Error;
                console.log(chalk.red(`\nInstallation failed: ${error.message}`));
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
          const error = e as Error;
          console.log(chalk.red('  ✗') + ` rev.yaml parse error: ${error.message}`);
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
    .description('Build PDF/DOCX/TEX/PPTX/Beamer from sections')
    .argument('[formats...]', 'Output formats: pdf, docx, tex, beamer, pptx, all', ['pdf', 'docx'])
    .option('-d, --dir <directory>', 'Project directory', '.')
    .option('-j, --journal <name>', 'Use journal profile for build formatting defaults')
    .option('--no-crossref', 'Skip pandoc-crossref filter')
    .option('--toc', 'Include table of contents')
    .option('--show-changes', 'Export DOCX with visible track changes. Add --dual to thread comments into the same file.')
    .option('--dual', 'Output both clean version and annotated version (with comments). With --show-changes, emits one DOCX with tracked changes AND threaded comments.')
    .option('--reference <docx>', 'Reference DOCX for comment position alignment (use with --dual)')
    .option('--theme <name>', 'Beamer theme (default, metropolis, etc.)')
    .option('--colortheme <name>', 'Beamer color theme')
    .option('--aspectratio <ratio>', 'Beamer aspect ratio (169, 43)')
    .option(
      '--pandoc-arg <arg>',
      'Extra arg to pass to pandoc (repeatable). Applied to every format being built; appended after rev.yaml pandoc-args so CLI wins.',
      (val: string, prev: string[] = []) => [...prev, val],
      []
    )
    .option('-o, --output <path>', 'Output filename or path. Relative paths resolve under outputDir; absolute paths bypass it. Extension auto-added if missing. Applied to every format being built; overrides rev.yaml output.<format>.')
    .option('--verbose', 'Show detailed output including postprocess scripts and the pandoc invocation')
    .action(async (formats: string[], options: BuildOptions) => {
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

      // Apply journal formatting from CLI flag (overrides rev.yaml journal field)
      let journalName: string | undefined;
      if (options.journal) {
        const { getJournalProfile } = await import('../journals.js');
        const { mergeJournalFormatting } = await import('../build.js');
        const profile = getJournalProfile(options.journal);
        if (!profile) {
          console.error(fmt.status('error', `Unknown journal: ${options.journal}`));
          console.error(chalk.dim('Use "rev validate --list" to see available profiles'));
          process.exit(1);
        }
        journalName = profile.name;
        if (profile.formatting) {
          Object.assign(config, mergeJournalFormatting(config, profile.formatting, dir));
        }
      } else if ((config as unknown as { journal?: string }).journal) {
        // Journal set in rev.yaml — already applied by loadConfig, just get name for display
        const { getJournalProfile } = await import('../journals.js');
        const profile = getJournalProfile((config as unknown as { journal?: string }).journal!);
        if (profile) journalName = profile.name;
      }

      console.log(fmt.header(`Building ${config.title || 'document'}`));
      console.log();

      const targetFormats = formats.length > 0 ? formats : ['pdf', 'docx'];
      const tocEnabled = options.toc || config.pdf?.toc || config.docx?.toc;
      if (journalName) console.log(chalk.dim(`  Journal: ${journalName}`));
      console.log(chalk.dim(`  Formats: ${targetFormats.join(', ')}`));
      console.log(chalk.dim(`  Crossref: ${hasPandocCrossref() && options.crossref !== false ? 'enabled' : 'disabled'}`));
      if (tocEnabled) console.log(chalk.dim(`  TOC: enabled`));
      if (options.showChanges && options.dual) {
        console.log(chalk.dim(`  Reviewed output: tracked changes + threaded comments (one file)`));
      } else if (options.showChanges) {
        console.log(chalk.dim(`  Track changes: visible`));
      } else if (options.dual) {
        console.log(chalk.dim(`  Dual output: clean + with comments`));
      }
      console.log('');

      if (options.toc) {
        config.pdf = config.pdf || {};
        config.pdf.toc = true;
        config.docx = config.docx || {};
        config.docx.toc = true;
      }

      if (options.dual) {
        config.docx = config.docx || {};
        config.docx.keepComments = false;
      }

      // Apply beamer CLI options
      if (options.theme) {
        config.beamer = config.beamer || {};
        config.beamer.theme = options.theme;
      }
      if (options.colortheme) {
        config.beamer = config.beamer || {};
        config.beamer.colortheme = options.colortheme;
      }
      if (options.aspectratio) {
        config.beamer = config.beamer || {};
        config.beamer.aspectratio = options.aspectratio;
      }

      if (options.showChanges) {
        if (!targetFormats.includes('docx') && !targetFormats.includes('all')) {
          console.error(fmt.status('error', '--show-changes only applies to DOCX output'));
          process.exit(1);
        }

        // --show-changes           → tracked changes only.
        // --show-changes --dual    → tracked changes AND threaded comments in
        //                            the one file (issue #6). Both write the
        //                            `<name>-changes.docx` deliverable.
        const includeComments = !!options.dual;

        const { combineSections, resolveOutputPath, buildReviewedDocx } = await import('../build.js');

        const spin = fmt.spinner('Building with track changes...').start();

        try {
          const paperPath = combineSections(dir, config);
          spin.stop();
          console.log(chalk.cyan('Combined sections → paper.md'));
          console.log(chalk.dim(`  ${paperPath}\n`));

          const outputPath = resolveOutputPath(dir, config, 'docx', {
            cliOverride: options.output,
            suffix: '-changes',
          });
          const outDir = path.dirname(outputPath);
          if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

          const spinTc = fmt.spinner(
            includeComments ? 'Applying track changes and comments...' : 'Applying track changes...'
          ).start();
          const result = await buildReviewedDocx(dir, paperPath, config, {
            outputPath,
            author: getUserName() || 'Author',
            includeComments,
            referencePath: options.reference ? path.resolve(dir, options.reference) : null,
            pandocArgs: options.pandocArg,
            verbose: options.verbose,
          });
          spinTc.stop();

          if (result.success) {
            const label = includeComments ? 'track changes + comments' : 'track changes';
            console.log(chalk.cyan(`Output (${label}):`));
            console.log(`  DOCX: ${path.basename(outputPath)}`);
            console.log(chalk.dim(`    ${result.stats.insertions} insertions, ${result.stats.deletions} deletions, ${result.stats.substitutions} substitutions`));
            if (includeComments) {
              console.log(chalk.dim(`    ${result.commentCount} comments, ${result.replyCount} replies`));
              if (result.realigned !== undefined) {
                console.log(chalk.dim(`    ${result.realigned} comments realigned from reference`));
              }
              if (result.skippedComments > 0) {
                console.log(chalk.yellow(`    Warning: ${result.skippedComments} comments could not be anchored`));
              }
            }
            console.log(chalk.green('\nBuild complete!'));
          } else {
            console.error(fmt.status('error', result.error || 'Build failed'));
            process.exit(1);
          }
        } catch (err) {
          spin.stop();
          const error = err as Error;
          console.error(fmt.status('error', error.message));
          if (process.env.DEBUG) console.error(error.stack);
          process.exit(1);
        }
        return;
      }

      const spin = fmt.spinner('Building...').start();

      try {
        const { results, paperPath, forwardRefsResolved, refsAutoInjected, warnings } = await build(dir, targetFormats, {
          crossref: options.crossref,
          config,
          verbose: options.verbose,
          pandocArgs: options.pandocArg,
          output: options.output,
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

        if (warnings && warnings.length > 0) {
          for (const w of warnings) {
            // Each warning may span multiple lines — colour the first line as
            // a warning header and pass through the rest unchanged.
            const [head, ...rest] = w.split('\n');
            console.log(chalk.yellow(`Warning: ${head}`));
            for (const line of rest) console.log(chalk.yellow(line));
          }
          console.log('');
        }

        console.log(chalk.cyan('Output:'));
        console.log(formatBuildResults(results));

        const failed = results.filter((r) => !r.success);
        if (failed.length > 0) {
          console.log('');
          for (const f of failed) {
            console.error(chalk.red(`\n${f.format} error:\n${f.error}`));
            const issue = f.format === 'pdf' || f.format === 'beamer' ? 'latex_error' : 'pandoc_failed';
            for (const suggestion of getBuildSuggestions(issue, { format: f.format })) {
              console.error(chalk.dim(`  ${suggestion}`));
            }
          }
          process.exit(1);
        }

        // Handle --dual mode
        if (options.dual) {
          const { buildCommentsDocx, buildCommentsPdf } = await import('../build.js');

          const docxResult = results.find(r => r.format === 'docx' && r.success);
          if (docxResult) {
            const spinDual = fmt.spinner('Building comments DOCX...').start();
            const dualResult = await buildCommentsDocx(dir, paperPath, config, docxResult.outputPath!, {
              referencePath: options.reference ? path.resolve(dir, options.reference) : null,
              pandocArgs: options.pandocArg,
              verbose: options.verbose,
            });
            spinDual.stop();

            for (const w of dualResult.warnings) {
              console.log(chalk.yellow(`  Warning: ${w}`));
            }
            if (dualResult.realigned !== undefined) {
              console.log(chalk.dim(`  Realigned ${dualResult.realigned} comments from reference`));
            }

            if (dualResult.skipped) {
              console.log(chalk.yellow('\nNo comments found - skipping comments DOCX'));
            } else if (dualResult.success) {
              console.log(chalk.cyan('\nDual output:'));
              console.log(`  Clean:    ${path.basename(docxResult.outputPath!)}`);
              console.log(`  Comments: ${path.basename(dualResult.outputPath!)} (${dualResult.commentCount} comments)`);
              if ((dualResult.skippedComments ?? 0) > 0) {
                console.log(chalk.yellow(`  Warning: ${dualResult.skippedComments} comments could not be anchored (markers not found)`));
              }
            } else {
              console.error(chalk.yellow(`\nWarning: Could not create comments DOCX: ${dualResult.error}`));
            }
          }

          const pdfResult = results.find(r => r.format === 'pdf' && r.success);
          if (pdfResult) {
            const spinPdf = fmt.spinner('Building annotated PDF...').start();
            const dualResult = await buildCommentsPdf(dir, paperPath, config, pdfResult.outputPath!, {
              pandocArgs: options.pandocArg,
              verbose: options.verbose,
            });
            spinPdf.stop();

            for (const w of dualResult.warnings) {
              console.log(chalk.yellow(`  Warning: ${w}`));
            }

            if (dualResult.skipped) {
              console.log(chalk.yellow('\nNo comments found - skipping annotated PDF'));
            } else if (dualResult.success) {
              console.log(chalk.cyan('\nPDF dual output:'));
              console.log(`  Clean:    ${path.basename(pdfResult.outputPath!)}`);
              console.log(`  Comments: ${path.basename(dualResult.outputPath!)} (${dualResult.commentCount} margin notes)`);
            } else {
              console.error(chalk.yellow(`\nWarning: Could not create annotated PDF: ${dualResult.error}`));
            }
          }
        }

        // Store base document for three-way merge (only for DOCX, not dual)
        const docxResult = results.find(r => r.format === 'docx' && r.success);
        if (docxResult && !options.dual) {
          try {
            const { storeBaseDocument } = await import('../merge.js');
            storeBaseDocument(dir, docxResult.outputPath!);
            console.log(chalk.dim(`\n  Saved as .rev/base.docx for merge`));
          } catch (err) {
            // Non-fatal - just log if DEBUG
            if (process.env.DEBUG) {
              const error = err as Error;
              console.log(chalk.dim(`\n  Could not store base document: ${error.message}`));
            }
          }
        }

        console.log(chalk.green('\nBuild complete!'));
      } catch (err) {
        spin.stop();
        const error = err as Error;
        console.error(fmt.status('error', error.message));
        if (process.env.DEBUG) console.error(error.stack);
        process.exit(1);
      }
    });
}
