/**
 * Formatting utilities for CLI output
 * Tables, boxes, spinners, progress bars
 */

import chalk from 'chalk';

/**
 * Format a table with borders and alignment
 * @param {string[]} headers - Column headers
 * @param {string[][]} rows - Row data
 * @param {object} options - Formatting options
 * @returns {string}
 */
export function table(headers, rows, options = {}) {
  const {
    align = headers.map(() => 'left'), // 'left', 'right', 'center'
    headerStyle = chalk.bold.cyan,
    borderStyle = chalk.dim,
    cellStyle = null, // function(value, colIndex, rowIndex) => styled string
  } = options;

  // Calculate column widths
  const widths = headers.map((h, i) => {
    const cellWidths = rows.map(row => stripAnsi(String(row[i] || '')).length);
    return Math.max(stripAnsi(h).length, ...cellWidths);
  });

  // Border characters
  const border = {
    topLeft: '┌', topRight: '┐', bottomLeft: '└', bottomRight: '┘',
    horizontal: '─', vertical: '│',
    leftT: '├', rightT: '┤', topT: '┬', bottomT: '┴', cross: '┼',
  };

  // Build lines
  const lines = [];

  // Top border
  const topBorder = border.topLeft +
    widths.map(w => border.horizontal.repeat(w + 2)).join(border.topT) +
    border.topRight;
  lines.push(borderStyle(topBorder));

  // Header row
  const headerRow = border.vertical +
    headers.map((h, i) => ' ' + pad(headerStyle(h), widths[i], align[i]) + ' ').join(border.vertical) +
    border.vertical;
  lines.push(borderStyle(border.vertical) +
    headers.map((h, i) => ' ' + pad(headerStyle(h), widths[i], align[i], stripAnsi(h).length) + ' ').join(borderStyle(border.vertical)) +
    borderStyle(border.vertical));

  // Header separator
  const headerSep = border.leftT +
    widths.map(w => border.horizontal.repeat(w + 2)).join(border.cross) +
    border.rightT;
  lines.push(borderStyle(headerSep));

  // Data rows
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    const cells = row.map((cell, colIdx) => {
      let value = String(cell || '');
      if (cellStyle) {
        value = cellStyle(value, colIdx, rowIdx);
      }
      const plainLen = stripAnsi(String(cell || '')).length;
      return ' ' + pad(value, widths[colIdx], align[colIdx], plainLen) + ' ';
    });
    lines.push(borderStyle(border.vertical) + cells.join(borderStyle(border.vertical)) + borderStyle(border.vertical));
  }

  // Bottom border
  const bottomBorder = border.bottomLeft +
    widths.map(w => border.horizontal.repeat(w + 2)).join(border.bottomT) +
    border.bottomRight;
  lines.push(borderStyle(bottomBorder));

  return lines.join('\n');
}

/**
 * Simple table without borders (compact)
 */
export function simpleTable(headers, rows, options = {}) {
  const { headerStyle = chalk.dim, indent = '  ' } = options;

  const widths = headers.map((h, i) => {
    const cellWidths = rows.map(row => stripAnsi(String(row[i] || '')).length);
    return Math.max(stripAnsi(h).length, ...cellWidths);
  });

  const lines = [];
  lines.push(indent + headers.map((h, i) => headerStyle(pad(h, widths[i], 'left'))).join('  '));
  lines.push(indent + widths.map(w => chalk.dim('─'.repeat(w))).join('  '));

  for (const row of rows) {
    lines.push(indent + row.map((cell, i) => pad(String(cell || ''), widths[i], 'left')).join('  '));
  }

  return lines.join('\n');
}

/**
 * Format a box around content
 */
export function box(content, options = {}) {
  const {
    title = null,
    padding = 1,
    borderStyle = chalk.dim,
    titleStyle = chalk.bold.cyan,
  } = options;

  const lines = content.split('\n');
  const maxWidth = Math.max(...lines.map(l => stripAnsi(l).length), title ? stripAnsi(title).length + 4 : 0);

  const border = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };
  const result = [];

  // Top border with optional title
  if (title) {
    const titlePart = ` ${titleStyle(title)} `;
    const remaining = maxWidth + 2 - stripAnsi(titlePart).length;
    result.push(borderStyle(border.tl + border.h) + titlePart + borderStyle(border.h.repeat(remaining) + border.tr));
  } else {
    result.push(borderStyle(border.tl + border.h.repeat(maxWidth + 2) + border.tr));
  }

  // Padding top
  for (let i = 0; i < padding; i++) {
    result.push(borderStyle(border.v) + ' '.repeat(maxWidth + 2) + borderStyle(border.v));
  }

  // Content
  for (const line of lines) {
    const plainLen = stripAnsi(line).length;
    const padded = line + ' '.repeat(maxWidth - plainLen);
    result.push(borderStyle(border.v) + ' ' + padded + ' ' + borderStyle(border.v));
  }

  // Padding bottom
  for (let i = 0; i < padding; i++) {
    result.push(borderStyle(border.v) + ' '.repeat(maxWidth + 2) + borderStyle(border.v));
  }

  // Bottom border
  result.push(borderStyle(border.bl + border.h.repeat(maxWidth + 2) + border.br));

  return result.join('\n');
}

/**
 * Summary stats in a nice format
 */
export function stats(data, options = {}) {
  const { title = null } = options;

  const lines = [];
  if (title) {
    lines.push(chalk.bold.cyan(title));
    lines.push('');
  }

  const maxKeyLen = Math.max(...Object.keys(data).map(k => k.length));

  for (const [key, value] of Object.entries(data)) {
    const label = chalk.dim(key.padEnd(maxKeyLen) + ':');
    lines.push(`  ${label} ${value}`);
  }

  return lines.join('\n');
}

/**
 * Progress indicator
 */
export function progress(current, total, options = {}) {
  const { width = 30, label = '' } = options;
  const pct = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;

  const bar = chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
  return `${label}${bar} ${pct}% (${current}/${total})`;
}

// Global setting for emoji usage
let useEmoji = false;

export function setEmoji(enabled) {
  useEmoji = enabled;
}

/**
 * Status line with icon
 */
export function status(type, message) {
  const textIcons = {
    success: chalk.green('✓'),
    error: chalk.red('✗'),
    warning: chalk.yellow('!'),
    info: chalk.blue('i'),
    comment: chalk.blue('#'),
    file: chalk.cyan('·'),
    folder: chalk.cyan('>'),
    build: chalk.magenta('*'),
    import: chalk.cyan('<'),
    export: chalk.cyan('>'),
  };

  const emojiIcons = {
    success: chalk.green('✓'),
    error: chalk.red('✗'),
    warning: chalk.yellow('⚠'),
    info: chalk.blue('ℹ'),
    comment: chalk.blue('💬'),
    file: chalk.cyan('📄'),
    folder: chalk.cyan('📁'),
    build: chalk.magenta('🔨'),
    import: chalk.cyan('📥'),
    export: chalk.cyan('📤'),
  };

  const icons = useEmoji ? emojiIcons : textIcons;
  const icon = icons[type] || chalk.dim('•');
  return `${icon} ${message}`;
}

/**
 * Pulsing star spinner frames (Claude-style)
 * Cycles through star brightness using unicode stars
 */
const starFrames = ['✦', '✧', '✦', '✧', '⋆', '✧', '✦', '✧'];
const starColors = [
  chalk.yellow,
  chalk.yellow.dim,
  chalk.white,
  chalk.yellow.dim,
  chalk.dim,
  chalk.yellow.dim,
  chalk.white,
  chalk.yellow.dim,
];

/**
 * Create a pulsing star spinner for async operations
 */
export function spinner(message) {
  let frameIndex = 0;
  let interval = null;

  const spin = {
    start() {
      process.stdout.write('\x1B[?25l'); // Hide cursor
      interval = setInterval(() => {
        const frame = starColors[frameIndex](starFrames[frameIndex]);
        process.stdout.write(`\r${frame} ${message}`);
        frameIndex = (frameIndex + 1) % starFrames.length;
      }, 120);
      return spin;
    },
    stop(finalMessage = null) {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      process.stdout.write('\r\x1B[K'); // Clear line
      process.stdout.write('\x1B[?25h'); // Show cursor
      if (finalMessage) {
        console.log(finalMessage);
      }
      return spin;
    },
    success(msg) {
      return spin.stop(status('success', msg || message));
    },
    error(msg) {
      return spin.stop(status('error', msg || message));
    },
  };

  return spin;
}

/**
 * Create a progress bar for batch operations
 * @param {number} total - Total number of items
 * @param {string} label - Label for the progress bar
 * @returns {object} Progress bar controller with update(), increment(), and done()
 */
export function progressBar(total, label = 'Progress') {
  let current = 0;
  const barWidth = 30;

  const bar = {
    update(n) {
      current = Math.min(n, total);
      const percent = Math.floor((current / total) * 100);
      const filled = Math.floor((current / total) * barWidth);
      const empty = barWidth - filled;
      const filledBar = chalk.cyan('█'.repeat(filled));
      const emptyBar = chalk.dim('░'.repeat(empty));
      process.stdout.write(`\r${label} [${filledBar}${emptyBar}] ${percent}% (${current}/${total})`);
      return bar;
    },
    increment() {
      return bar.update(current + 1);
    },
    done(message) {
      process.stdout.write('\r\x1B[K'); // Clear line
      if (message) {
        console.log(status('success', message));
      }
      return bar;
    },
  };

  return bar;
}

/**
 * Diff display with inline highlighting
 */
export function diff(insertions, deletions, substitutions) {
  const lines = [];

  if (insertions > 0) {
    lines.push(chalk.green(`  + ${insertions} insertion${insertions !== 1 ? 's' : ''}`));
  }
  if (deletions > 0) {
    lines.push(chalk.red(`  - ${deletions} deletion${deletions !== 1 ? 's' : ''}`));
  }
  if (substitutions > 0) {
    lines.push(chalk.yellow(`  ~ ${substitutions} substitution${substitutions !== 1 ? 's' : ''}`));
  }

  return lines.join('\n');
}

/**
 * Show inline diff preview for CriticMarkup changes
 * @param {string} text - Text with CriticMarkup annotations
 * @param {object} options
 * @returns {string}
 */
export function inlineDiffPreview(text, options = {}) {
  const { maxLines = 10, contextChars = 40 } = options;
  const lines = [];

  // Find all changes
  const changes = [];

  // Insertions: {++text++}
  const insertPattern = /\{\+\+([^+]*)\+\+\}/g;
  let match;
  while ((match = insertPattern.exec(text)) !== null) {
    changes.push({
      type: 'insert',
      content: match[1],
      index: match.index,
      fullMatch: match[0],
    });
  }

  // Deletions: {--text--}
  const deletePattern = /\{--([^-]*)--\}/g;
  while ((match = deletePattern.exec(text)) !== null) {
    changes.push({
      type: 'delete',
      content: match[1],
      index: match.index,
      fullMatch: match[0],
    });
  }

  // Substitutions: {~~old~>new~~}
  const subPattern = /\{~~([^~]*)~>([^~]*)~~\}/g;
  while ((match = subPattern.exec(text)) !== null) {
    changes.push({
      type: 'substitute',
      oldContent: match[1],
      newContent: match[2],
      index: match.index,
      fullMatch: match[0],
    });
  }

  // Sort by position
  changes.sort((a, b) => a.index - b.index);

  // Show preview for each change (up to maxLines)
  const shown = changes.slice(0, maxLines);

  for (const change of shown) {
    // Get context
    const before = text.slice(Math.max(0, change.index - contextChars), change.index)
      .replace(/\n/g, ' ').trim();
    const afterIdx = change.index + change.fullMatch.length;
    const after = text.slice(afterIdx, afterIdx + contextChars)
      .replace(/\n/g, ' ').trim();

    let preview = '';
    if (change.type === 'insert') {
      preview = chalk.dim(before) + chalk.green.bold('+' + change.content) + chalk.dim(after);
      lines.push(chalk.green('  + ') + truncate(preview, 80));
    } else if (change.type === 'delete') {
      preview = chalk.dim(before) + chalk.red.bold('-' + change.content) + chalk.dim(after);
      lines.push(chalk.red('  - ') + truncate(preview, 80));
    } else if (change.type === 'substitute') {
      preview = chalk.dim(before) +
        chalk.red.strikethrough(change.oldContent) +
        chalk.green.bold(change.newContent) +
        chalk.dim(after);
      lines.push(chalk.yellow('  ~ ') + truncate(preview, 80));
    }
  }

  if (changes.length > maxLines) {
    lines.push(chalk.dim(`  ... and ${changes.length - maxLines} more changes`));
  }

  return lines.join('\n');
}

/**
 * Truncate string to max length
 */
function truncate(str, maxLen) {
  const plain = stripAnsi(str);
  if (plain.length <= maxLen) return str;
  // This is approximate since we have ANSI codes
  return str.slice(0, maxLen + (str.length - plain.length)) + chalk.dim('...');
}

/**
 * Section header
 */
export function header(text, options = {}) {
  const { style = chalk.bold.cyan, width = 60 } = options;
  const padding = Math.max(0, width - text.length - 4);
  return style(`── ${text} ${'─'.repeat(padding)}`);
}

/**
 * Strip ANSI codes for length calculation
 */
function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Pad string with alignment
 */
function pad(str, width, align, strLen = null) {
  const len = strLen !== null ? strLen : stripAnsi(str).length;
  const padding = Math.max(0, width - len);

  if (align === 'right') {
    return ' '.repeat(padding) + str;
  } else if (align === 'center') {
    const left = Math.floor(padding / 2);
    const right = padding - left;
    return ' '.repeat(left) + str + ' '.repeat(right);
  }
  return str + ' '.repeat(padding);
}
