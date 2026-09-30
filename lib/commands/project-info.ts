/**
 * Project information commands: word-count (wc), stats, search
 *
 * Read-only queries about the project state.
 */

import type { Command } from 'commander';
import {
  chalk,
  fs,
  path,
  fmt,
  findFiles,
  loadBuildConfig,
  findSections,
  countAnnotations,
  getComments,
  countWords,
  jsonMode,
  jsonOutput,
} from './context.js';

// Use the actual BuildConfig from build.ts which allows string|Author[]
type BuildConfig = ReturnType<typeof loadBuildConfig>;

// Options interfaces
interface WordCountOptions {
  limit?: number;
  journal?: string;
}

interface StatsOptions {
  // No options currently
}

interface SearchOptions {
  ignoreCase?: boolean;
  context?: number;
}

/**
 * Register project-info commands with the program
 */
export function register(program: Command): void {
  // ==========================================================================
  // WORD-COUNT command - Per-section word counts
  // ==========================================================================

  program
    .command('word-count')
    .alias('wc')
    .description('Show word counts per section')
    .option('-l, --limit <number>', 'Warn if total exceeds limit', parseInt)
    .option('-j, --journal <name>', 'Use journal word limit (default: the journal in rev.yaml)')
    .action(async (options: WordCountOptions) => {
      let config: Partial<BuildConfig> = {};
      try {
        config = loadBuildConfig('.') || {};
      } catch {
        // Not in a rev project, that's ok
      }
      const { excludeFromWordCount } = await import('../journals.js');
      const sections = excludeFromWordCount(findSections('.', config.sections), config.wordCount?.exclude);

      if (sections.length === 0) {
        console.error(chalk.red('No section files found. Run from a rev project directory.'));
        process.exit(1);
      }

      const texts = sections.map(section => fs.readFileSync(section, 'utf-8'));
      const perSection = sections.map((section, i) => ({ file: section, words: countWords(texts[i]!) }));
      let total = perSection.reduce((sum, s) => sum + s.words, 0);

      // A journal limit is checked against what that journal counts, measured
      // exactly as `rev validate` measures it.
      let limit = options.limit;
      const journalId = options.journal ?? (config as { journal?: string }).journal;
      const journals = journalId ? await import('../journals.js') : null;
      const profile = journals ? journals.getJournalProfile(journalId!) : null;
      if (journals && !profile) {
        console.error(chalk.red(`\nUnknown journal: ${journalId}`));
        console.error(chalk.dim('Use rev validate --list to see available profiles'));
        process.exit(1);
      }
      const count = journals && profile
        ? journals.countForWordLimit(texts, profile.requirements.wordLimit, journals.measureReferenceWords(texts, profile, {
            directory: process.cwd(),
            bibliography: config.bibliography,
            csl: config.csl,
          }), { includeStatements: config.wordCount?.includeStatements, statementHeadings: config.wordCount?.statementHeadings })
        : null;
      if (count) total = count.wordCount;
      if (profile?.requirements.wordLimit?.main) limit = profile.requirements.wordLimit.main;

      if (jsonMode) {
        const journal = journals && profile && count
          ? { id: journalId, name: profile.name, requirements: profile.requirements, count,
              keywords: journals.extractKeywords(texts.join('\n\n')).length,
              warning: journals.referenceListWarning(profile, count) }
          : null;
        jsonOutput({ sections: perSection, total, limit: limit ?? null, journal });
        return;
      }

      const rows = perSection.map(s => [s.file, s.words.toLocaleString()]);
      rows.push(['', '']);
      rows.push([chalk.bold('Total'), chalk.bold(perSection.reduce((sum, s) => sum + s.words, 0).toLocaleString())]);
      console.log(fmt.header('Word Count'));
      console.log(fmt.table(['Section', 'Words'], rows));

      if (journals && profile && count) {
        console.log(chalk.cyan(`\n${profile.name} counts:`));
        const warning = journals.referenceListWarning(profile, count);
        if (warning) console.log(chalk.yellow(`⚠ ${warning}`));
        console.log(fmt.table(['Metric', 'Value'], journals.wordLimitRows(count)));
        if (profile.requirements.wordLimit?.main) {
          console.log(chalk.dim(`\nUsing ${profile.name} word limit: ${limit!.toLocaleString()}`));
        }
      }

      if (limit && total > limit) {
        console.log(chalk.red(`\n⚠ Over limit by ${(total - limit).toLocaleString()} words`));
      } else if (limit) {
        console.log(chalk.green(`\n✓ Within limit (${(limit - total).toLocaleString()} words remaining)`));
      }
    });

  // ==========================================================================
  // STATS command - Project dashboard
  // ==========================================================================

  program
    .command('stats')
    .description('Show project statistics dashboard')
    .action(async (_options: StatsOptions) => {
      let config: Partial<BuildConfig> = {};
      try {
        config = loadBuildConfig('.') || {};
      } catch {
        // Not in a rev project, that's ok
      }
      let sections = config.sections || [];

      if (sections.length === 0) {
        sections = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f)
        );
      }

      let totalWords = 0;
      let totalFigures = 0;
      let totalTables = 0;
      let totalComments = 0;
      let pendingComments = 0;
      const citations = new Set<string>();

      for (const section of sections) {
        if (!fs.existsSync(section)) continue;
        const text = fs.readFileSync(section, 'utf-8');

        totalWords += countWords(text);
        totalFigures += (text.match(/!\[.*?\]\(.*?\)/g) || []).length;
        totalTables += (text.match(/^\|[^|]+\|/gm) || []).length / 5; // Approximate

        const comments = getComments(text);
        totalComments += comments.length;
        pendingComments += comments.filter(c => !c.resolved).length;

        const cites = text.match(/@(\w+)(?![:\w])/g) || [];
        cites.forEach(c => citations.add(c.slice(1)));
      }

      console.log(fmt.header('Project Statistics'));
      console.log();

      const stats: [string, string | number][] = [
        ['Sections', sections.length],
        ['Words', totalWords.toLocaleString()],
        ['Figures', Math.round(totalFigures)],
        ['Tables', Math.round(totalTables)],
        ['Citations', citations.size],
        ['Comments', `${totalComments} (${pendingComments} pending)`],
      ];

      for (const [label, value] of stats) {
        console.log(`  ${chalk.dim(label.padEnd(12))} ${chalk.bold(value)}`);
      }

      // Bibliography stats
      const bibPath = config.bibliography || 'references.bib';
      if (fs.existsSync(bibPath)) {
        const bibContent = fs.readFileSync(bibPath, 'utf-8');
        const bibEntries = (bibContent.match(/@\w+\s*\{/g) || []).length;
        console.log(`  ${chalk.dim('Bib entries'.padEnd(12))} ${chalk.bold(bibEntries)}`);
      }

      console.log();
    });

  // ==========================================================================
  // SEARCH command - Search across section files
  // ==========================================================================

  program
    .command('search')
    .description('Search across all section files')
    .argument('<query>', 'Search query (supports regex)')
    .option('-i, --ignore-case', 'Case-insensitive search')
    .option('-c, --context <lines>', 'Show context lines', parseInt, 1)
    .action((query: string, options: SearchOptions) => {
      let config: Partial<BuildConfig> = {};
      try {
        config = loadBuildConfig('.') || {};
      } catch {
        // Not in a rev project, that's ok
      }
      let sections = config.sections || [];

      if (sections.length === 0) {
        sections = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md'].includes(f)
        );
      }

      const flags = options.ignoreCase ? 'gi' : 'g';
      let pattern: RegExp;
      try {
        pattern = new RegExp(query, flags);
      } catch {
        pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      }

      let totalMatches = 0;

      for (const section of sections) {
        if (!fs.existsSync(section)) continue;
        const text = fs.readFileSync(section, 'utf-8');
        const lines = text.split('\n');

        const matches: { line: number; text: string }[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (pattern.test(lines[i])) {
            matches.push({ line: i + 1, text: lines[i] });
            pattern.lastIndex = 0;
          }
        }

        if (matches.length > 0) {
          console.log(chalk.cyan.bold(`\n${section}`));
          for (const match of matches) {
            const highlighted = match.text.replace(pattern, (m) => chalk.yellow.bold(m));
            console.log(`  ${chalk.dim(match.line + ':')} ${highlighted}`);
          }
          totalMatches += matches.length;
        }
      }

      if (totalMatches === 0) {
        console.log(chalk.yellow(`No matches found for "${query}"`));
      } else {
        console.log(chalk.dim(`\n${totalMatches} match${totalMatches === 1 ? '' : 'es'} found`));
      }
    });
}
