/**
 * Formatting utilities for CLI output
 * Tables, boxes, spinners, progress bars
 */

import chalk from 'chalk';

// Type definitions for function parameters
interface TableOptions {
  align?: Array<'left' | 'right' | 'center'>;
  headerStyle?: (text: string) => string;
  borderStyle?: (text: string) => string;
  cellStyle?: ((value: string, colIndex: number, rowIndex: number) => string) | null;
}

interface SimpleTableOptions {
  headerStyle?: (text: string) => string;
  indent?: string;
}

interface BoxOptions {
  title?: string | null;
  padding?: number;
  borderStyle?: (text: string) => string;
  titleStyle?: (text: string) => string;
}

interface StatsOptions {
  title?: string | null;
}

interface ProgressOptions {
  width?: number;
  label?: string;
}

interface InlineDiffPreviewOptions {
  maxLines?: number;
  contextChars?: number;
}

interface HeaderOptions {
  style?: (text: string) => string;
  width?: number;
}

interface Spinner {
  text: string;
  start: () => Spinner;
  stop: (finalMessage?: string | null) => Spinner;
  success: (msg?: string) => Spinner;
  error: (msg?: string) => Spinner;
}

interface ProgressBar {
  update: (n: number) => ProgressBar;
  increment: () => ProgressBar;
  done: (message?: string) => ProgressBar;
}

/**
 * Format a table with borders and alignment
 * @param headers - Column headers
 * @param rows - Row data
 * @param options - Formatting options
 * @returns Formatted table string
 */
export function table(headers: string[], rows: string[][], options: TableOptions = {}): string {
  const {
    align = headers.map(() => 'left'), // 'left', 'right', 'center'
    headerStyle = chalk.bold.cyan,
    borderStyle = chalk.dim,
    cellStyle = null, // function(value, colIndex, rowIndex) => styled string
  } = options;

  // Calculate column widths
  const widths = headers.map((h, i) => {
    const cellWidths = rows.map(row => stripAnsi(String(row[i] || '')));
    return Math.max(stripAnsi(h), ...cellWidths);
  });

  // Border characters
  const border = {
    topLeft: '┌', topRight: '┐', bottomLeft: '└', bottomRight: '┘',
    horizontal: '─', vertical: '│',
    leftT: '├', rightT: '┤', topT: '┬', bottomT: '┴', cross: '┼',
  };

  // Build lines
  const lines: string[] = [];

  // Top border
  const topBorder = border.topLeft +
    widths.map(w => border.horizontal.repeat(w + 2)).join(border.topT) +
    border.topRight;
  lines.push(borderStyle(topBorder));

  // Header row
  const headerRow = border.vertical +
    headers.map((h, i) => ' ' + pad(headerStyle(h), widths[i] || 0, align[i] || 'left') + ' ').join(border.vertical) +
    border.vertical;
  lines.push(borderStyle(border.vertical) +
    headers.map((h, i) => ' ' + pad(headerStyle(h), widths[i] || 0, align[i] || 'left', stripAnsi(h)) + ' ').join(borderStyle(border.vertical)) +
    borderStyle(border.vertical));

  // Header separator
  const headerSep = border.leftT +
    widths.map(w => border.horizontal.repeat(w + 2)).join(border.cross) +
    border.rightT;
  lines.push(borderStyle(headerSep));

  // Data rows
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    if (!row) continue;
    const cells = row.map((cell, colIdx) => {
      let value = String(cell || '');
      if (cellStyle) {
        value = cellStyle(value, colIdx, rowIdx);
      }
      const plainLen = stripAnsi(String(cell || ''));
      return ' ' + pad(value, widths[colIdx] || 0, align[colIdx] || 'left', plainLen) + ' ';
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
export function simpleTable(headers: string[], rows: string[][], options: SimpleTableOptions = {}): string {
  const { headerStyle = chalk.dim, indent = '  ' } = options;

  const widths = headers.map((h, i) => {
    const cellWidths = rows.map(row => stripAnsi(String(row[i] || '')));
    return Math.max(stripAnsi(h), ...cellWidths);
  });

  const lines: string[] = [];
  lines.push(indent + headers.map((h, i) => headerStyle(pad(h, widths[i] || 0, 'left'))).join('  '));
  lines.push(indent + widths.map(w => chalk.dim('─'.repeat(w))).join('  '));

  for (const row of rows) {
    lines.push(indent + row.map((cell, i) => pad(String(cell || ''), widths[i] || 0, 'left')).join('  '));
  }

  return lines.join('\n');
}

/**
 * Format a box around content
 */
export function box(content: string, options: BoxOptions = {}): string {
  const {
    title = null,
    padding = 1,
    borderStyle = chalk.dim,
    titleStyle = chalk.bold.cyan,
  } = options;

  const lines = content.split('\n');
  const maxWidth = Math.max(...lines.map(l => stripAnsi(l)), title ? stripAnsi(title) + 4 : 0);

  const border = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' };
  const result: string[] = [];

  // Top border with optional title
  if (title) {
    const titlePart = ` ${titleStyle(title)} `;
    const remaining = maxWidth + 2 - stripAnsi(titlePart);
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
    const plainLen = stripAnsi(line);
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
export function stats(data: Record<string, string | number>, options: StatsOptions = {}): string {
  const { title = null } = options;

  const lines: string[] = [];
  if (title) {
    lines.push(chalk.bold.cyan(title));
    lines.push('');
  }

  const keys = Object.keys(data);
  const maxKeyLen = keys.length > 0 ? Math.max(...keys.map(k => k.length)) : 0;

  for (const [key, value] of Object.entries(data)) {
    const label = chalk.dim(key.padEnd(maxKeyLen) + ':');
    lines.push(`  ${label} ${value}`);
  }

  return lines.join('\n');
}

/**
 * Progress indicator
 */
export function progress(current: number, total: number, options: ProgressOptions = {}): string {
  const { width = 30, label = '' } = options;
  const pct = Math.round((current / total) * 100);
  const filled = Math.round((current / total) * width);
  const empty = width - filled;

  const bar = chalk.green('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
  return `${label}${bar} ${pct}% (${current}/${total})`;
}

// Global setting for emoji usage
let useEmoji = false;

export function setEmoji(enabled: boolean): void {
  useEmoji = enabled;
}

/**
 * Status line with icon
 */
export function status(type: string, message: string): string {
  const textIcons: Record<string, string> = {
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

  const emojiIcons: Record<string, string> = {
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
export function spinner(message: string): Spinner {
  let frameIndex = 0;
  let interval: NodeJS.Timeout | null = null;

  const spin: Spinner = {
    text: message,
    start() {
      process.stdout.write('\x1B[?25l'); // Hide cursor
      interval = setInterval(() => {
        const colorFn = starColors[frameIndex];
        const frameChr = starFrames[frameIndex];
        if (colorFn && frameChr) {
          const frame = colorFn(frameChr);
          process.stdout.write(`\r${frame} ${spin.text}`);
        }
        frameIndex = (frameIndex + 1) % starFrames.length;
      }, 120);
      return spin;
    },
    stop(finalMessage: string | null = null) {
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
    success(msg?: string) {
      return spin.stop(status('success', msg || message));
    },
    error(msg?: string) {
      return spin.stop(status('error', msg || message));
    },
  };

  return spin;
}

/**
 * Create a progress bar for batch operations
 * @param total - Total number of items
 * @param label - Label for the progress bar
 * @returns Progress bar controller with update(), increment(), and done()
 */
export function progressBar(total: number, label: string = 'Progress'): ProgressBar {
  let current = 0;
  const barWidth = 30;

  const bar: ProgressBar = {
    update(n: number) {
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
    done(message?: string) {
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
export function diff(insertions: number, deletions: number, substitutions: number): string {
  const lines: string[] = [];

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
 * @param text - Text with CriticMarkup annotations
 * @param options - Display options
 * @returns Formatted preview string
 */
export function inlineDiffPreview(text: string, options: InlineDiffPreviewOptions = {}): string {
  const { maxLines = 10, contextChars = 40 } = options;
  const lines: string[] = [];

  // Find all changes
  const changes: Array<{
    type: 'insert' | 'delete' | 'substitute';
    content?: string;
    oldContent?: string;
    newContent?: string;
    index: number;
    fullMatch: string;
  }> = [];

  // Insertions: {++text++}
  const insertPattern = /\{\+\+([^+]*)\+\+\}/g;
  let match: RegExpExecArray | null;
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
        chalk.red.strikethrough(change.oldContent || '') +
        chalk.green.bold(change.newContent || '') +
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
function truncate(str: string, maxLen: number): string {
  const plain = stripAnsiStr(str);
  if (plain.length <= maxLen) return str;
  // This is approximate since we have ANSI codes
  return str.slice(0, maxLen + (str.length - plain.length)) + chalk.dim('...');
}

/**
 * Section header
 */
export function header(text: string, options: HeaderOptions = {}): string {
  const { style = chalk.bold.cyan, width = 60 } = options;
  const padding = Math.max(0, width - text.length - 4);
  return style(`── ${text} ${'─'.repeat(padding)}`);
}

/**
 * Strip ANSI codes for length calculation
 */
function stripAnsi(str: string): number {
  return str.replace(/\x1b\[[0-9;]*m/g, '').length;
}

/**
 * Strip ANSI codes and return string
 */
function stripAnsiStr(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Pad string with alignment
 */
function pad(str: string, width: number, align: 'left' | 'right' | 'center', strLen: number | null = null): string {
  const len = strLen !== null ? strLen : stripAnsi(str);
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
