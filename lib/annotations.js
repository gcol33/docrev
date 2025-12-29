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
 * (e.g., figure caption, nested inside other annotation, etc.)
 * @param {string} commentContent - The content inside {>>...<<}
 * @param {string} fullText - The full document text
 * @param {number} position - Position of the comment in the text
 * @returns {boolean} true if this is a false positive (not a real comment)
 */
function isCommentFalsePositive(commentContent, fullText, position) {
  // Check if nested inside a deletion or insertion block
  // Look backwards for unclosed {-- or {++ before this position
  const textBefore = fullText.slice(Math.max(0, position - 500), position);

  // Count unclosed deletion markers
  const delOpens = (textBefore.match(/\{--/g) || []).length;
  const delCloses = (textBefore.match(/--\}/g) || []).length;
  if (delOpens > delCloses) return true; // Nested inside deletion

  // Count unclosed insertion markers
  const insOpens = (textBefore.match(/\{\+\+/g) || []).length;
  const insCloses = (textBefore.match(/\+\+\}/g) || []).length;
  if (insOpens > insCloses) return true; // Nested inside insertion

  // Heuristics for figure captions and other false positives:

  // Contains image/figure path patterns
  if (/\(figures?\/|\(images?\/|\.png|\.jpg|\.pdf/i.test(commentContent)) return true;

  // Contains markdown figure reference syntax
  if (/\{#fig:|!\[/.test(commentContent)) return true;

  // Very long without clear author pattern (likely caption, not comment)
  // Real comments typically have "Author:" at start and are shorter
  const hasAuthorPrefix = /^[A-Za-z][A-Za-z\s]{0,20}:/.test(commentContent.trim());
  if (!hasAuthorPrefix && commentContent.length > 200) return true;

  // Looks like a figure caption (starts with "Fig" or contains typical caption words)
  if (/^(Fig\.?|Figure|Table|Sankey|Diagram|Proportion|Distribution)/i.test(commentContent.trim())) {
    return true;
  }

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
 * @param {string} text
 * @param {{keepComments?: boolean}} options
 * @returns {string}
 */
export function stripAnnotations(text, options = {}) {
  const { keepComments = false } = options;

  // Apply substitutions: {~~old~>new~~} → new
  text = text.replace(PATTERNS.substitute, '$2');

  // Apply insertions: {++text++} → text
  text = text.replace(PATTERNS.insert, '$1');

  // Apply deletions: {--text--} → nothing
  text = text.replace(PATTERNS.delete, '');

  // Remove highlights: {==text==} → text
  text = text.replace(PATTERNS.highlight, '$1');

  // Remove comments unless keeping
  if (!keepComments) {
    text = text.replace(PATTERNS.comment, '');
  }

  return text;
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

  switch (annotation.type) {
    case 'insert':
      replacement = accept ? annotation.content : '';
      break;
    case 'delete':
      replacement = accept ? '' : annotation.content;
      break;
    case 'substitute':
      replacement = accept ? annotation.replacement : annotation.content;
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
