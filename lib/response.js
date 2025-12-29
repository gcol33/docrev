/**
 * Response letter generator
 * Extract comments and replies from markdown files for journal resubmission
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Parse a comment with potential replies
 * Format: {>>Author: comment<<} {>>Reply Author: reply<<}
 * @param {string} text
 * @returns {Array<{author: string, text: string, replies: Array, context: string, file: string, line: number}>}
 */
export function parseCommentsWithReplies(text, file = '') {
  const comments = [];
  const lines = text.split('\n');

  // Pattern for comments: {>>Author: text<<}
  const commentPattern = /\{>>([^:]+):\s*([^<]+)<<\}/g;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const matches = [...line.matchAll(commentPattern)];

    if (matches.length === 0) continue;

    // Get context (surrounding text without comments)
    const contextLine = line.replace(/\{>>[^<]+<<\}/g, '').trim();
    const context = contextLine.slice(0, 100) + (contextLine.length > 100 ? '...' : '');

    // First match is the original comment, rest are replies
    const [first, ...rest] = matches;

    comments.push({
      author: first[1].trim(),
      text: first[2].trim(),
      replies: rest.map(m => ({
        author: m[1].trim(),
        text: m[2].trim(),
      })),
      context,
      file,
      line: lineNum + 1,
    });
  }

  return comments;
}

/**
 * Group comments by reviewer
 * @param {Array} comments
 * @returns {Map<string, Array>}
 */
export function groupByReviewer(comments) {
  const grouped = new Map();

  for (const comment of comments) {
    const reviewer = comment.author;
    if (!grouped.has(reviewer)) {
      grouped.set(reviewer, []);
    }
    grouped.get(reviewer).push(comment);
  }

  return grouped;
}

/**
 * Generate response letter in Markdown format
 * @param {Array} comments - All comments from all files
 * @param {object} options
 * @returns {string}
 */
export function generateResponseLetter(comments, options = {}) {
  const {
    title = 'Response to Reviewers',
    authorName = 'Author',
    includeContext = true,
    includeLocation = true,
  } = options;

  const lines = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`We thank the reviewers for their constructive feedback. Below we address each comment.`);
  lines.push('');

  // Group by reviewer
  const grouped = groupByReviewer(comments);

  // Sort reviewers (put known reviewer names first, then others)
  const reviewers = [...grouped.keys()].sort((a, b) => {
    // "Reviewer" names first, then alphabetical
    const aIsReviewer = a.toLowerCase().includes('reviewer');
    const bIsReviewer = b.toLowerCase().includes('reviewer');
    if (aIsReviewer && !bIsReviewer) return -1;
    if (!aIsReviewer && bIsReviewer) return 1;
    return a.localeCompare(b);
  });

  for (const reviewer of reviewers) {
    // Skip if this is the author's own comments (replies)
    if (reviewer.toLowerCase() === authorName.toLowerCase()) continue;
    if (reviewer.toLowerCase() === 'claude') continue;

    const reviewerComments = grouped.get(reviewer);
    lines.push(`## ${reviewer}`);
    lines.push('');

    for (let i = 0; i < reviewerComments.length; i++) {
      const c = reviewerComments[i];

      lines.push(`### Comment ${i + 1}`);
      if (includeLocation) {
        lines.push(`*${c.file}:${c.line}*`);
      }
      lines.push('');

      // Original comment
      lines.push(`> **${c.author}:** ${c.text}`);
      lines.push('');

      // Context if available
      if (includeContext && c.context) {
        lines.push(`*Context:* "${c.context}"`);
        lines.push('');
      }

      // Replies
      if (c.replies.length > 0) {
        lines.push('**Response:**');
        lines.push('');
        for (const reply of c.replies) {
          lines.push(`${reply.text}`);
        }
      } else {
        lines.push('**Response:**');
        lines.push('');
        lines.push('*[TODO: Add response]*');
      }
      lines.push('');
      lines.push('---');
      lines.push('');
    }
  }

  // Summary stats
  const totalComments = comments.filter(c =>
    !c.author.toLowerCase().includes('claude') &&
    c.author.toLowerCase() !== authorName.toLowerCase()
  ).length;
  const answered = comments.filter(c => c.replies.length > 0).length;

  lines.push('## Summary');
  lines.push('');
  lines.push(`- Total comments: ${totalComments}`);
  lines.push(`- Addressed: ${answered}`);
  lines.push(`- Pending: ${totalComments - answered}`);

  return lines.join('\n');
}

/**
 * Collect comments from multiple files
 * @param {string[]} files - Array of file paths
 * @returns {Array}
 */
export function collectComments(files) {
  const allComments = [];

  for (const file of files) {
    if (!fs.existsSync(file)) continue;

    const text = fs.readFileSync(file, 'utf-8');
    const comments = parseCommentsWithReplies(text, path.basename(file));
    allComments.push(...comments);
  }

  return allComments;
}
