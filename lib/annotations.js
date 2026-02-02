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
 * @param {string} commentContent - The content inside {>>...<<}
 * @param {string} fullText - The full document text
 * @param {number} position - Position of the comment in the text
 * @returns {boolean} true if this is a false positive (not a real comment)
 */
function isCommentFalsePositive(commentContent, fullText, position) {
  // Check if inside a code block (fenced or indented)
  const textBefore = fullText.slice(Math.max(0, position - 2000), position);
  const textAfter = fullText.slice(position, Math.min(fullText.length, position + 2000));

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

  // Contains URL patterns (likely a link, not a comment)
  if (/https?:\/\/|www\./i.test(commentContent) && commentContent.length < 150) return true;

  // Looks like code (contains programming patterns)
  if (/function\s*\(|=>|import\s+|export\s+|const\s+|let\s+|var\s+/.test(commentContent)) return true;

  // Very long without clear author pattern (likely caption, not comment)
  // Real comments typically have "Author:" at start and are shorter
  const hasAuthorPrefix = /^[A-Za-z][A-Za-z\s]{0,20}:\s/.test(commentContent.trim());
  const hasResolvedMark = /^[✓✔]\s/.test(commentContent.trim());
  if (!hasAuthorPrefix && !hasResolvedMark && commentContent.length > 200) return true;

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

/**
 * Parse all annotations from text
 * @param {string} text
 * @returns {Array<{type: string, match: string, content: string, replacement?: string, author?: string, position: number, line: number}>}
 */
export function parseAnnotations(text) {
  const annotations = [];

  // Build line number lookup
  const lines = text.split('\n');
  let pos = 0;
  const lineStarts = lines.map((line) => {
    const start = pos;
    pos += line.length + 1;
    return start;
  });

  function getLine(position) {
    for (let i = 0; i < lineStarts.length; i++) {
      if (lineStarts[i] > position) return i;
    }
    return lineStarts.length;
  }

  function getContext(position, length) {
    const start = Math.max(0, position - 50);
    const end = Math.min(text.length, position + length + 50);
    const before = text.slice(start, position).split('\n').pop() || '';
    const after = text.slice(position + length, end).split('\n')[0] || '';
    return { before, after };
  }

  // Parse insertions
  for (const match of text.matchAll(PATTERNS.insert)) {
    const ctx = getContext(match.index, match[0].length);
    annotations.push({
      type: 'insert',
      match: match[0],
      content: match[1],
      position: match.index,
      line: getLine(match.index),
      ...ctx,
    });
  }

  // Parse deletions
  for (const match of text.matchAll(PATTERNS.delete)) {
    const ctx = getContext(match.index, match[0].length);
    annotations.push({
      type: 'delete',
      match: match[0],
      content: match[1],
      position: match.index,
      line: getLine(match.index),
      ...ctx,
    });
  }

  // Parse substitutions
  for (const match of text.matchAll(PATTERNS.substitute)) {
    const ctx = getContext(match.index, match[0].length);
    annotations.push({
      type: 'substitute',
      match: match[0],
      content: match[1],
      replacement: match[2],
      position: match.index,
      line: getLine(match.index),
      ...ctx,
    });
  }

  // Parse comments (with false positive filtering)
  for (const match of text.matchAll(PATTERNS.comment)) {
    // Skip false positives (figure captions, nested annotations, etc.)
    if (isCommentFalsePositive(match[1], text, match.index)) {
      continue;
    }

    const ctx = getContext(match.index, match[0].length);
    let commentText = match[1];
    let author = '';

    // Extract author if present (format: "Author: comment")
    const colonIdx = commentText.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) {
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
 * @param {string} text
 * @param {{keepComments?: boolean}} options
 * @returns {string}
 */
export function stripAnnotations(text, options = {}) {
  const { keepComments = false } = options;

  // Iterate until no more changes (handles nested annotations)
  let prev;
  let iterations = 0;
  const maxIterations = 20; // Safety limit

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
  } while (text !== prev && iterations < maxIterations);

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

  return text;
}

/**
 * Collapse multiple spaces to single space, preserving table formatting
 * Useful for cleaning up messy Word imports
 * @param {string} text
 * @returns {string}
 */
export function stripToSingleSpace(text) {
  const lines = text.split('\n');
  let inTable = false;

  // Helper to check if a line looks like table content
  const looksLikeTableRow = (ln) => {
    const trimmed = ln.trim();
    if (!trimmed) return false;
    // Has multiple consecutive spaces (column spacing)
    // OR italicized category header with trailing spaces
    return /\S\s{2,}\S/.test(trimmed) || (/^\*[^*]+\*\s*$/.test(trimmed) && /\s{2,}$/.test(ln));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

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
        if (lines[j].trim() !== '') {
          nextContentLine = lines[j];
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
 * @param {string} text
 * @returns {boolean}
 */
export function hasAnnotations(text) {
  return PATTERNS.insert.test(text) ||
         PATTERNS.delete.test(text) ||
         PATTERNS.substitute.test(text) ||
         PATTERNS.comment.test(text) ||
         PATTERNS.highlight.test(text);
}

/**
 * Apply a decision to a single annotation
 * @param {string} text
 * @param {{type: string, match: string, content: string, replacement?: string}} annotation
 * @param {boolean} accept
 * @returns {string}
 */
export function applyDecision(text, annotation, accept) {
  let replacement;

  // Extract any comments embedded in the annotation content
  // These should be preserved when accepting deletions or rejecting insertions
  const commentPattern = /\{>>[^<]*<<\}/g;
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
        replacement = annotation.replacement;
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
 * @param {string} text
 * @returns {Array}
 */
export function getTrackChanges(text) {
  return parseAnnotations(text).filter((a) => a.type !== 'comment');
}

/**
 * Get comments only
 * @param {string} text
 * @param {object} options
 * @returns {Array}
 */
export function getComments(text, options = {}) {
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
 * @param {string} text - Document text
 * @param {object} comment - Comment object with position and match
 * @param {boolean} resolved - Whether to mark as resolved
 * @returns {string} Updated text
 */
export function setCommentStatus(text, comment, resolved) {
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
 * @param {string} text
 * @returns {{inserts: number, deletes: number, substitutes: number, comments: number, total: number}}
 */
export function countAnnotations(text) {
  const annotations = parseAnnotations(text);
  const counts = { inserts: 0, deletes: 0, substitutes: 0, comments: 0, total: 0 };

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
