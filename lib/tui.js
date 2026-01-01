/**
 * TUI (Text User Interface) components for enhanced visual display
 * Uses box-drawing characters and colors for a richer terminal experience
 */

import chalk from 'chalk';
import * as readline from 'readline';

/**
 * Clear the terminal screen
 */
export function clearScreen() {
  process.stdout.write('\x1B[2J\x1B[H');
}

/**
 * Move cursor to position
 * @param {number} row
 * @param {number} col
 */
export function moveCursor(row, col) {
  process.stdout.write(`\x1B[${row};${col}H`);
}

/**
 * Get terminal dimensions
 * @returns {{rows: number, cols: number}}
 */
export function getTerminalSize() {
  return {
    rows: process.stdout.rows || 24,
    cols: process.stdout.columns || 80,
  };
}

/**
 * Draw a box with content
 * @param {object} options
 * @param {string} options.title
 * @param {string[]} options.content
 * @param {number} options.width
 * @param {string} options.borderColor
 * @returns {string[]}
 */
export function drawBox({ title = '', content = [], width = 60, borderColor = 'dim' }) {
  const border = {
    tl: '╭', tr: '╮', bl: '╰', br: '╯',
    h: '─', v: '│',
  };

  const colorFn = chalk[borderColor] || chalk.dim;
  const lines = [];

  // Top border with title
  if (title) {
    const titleDisplay = ` ${title} `;
    const remaining = width - titleDisplay.length - 2;
    lines.push(
      colorFn(border.tl + border.h) +
      chalk.bold(titleDisplay) +
      colorFn(border.h.repeat(Math.max(0, remaining)) + border.tr)
    );
  } else {
    lines.push(colorFn(border.tl + border.h.repeat(width - 2) + border.tr));
  }

  // Content lines
  for (const line of content) {
    const plainLen = stripAnsi(line).length;
    const padding = Math.max(0, width - 4 - plainLen);
    lines.push(
      colorFn(border.v) + ' ' + line + ' '.repeat(padding) + ' ' + colorFn(border.v)
    );
  }

  // Bottom border
  lines.push(colorFn(border.bl + border.h.repeat(width - 2) + border.br));

  return lines;
}

/**
 * Draw a status bar at the bottom of the screen
 * @param {string} left - Left-aligned text
 * @param {string} right - Right-aligned text
 * @returns {string}
 */
export function statusBar(left, right = '') {
  const { cols } = getTerminalSize();
  const leftLen = stripAnsi(left).length;
  const rightLen = stripAnsi(right).length;
  const padding = Math.max(0, cols - leftLen - rightLen);

  return chalk.inverse(left + ' '.repeat(padding) + right);
}

/**
 * Draw a progress indicator
 * @param {number} current
 * @param {number} total
 * @param {number} width
 * @returns {string}
 */
export function progressIndicator(current, total, width = 20) {
  const ratio = current / total;
  const filled = Math.round(ratio * width);
  const empty = width - filled;

  const bar = chalk.cyan('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
  return `${bar} ${current}/${total}`;
}

/**
 * Format a comment for TUI display
 * @param {object} comment
 * @param {number} index
 * @param {number} total
 * @param {number} width
 * @returns {string[]}
 */
export function formatCommentCard(comment, index, total, width = 70) {
  const statusIcon = comment.resolved ? chalk.green('✓') : chalk.yellow('○');
  const author = comment.author || 'Anonymous';

  const content = [];

  // Author and status line
  content.push(chalk.blue(author) + ' ' + statusIcon);
  content.push('');

  // Comment text (word-wrap)
  const wrappedText = wordWrap(comment.content, width - 6);
  for (const line of wrappedText) {
    content.push(line);
  }

  // Context
  if (comment.before) {
    content.push('');
    const context = comment.before.trim().slice(-50);
    content.push(chalk.dim(`Context: "...${context}"`));
  }

  // Line number
  content.push('');
  content.push(chalk.dim(`Line ${comment.line}`));

  return drawBox({
    title: `Comment ${index + 1}/${total}`,
    content,
    width,
    borderColor: comment.resolved ? 'green' : 'cyan',
  });
}

/**
 * Draw the action menu
 * @param {string[]} options - Array of [key, description] tuples
 * @returns {string}
 */
export function actionMenu(options) {
  return options
    .map(([key, desc]) => chalk.bold(`[${key}]`) + chalk.dim(desc))
    .join('  ');
}

/**
 * Word wrap text to fit within width
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function wordWrap(text, width) {
  const words = text.split(/\s+/);
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);
  return lines;
}

/**
 * Strip ANSI codes for length calculation
 * @param {string} str
 * @returns {string}
 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Run TUI comment review session
 * @param {string} text
 * @param {object} options
 * @returns {Promise<{text: string, resolved: number, replied: number, skipped: number}>}
 */
export async function tuiCommentReview(text, options = {}) {
  const { getComments, setCommentStatus } = await import('./annotations.js');
  const { createDocumentSession } = await import('./undo.js');
  const { author = 'Author', addReply, setStatus } = options;

  const comments = getComments(text, { pendingOnly: true });

  if (comments.length === 0) {
    console.log(chalk.green('No pending comments found.'));
    return { text, resolved: 0, replied: 0, skipped: 0 };
  }

  // Create session with undo support
  const session = createDocumentSession(text);

  let currentIndex = 0;
  let resolved = 0;
  let replied = 0;
  let skipped = 0;
  let message = ''; // Status message to display

  // Helper to render current state
  const render = () => {
    clearScreen();

    const { cols } = getTerminalSize();
    const cardWidth = Math.min(cols - 4, 80);

    // Header
    console.log(chalk.cyan.bold(`  Reviewing ${comments.length} comment(s) as ${author}`));
    const undoInfo = session.info();
    const undoStatus = session.canUndo()
      ? chalk.dim(` | ${undoInfo.undoSteps} undo`)
      : '';
    console.log(chalk.dim(`  ${progressIndicator(currentIndex + 1, comments.length)}${undoStatus}`));
    console.log();

    // Current comment card
    const comment = comments[currentIndex];
    const card = formatCommentCard(comment, currentIndex, comments.length, cardWidth);
    for (const line of card) {
      console.log('  ' + line);
    }

    console.log();

    // Status message
    if (message) {
      console.log('  ' + message);
      console.log();
      message = '';
    }

    // Action menu with undo
    const menuItems = [
      ['r', 'eply'],
      ['m', 'ark resolved'],
      ['s', 'kip'],
      ['n', 'ext'],
      ['p', 'rev'],
    ];

    if (session.canUndo()) {
      menuItems.push(['u', 'ndo']);
    }

    menuItems.push(['A', 'll resolve'], ['q', 'uit']);

    console.log('  ' + actionMenu(menuItems));

    console.log();
  };

  // Prompt for keypress
  const promptKey = (validKeys) => {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      process.stdin.once('data', (key) => {
        const char = key.toString();

        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        rl.close();

        if (char === '\u0003') {
          // Ctrl+C
          clearScreen();
          process.exit(0);
        }

        if (validKeys.includes(char.toLowerCase()) || validKeys.includes(char)) {
          resolve(char);
        } else {
          resolve(promptKey(validKeys));
        }
      });
    });
  };

  // Prompt for text input
  const promptText = (prompt) => {
    return new Promise((resolve) => {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  };

  // Main loop
  while (currentIndex < comments.length) {
    render();

    const validKeys = session.canUndo()
      ? ['r', 'm', 's', 'n', 'p', 'u', 'A', 'q']
      : ['r', 'm', 's', 'n', 'p', 'A', 'q'];

    const choice = await promptKey(validKeys);
    const comment = comments[currentIndex];

    switch (choice) {
      case 'q':
        clearScreen();
        console.log(chalk.yellow('Aborted.'));
        return { text: session.getText(), resolved, replied, skipped: comments.length - currentIndex };

      case 'u':
        // Undo last change
        if (session.canUndo()) {
          const undone = session.undo();
          if (undone) {
            message = chalk.yellow(`Undone: ${undone.description}`);
            // Adjust counters (approximate)
            if (undone.description.includes('Resolved')) resolved = Math.max(0, resolved - 1);
            if (undone.description.includes('Reply')) replied = Math.max(0, replied - 1);
            if (currentIndex > 0) currentIndex--;
          }
        }
        break;

      case 'A':
        // Resolve all remaining
        let newText = session.getText();
        for (let j = currentIndex; j < comments.length; j++) {
          if (setStatus) {
            newText = setStatus(newText, comments[j], true);
          }
        }
        session.applyChange(newText, `Resolved ${comments.length - currentIndex} comments`);
        resolved += comments.length - currentIndex;
        currentIndex = comments.length;
        break;

      case 'm':
        if (setStatus) {
          const newText = setStatus(session.getText(), comment, true);
          session.applyChange(newText, `Resolved comment #${currentIndex + 1}`);
        }
        resolved++;
        currentIndex++;
        break;

      case 'r':
        console.log();
        const replyText = await promptText(chalk.cyan('  Reply: '));
        if (replyText.trim() && addReply) {
          const newText = addReply(session.getText(), comment, author, replyText.trim());
          session.applyChange(newText, `Reply to comment #${currentIndex + 1}`);
          replied++;
        }
        currentIndex++;
        break;

      case 's':
        skipped++;
        currentIndex++;
        break;

      case 'n':
        if (currentIndex < comments.length - 1) {
          currentIndex++;
        }
        break;

      case 'p':
        if (currentIndex > 0) {
          currentIndex--;
        }
        break;
    }
  }

  // Summary
  clearScreen();
  console.log(chalk.cyan.bold('  Review Complete'));
  console.log();

  const undoInfo = session.info();
  const summaryBox = drawBox({
    title: 'Summary',
    content: [
      chalk.green(`Resolved: ${resolved}`),
      chalk.blue(`Replied:  ${replied}`),
      chalk.yellow(`Skipped:  ${skipped}`),
      undoInfo.undoSteps > 1 ? chalk.dim(`Changes:  ${undoInfo.undoSteps}`) : '',
    ].filter(Boolean),
    width: 30,
    borderColor: 'cyan',
  });

  for (const line of summaryBox) {
    console.log('  ' + line);
  }

  console.log();

  return { text: session.getText(), resolved, replied, skipped };
}
