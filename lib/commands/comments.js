/**
 * Comment commands: comments, resolve, next, prev, first, last, todo, accept, reject, reply
 *
 * Commands for viewing, navigating, and managing reviewer comments and track changes.
 */

import {
  chalk,
  fs,
  path,
  fmt,
  jsonMode,
  jsonOutput,
  findFiles,
  getComments,
  setCommentStatus,
  getTrackChanges,
  applyDecision,
  interactiveCommentReview,
  tuiCommentReview,
  getUserName,
  exitWithError,
  getAnnotationSuggestions,
  requireFile,
} from './context.js';

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
  return text.slice(0, insertPos) + ' ' + replyAnnotation + text.slice(insertPos);
}

/**
 * Helper to find section file by name (deterministic priority)
 */
function findSectionFile(section) {
  const allMd = findFiles('.md');
  const sectionLower = section.toLowerCase();

  // 1. Exact filename match
  const exactFile = allMd.find(f => f === section || f === `${section}.md`);
  if (exactFile) return [exactFile];

  // 2. Filename contains (partial match)
  const filenameMatch = allMd.filter(f =>
    f.toLowerCase().replace(/\.md$/, '').includes(sectionLower)
  );
  if (filenameMatch.length === 1) return filenameMatch;
  if (filenameMatch.length > 1) {
    console.log(chalk.yellow(`  Multiple files match "${section}": ${filenameMatch.join(', ')}`));
    console.log(chalk.dim(`  Using first match: ${filenameMatch[0]}`));
    return [filenameMatch[0]];
  }

  // 3. Exact header match
  for (const f of allMd) {
    try {
      const text = fs.readFileSync(f, 'utf-8');
      const headerMatch = text.match(/^#\s+(.+)$/m);
      if (headerMatch && headerMatch[1].toLowerCase().trim() === sectionLower) {
        return [f];
      }
    } catch {
      // Skip unreadable files silently - not critical for section matching
    }
  }

  // 4. Header contains (partial match)
  const headerMatches = [];
  for (const f of allMd) {
    try {
      const text = fs.readFileSync(f, 'utf-8');
      const headerMatch = text.match(/^#\s+(.+)$/m);
      if (headerMatch && headerMatch[1].toLowerCase().includes(sectionLower)) {
        headerMatches.push(f);
      }
    } catch {
      // Skip unreadable files silently - not critical for section matching
    }
  }
  if (headerMatches.length === 1) return headerMatches;
  if (headerMatches.length > 1) {
    console.log(chalk.yellow(`  Multiple files match "${section}": ${headerMatches.join(', ')}`));
    console.log(chalk.dim(`  Using first match: ${headerMatches[0]}`));
    return [headerMatches[0]];
  }

  // No match - return original (will fail later with file not found)
  return [section];
}

/**
 * Register comment commands with the program
 * @param {import('commander').Command} program
 */
export function register(program) {
  // ==========================================================================
  // COMMENTS command - List all comments
  // ==========================================================================

  program
    .command('comments')
    .alias('c')
    .description('List all comments in the document')
    .argument('<file>', 'Markdown file')
    .option('-p, --pending', 'Show only pending (unresolved) comments')
    .option('-r, --resolved', 'Show only resolved comments')
    .option('-a, --author <name>', 'Filter by author name (case-insensitive)')
    .option('-e, --export <csvFile>', 'Export comments to CSV file')
    .option('-i, --interactive', 'Interactive review mode (reply, resolve, skip)')
    .option('-t, --tui', 'Visual TUI mode for comment review')
    .action(async (file, options) => {
      requireFile(file, 'Markdown file');

      const text = fs.readFileSync(file, 'utf-8');

      // TUI review mode
      if (options.tui) {
        let author = options.author || getUserName();
        if (!author) {
          exitWithError('No user name set for replies', getAnnotationSuggestions('no_author'));
        }

        const result = await tuiCommentReview(text, {
          author,
          addReply: (txt, comment, auth, msg) => {
            const replyAnnotation = `{>>${auth}: ${msg}<<}`;
            const insertPos = comment.position + comment.match.length;
            return txt.slice(0, insertPos) + ' ' + replyAnnotation + txt.slice(insertPos);
          },
          setStatus: setCommentStatus,
        });

        if (result.resolved > 0 || result.replied > 0) {
          fs.writeFileSync(file, result.text, 'utf-8');
          console.log(fmt.status('success', `Changes saved to ${file}`));
        }
        return;
      }

      // Interactive review mode
      if (options.interactive) {
        let author = options.author || getUserName();
        if (!author) {
          exitWithError('No user name set for replies', getAnnotationSuggestions('no_author'));
        }

        const result = await interactiveCommentReview(text, {
          author,
          addReply: (txt, comment, auth, msg) => {
            const replyAnnotation = `{>>${auth}: ${msg}<<}`;
            const insertPos = comment.position + comment.match.length;
            return txt.slice(0, insertPos) + ' ' + replyAnnotation + txt.slice(insertPos);
          },
          setCommentStatus,
        });

        if (result.resolved > 0 || result.replied > 0) {
          fs.writeFileSync(file, result.text, 'utf-8');
          console.log(fmt.status('success', `Changes saved to ${file}`));
        }
        return;
      }

      let comments = getComments(text, {
        pendingOnly: options.pending,
        resolvedOnly: options.resolved,
      });

      // Filter by author if specified
      if (options.author) {
        const authorFilter = options.author.toLowerCase();
        comments = comments.filter(c =>
          c.author && c.author.toLowerCase().includes(authorFilter)
        );
      }

      // CSV export mode
      if (options.export) {
        const csvEscape = (str) => {
          if (!str) return '';
          str = String(str);
          if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
          }
          return str;
        };

        const header = ['number', 'author', 'comment', 'context', 'status', 'file', 'line'];
        const rows = comments.map((c, i) => [
          i + 1,
          csvEscape(c.author || ''),
          csvEscape(c.content),
          csvEscape(c.before ? c.before.trim() : ''),
          c.resolved ? 'resolved' : 'pending',
          path.basename(file),
          c.line,
        ].join(','));

        const csv = [header.join(','), ...rows].join('\n');
        fs.writeFileSync(options.export, csv, 'utf-8');
        console.log(fmt.status('success', `Exported ${comments.length} comments to ${options.export}`));
        return;
      }

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

      let filter = options.pending ? ' (pending)' : options.resolved ? ' (resolved)' : '';
      if (options.author) filter += ` by "${options.author}"`;
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

  // ==========================================================================
  // RESOLVE command - Mark comments as resolved/pending
  // ==========================================================================

  program
    .command('resolve')
    .alias('r')
    .description('Mark comments as resolved or pending')
    .argument('<file>', 'Markdown file')
    .option('-n, --number <n>', 'Comment number to toggle', parseInt)
    .option('-a, --all', 'Mark all comments as resolved')
    .option('-u, --unresolve', 'Mark as pending (unresolve)')
    .option('--dry-run', 'Preview without saving')
    .action((file, options) => {
      requireFile(file, 'Markdown file');

      let text = fs.readFileSync(file, 'utf-8');
      const comments = getComments(text);

      if (comments.length === 0) {
        console.log(fmt.status('info', 'No comments found'));
        console.log(chalk.dim(getAnnotationSuggestions('no_comments').join('\n  ')));
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
        if (options.dryRun) {
          console.log(fmt.status('info', `Would mark ${count} comment(s) as ${resolveStatus ? 'resolved' : 'pending'}`));
        } else {
          fs.writeFileSync(file, text, 'utf-8');
          console.log(fmt.status('success', `Marked ${count} comment(s) as ${resolveStatus ? 'resolved' : 'pending'}`));
        }
        return;
      }

      if (options.number !== undefined) {
        const idx = options.number - 1;
        if (idx < 0 || idx >= comments.length) {
          exitWithError(
            `Invalid comment number ${options.number}. File has ${comments.length} comment(s)`,
            getAnnotationSuggestions('invalid_number')
          );
        }
        const comment = comments[idx];
        text = setCommentStatus(text, comment, resolveStatus);
        if (options.dryRun) {
          console.log(fmt.status('info', `Would mark comment #${options.number} as ${resolveStatus ? 'resolved' : 'pending'}`));
        } else {
          fs.writeFileSync(file, text, 'utf-8');
          console.log(fmt.status('success', `Comment #${options.number} marked as ${resolveStatus ? 'resolved' : 'pending'}`));
        }
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

  // ==========================================================================
  // NEXT command - Show next pending comment
  // ==========================================================================

  program
    .command('next')
    .alias('n')
    .description('Show next pending comment')
    .argument('[file]', 'Specific file (default: all markdown files)')
    .option('-n, --number <n>', 'Skip to nth pending comment', parseInt)
    .action((file, options) => {
      const files = file ? [file] : findFiles('.md');

      if (files.length === 0) {
        console.log(fmt.status('info', 'No markdown files found.'));
        return;
      }

      // Collect all pending comments across files
      const allPending = [];
      for (const f of files) {
        if (!fs.existsSync(f)) continue;
        const text = fs.readFileSync(f, 'utf-8');
        const allComments = getComments(text);
        const pending = getComments(text, { pendingOnly: true });

        for (const c of pending) {
          const idx = allComments.findIndex(x => x.position === c.position) + 1;
          allPending.push({ ...c, file: f, number: idx });
        }
      }

      if (allPending.length === 0) {
        console.log(fmt.status('success', 'No pending comments!'));
        return;
      }

      // Get the nth pending comment (default: 1st)
      const targetIdx = (options.number || 1) - 1;
      if (targetIdx < 0 || targetIdx >= allPending.length) {
        console.error(chalk.red(`Invalid number. Only ${allPending.length} pending comment(s).`));
        process.exit(1);
      }

      const c = allPending[targetIdx];
      const position = targetIdx + 1;

      console.log(fmt.header(`Comment ${position}/${allPending.length}`));
      console.log();
      console.log(`  ${chalk.cyan(c.file)}:${c.line} ${chalk.dim(`#${c.number}`)}`);
      console.log();
      if (c.author) console.log(`  ${chalk.blue(c.author)}`);
      console.log(`  ${c.content}`);
      if (c.before) {
        console.log();
        console.log(chalk.dim(`  Context: "${c.before.trim().slice(-60)}"`));
      }
      console.log();
      console.log(chalk.dim(`  rev reply ${c.file} -n ${c.number} -m "..."`));
      console.log(chalk.dim(`  rev resolve ${c.file} -n ${c.number}`));
      if (position < allPending.length) {
        console.log(chalk.dim(`  rev next -n ${position + 1}`));
      }
    });

  // ==========================================================================
  // PREV command - Show previous/last pending comment
  // ==========================================================================

  program
    .command('prev')
    .alias('p')
    .description('Show previous pending comment')
    .argument('[file]', 'Specific file (default: all markdown files)')
    .option('-n, --number <n>', 'Skip to nth pending comment from end', parseInt)
    .action((file, options) => {
      const files = file ? [file] : findFiles('.md');

      if (files.length === 0) {
        console.log(fmt.status('info', 'No markdown files found.'));
        return;
      }

      // Collect all pending comments across files
      const allPending = [];
      for (const f of files) {
        if (!fs.existsSync(f)) continue;
        const text = fs.readFileSync(f, 'utf-8');
        const allComments = getComments(text);
        const pending = getComments(text, { pendingOnly: true });

        for (const c of pending) {
          const idx = allComments.findIndex(x => x.position === c.position) + 1;
          allPending.push({ ...c, file: f, number: idx });
        }
      }

      if (allPending.length === 0) {
        console.log(fmt.status('success', 'No pending comments!'));
        return;
      }

      // Get the nth pending comment from end (default: last)
      const fromEnd = options.number || 1;
      const targetIdx = allPending.length - fromEnd;
      if (targetIdx < 0 || targetIdx >= allPending.length) {
        console.error(chalk.red(`Invalid number. Only ${allPending.length} pending comment(s).`));
        process.exit(1);
      }

      const c = allPending[targetIdx];
      const position = targetIdx + 1;

      console.log(fmt.header(`Comment ${position}/${allPending.length}`));
      console.log();
      console.log(`  ${chalk.cyan(c.file)}:${c.line} ${chalk.dim(`#${c.number}`)}`);
      console.log();
      if (c.author) console.log(`  ${chalk.blue(c.author)}`);
      console.log(`  ${c.content}`);
      if (c.before) {
        console.log();
        console.log(chalk.dim(`  Context: "${c.before.trim().slice(-60)}"`));
      }
      console.log();
      console.log(chalk.dim(`  rev reply ${c.file} -n ${c.number} -m "..."`));
      console.log(chalk.dim(`  rev resolve ${c.file} -n ${c.number}`));
      if (position > 1) {
        console.log(chalk.dim(`  rev next -n ${position - 1}`));
      }
      if (position < allPending.length) {
        console.log(chalk.dim(`  rev next -n ${position + 1}`));
      }
    });

  // ==========================================================================
  // FIRST command - Show first comment
  // ==========================================================================

  program
    .command('first')
    .description('Show first comment')
    .argument('[section]', 'Specific file or section name (default: all markdown files)')
    .action((section) => {
      const files = section ? findSectionFile(section) : findFiles('.md');

      if (files.length === 0) {
        console.log(fmt.status('info', 'No markdown files found.'));
        return;
      }

      // Find first comment across files
      for (const f of files) {
        if (!fs.existsSync(f)) continue;
        const text = fs.readFileSync(f, 'utf-8');
        const comments = getComments(text);

        if (comments.length > 0) {
          const c = comments[0];
          const statusIcon = c.resolved ? chalk.green('✓') : chalk.yellow('○');

          console.log(fmt.header(`Comment 1/${comments.length}`));
          console.log();
          console.log(`  ${chalk.cyan(f)}:${c.line} #1 ${statusIcon}`);
          console.log();
          if (c.author) console.log(`  ${chalk.blue(c.author)}`);
          console.log(`  ${c.content}`);
          if (c.before) {
            console.log();
            console.log(chalk.dim(`  Context: "${c.before.trim().slice(-60)}"`));
          }
          console.log();
          console.log(chalk.dim(`  rev reply ${f} -n 1 -m "..."`));
          console.log(chalk.dim(`  rev resolve ${f} -n 1`));
          return;
        }
      }

      console.log(fmt.status('info', 'No comments found.'));
    });

  // ==========================================================================
  // LAST command - Show last comment
  // ==========================================================================

  program
    .command('last')
    .description('Show last comment')
    .argument('[section]', 'Specific file or section name (default: all markdown files)')
    .action((section) => {
      const files = section ? findSectionFile(section) : findFiles('.md').reverse();

      if (files.length === 0) {
        console.log(fmt.status('info', 'No markdown files found.'));
        return;
      }

      // Find last comment across files (reverse order)
      for (const f of files) {
        if (!fs.existsSync(f)) continue;
        const text = fs.readFileSync(f, 'utf-8');
        const comments = getComments(text);

        if (comments.length > 0) {
          const c = comments[comments.length - 1];
          const idx = comments.length;
          const statusIcon = c.resolved ? chalk.green('✓') : chalk.yellow('○');

          console.log(fmt.header(`Comment ${idx}/${comments.length}`));
          console.log();
          console.log(`  ${chalk.cyan(f)}:${c.line} #${idx} ${statusIcon}`);
          console.log();
          if (c.author) console.log(`  ${chalk.blue(c.author)}`);
          console.log(`  ${c.content}`);
          if (c.before) {
            console.log();
            console.log(chalk.dim(`  Context: "${c.before.trim().slice(-60)}"`));
          }
          console.log();
          console.log(chalk.dim(`  rev reply ${f} -n ${idx} -m "..."`));
          console.log(chalk.dim(`  rev resolve ${f} -n ${idx}`));
          return;
        }
      }

      console.log(fmt.status('info', 'No comments found.'));
    });

  // ==========================================================================
  // TODO command - List pending comments as checklist
  // ==========================================================================

  program
    .command('todo')
    .alias('t')
    .description('List all pending comments as a checklist')
    .argument('[file]', 'Specific file (default: all markdown files)')
    .option('--by-author', 'Group by author')
    .action((file, options) => {
      const files = file ? [file] : findFiles('.md');

      if (files.length === 0) {
        console.log(fmt.status('info', 'No markdown files found.'));
        return;
      }

      // Collect all pending comments
      const todos = [];
      for (const f of files) {
        if (!fs.existsSync(f)) continue;
        const text = fs.readFileSync(f, 'utf-8');
        const allComments = getComments(text);
        const pending = allComments.filter(c => !c.resolved);

        for (const c of pending) {
          const idx = allComments.findIndex(x => x.position === c.position) + 1;
          todos.push({
            file: f,
            number: idx,
            line: c.line,
            author: c.author || 'Anonymous',
            content: c.content,
          });
        }
      }

      if (todos.length === 0) {
        console.log(fmt.status('success', 'No pending comments!'));
        return;
      }

      console.log(fmt.header(`Todo (${todos.length} pending)`));
      console.log();

      if (options.byAuthor) {
        // Group by author
        const byAuthor = {};
        for (const t of todos) {
          if (!byAuthor[t.author]) byAuthor[t.author] = [];
          byAuthor[t.author].push(t);
        }

        for (const [author, items] of Object.entries(byAuthor)) {
          console.log(`  ${chalk.blue(author)} (${items.length})`);
          for (const t of items) {
            const preview = t.content.length > 50 ? t.content.slice(0, 50) + '...' : t.content;
            console.log(`    ${chalk.yellow('○')} ${chalk.dim(`${t.file}:${t.line}`)} ${preview}`);
          }
          console.log();
        }
      } else {
        // List by file
        let currentFile = null;
        for (const t of todos) {
          if (t.file !== currentFile) {
            if (currentFile) console.log();
            console.log(`  ${chalk.cyan(t.file)}`);
            currentFile = t.file;
          }
          const preview = t.content.length > 50 ? t.content.slice(0, 50) + '...' : t.content;
          const authorTag = t.author !== 'Anonymous' ? chalk.dim(`[${t.author}] `) : '';
          console.log(`    ${chalk.yellow('○')} #${t.number} ${authorTag}${preview}`);
        }
      }

      console.log();
    });

  // ==========================================================================
  // ACCEPT command - Accept track changes
  // ==========================================================================

  program
    .command('accept')
    .alias('a')
    .description('Accept track changes')
    .argument('<file>', 'Markdown file')
    .option('-n, --number <n>', 'Accept specific change by number', parseInt)
    .option('-a, --all', 'Accept all changes')
    .option('--dry-run', 'Preview without saving')
    .action((file, options) => {
      if (!fs.existsSync(file)) {
        console.error(chalk.red(`Error: File not found: ${file}`));
        process.exit(1);
      }

      let text = fs.readFileSync(file, 'utf-8');
      const changes = getTrackChanges(text);

      if (changes.length === 0) {
        console.log(fmt.status('info', 'No track changes found.'));
        return;
      }

      if (options.all) {
        // Accept all changes - process in reverse to preserve positions
        const sorted = [...changes].sort((a, b) => b.position - a.position);
        for (const change of sorted) {
          text = applyDecision(text, change, true);
        }
        if (!options.dryRun) {
          fs.writeFileSync(file, text, 'utf-8');
          console.log(fmt.status('success', `Accepted ${changes.length} change(s)`));
        } else {
          console.log(fmt.status('info', `Would accept ${changes.length} change(s)`));
        }
        return;
      }

      if (options.number !== undefined) {
        const idx = options.number - 1;
        if (idx < 0 || idx >= changes.length) {
          console.error(chalk.red(`Invalid change number. File has ${changes.length} changes.`));
          process.exit(1);
        }
        const change = changes[idx];
        text = applyDecision(text, change, true);
        if (!options.dryRun) {
          fs.writeFileSync(file, text, 'utf-8');
          console.log(fmt.status('success', `Accepted change #${options.number}`));
        } else {
          console.log(fmt.status('info', `Would accept change #${options.number}`));
        }
        return;
      }

      // No options: show changes
      console.log(fmt.header(`Track Changes in ${path.basename(file)}`));
      console.log();

      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        let desc;
        if (c.type === 'insert') {
          desc = chalk.green(`+++ "${c.content.slice(0, 40)}${c.content.length > 40 ? '...' : ''}"`);
        } else if (c.type === 'delete') {
          desc = chalk.red(`--- "${c.content.slice(0, 40)}${c.content.length > 40 ? '...' : ''}"`);
        } else if (c.type === 'substitute') {
          desc = chalk.yellow(`~~~ "${c.content.slice(0, 20)}" → "${(c.replacement || '').slice(0, 20)}"`);
        }
        console.log(`  #${i + 1} ${chalk.dim(`L${c.line}`)} ${desc}`);
      }

      console.log();
      console.log(chalk.dim(`  rev accept ${file} -n <number>    Accept specific change`));
      console.log(chalk.dim(`  rev accept ${file} -a             Accept all changes`));
    });

  // ==========================================================================
  // REJECT command - Reject track changes
  // ==========================================================================

  program
    .command('reject')
    .alias('x')
    .description('Reject track changes')
    .argument('<file>', 'Markdown file')
    .option('-n, --number <n>', 'Reject specific change by number', parseInt)
    .option('-a, --all', 'Reject all changes')
    .option('--dry-run', 'Preview without saving')
    .action((file, options) => {
      if (!fs.existsSync(file)) {
        console.error(chalk.red(`Error: File not found: ${file}`));
        process.exit(1);
      }

      let text = fs.readFileSync(file, 'utf-8');
      const changes = getTrackChanges(text);

      if (changes.length === 0) {
        console.log(fmt.status('info', 'No track changes found.'));
        return;
      }

      if (options.all) {
        // Reject all changes - process in reverse to preserve positions
        const sorted = [...changes].sort((a, b) => b.position - a.position);
        for (const change of sorted) {
          text = applyDecision(text, change, false);
        }
        if (!options.dryRun) {
          fs.writeFileSync(file, text, 'utf-8');
          console.log(fmt.status('success', `Rejected ${changes.length} change(s)`));
        } else {
          console.log(fmt.status('info', `Would reject ${changes.length} change(s)`));
        }
        return;
      }

      if (options.number !== undefined) {
        const idx = options.number - 1;
        if (idx < 0 || idx >= changes.length) {
          console.error(chalk.red(`Invalid change number. File has ${changes.length} changes.`));
          process.exit(1);
        }
        const change = changes[idx];
        text = applyDecision(text, change, false);
        if (!options.dryRun) {
          fs.writeFileSync(file, text, 'utf-8');
          console.log(fmt.status('success', `Rejected change #${options.number}`));
        } else {
          console.log(fmt.status('info', `Would reject change #${options.number}`));
        }
        return;
      }

      // No options: show changes (same as accept)
      console.log(fmt.header(`Track Changes in ${path.basename(file)}`));
      console.log();

      for (let i = 0; i < changes.length; i++) {
        const c = changes[i];
        let desc;
        if (c.type === 'insert') {
          desc = chalk.green(`+++ "${c.content.slice(0, 40)}${c.content.length > 40 ? '...' : ''}"`);
        } else if (c.type === 'delete') {
          desc = chalk.red(`--- "${c.content.slice(0, 40)}${c.content.length > 40 ? '...' : ''}"`);
        } else if (c.type === 'substitute') {
          desc = chalk.yellow(`~~~ "${c.content.slice(0, 20)}" → "${(c.replacement || '').slice(0, 20)}"`);
        }
        console.log(`  #${i + 1} ${chalk.dim(`L${c.line}`)} ${desc}`);
      }

      console.log();
      console.log(chalk.dim(`  rev reject ${file} -n <number>    Reject specific change`));
      console.log(chalk.dim(`  rev reject ${file} -a             Reject all changes`));
    });

  // ==========================================================================
  // REPLY command - Reply to comments
  // ==========================================================================

  program
    .command('reply')
    .description('Reply to reviewer comments interactively')
    .argument('<file>', 'Markdown file with comments')
    .option('-m, --message <text>', 'Reply message (non-interactive)')
    .option('-n, --number <n>', 'Reply to specific comment number', parseInt)
    .option('-a, --author <name>', 'Override author name')
    .option('--all', 'Reply to all pending comments with the same message (requires -m)')
    .option('--dry-run', 'Preview without saving')
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
      const comments = getComments(text, { pendingOnly: true });

      if (comments.length === 0) {
        console.log(chalk.green('No pending comments found in this file.'));
        return;
      }

      // Batch reply mode: reply to all pending comments
      if (options.all) {
        if (!options.message) {
          console.error(chalk.red('Batch reply requires a message (-m "your reply")'));
          console.error(chalk.dim('Example: rev reply file.md --all -m "Addressed"'));
          process.exit(1);
        }
        let result = text;
        let count = 0;
        // Process in reverse order to maintain positions
        const sortedComments = [...comments].sort((a, b) => b.position - a.position);
        for (const comment of sortedComments) {
          result = addReply(result, comment, author, options.message);
          count++;
        }
        if (options.dryRun) {
          console.log(fmt.status('info', `Would add reply to ${count} pending comment(s)`));
        } else {
          fs.writeFileSync(file, result, 'utf-8');
          console.log(chalk.green(`Reply added to ${count} pending comment(s)`));
        }
        return;
      }

      // Non-interactive mode: reply to specific comment
      if (options.message && options.number !== undefined) {
        const allComments = getComments(text); // Get all comments for numbering
        const idx = options.number - 1;
        if (idx < 0 || idx >= allComments.length) {
          console.error(chalk.red(`Invalid comment number. File has ${allComments.length} comments.`));
          process.exit(1);
        }
        const result = addReply(text, allComments[idx], author, options.message);
        if (options.dryRun) {
          console.log(fmt.status('info', `Would add reply to comment #${options.number}`));
        } else {
          fs.writeFileSync(file, result, 'utf-8');
          console.log(chalk.green(`Reply added to comment #${options.number}`));
        }
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
}
