/**
 * CriticMarkup annotation parsing and manipulation
 *
 * Syntax:
 *   {++inserted text++}     - Insertions
 *   {--deleted text--}      - Deletions
 *   {~~old~>new~~}          - Substitutions
 *   {>>Author: comment<<}   - Comments
 *   {==text==}              - Highlights
 */

import type { Annotation, AnnotationCounts, StripOptions, CommentFilterOptions } from './types.js';

// =============================================================================
// Constants
// =============================================================================

/** Window size for context lookup (characters before/after position) */
const CONTEXT_WINDOW_SIZE = 2000;

/** Characters of context to include in annotation results */
const CONTEXT_SNIPPET_SIZE = 50;

/** Maximum iterations for nested annotation stripping (safety limit) */
const MAX_STRIP_ITERATIONS = 20;

/** Maximum author name length in comments */
const MAX_AUTHOR_LENGTH = 30;

/** Maximum content length before heuristic assumes it's not a comment */
const MAX_COMMENT_CONTENT_LENGTH = 200;

// =============================================================================
// Patterns
// =============================================================================

// Patterns for each annotation type
const PATTERNS = {
  insert: /\{\+\+(.+?)\+\+\}/gs,
  delete: /\{--(.+?)--\}/gs,
  substitute: /\{~~(.+?)~>(.+?)~~\}/gs,
  comment: /\{>>(.+?)<<\}/gs,
  highlight: /\{==(.+?)==\}/gs,
};

/**
 * Check if a potential comment is actually a false positive
 * (e.g., figure caption, nested inside other annotation, code block, etc.)
 * @param commentContent - The content inside {>>...<<}
 * @param fullText - The full document text
 * @param position - Position of the comment in the text
 * @returns true if this is a false positive (not a real comment)
 */
function isCommentFalsePositive(commentContent: string, fullText: string, position: number): boolean {
  // Check if inside a code block (fenced or indented)
  const textBefore = fullText.slice(Math.max(0, position - CONTEXT_WINDOW_SIZE), position);
  const textAfter = fullText.slice(position, Math.min(fullText.length, position + CONTEXT_WINDOW_SIZE));

  // Count unclosed fenced code blocks (``` or ~~~)
  const fenceOpens = (textBefore.match(/^```|^~~~/gm) || []).length;
  const fenceCloses = (textBefore.match(/```$|~~~$/gm) || []).length;
  if (fenceOpens > fenceCloses) return true; // Inside code block

  // Check if on an indented line (4+ spaces or tab at line start = code)
  const lineStart = textBefore.lastIndexOf('\n') + 1;
  const linePrefix = fullText.slice(lineStart, position);
  if (/^(\t|    )/.test(linePrefix)) return true; // Indented code

  // Check if inside inline code backticks
  const backticksBefore = (linePrefix.match(/`/g) || []).length;
  if (backticksBefore % 2 === 1) return true; // Inside inline code

  // Check if nested inside a deletion or insertion block
  const nearTextBefore = fullText.slice(Math.max(0, position - 500), position);

  // Count unclosed deletion markers
  const delOpens = (nearTextBefore.match(/\{--/g) || []).length;
  const delCloses = (nearTextBefore.match(/--\}/g) || []).length;
  if (delOpens > delCloses) return true; // Nested inside deletion

  // Count unclosed insertion markers
  const insOpens = (nearTextBefore.match(/\{\+\+/g) || []).length;
  const insCloses = (nearTextBefore.match(/\+\+\}/g) || []).length;
  if (insOpens > insCloses) return true; // Nested inside insertion

  // Heuristics for figure captions and other false positives:

  // Contains image/figure path patterns
  if (/\(figures?\/|\(images?\/|\.png|\.jpg|\.jpeg|\.gif|\.svg|\.pdf/i.test(commentContent)) return true;

  // Contains markdown figure reference syntax
  if (/\{#fig:|!\[/.test(commentContent)) return true;

  // Real comments typically have "Author:" at start. Accept hyphens, apostrophes,
  // periods, and Unicode letters so names like "Jens-Christian Svenning" or
  // "Camilla T Colding-Jørgensen" don't get rejected. See gcol33/docrev#1.
  const hasAuthorPrefix = /^[\p{L}][\p{L}\s\-'.]{0,30}:\s/u.test(commentContent.trim());
  const hasResolvedMark = /^[✓✔]\s/.test(commentContent.trim());

  // Contains URL patterns (likely a link, not a comment) — only filter when
  // there is no real author prefix, since reviewers legitimately cite URLs/DOIs.
  if (!hasAuthorPrefix && /https?:\/\/|www\./i.test(commentContent) && commentContent.length < 150) return true;

  // Looks like code (contains programming patterns)
  if (/function\s*\(|=>|import\s+|export\s+|const\s+|let\s+|var\s+/.test(commentContent)) return true;

  // Very long without clear author pattern (likely caption, not comment)
  if (!hasAuthorPrefix && !hasResolvedMark && commentContent.length > MAX_COMMENT_CONTENT_LENGTH) return true;

  // Looks like a figure caption (starts with "Fig" or contains typical caption words)
  if (/^(Fig\.?|Figure|Table|Sankey|Diagram|Proportion|Distribution|Map|Chart|Graph|Plot|Panel)/i.test(commentContent.trim())) {
    return true;
  }

  // Contains LaTeX-like patterns (likely equation, not comment)
  if (/\\[a-z]+\{|\\frac|\\sum|\\int|\\begin\{/.test(commentContent)) return true;

  // Looks like BibTeX entry (not a comment)
  if (/@article\{|@book\{|@inproceedings\{/i.test(commentContent)) return true;

  return false;
}

// Combined pattern for any track change (not comments)
const TRACK_CHANGE_PATTERN = /(\{\+\+.+?\+\+\}|\{--.+?--\}|\{~~.+?~>.+?~~\})/gs;

// =============================================================================
// Public API
// =============================================================================

/**
 * Parse all annotations from text
 * @param text - Markdown text containing CriticMarkup annotations
 * @returns Array of parsed annotations sorted by position
 * @throws TypeError If text is not a string
 */
export function parseAnnotations(text: string): Annotation[] {
  if (typeof text !== 'string') {
    throw new TypeError(`text must be a string, got ${typeof text}`);
  }

  const annotations: Annotation[] = [];

  // Build line number lookup
  const lines = text.split('\n');
  let pos = 0;
  const lineStarts = lines.map((line) => {
    const start = pos;
    pos += line.length + 1;
    return start;
  });

  function getLine(position: number): number {
    for (let i = 0; i < lineStarts.length; i++) {
      const start = lineStarts[i];
      if (start !== undefined && start > position) return i;
    }
    return lineStarts.length;
  }

  function getContext(position: number, length: number): { before: string; after: string } {
    const start = Math.max(0, position - CONTEXT_SNIPPET_SIZE);
    const end = Math.min(text.length, position + length + CONTEXT_SNIPPET_SIZE);
    const before = text.slice(start, position).split('\n').pop() || '';
    const after = text.slice(position + length, end).split('\n')[0] || '';
    return { before, after };
  }

  // Parse insertions
  for (const match of text.matchAll(PATTERNS.insert)) {
    if (match.index === undefined) continue;
    const ctx = getContext(match.index, match[0].length);
    annotations.push({
      type: 'insert',
      match: match[0],
      content: match[1] || '',
      position: match.index,
      line: getLine(match.index),
      ...ctx,
    });
  }

  // Parse deletions
  for (const match of text.matchAll(PATTERNS.delete)) {
    if (match.index === undefined) continue;
    const ctx = getContext(match.index, match[0].length);
    annotations.push({
      type: 'delete',
      match: match[0],
      content: match[1] || '',
      position: match.index,
      line: getLine(match.index),
      ...ctx,
    });
  }

  // Parse substitutions
  for (const match of text.matchAll(PATTERNS.substitute)) {
    if (match.index === undefined) continue;
    const ctx = getContext(match.index, match[0].length);
    annotations.push({
      type: 'substitute',
      match: match[0],
      content: match[1] || '',
      replacement: match[2] || '',
      position: match.index,
      line: getLine(match.index),
      ...ctx,
    });
  }

  // Parse comments (with false positive filtering)
  for (const match of text.matchAll(PATTERNS.comment)) {
    if (match.index === undefined) continue;
    // Skip false positives (figure captions, nested annotations, etc.)
    const commentContent = match[1] || '';
    if (isCommentFalsePositive(commentContent, text, match.index)) {
      continue;
    }

    const ctx = getContext(match.index, match[0].length);
    let commentText = commentContent;
    let author = '';

    // Extract author if present (format: "Author: comment")
    const colonIdx = commentText.indexOf(':');
    if (colonIdx > 0 && colonIdx < MAX_AUTHOR_LENGTH) {
      author = commentText.slice(0, colonIdx).trim();
      commentText = commentText.slice(colonIdx + 1).trim();
    }

    annotations.push({
      type: 'comment',
      match: match[0],
      content: commentText,
      author,
      position: match.index,
      line: getLine(match.index),
      ...ctx,
    });
  }

  // Sort by position
  annotations.sort((a, b) => a.position - b.position);
  return annotations;
}

/**
 * Strip annotations from text, applying changes
 * Handles nested annotations by iterating until stable
 * @param text - Markdown text with CriticMarkup annotations
 * @param options - Strip options
 * @returns Clean text with annotations applied/removed
 * @throws TypeError If text is not a string
 */
export function stripAnnotations(text: string, options: StripOptions = {}): string {
  if (typeof text !== 'string') {
    throw new TypeError(`text must be a string, got ${typeof text}`);
  }

  const { keepComments = false } = options;

  // Iterate until no more changes (handles nested annotations)
  let prev: string;
  let iterations = 0;

  do {
    prev = text;

    // Apply substitutions: {~~old~>new~~} → new
    text = text.replace(PATTERNS.substitute, '$2');

    // Apply insertions: {++text++} → text
    text = text.replace(PATTERNS.insert, '$1');

    // Apply deletions: {--text--} → nothing
    // Don't touch surrounding whitespace - just remove the annotation
    text = text.replace(PATTERNS.delete, '');

    // Remove highlights: {==text==} → text
    text = text.replace(PATTERNS.highlight, '$1');

    // Remove comments unless keeping
    if (!keepComments) {
      text = text.replace(PATTERNS.comment, '');
    }

    // Strip pandoc highlight spans: [text]{.mark} → text
    text = text.replace(/\[([^\]]*)\]\{\.mark\}/g, '$1');

    // Clean up partial/orphaned markers within the loop
    // This handles cases where nested annotations leave behind fragments

    // Empty annotations (from nested stripping)
    text = text.replace(/\{----\}/g, '');
    text = text.replace(/\{\+\+\+\+\}/g, '');
    text = text.replace(/\{--\s*--\}/g, '');
    text = text.replace(/\{\+\+\s*\+\+\}/g, '');

    // Orphaned substitution fragments: ~>text~~} or {~~text (no proper pairs)
    text = text.replace(/~>[^{]*?~~\}/g, '');
    text = text.replace(/\{~~[^~}]*$/gm, '');

    // Handle malformed substitution from nested: {~~{~~old → just strip the {~~
    text = text.replace(/\{~~\{~~/g, '{~~');
    text = text.replace(/~~\}~~\}/g, '~~}');

    iterations++;
  } while (text !== prev && iterations < MAX_STRIP_ITERATIONS);

  // Final cleanup of any remaining orphaned markers
  // Orphaned closing markers
  text = text.replace(/--\}(?:--\})+/g, '');
  text = text.replace(/\+\+\}(?:\+\+\})+/g, '');
  text = text.replace(/~~\}(?:~~\})+/g, '');
  text = text.replace(/--\}/g, '');
  text = text.replace(/\+\+\}/g, '');
  text = text.replace(/~~\}/g, '');

  // Orphaned opening markers
  text = text.replace(/\{--(?:\{--)+/g, '');
  text = text.replace(/\{\+\+(?:\{\+\+)+/g, '');
  text = text.replace(/\{~~(?:\{~~)+/g, '');
  text = text.replace(/\{--/g, '');
  text = text.replace(/\{\+\+/g, '');
  text = text.replace(/\{~~/g, '');
  text = text.replace(/~>/g, '');

  // Remove orphan [ from stripped {.mark} spans where the closing ]{.mark}
  // was inside a comment. A [ is orphan if no matching ] follows before
  // the next [ or end of line.
  text = text.replace(/\[(?![^\[\]]*\])/g, '');

  return text;
}

/**
 * Collapse multiple spaces to single space, preserving table formatting
 * Useful for cleaning up messy Word imports
 * @param text - Text to normalize
 * @returns Text with multiple spaces collapsed to single spaces
 * @throws TypeError If text is not a string
 */
export function stripToSingleSpace(text: string): string {
  if (typeof text !== 'string') {
    throw new TypeError(`text must be a string, got ${typeof text}`);
  }

  const lines = text.split('\n');
  let inTable = false;

  // Helper to check if a line looks like table content
  const looksLikeTableRow = (ln: string): boolean => {
    const trimmed = ln.trim();
    if (!trimmed) return false;
    // Has multiple consecutive spaces (column spacing)
    // OR italicized category header with trailing spaces
    return /\S\s{2,}\S/.test(trimmed) || (/^\*[^*]+\*\s*$/.test(trimmed) && /\s{2,}$/.test(ln));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    // Detect table separator line
    const isTableSeparator = /^\|?[\s-]*[-]{3,}[\s|:-]+[-]{3,}/.test(line) ||
                              /^[-]{3,}\s{2,}[-]{3,}/.test(line);

    if (isTableSeparator) {
      inTable = true;
      continue;
    }

    // Check if we're exiting the table
    if (inTable && line.trim() === '') {
      let nextContentLine = '';
      for (let j = i + 1; j < lines.length && j < i + 5; j++) {
        const nextLine = lines[j];
        if (nextLine && nextLine.trim() !== '') {
          nextContentLine = nextLine;
          break;
        }
      }
      if (!looksLikeTableRow(nextContentLine) && !/^[-]{3,}/.test(nextContentLine.trim())) {
        inTable = false;
      }
      continue;
    }

    // Only collapse spaces outside tables
    if (!inTable) {
      lines[i] = line.replace(/  +/g, ' ');
    }
  }

  return lines.join('\n');
}

/**
 * Check if text contains any CriticMarkup annotations
 * @param text - Text to check
 * @returns True if text contains any annotations
 * @throws TypeError If text is not a string
 */
export function hasAnnotations(text: string): boolean {
  if (typeof text !== 'string') {
    throw new TypeError(`text must be a string, got ${typeof text}`);
  }

  return PATTERNS.insert.test(text) ||
         PATTERNS.delete.test(text) ||
         PATTERNS.substitute.test(text) ||
         PATTERNS.comment.test(text) ||
         PATTERNS.highlight.test(text);
}

/**
 * Apply a decision to a single annotation (accept or reject)
 * @param text - Document text containing the annotation
 * @param annotation - Annotation object from parseAnnotations()
 * @param accept - True to accept the change, false to reject
 * @returns Updated text with the decision applied
 * @throws TypeError If text is not a string or annotation is invalid
 */
export function applyDecision(text: string, annotation: Annotation, accept: boolean): string {
  if (typeof text !== 'string') {
    throw new TypeError(`text must be a string, got ${typeof text}`);
  }
  if (!annotation || typeof annotation.type !== 'string' || typeof annotation.match !== 'string') {
    throw new TypeError('annotation must have type and match properties');
  }
  let replacement: string;

  // Extract any comments embedded in the annotation content
  // These should be preserved when accepting deletions or rejecting insertions
  const commentPattern = /\{>>[\s\S]*?<<\}/g;
  const embeddedComments = (annotation.match || '').match(commentPattern) || [];

  switch (annotation.type) {
    case 'insert':
      if (accept) {
        replacement = annotation.content;
      } else {
        // Rejecting insertion - preserve any comments that were inside
        replacement = embeddedComments.length > 0 ? embeddedComments.join('') : '';
      }
      break;
    case 'delete':
      if (accept) {
        // Accepting deletion - preserve any comments by placing them before
        replacement = embeddedComments.length > 0 ? embeddedComments.join('') : '';
      } else {
        replacement = annotation.content;
      }
      break;
    case 'substitute':
      if (accept) {
        // For substitutions, check if comments are in the old text being replaced
        const oldTextComments = (annotation.content || '').match(commentPattern) || [];
        replacement = annotation.replacement || '';
        if (oldTextComments.length > 0) {
          // Prepend comments that were in the old text
          replacement = oldTextComments.join('') + replacement;
        }
      } else {
        replacement = annotation.content;
      }
      break;
    default:
      return text;
  }

  return text.replace(annotation.match, replacement);
}

/**
 * Get track changes only (no comments)
 * @param text - Markdown text with CriticMarkup annotations
 * @returns Array of insert/delete/substitute annotations
 * @throws TypeError If text is not a string
 */
export function getTrackChanges(text: string): Annotation[] {
  // Input validation delegated to parseAnnotations
  return parseAnnotations(text).filter((a) => a.type !== 'comment');
}

/**
 * Get comments only
 * @param text - Markdown text with CriticMarkup annotations
 * @param options - Filter options
 * @returns Array of comment annotations
 * @throws TypeError If text is not a string
 */
export function getComments(text: string, options: CommentFilterOptions = {}): Annotation[] {
  // Input validation delegated to parseAnnotations
  const { pendingOnly = false, resolvedOnly = false } = options;
  let comments = parseAnnotations(text).filter((a) => a.type === 'comment');

  // Check for resolved status marker at end of comment
  comments = comments.map((c) => {
    const resolved = c.content.endsWith('[RESOLVED]') || c.content.endsWith('[✓]');
    return {
      ...c,
      resolved,
      content: resolved
        ? c.content.replace(/\s*\[(RESOLVED|✓)\]$/, '').trim()
        : c.content,
    };
  });

  if (pendingOnly) {
    comments = comments.filter((c) => !c.resolved);
  }
  if (resolvedOnly) {
    comments = comments.filter((c) => c.resolved);
  }

  return comments;
}

/**
 * Mark a comment as resolved or pending
 * @param text - Document text containing the comment
 * @param comment - Comment annotation object from getComments()
 * @param resolved - True to mark resolved, false to mark pending
 * @returns Updated text with status marker applied
 * @throws TypeError If text is not a string or comment is invalid
 */
export function setCommentStatus(text: string, comment: Annotation, resolved: boolean): string {
  if (typeof text !== 'string') {
    throw new TypeError(`text must be a string, got ${typeof text}`);
  }
  if (!comment || typeof comment.match !== 'string') {
    throw new TypeError('comment must have a match property');
  }
  // Find the comment in the text
  const originalMatch = comment.match;

  if (resolved) {
    // Add [RESOLVED] marker before the closing <<
    const newMatch = originalMatch.replace(/<<\}$/, ' [RESOLVED]<<}');
    return text.replace(originalMatch, newMatch);
  } else {
    // Remove resolved markers
    const newMatch = originalMatch.replace(/\s*\[(RESOLVED|✓)\]<<\}$/, '<<}');
    return text.replace(originalMatch, newMatch);
  }
}

/**
 * Count annotations by type
 * @param text - Markdown text with CriticMarkup annotations
 * @returns Counts by annotation type
 * @throws TypeError If text is not a string
 */
export function countAnnotations(text: string): AnnotationCounts {
  // Input validation delegated to parseAnnotations
  const annotations = parseAnnotations(text);
  const counts: AnnotationCounts = { inserts: 0, deletes: 0, substitutes: 0, comments: 0, total: 0 };

  for (const a of annotations) {
    counts.total++;
    switch (a.type) {
      case 'insert':
        counts.inserts++;
        break;
      case 'delete':
        counts.deletes++;
        break;
      case 'substitute':
        counts.substitutes++;
        break;
      case 'comment':
        counts.comments++;
        break;
    }
  }

  return counts;
}

/**
 * Clean up orphaned/malformed CriticMarkup markers
 * This can happen when track changes span across comment boundaries
 * @param text - Document text with potentially malformed markers
 * @returns Cleaned text with orphaned markers removed
 * @throws TypeError If text is not a string
 */
export function cleanupOrphanedMarkers(text: string): string {
  if (typeof text !== 'string') {
    throw new TypeError(`text must be a string, got ${typeof text}`);
  }
  let result = text;

  // Remove orphaned insertion end markers (++} not preceded by {++)
  // These occur when an insertion's start was inside something that got deleted/replaced
  result = result.replace(/(?<!\{\+\+[^}]*)\+\+\}/g, '');

  // Remove orphaned deletion end markers (--} not preceded by {--)
  result = result.replace(/(?<!\{--[^}]*)--\}/g, '');

  // Remove orphaned substitution end markers (~~} not preceded by {~~)
  result = result.replace(/(?<!\{~~[^}]*)~~\}/g, '');

  // Fix unclosed insertions: {++ without matching ++}
  // Find {++ and check if there's a matching ++} before the next { marker
  result = result.replace(/\{\+\+([^+]*?)(?=\{[+\-~>]|\{>>|$)/g, (match, content) => {
    // If content has no ++}, it's unclosed - just keep the content
    if (!content.includes('++}')) {
      return content;
    }
    return match;
  });

  // Fix unclosed deletions: {-- without matching --}
  result = result.replace(/\{--([^-]*?)(?=\{[+\-~>]|\{>>|$)/g, (match, content) => {
    if (!content.includes('--}')) {
      return content;
    }
    return match;
  });

  // Fix unclosed substitutions: {~~ without matching ~~}
  // This is trickier because we need both ~> and ~~}
  result = result.replace(/\{~~([^~]*?)~>([^~]*?)(?=\{[+\-~>]|\{>>|$)/g, (match, old, newText) => {
    if (!match.includes('~~}')) {
      // Unclosed substitution - keep the new text
      return newText;
    }
    return match;
  });

  return result;
}
