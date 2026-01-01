/**
 * Interactive review TUI for track changes
 */

import * as readline from 'readline';
import chalk from 'chalk';
import { getTrackChanges, getComments, applyDecision } from './annotations.js';

/**
 * Format an annotation for display
 * @param {object} annotation
 * @param {number} index
 * @param {number} total
 * @returns {string}
 */
function formatAnnotation(annotation, index, total) {
  const header = chalk.dim(`─── Change ${index + 1}/${total} (line ${annotation.line}) ───`);

  let action;
  let display;

  switch (annotation.type) {
    case 'insert':
      action = chalk.green(`+ Insert: "${annotation.content}"`);
      display =
        chalk.dim(annotation.before) +
        chalk.green.bold(`[${annotation.content}]`) +
        chalk.dim(annotation.after);
      break;
    case 'delete':
      action = chalk.red(`- Delete: "${annotation.content}"`);
      display =
        chalk.dim(annotation.before) +
        chalk.red.strikethrough(`[${annotation.content}]`) +
        chalk.dim(annotation.after);
      break;
    case 'substitute':
      action = chalk.yellow(`~ Change: "${annotation.content}" → "${annotation.replacement}"`);
      display =
        chalk.dim(annotation.before) +
        chalk.red.strikethrough(`[${annotation.content}]`) +
        chalk.dim(' → ') +
        chalk.green.bold(`[${annotation.replacement}]`) +
        chalk.dim(annotation.after);
      break;
  }

  return `\n${header}\n\n  ${action}\n\n  ${display}\n`;
}

/**
 * Prompt for a single keypress
 * @param {string} prompt
 * @param {string[]} validKeys
 * @returns {Promise<string>}
 */
function promptKey(prompt, validKeys) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Enable raw mode for single keypress
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    process.stdout.write(prompt);

    process.stdin.once('data', (key) => {
      const char = key.toString().toLowerCase();

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      rl.close();

      if (char === '\u0003') {
        // Ctrl+C
        process.exit(0);
      }

      if (validKeys.includes(char)) {
        console.log(char);
        resolve(char);
      } else {
        console.log();
        resolve(promptKey(prompt, validKeys));
      }
    });
  });
}

/**
 * Run interactive review session
 * @param {string} text
 * @returns {Promise<{text: string, accepted: number, rejected: number, skipped: number}>}
 */
export async function interactiveReview(text) {
  const changes = getTrackChanges(text);
  const comments = getComments(text);

  if (changes.length === 0) {
    console.log(chalk.green('No track changes found.'));
    if (comments.length > 0) {
      console.log(chalk.yellow(`${comments.length} comment(s) remain in the document.`));
    }
    return { text, accepted: 0, rejected: 0, skipped: 0 };
  }

  console.log(chalk.cyan(`\nFound ${changes.length} track change(s)\n`));

  let accepted = 0;
  let rejected = 0;
  let skipped = 0;
  let currentText = text;

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i];
    console.log(formatAnnotation(change, i, changes.length));

    const prompt = chalk.dim('[a]ccept [r]eject [s]kip | accept [A]ll reject a[L]l [q]uit: ');
    const choice = await promptKey(prompt, ['a', 'r', 's', 'A', 'L', 'q']);

    switch (choice) {
      case 'q':
        console.log(chalk.yellow('\nAborted. No changes saved.'));
        return { text, accepted: 0, rejected: 0, skipped: changes.length };

      case 'A':
        // Accept all remaining
        for (let j = i; j < changes.length; j++) {
          currentText = applyDecision(currentText, changes[j], true);
        }
        accepted += changes.length - i;
        console.log(chalk.green(`\nAccepted all ${changes.length - i} remaining changes.`));
        i = changes.length; // Exit loop
        break;

      case 'L':
        // Reject all remaining
        for (let j = i; j < changes.length; j++) {
          currentText = applyDecision(currentText, changes[j], false);
        }
        rejected += changes.length - i;
        console.log(chalk.red(`\nRejected all ${changes.length - i} remaining changes.`));
        i = changes.length; // Exit loop
        break;

      case 'a':
        currentText = applyDecision(currentText, change, true);
        accepted++;
        break;

      case 'r':
        currentText = applyDecision(currentText, change, false);
        rejected++;
        break;

      case 's':
        skipped++;
        break;
    }
  }

  console.log(chalk.cyan('\n─── Summary ───'));
  console.log(chalk.green(`Accepted: ${accepted}`));
  console.log(chalk.red(`Rejected: ${rejected}`));
  console.log(chalk.yellow(`Skipped: ${skipped}`));

  if (comments.length > 0) {
    console.log(chalk.blue(`\n${comments.length} comment(s) preserved.`));
  }

  return { text: currentText, accepted, rejected, skipped };
}

/**
 * List all comments
 * @param {string} text
 */
export function listComments(text) {
  const comments = getComments(text);

  if (comments.length === 0) {
    console.log(chalk.green('No comments found.'));
    return;
  }

  console.log(chalk.cyan(`\nFound ${comments.length} comment(s):\n`));

  for (let i = 0; i < comments.length; i++) {
    const c = comments[i];
    const author = c.author || 'Anonymous';
    const header = chalk.blue(`[${i + 1}] ${author}`) + chalk.dim(` (line ${c.line})`);

    console.log(header);
    console.log(`  ${c.content}`);
    console.log(
      chalk.dim(`  Context: ...${c.before.slice(-25)}`) +
        chalk.yellow('*') +
        chalk.dim(`${c.after.slice(0, 25)}...`)
    );
    console.log();
  }
}

/**
 * Format a comment for interactive display
 * @param {object} comment
 * @param {number} index
 * @param {number} total
 * @returns {string}
 */
function formatComment(comment, index, total) {
  const statusIcon = comment.resolved ? chalk.green('✓') : chalk.yellow('○');
  const author = comment.author || 'Anonymous';
  const header = chalk.dim(`─── Comment ${index + 1}/${total} (line ${comment.line}) ───`);

  const authorLine = chalk.blue(`${author}`) + ` ${statusIcon}`;
  const context = chalk.dim(`Context: "...${(comment.before || '').slice(-40)}"`);

  return `\n${header}\n\n  ${authorLine}\n  ${comment.content}\n\n  ${context}\n`;
}

/**
 * Run interactive comment review session
 * @param {string} text
 * @param {object} options
 * @param {string} options.author - Author name for replies
 * @param {Function} options.addReply - Function to add reply to comment
 * @param {Function} options.setCommentStatus - Function to set comment status
 * @returns {Promise<{text: string, resolved: number, replied: number, skipped: number}>}
 */
export async function interactiveCommentReview(text, options = {}) {
  const { author = 'Author', addReply, setCommentStatus } = options;
  const comments = getComments(text, { pendingOnly: true });

  if (comments.length === 0) {
    console.log(chalk.green('No pending comments found.'));
    return { text, resolved: 0, replied: 0, skipped: 0 };
  }

  console.log(chalk.cyan(`\nReviewing ${comments.length} pending comment(s) as ${chalk.bold(author)}\n`));

  let resolved = 0;
  let replied = 0;
  let skipped = 0;
  let currentText = text;

  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i];
    console.log(formatComment(comment, i, comments.length));

    const prompt = chalk.dim('[r]eply [m]ark resolved [s]kip | resolve [A]ll [q]uit: ');
    const choice = await promptKey(prompt, ['r', 'm', 's', 'A', 'q']);

    switch (choice) {
      case 'q':
        console.log(chalk.yellow('\nAborted.'));
        return { text: currentText, resolved, replied, skipped: comments.length - i };

      case 'A':
        // Resolve all remaining
        for (let j = i; j < comments.length; j++) {
          if (setCommentStatus) {
            currentText = setCommentStatus(currentText, comments[j], true);
          }
        }
        resolved += comments.length - i;
        console.log(chalk.green(`\nResolved all ${comments.length - i} remaining comments.`));
        i = comments.length;
        break;

      case 'm':
        if (setCommentStatus) {
          currentText = setCommentStatus(currentText, comment, true);
        }
        resolved++;
        console.log(chalk.green('  Marked as resolved'));
        break;

      case 'r':
        // Get reply text
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const replyText = await new Promise((resolve) => {
          rl.question(chalk.cyan('  Reply: '), resolve);
        });
        rl.close();

        if (replyText.trim() && addReply) {
          currentText = addReply(currentText, comment, author, replyText.trim());
          replied++;
          console.log(chalk.green('  Reply added'));
        } else {
          console.log(chalk.dim('  No reply added'));
        }
        break;

      case 's':
        skipped++;
        break;
    }
  }

  console.log(chalk.cyan('\n─── Summary ───'));
  console.log(chalk.green(`Resolved: ${resolved}`));
  console.log(chalk.blue(`Replied: ${replied}`));
  console.log(chalk.yellow(`Skipped: ${skipped}`));

  return { text: currentText, resolved, replied, skipped };
}
