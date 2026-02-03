/**
 * Shared utility functions
 */

/**
 * Count words in text (excluding markdown syntax)
 * @param text - Markdown text
 * @returns Word count
 */
export function countWords(text: string): number {
  return text
    .replace(/^---[\s\S]*?---/m, '') // Remove YAML frontmatter
    .replace(/!\[.*?\]\(.*?\)/g, '') // Remove images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Keep link text
    .replace(/#+\s*/g, '') // Remove headers
    .replace(/\*\*|__|[*_`]/g, '') // Remove formatting
    .replace(/```[\s\S]*?```/g, '') // Remove code blocks
    .replace(/\{[^}]+\}/g, '') // Remove CriticMarkup and attributes
    .replace(/@\w+:\w+/g, '') // Remove cross-references
    .replace(/@\w+/g, '') // Remove citations
    .replace(/\|[^|]+\|/g, ' ') // Remove table cells
    .replace(/[-=]{3,}/g, '') // Remove horizontal rules
    .replace(/\n+/g, ' ') // Newlines to spaces
    .replace(/\s+/g, ' ') // Collapse multiple spaces
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0).length;
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
