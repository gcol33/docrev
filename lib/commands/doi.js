/**
 * DOI commands: doi, orcid
 *
 * Commands for DOI validation, fetching, and ORCID profile lookup.
 */

import {
  chalk,
  fs,
  path,
  fmt,
} from './context.js';

/**
 * Register DOI commands with the program
 * @param {import('commander').Command} program
 */
export function register(program) {
  // ==========================================================================
  // DOI command - Validate and fetch DOIs
  // ==========================================================================

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
      const { parseBibEntries, checkBibDois, fetchBibtex, addToBib, isValidDoiFormat, lookupDoi, lookupMissingDois } = await import('../doi.js');

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

  // ==========================================================================
  // ORCID command - Fetch author info from ORCID
  // ==========================================================================

  program
    .command('orcid')
    .description('Fetch author information from ORCID')
    .argument('<orcid>', 'ORCID iD (e.g., 0000-0002-1825-0097)')
    .option('--yaml', 'Output as YAML for rev.yaml authors section')
    .option('--badge', 'Output markdown badge')
    .action(async (orcidInput, options) => {
      const { fetchOrcidProfile, fetchOrcidWorkCount, formatAuthorYaml, getOrcidBadge, cleanOrcid, isValidOrcid } = await import('../orcid.js');

      const orcid = cleanOrcid(orcidInput);

      if (!isValidOrcid(orcid)) {
        console.error(fmt.status('error', `Invalid ORCID format: ${orcidInput}`));
        console.log(chalk.dim('Expected format: 0000-0000-0000-0000'));
        console.log(chalk.dim('Or: https://orcid.org/0000-0000-0000-0000'));
        process.exit(1);
      }

      console.log(chalk.cyan(`Fetching ORCID profile...`));

      try {
        const profile = await fetchOrcidProfile(orcid);
        const workCount = await fetchOrcidWorkCount(orcid);

        if (options.yaml) {
          console.log();
          console.log(formatAuthorYaml(profile));
          return;
        }

        if (options.badge) {
          console.log();
          console.log(getOrcidBadge(orcid));
          return;
        }

        console.log();
        console.log(fmt.header('ORCID Profile'));
        console.log();
        console.log(`  ${chalk.bold('Name:')}        ${profile.name || chalk.dim('(not public)')}`);
        console.log(`  ${chalk.bold('ORCID:')}       ${chalk.green(profile.orcid)}`);
        console.log(`  ${chalk.bold('Affiliation:')} ${profile.affiliation || chalk.dim('(not public)')}`);
        console.log(`  ${chalk.bold('Email:')}       ${profile.email || chalk.dim('(not public)')}`);
        console.log(`  ${chalk.bold('Works:')}       ${workCount} publication(s)`);
        console.log();
        console.log(chalk.dim(`  Profile: https://orcid.org/${profile.orcid}`));
        console.log();
        console.log(chalk.dim('  Use --yaml to output for rev.yaml authors section'));
        console.log(chalk.dim('  Use --badge to get markdown badge'));
      } catch (err) {
        console.error(fmt.status('error', err.message));
        process.exit(1);
      }
    });
}
