/**
 * Response commands: response, validate, profiles, anonymize
 *
 * Commands for generating reviewer responses and validating manuscripts.
 */

import {
  chalk,
  fs,
  path,
  fmt,
  collectComments,
  generateResponseLetter,
  groupByReviewer,
  getUserName,
} from './context.js';

/**
 * Register response commands with the program
 * @param {import('commander').Command} program
 */
export function register(program) {
  // ==========================================================================
  // RESPONSE command - Generate response letter for reviewers
  // ==========================================================================

  program
    .command('response')
    .description('Generate response letter from reviewer comments')
    .argument('[files...]', 'Markdown files to process (default: all section files)')
    .option('-o, --output <file>', 'Output file (default: response-letter.md)')
    .option('-a, --author <name>', 'Author name for identifying replies')
    .option('--no-context', 'Omit context snippets')
    .option('--no-location', 'Omit file:line references')
    .action(async (files, options) => {
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

      const letter = generateResponseLetter(comments, {
        authorName: options.author || getUserName() || 'Author',
        includeContext: options.context !== false,
        includeLocation: options.location !== false,
      });

      const outputPath = options.output || 'response-letter.md';
      fs.writeFileSync(outputPath, letter, 'utf-8');

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

  // ==========================================================================
  // VALIDATE command - Check manuscript against journal requirements
  // ==========================================================================

  program
    .command('validate')
    .description('Validate manuscript against journal requirements')
    .argument('[files...]', 'Markdown files to validate (default: all section files)')
    .option('-j, --journal <name>', 'Journal profile (e.g., nature, plos-one, science)')
    .option('--list', 'List available journal profiles')
    .action(async (files, options) => {
      const { listJournals, validateProject, getJournalProfile } = await import('../journals.js');

      if (options.list) {
        console.log(fmt.header('Available Journal Profiles'));
        console.log();
        const journals = listJournals();
        const builtIn = journals.filter(j => !j.custom);
        const custom = journals.filter(j => j.custom);

        for (const j of builtIn) {
          console.log(`  ${chalk.bold(j.id)} - ${j.name}`);
          if (j.url) console.log(chalk.dim(`    ${j.url}`));
        }

        if (custom.length > 0) {
          console.log();
          console.log(chalk.cyan('  Custom Profiles:'));
          for (const j of custom) {
            console.log(`  ${chalk.bold(j.id)} - ${j.name} ${chalk.cyan('[custom]')}`);
            if (j.url) console.log(chalk.dim(`    ${j.url}`));
          }
        }

        console.log();
        console.log(chalk.dim('Usage: rev validate --journal <name>'));
        console.log(chalk.dim('Manage custom profiles: rev profiles'));
        return;
      }

      if (!options.journal) {
        console.error(fmt.status('error', 'Please specify a journal with --journal <name>'));
        console.error(chalk.dim('Use --list to see available profiles'));
        process.exit(1);
      }

      const profile = getJournalProfile(options.journal);
      if (!profile) {
        console.error(fmt.status('error', `Unknown journal: ${options.journal}`));
        console.error(chalk.dim('Use --list to see available profiles'));
        process.exit(1);
      }

      let mdFiles = files;
      if (!mdFiles || mdFiles.length === 0) {
        mdFiles = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f)
        );
      }

      if (mdFiles.length === 0) {
        console.error(fmt.status('error', 'No markdown files found'));
        process.exit(1);
      }

      console.log(fmt.header(`Validating for ${profile.name}`));
      console.log(chalk.dim(`  ${profile.url}`));
      console.log();

      const result = validateProject(mdFiles, options.journal);

      console.log(chalk.cyan('Manuscript Stats:'));
      console.log(fmt.table(['Metric', 'Value'], [
        ['Word count', result.stats.wordCount.toString()],
        ['Abstract', `${result.stats.abstractWords} words`],
        ['Title', `${result.stats.titleChars} chars`],
        ['Figures', result.stats.figures.toString()],
        ['Tables', result.stats.tables.toString()],
        ['References', result.stats.references.toString()],
      ]));
      console.log();

      if (result.errors.length > 0) {
        console.log(chalk.red('Errors:'));
        for (const err of result.errors) {
          console.log(chalk.red(`  ✗ ${err}`));
        }
        console.log();
      }

      if (result.warnings.length > 0) {
        console.log(chalk.yellow('Warnings:'));
        for (const warn of result.warnings) {
          console.log(chalk.yellow(`  ⚠ ${warn}`));
        }
        console.log();
      }

      if (result.valid) {
        console.log(fmt.status('success', `Manuscript meets ${profile.name} requirements`));
      } else {
        console.log(fmt.status('error', `Manuscript has ${result.errors.length} error(s)`));
        process.exit(1);
      }
    });

  // ==========================================================================
  // PROFILES command - Manage custom journal profiles
  // ==========================================================================

  program
    .command('profiles')
    .description('Manage custom journal profiles')
    .option('--list', 'List all custom profiles')
    .option('--new <name>', 'Create a new profile template')
    .option('--project', 'Create profile in project directory (with --new)')
    .option('--dirs', 'Show profile directory locations')
    .action(async (options) => {
      const {
        listCustomProfiles,
        saveProfileTemplate,
        getPluginDirs,
      } = await import('../plugins.js');
      const { listJournals } = await import('../journals.js');

      if (options.dirs) {
        const dirs = getPluginDirs();
        console.log(fmt.header('Profile Directories'));
        console.log();
        console.log(`  User:    ${dirs.user}`);
        console.log(chalk.dim(`           ${dirs.userExists ? 'exists' : 'not created'}`));
        console.log();
        console.log(`  Project: ${dirs.project}`);
        console.log(chalk.dim(`           ${dirs.projectExists ? 'exists' : 'not created'}`));
        console.log();
        console.log(chalk.dim('Use --new <name> to create a profile template'));
        return;
      }

      if (options.new) {
        try {
          const filePath = saveProfileTemplate(options.new, options.project);
          console.log(fmt.status('success', `Created profile template: ${filePath}`));
          console.log(chalk.dim('Edit the file to customize journal requirements'));
        } catch (err) {
          console.error(fmt.status('error', err.message));
          process.exit(1);
        }
        return;
      }

      console.log(fmt.header('Custom Journal Profiles'));
      console.log();

      const customProfiles = listCustomProfiles();

      if (customProfiles.length === 0) {
        console.log(chalk.dim('  No custom profiles found'));
        console.log();
        console.log(chalk.dim('  Create one with: rev profiles --new "Journal Name"'));
        console.log();
        const dirs = getPluginDirs();
        console.log(chalk.dim(`  User profiles:    ${dirs.user}`));
        console.log(chalk.dim(`  Project profiles: ${dirs.project}`));
      } else {
        for (const p of customProfiles) {
          const source = p.source === 'project' ? chalk.cyan('[project]') : chalk.dim('[user]');
          console.log(`  ${chalk.bold(p.id)} - ${p.name} ${source}`);
          console.log(chalk.dim(`    ${p.path}`));
        }
        console.log();
        console.log(chalk.dim(`  ${customProfiles.length} custom profile(s)`));
      }

      console.log();

      const allJournals = listJournals();
      const builtIn = allJournals.filter(j => !j.custom).length;
      console.log(chalk.dim(`  ${builtIn} built-in profiles available (rev validate --list)`));
    });

  // ==========================================================================
  // ANONYMIZE command - Prepare document for blind review
  // ==========================================================================

  program
    .command('anonymize')
    .description('Prepare document for blind review')
    .argument('<input>', 'Input markdown file or directory')
    .option('-o, --output <file>', 'Output file (default: input-anonymous.md)')
    .option('--authors <names>', 'Author names to redact (comma-separated)')
    .option('--dry-run', 'Show what would be changed without writing')
    .action(async (input, options) => {
      const { default: YAML } = await import('yaml');

      const isDir = fs.existsSync(input) && fs.statSync(input).isDirectory();
      const files = isDir
        ? fs.readdirSync(input)
            .filter(f => f.endsWith('.md') && !['README.md', 'CLAUDE.md'].includes(f))
            .map(f => path.join(input, f))
        : [input];

      if (files.length === 0) {
        console.error(fmt.status('error', 'No markdown files found'));
        process.exit(1);
      }

      let authorNames = [];
      if (options.authors) {
        authorNames = options.authors.split(',').map(n => n.trim());
      } else {
        const configPath = isDir ? path.join(input, 'rev.yaml') : 'rev.yaml';
        if (fs.existsSync(configPath)) {
          try {
            const config = YAML.parse(fs.readFileSync(configPath, 'utf-8'));
            if (config.authors) {
              authorNames = config.authors.map(a => typeof a === 'string' ? a : a.name).filter(Boolean);
            }
          } catch { /* ignore */ }
        }
      }

      console.log(fmt.header('Anonymizing Document'));
      console.log();

      let totalChanges = 0;

      for (const file of files) {
        if (!fs.existsSync(file)) {
          console.error(chalk.yellow(`  Skipping: ${file} (not found)`));
          continue;
        }

        let text = fs.readFileSync(file, 'utf-8');
        let changes = 0;

        text = text.replace(/^---\n([\s\S]*?)\n---/, (match, fm) => {
          let modified = fm;
          modified = modified.replace(/^author:.*(?:\n(?:  |\t).*)*$/m, '');
          modified = modified.replace(/^authors:.*(?:\n(?:  |\t|-\s+).*)*$/m, '');
          modified = modified.replace(/^affiliation:.*$/m, '');
          modified = modified.replace(/^email:.*$/m, '');
          if (modified !== fm) changes++;
          return '---\n' + modified.replace(/\n{3,}/g, '\n\n').trim() + '\n---';
        });

        const ackPatterns = [
          /^#+\s*Acknowledgments?[\s\S]*?(?=^#|\Z)/gmi,
          /^#+\s*Funding[\s\S]*?(?=^#|\Z)/gmi,
        ];
        for (const pattern of ackPatterns) {
          const before = text;
          text = text.replace(pattern, '');
          if (text !== before) changes++;
        }

        for (const name of authorNames) {
          const namePattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
          const before = text;
          text = text.replace(namePattern, '[AUTHOR]');
          if (text !== before) changes++;
        }

        for (const name of authorNames) {
          const lastName = name.split(/\s+/).pop();
          if (lastName && lastName.length > 2) {
            const citePat = new RegExp(`@${lastName}(\\d{4})`, 'gi');
            const before = text;
            text = text.replace(citePat, '@AUTHOR$1');
            if (text !== before) changes++;
          }
        }

        totalChanges += changes;

        if (options.dryRun) {
          console.log(chalk.dim(`  ${path.basename(file)}: ${changes} change(s)`));
        } else {
          const outPath = options.output || file.replace(/\.md$/, '-anonymous.md');
          fs.writeFileSync(outPath, text, 'utf-8');
          console.log(fmt.status('success', `${path.basename(file)} → ${path.basename(outPath)} (${changes} changes)`));
        }
      }

      console.log();
      if (options.dryRun) {
        console.log(chalk.dim(`  Total: ${totalChanges} change(s) would be made`));
      } else {
        console.log(fmt.status('success', `Anonymized ${files.length} file(s)`));
      }
    });
}
