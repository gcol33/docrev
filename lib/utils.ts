/**
 * Shared utility functions
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Find the docrev package root by walking up from a directory inside the
 * package until a `package.json` appears. Works both from source
 * (`lib/commands` → repo root) and from the compiled package
 * (`dist/lib/commands` → the installed package root) — a fixed number of
 * `..` segments cannot serve both layouts.
 */
export function packageRoot(fromDir: string): string {
  let dir = fromDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return fromDir;
    dir = parent;
  }
}

/**
 * Count the words of a manuscript's prose.
 *
 * What is not prose is removed first: frontmatter, fenced code, table rows,
 * images with their captions, attribute and CriticMarkup braces, citations
 * and cross-references, emphasis markers and horizontal rules. Link text is
 * kept, since a reader reads it as part of the sentence. Heading text is
 * kept and only the marker removed.
 *
 * A pattern that removes a delimited construct is bounded by that
 * construct's own closing delimiter, and one that has no closing delimiter
 * on the same line is bounded to a single line. A negated class that can
 * match a newline runs from one construct to the NEXT one when the first is
 * unterminated, and takes the prose between them with it, which is how a
 * table-cell pattern came to delete whole paragraphs standing between two
 * tables.
 *
 * @param text - Markdown text
 * @returns Word count
 */
export function countWords(text: string): number {
  const withoutFrontmatter = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
  const withoutCode = withoutFrontmatter.replace(/^[ \t]*```[\s\S]*?^[ \t]*```/gm, '');
  const withoutTables = withoutCode
    .split('\n')
    .filter(line => !/^\s*\|/.test(line))
    .join('\n');

  return withoutTables
    .replace(/!\[[^\]]*\]\([^)\n]*\)/g, '') // Remove images, caption and all
    .replace(/\[[^\]\n]*@[^\]\n]*\]/g, '') // Remove bracketed citations, brackets included
    .replace(/\[([^\]]+)\]\([^)\n]+\)/g, '$1') // Keep link text
    .replace(/^[ \t]*#+[ \t]*/gm, '') // Remove heading markers
    .replace(/\{[^}\n]*\}/g, '') // Remove CriticMarkup and attributes
    .replace(/@[\w-]+(?::[\w-]+)?/g, '') // Remove bare citations and cross-references
    .replace(/\*\*|__|[*_`]/g, '') // Remove formatting
    .replace(/^[ \t]*[-=*_]{3,}[ \t]*$/gm, '') // Remove horizontal rules
    .split(/\s+/)
    .filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

/**
 * Levenshtein edit distance between two strings.
 * Shared by command typo suggestions, config-key typo detection, and
 * similar-filename suggestions.
 */
export function levenshtein(a: string, b: string): number {
  const matrix: number[][] = Array(b.length + 1)
    .fill(null)
    .map(() => Array(a.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[0]![i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j]![0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j]![i] = Math.min(
        matrix[j]![i - 1]! + 1,
        matrix[j - 1]![i]! + 1,
        matrix[j - 1]![i - 1]! + cost
      );
    }
  }
  return matrix[b.length]![a.length]!;
}

/**
 * Normalize whitespace in text
 * @param text - Input text
 * @returns Normalized text
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\t/g, '    ')
    .replace(/ +/g, ' ')
    .trim();
}

/**
 * Escape XML special characters
 * @param str - Input string
 * @returns XML-safe string
 */
export function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Escape LaTeX special characters
 * @param text - Text to escape
 * @returns Escaped text
 */
export function escapeLatex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([#$%&_{}])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\n/g, ' ');
}
