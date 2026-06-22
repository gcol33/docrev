/**
 * Realign comments from a reference DOCX onto markdown.
 *
 * This is the same job as `rev sync`: read the comments and their anchors from
 * a docx, then place them into the current markdown. It therefore reuses the
 * one extraction + placement engine rather than carrying a second docx parser
 * and a proportional position-mapper.
 */

import * as fs from 'fs';
import { extractWordComments, extractCommentAnchors } from './word-extraction.js';
import { insertCommentsIntoMarkdown } from './import.js';

interface RealignOptions {
  dryRun?: boolean;
  /** When set, realign only comments by these authors; otherwise all. */
  author?: string;
  replyAuthor?: string;
}

interface RealignResult {
  success: boolean;
  dryRun?: boolean;
  insertions: number;
  error?: string;
}

interface RealignMarkdownOptions {
  author?: string;
  replyAuthor?: string;
}

interface RealignMarkdownResult {
  success: boolean;
  markdown: string;
  insertions: number;
  error?: string;
}

/** Existing CriticMarkup comments, removed before the reference set is placed. */
function stripExistingComments(markdown: string): string {
  return markdown.replace(/\s*\{>>[\s\S]+?<<\}/g, '');
}

/**
 * Realign the reference docx's comments onto an in-memory markdown string.
 * Existing comments are cleared first so re-running is idempotent.
 */
export async function realignMarkdown(
  docxPath: string,
  markdown: string,
  options: RealignMarkdownOptions = {},
): Promise<RealignMarkdownResult> {
  try {
    let comments = await extractWordComments(docxPath);
    const { anchors } = await extractCommentAnchors(docxPath);

    if (options.author) {
      const keep = new Set([options.author, options.replyAuthor].filter(Boolean) as string[]);
      comments = comments.filter((c) => keep.has(c.author));
    }

    const stripped = stripExistingComments(markdown);
    const stats = { placed: 0, lowConfidence: 0, deduped: 0, unmatched: 0 };
    const result = insertCommentsIntoMarkdown(stripped, comments, anchors, {
      quiet: true,
      wrapAnchor: false,
      outStats: stats,
    });

    return { success: true, markdown: result, insertions: stats.placed + stats.lowConfidence };
  } catch (err: any) {
    return { success: false, markdown, insertions: 0, error: err.message };
  }
}

/**
 * Realign the reference docx's comments onto a markdown file in place.
 */
export async function realignComments(
  docxPath: string,
  markdownPath: string,
  options: RealignOptions = {},
): Promise<RealignResult> {
  const { dryRun = false, author, replyAuthor } = options;

  const original = fs.readFileSync(markdownPath, 'utf-8');
  const realigned = await realignMarkdown(docxPath, original, { author, replyAuthor });
  if (!realigned.success) {
    return { success: false, insertions: 0, error: realigned.error };
  }

  if (dryRun) {
    return { success: true, dryRun: true, insertions: realigned.insertions };
  }

  fs.writeFileSync(markdownPath, realigned.markdown);
  return { success: true, insertions: realigned.insertions };
}
