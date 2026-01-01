/**
 * History commands: diff, history, contributors
 *
 * Commands for git-based revision tracking and author statistics.
 */

import {
  chalk,
  fs,
  path,
  fmt,
  loadBuildConfig,
} from './context.js';

/**
 * Register history commands with the program
 * @param {import('commander').Command} program
 */
export function register(program) {
  // ==========================================================================
  // DIFF command - Compare sections against git history
  // ==========================================================================

  program
    .command('diff')
    .description('Compare sections against git history')
    .argument('[ref]', 'Git reference to compare against (default: main/master)')
    .option('-f, --files <files>', 'Specific files to compare (comma-separated)')
    .option('--stat', 'Show only statistics, not full diff')
    .action(async (ref, options) => {
      const {
        isGitRepo,
        getDefaultBranch,
        getCurrentBranch,
        getChangedFiles,
        getWordCountDiff,
        compareFileVersions,
      } = await import('../git.js');

      if (!isGitRepo()) {
        console.error(fmt.status('error', 'Not a git repository'));
        process.exit(1);
      }

      const compareRef = ref || getDefaultBranch();
      const currentBranch = getCurrentBranch();

      console.log(fmt.header('Git Diff'));
      console.log(chalk.dim(`  Comparing: ${compareRef} → ${currentBranch || 'HEAD'}`));
      console.log();

      // Get files to compare
      let filesToCompare;
      if (options.files) {
        filesToCompare = options.files.split(',').map(f => f.trim());
      } else {
        // Default to markdown section files
        filesToCompare = fs.readdirSync('.').filter(f =>
          f.endsWith('.md') && !['README.md', 'CLAUDE.md'].includes(f)
        );
      }

      if (filesToCompare.length === 0) {
        console.log(fmt.status('info', 'No markdown files found'));
        return;
      }

      // Get changed files from git
      const changedFiles = getChangedFiles(compareRef);
      const changedSet = new Set(changedFiles.map(f => f.file));

      // Get word count differences
      const { total, byFile } = getWordCountDiff(filesToCompare, compareRef);

      // Show results
      const rows = [];
      for (const file of filesToCompare) {
        const stats = byFile[file];
        if (stats && (stats.added > 0 || stats.removed > 0)) {
          const status = changedSet.has(file)
            ? changedFiles.find(f => f.file === file)?.status || 'modified'
            : 'unchanged';
          rows.push([
            file,
            status,
            chalk.green(`+${stats.added}`),
            chalk.red(`-${stats.removed}`),
          ]);
        }
      }

      if (rows.length === 0) {
        console.log(fmt.status('success', 'No changes detected'));
        return;
      }

      console.log(fmt.table(['File', 'Status', 'Added', 'Removed'], rows));
      console.log();
      console.log(chalk.dim(`Total: ${chalk.green(`+${total.added}`)} words, ${chalk.red(`-${total.removed}`)} words`));

      // Show detailed diff if not --stat
      if (!options.stat && rows.length > 0) {
        console.log();
        console.log(chalk.cyan('Changed sections:'));
        for (const file of filesToCompare) {
          const stats = byFile[file];
          if (stats && (stats.added > 0 || stats.removed > 0)) {
            const { changes } = compareFileVersions(file, compareRef);
            console.log(chalk.bold(`\n  ${file}:`));

            // Show first few significant changes
            let shown = 0;
            for (const change of changes) {
              if (shown >= 3) {
                console.log(chalk.dim('    ...'));
                break;
              }
              const preview = change.text.slice(0, 60).replace(/\n/g, ' ');
              if (change.type === 'add') {
                console.log(chalk.green(`    + "${preview}..."`));
              } else {
                console.log(chalk.red(`    - "${preview}..."`));
              }
              shown++;
            }
          }
        }
      }
    });

  // ==========================================================================
  // HISTORY command - Show revision history
  // ==========================================================================

  program
    .command('history')
    .description('Show revision history for section files')
    .argument('[file]', 'Specific file (default: all sections)')
    .option('-n, --limit <count>', 'Number of commits to show', '10')
    .action(async (file, options) => {
      const {
        isGitRepo,
        getFileHistory,
        getRecentCommits,
        hasUncommittedChanges,
      } = await import('../git.js');

      if (!isGitRepo()) {
        console.error(fmt.status('error', 'Not a git repository'));
        process.exit(1);
      }

      const limit = parseInt(options.limit) || 10;

      console.log(fmt.header('Revision History'));
      console.log();

      if (file) {
        // Show history for specific file
        if (!fs.existsSync(file)) {
          console.error(fmt.status('error', `File not found: ${file}`));
          process.exit(1);
        }

        const history = getFileHistory(file, limit);

        if (history.length === 0) {
          console.log(fmt.status('info', 'No history found (file may not be committed)'));
          return;
        }

        console.log(chalk.cyan(`History for ${file}:`));
        console.log();

        for (const commit of history) {
          const date = new Date(commit.date).toLocaleDateString();
          console.log(`  ${chalk.yellow(commit.hash)} ${chalk.dim(date)}`);
          console.log(`    ${commit.message}`);
        }
      } else {
        // Show recent commits affecting any file
        const commits = getRecentCommits(limit);

        if (commits.length === 0) {
          console.log(fmt.status('info', 'No commits found'));
          return;
        }

        if (hasUncommittedChanges()) {
          console.log(chalk.yellow('  * Uncommitted changes'));
          console.log();
        }

        for (const commit of commits) {
          const date = new Date(commit.date).toLocaleDateString();
          console.log(`  ${chalk.yellow(commit.hash)} ${chalk.dim(date)} ${chalk.blue(commit.author)}`);
          console.log(`    ${commit.message}`);
        }
      }
    });

  // ==========================================================================
  // CONTRIBUTORS command - Show who wrote what
  // ==========================================================================

  program
    .command('contributors')
    .alias('authors')
    .description('Show author contributions across section files')
    .argument('[file]', 'Specific file (default: all sections)')
    .option('--blame', 'Show detailed line-by-line blame for a file')
    .action(async (file, options) => {
      const { isGitRepo, getAuthorStats, getContributors, getFileBlame } = await import('../git.js');

      if (!isGitRepo()) {
        console.error(fmt.status('error', 'Not a git repository'));
        process.exit(1);
      }

      console.log(fmt.header('Contributors'));
      console.log();

      if (file) {
        // Show stats for specific file
        if (!fs.existsSync(file)) {
          console.error(fmt.status('error', `File not found: ${file}`));
          process.exit(1);
        }

        if (options.blame) {
          // Detailed blame output
          const blame = getFileBlame(file);
          if (blame.length === 0) {
            console.log(fmt.status('info', 'No git history (file may not be committed)'));
            return;
          }

          console.log(chalk.cyan(`Blame for ${file}:`));
          console.log();

          for (const entry of blame) {
            const authorShort = entry.author.slice(0, 15).padEnd(15);
            const content = entry.content.length > 60 ? entry.content.slice(0, 60) + '...' : entry.content;
            console.log(`  ${chalk.dim(entry.hash)} ${chalk.blue(authorShort)} ${chalk.dim(`L${String(entry.line).padStart(3)}`)} ${content}`);
          }
        } else {
          // Summary stats
          const stats = getAuthorStats(file);
          if (Object.keys(stats).length === 0) {
            console.log(fmt.status('info', 'No git history (file may not be committed)'));
            return;
          }

          console.log(chalk.cyan(`Authors for ${file}:`));
          console.log();

          const sorted = Object.entries(stats).sort((a, b) => b[1].lines - a[1].lines);
          for (const [author, data] of sorted) {
            const bar = '█'.repeat(Math.ceil(data.percentage / 5));
            console.log(`  ${chalk.blue(author.padEnd(25))} ${chalk.dim(String(data.lines).padStart(4))} lines ${chalk.green(bar)} ${data.percentage}%`);
          }
        }
      } else {
        // Show contributors across all sections
        let config = {};
        try {
          config = loadBuildConfig() || {};
        } catch {
          // Not in a rev project
        }

        let sections = config.sections || [];
        if (sections.length === 0) {
          sections = fs.readdirSync('.').filter(f =>
            f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f)
          );
        }

        if (sections.length === 0) {
          console.error(fmt.status('error', 'No section files found'));
          process.exit(1);
        }

        const contributors = getContributors(sections);

        if (Object.keys(contributors).length === 0) {
          console.log(fmt.status('info', 'No git history found'));
          return;
        }

        const sorted = Object.entries(contributors).sort((a, b) => b[1].lines - a[1].lines);
        const totalLines = sorted.reduce((sum, [, data]) => sum + data.lines, 0);

        console.log(chalk.cyan('Project contributors:'));
        console.log();

        for (const [author, data] of sorted) {
          const pct = Math.round((data.lines / totalLines) * 100);
          const bar = '█'.repeat(Math.ceil(pct / 5));
          console.log(`  ${chalk.blue(author.padEnd(25))} ${chalk.dim(String(data.lines).padStart(5))} lines  ${chalk.dim(String(data.files))} files ${chalk.green(bar)} ${pct}%`);
        }

        console.log();
        console.log(chalk.dim(`  Total: ${totalLines} lines across ${sections.length} files`));
      }
    });
}
