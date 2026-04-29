/**
 * Import functionality - convert Word docs to annotated Markdown
 *
 * Orchestration workflows + re-exports from extraction/diff/restore modules
 */

import * as fs from 'fs';
import * as path from 'path';
import { stripAnnotations } from './annotations.js';
import { readImageRegistry } from './image-registry.js';
import { exec } from 'child_process';
import { promisify } from 'util';

// Import from split modules
import {
  extractFromWord,
  extractWordComments,
  extractCommentAnchors,
  extractWordTables,
} from './word-extraction.js';
import type {
  WordComment,
  CommentAnchorData,
  WordTable,
  ExtractFromWordResult,
} from './word-extraction.js';
import {
  generateSmartDiff,
  generateAnnotatedDiff,
  cleanupAnnotations,
  fixCitationAnnotations,
} from './diff-engine.js';
import {
  restoreCrossrefFromWord,
  restoreImagesFromRegistry,
  parseVisibleComments,
  convertVisibleComments,
} from './restore-references.js';
import { findAnchorInText, findAllOccurrences } from './anchor-match.js';

/**
 * Pick the best position from candidate `occurrences` given the
 * surrounding `before` / `after` context from the docx, while
 * respecting `usedPositions` to avoid stacking distinct comments at
 * the same anchor instance.
 *
 * Returns the chosen position, or -1 if every candidate is already used.
 */
function pickBestOccurrence(
  occurrences: number[],
  result: string,
  before: string,
  after: string,
  anchorLen: number,
  usedPositions: Set<number>,
): number {
  if (occurrences.length === 0) return -1;
  if (occurrences.length === 1) {
    return usedPositions.has(occurrences[0]) ? -1 : occurrences[0];
  }

  let bestIdx = occurrences.find(p => !usedPositions.has(p)) ?? -1;
  if (bestIdx < 0) return -1;
  let bestScore = -1;

  for (const pos of occurrences) {
    if (usedPositions.has(pos)) continue;
    let score = 0;

    if (before) {
      const contextBefore = result.slice(Math.max(0, pos - before.length - 20), pos).toLowerCase();
      const beforeLower = before.toLowerCase();
      const beforeWords = beforeLower.split(/\s+/).filter(w => w.length > 3);
      for (const word of beforeWords) {
        if (contextBefore.includes(word)) score += 2;
      }
      if (contextBefore.includes(beforeLower.slice(-30))) score += 5;
    }

    if (after) {
      const contextAfter = result.slice(pos + anchorLen, pos + anchorLen + after.length + 20).toLowerCase();
      const afterLower = after.toLowerCase();
      const afterWords = afterLower.split(/\s+/).filter(w => w.length > 3);
      for (const word of afterWords) {
        if (contextAfter.includes(word)) score += 2;
      }
      if (contextAfter.includes(afterLower.slice(0, 30))) score += 5;
    }

    if (score > bestScore || (score === bestScore && pos < bestIdx)) {
      bestScore = score;
      bestIdx = pos;
    }
  }

  return bestIdx;
}

// Re-export everything so existing imports from './import.js' still work
export {
  extractFromWord,
  extractWordComments,
  extractCommentAnchors,
  extractHeadings,
  extractWordTables,
} from './word-extraction.js';
export type {
  WordComment,
  TextNode,
  CommentAnchorData,
  CommentAnchorsResult,
  DocxHeading,
  WordTable,
  ParsedRow,
  ExtractFromWordOptions,
  ExtractMessage,
  ExtractFromWordResult,
} from './word-extraction.js';

export {
  generateSmartDiff,
  generateAnnotatedDiff,
  cleanupAnnotations,
  fixCitationAnnotations,
} from './diff-engine.js';
export type {
  GenerateSmartDiffOptions,
} from './diff-engine.js';

export {
  restoreCrossrefFromWord,
  restoreImagesFromRegistry,
  parseVisibleComments,
  convertVisibleComments,
} from './restore-references.js';
export type {
  RestoreCrossrefResult,
  RestoreImagesResult,
} from './restore-references.js';

const execAsync = promisify(exec);

// ============================================
// Type Definitions (orchestration-specific)
// ============================================

export interface InsertCommentsOptions {
  quiet?: boolean;
  sectionBoundary?: { start: number; end: number } | null;
  /**
   * When true (default), comments wrap their anchor text in `[anchor]{.mark}`
   * so the rebuilt docx restores the original Word comment range. When false,
   * comments are inserted as standalone `{>>...<<}` blocks adjacent to the
   * anchor — the prose stays byte-identical except for the inserted blocks.
   *
   * Set to false from `sync --comments-only` so a draft revised after the
   * docx was sent for review keeps its prose intact, and so multiple
   * comments sharing one anchor don't produce nested broken markup.
   */
  wrapAnchor?: boolean;
}

export interface CommentWithPos {
  id: string;
  author: string;
  text: string;
  date: string;
  pos: number;
  anchorText: string | null;
  anchorEnd?: number;
  isEmpty?: boolean;
  strategy?: string;
}

export type { AnchorSearchResult } from './anchor-match.js';

export interface MarkdownPrefixResult {
  prefix: string;
  content: string;
}

export interface ImportWordWithTrackChangesOptions {
  mediaDir?: string;
  projectDir?: string;
}

export interface ImportWordWithTrackChangesResult {
  text: string;
  stats: {
    insertions: number;
    deletions: number;
    substitutions: number;
    comments: number;
    total: number;
    hasTrackChanges: boolean;
    trackChangeStats: { insertions: number; deletions: number };
  };
  extractedMedia: string[];
  comments: WordComment[];
}

export interface ImportFromWordOptions {
  author?: string;
  sectionContent?: string;
  figuresDir?: string;
  wordTables?: WordTable[];
}

export interface ImportFromWordResult {
  annotated: string;
  stats: {
    insertions: number;
    deletions: number;
    substitutions: number;
    comments: number;
    total: number;
  };
  extractedMedia: string[];
}

export interface MovedFile {
  from: string;
  to: string;
  name: string;
}

export interface MoveExtractedMediaResult {
  moved: MovedFile[];
  errors: string[];
}

// ============================================
// Functions
// ============================================

/**
 * If `pos` lands inside a section file's leading `# Heading` line (or the
 * blank line right after it), advance past the first paragraph break so
 * the comment stays inside the section. A comment authored at the very
 * start of a Word section maps to `pos === 0`, but inserting at column 0
 * of a markdown file that begins with `# Heading` puts the `{>>...<<}`
 * before the heading marker — Pandoc then treats the line as ordinary
 * paragraph text and the comment renders in the previous section.
 */
function pushPastSectionHeading(text: string, pos: number): number {
  if (pos > 0) {
    const headingMatch = text.match(/^#{1,6}\s.+$/m);
    if (!headingMatch || headingMatch.index === undefined) return pos;
    const headingEnd = headingMatch.index + headingMatch[0].length;
    if (pos >= headingEnd) return pos;
  }
  // pos is at-or-before the first heading line. Advance to the first
  // non-blank position after the heading paragraph.
  const headingLine = text.match(/^#{1,6}\s.+(?:\n|$)/m);
  if (!headingLine || headingLine.index === undefined) return pos;
  let after = headingLine.index + headingLine[0].length;
  // Skip blank lines so we land at the start of the first body paragraph.
  while (after < text.length && (text[after] === '\n' || text[after] === '\r')) {
    after++;
  }
  return after;
}

/**
 * Insert comments into markdown text based on anchor texts with context
 */
export function insertCommentsIntoMarkdown(
  markdown: string,
  comments: WordComment[],
  anchors: Map<string, CommentAnchorData | string>,
  options: InsertCommentsOptions = {}
): string {
  const { quiet = false, sectionBoundary = null, wrapAnchor = true } = options;
  let result = markdown;
  let unmatchedCount = 0;
  const duplicateWarnings: string[] = [];
  const usedPositions = new Set<number>(); // For tie-breaking: track used positions

  // Anchor matching primitives live in lib/anchor-match.ts so that
  // `rev verify-anchors` can use the same strategies for drift reporting.

  // Get all positions in order (for sequential tie-breaking)
  const commentsWithPositions = comments.map((c): CommentWithPos => {
    const anchorData = anchors.get(c.id);
    if (!anchorData) {
      unmatchedCount++;
      return { ...c, pos: -1, anchorText: null };
    }

    // Support both old format (string) and new format ({anchor, before, after})
    const anchor = typeof anchorData === 'string' ? anchorData : anchorData.anchor;
    const before = typeof anchorData === 'object' ? anchorData.before : '';
    const after = typeof anchorData === 'object' ? anchorData.after : '';
    const isEmpty = typeof anchorData === 'object' && anchorData.isEmpty;
    const docPosition = typeof anchorData === 'object' ? anchorData.docPosition : undefined;

    // Position-based insertion (most reliable)
    if (sectionBoundary && docPosition !== undefined) {
      const sectionLength = sectionBoundary.end - sectionBoundary.start;
      if (sectionLength > 0) {
        let relativePos;
        if (docPosition < sectionBoundary.start) {
          relativePos = 0;
        } else {
          relativePos = docPosition - sectionBoundary.start;
        }

        const proportion = Math.min(relativePos / sectionLength, 1.0);
        const markdownPos = Math.floor(proportion * result.length);

        // For empty anchors, before/after context is the only signal that
        // pinpoints the original split — without it, proportional placement
        // can land mid-word or split unrelated phrases. Try context match
        // first; only fall through to proportional when context is gone.
        if ((!anchor || isEmpty) && (before || after)) {
          const ctx = findAnchorInText('', result, before, after);
          if (ctx.occurrences.length > 0) {
            const pos = pushPastSectionHeading(result, ctx.occurrences[0]);
            return { ...c, pos, anchorText: null, isEmpty: true, strategy: `ctx:${ctx.strategy}` };
          }
        }

        let insertPos = markdownPos;

        // Look for nearby word boundary
        const searchWindow = result.slice(Math.max(0, markdownPos - 25), Math.min(result.length, markdownPos + 25));
        const spaceIdx = searchWindow.indexOf(' ', 25);
        if (spaceIdx !== -1 && spaceIdx < 50) {
          insertPos = Math.max(0, markdownPos - 25) + spaceIdx;
        }

        // If we have anchor text, try to find it near this position.
        // Collect ALL occurrences in the local window, then disambiguate
        // via before/after context + usedPositions — otherwise two
        // comments sharing the same anchor word would both collide at
        // the leftmost match. The context-scoring helper handles the
        // "repeated formulaic prose" case using docx-side context, which
        // is a stronger signal than raw distance to the proportional
        // insertPos (insertPos is itself an approximation).
        if (anchor && !isEmpty) {
          const searchStart = Math.max(0, insertPos - 200);
          const searchEnd = Math.min(result.length, insertPos + 200);
          const localSearch = result.slice(searchStart, searchEnd).toLowerCase();
          const anchorLower = anchor.toLowerCase();

          const localHits = findAllOccurrences(localSearch, anchorLower).map(i => searchStart + i);
          if (localHits.length > 0) {
            const chosen = pickBestOccurrence(localHits, result, before, after, anchor.length, usedPositions);
            if (chosen >= 0) {
              if (localHits.length > 1) {
                duplicateWarnings.push(`"${anchor.slice(0, 40)}${anchor.length > 40 ? '...' : ''}" appears ${localHits.length} times in section window`);
              }
              usedPositions.add(chosen);
              return { ...c, pos: chosen, anchorText: anchor, anchorEnd: chosen + anchor.length, strategy: 'position+text' };
            }
          }

          // Try first few words
          const words = anchor.split(/\s+/).slice(0, 4).join(' ').toLowerCase();
          if (words.length >= 10) {
            const partialHits = findAllOccurrences(localSearch, words).map(i => searchStart + i);
            if (partialHits.length > 0) {
              const chosen = pickBestOccurrence(partialHits, result, before, after, words.length, usedPositions);
              if (chosen >= 0) {
                usedPositions.add(chosen);
                return { ...c, pos: chosen, anchorText: words, anchorEnd: chosen + words.length, strategy: 'position+partial' };
              }
            }
          }
        }

        // A docPosition at the very start of a section maps to markdownPos=0,
        // which sits before the file's `# Heading` line and gets rendered in
        // the previous section. Push past the heading line so the comment
        // stays inside the section it was authored in.
        insertPos = pushPastSectionHeading(result, insertPos);

        return { ...c, pos: insertPos, anchorText: null, strategy: 'position-only' };
      }
    }

    // Handle empty anchors
    if (!anchor || isEmpty) {
      if (before || after) {
        const { occurrences } = findAnchorInText('', result, before, after);
        if (occurrences.length > 0) {
          return { ...c, pos: occurrences[0], anchorText: null, isEmpty: true };
        }
      }
      unmatchedCount++;
      return { ...c, pos: -1, anchorText: null, isEmpty: true };
    }

    // Text-based matching strategies
    const { occurrences, matchedAnchor, strategy, stripped } = findAnchorInText(anchor, result, before, after);

    if (occurrences.length === 0) {
      unmatchedCount++;
      return { ...c, pos: -1, anchorText: null };
    }

    const anchorLen = matchedAnchor ? matchedAnchor.length : 0;

    if (occurrences.length === 1) {
      if (matchedAnchor) {
        return { ...c, pos: occurrences[0], anchorText: matchedAnchor, anchorEnd: occurrences[0] + anchorLen };
      } else {
        return { ...c, pos: occurrences[0], anchorText: null };
      }
    }

    // Multiple occurrences - use context for disambiguation
    if (matchedAnchor) {
      duplicateWarnings.push(`"${matchedAnchor.slice(0, 40)}${matchedAnchor.length > 40 ? '...' : ''}" appears ${occurrences.length} times`);
    }

    const bestIdx = pickBestOccurrence(occurrences, result, before, after, anchorLen, usedPositions);
    const finalIdx = bestIdx >= 0 ? bestIdx : occurrences[0];
    usedPositions.add(finalIdx);

    if (matchedAnchor) {
      return { ...c, pos: finalIdx, anchorText: matchedAnchor, anchorEnd: finalIdx + anchorLen };
    } else {
      return { ...c, pos: finalIdx, anchorText: null };
    }
  });

  // Log any unmatched comments for debugging
  const unmatched = commentsWithPositions.filter((c) => c.pos < 0);
  if (process.env.DEBUG) {
    console.log(`[DEBUG] insertComments: ${comments.length} input, ${commentsWithPositions.length} processed, ${unmatched.length} unmatched`);
    if (unmatched.length > 0) {
      unmatched.forEach(c => console.log(`[DEBUG]   Unmatched ID=${c.id}: anchor="${(c.anchorText || 'none').slice(0,30)}"`));
    }
  }

  const matched = commentsWithPositions.filter((c) => c.pos >= 0);

  // Sort by position descending (insert from end to avoid offset issues)
  matched.sort((a, b) => b.pos - a.pos);

  // Insert each comment. With `wrapAnchor` (the default), the anchor text
  // gets wrapped in `[anchor]{.mark}` so the rebuilt docx restores the
  // original Word comment range. Without it, the comment block is inserted
  // adjacent to the anchor and prose stays untouched — required for
  // comments-only sync where multiple comments may share one anchor.
  for (const c of matched) {
    const comment = `{>>${c.author}: ${c.text}<<}`;
    if (wrapAnchor && c.anchorText && c.anchorEnd) {
      const before = result.slice(0, c.pos);
      const anchor = result.slice(c.pos, c.anchorEnd);
      const after = result.slice(c.anchorEnd);
      result = before + comment + `[${anchor}]{.mark}` + after;
    } else {
      // Insert comment at the anchor position with no surrounding whitespace
      // tweaks; CriticMarkup blocks are invisible to readers, and adding a
      // leading space would shift prose byte-for-byte (relevant when callers
      // verify that --comments-only didn't touch the original).
      result = result.slice(0, c.pos) + comment + result.slice(c.pos);
    }
  }

  // Log warnings unless quiet mode
  if (!quiet) {
    if (unmatchedCount > 0) {
      console.warn(`Warning: ${unmatchedCount} comment(s) could not be matched to anchor text`);
    }
    if (duplicateWarnings.length > 0) {
      console.warn(`Warning: Duplicate anchor text found (using context & tie-breaks for placement):`);
      for (const w of duplicateWarnings) {
        console.warn(`  - ${w}`);
      }
    }
  }

  return result;
}

/**
 * Import Word document with track changes directly as CriticMarkup
 */
export async function importWordWithTrackChanges(
  docxPath: string,
  options: ImportWordWithTrackChangesOptions = {}
): Promise<ImportWordWithTrackChangesResult> {
  const { mediaDir, projectDir } = options;
  const docxDir = path.dirname(docxPath);
  const targetMediaDir = mediaDir || path.join(docxDir, 'media');
  const targetProjectDir = projectDir || docxDir;

  const registry = readImageRegistry(targetProjectDir);
  const hasRegistry = registry && registry.figures && registry.figures.length > 0;

  // First pass: count images
  const { stdout: rawText } = await execAsync(
    `pandoc "${docxPath}" -t markdown --wrap=none --track-changes=all`,
    { maxBuffer: 50 * 1024 * 1024 }
  );

  const wordImageCount = (rawText.match(/!\[[^\]]*\]\(media\/[^)]+\)/g) || []).length;
  const registryCount = hasRegistry ? registry.figures.length : 0;

  const needsMediaExtraction = wordImageCount > registryCount;

  if (hasRegistry) {
    console.log(`Registry has ${registryCount} figures, Word doc has ${wordImageCount} images`);
    if (needsMediaExtraction) {
      console.log(`Extracting media (${wordImageCount - registryCount} new image(s) detected)`);
    } else {
      console.log(`Using existing figures from registry`);
    }
  }

  // Extract from Word
  const extracted = await extractFromWord(docxPath, {
    mediaDir: targetMediaDir,
    skipMediaExtraction: !needsMediaExtraction,
  });

  let text = extracted.text;
  const extractedMedia = extracted.extractedMedia || [];
  const comments = extracted.comments || [];
  const anchors = extracted.anchors || new Map();

  // Log messages
  for (const msg of extracted.messages || []) {
    if (msg.type === 'info') {
      console.log(msg.message);
    } else if (msg.type === 'warning') {
      console.warn(`Warning: ${msg.message}`);
    }
  }

  // Restore crossref
  const crossrefResult = restoreCrossrefFromWord(text, targetProjectDir);
  text = crossrefResult.text;
  if (crossrefResult.restored > 0) {
    console.log(`Restored ${crossrefResult.restored} crossref reference(s)`);
  }

  // Restore images
  const imageRestoreResult = restoreImagesFromRegistry(text, targetProjectDir, crossrefResult.restoredLabels);
  text = imageRestoreResult.text;
  if (imageRestoreResult.restored > 0) {
    console.log(`Restored ${imageRestoreResult.restored} image(s) from registry`);
  }

  // Insert comments
  if (comments.length > 0) {
    text = insertCommentsIntoMarkdown(text, comments, anchors);
    console.log(`Inserted ${comments.length} comment(s)`);
  }

  // Clean up
  text = cleanupAnnotations(text);

  // Count final changes
  const insertions = (text.match(/\{\+\+/g) || []).length;
  const deletions = (text.match(/\{--/g) || []).length;
  const substitutions = (text.match(/\{~~/g) || []).length;
  const commentCount = (text.match(/\{>>/g) || []).length;

  return {
    text,
    stats: {
      insertions,
      deletions,
      substitutions,
      comments: commentCount,
      total: insertions + deletions + substitutions + commentCount,
      hasTrackChanges: extracted.hasTrackChanges,
      trackChangeStats: extracted.trackChangeStats,
    },
    extractedMedia,
    comments,
  };
}

/**
 * Legacy import function: Word doc → annotated MD via diff
 */
export async function importFromWord(
  docxPath: string,
  originalMdPath: string,
  options: ImportFromWordOptions = {}
): Promise<ImportFromWordResult> {
  const { author = 'Reviewer', sectionContent, figuresDir } = options;
  const projectDir = path.dirname(originalMdPath);

  let wordText: string;
  let extractedMedia: string[] = [];
  let wordTables: WordTable[] = options.wordTables || [];
  let hasTrackChanges = false;

  if (sectionContent !== undefined) {
    let annotated = cleanupAnnotations(sectionContent);

    const insertions = (annotated.match(/\{\+\+/g) || []).length;
    const deletions = (annotated.match(/\{--/g) || []).length;
    const substitutions = (annotated.match(/\{~~/g) || []).length;
    const commentCount = (annotated.match(/\{>>/g) || []).length;

    return {
      annotated,
      stats: {
        insertions,
        deletions,
        substitutions,
        comments: commentCount,
        total: insertions + deletions + substitutions + commentCount,
      },
      extractedMedia: [],
    };
  } else {
    const docxDir = path.dirname(docxPath);
    const mediaDir = figuresDir || docxDir;

    const extracted = await extractFromWord(docxPath, { mediaDir });
    wordText = extracted.text;
    extractedMedia = extracted.extractedMedia || [];
    wordTables = extracted.tables || [];
    hasTrackChanges = extracted.hasTrackChanges || false;

    for (const msg of extracted.messages || []) {
      if (msg.type === 'info') {
        console.log(msg.message);
      } else if (msg.type === 'warning') {
        console.warn(`Warning: ${msg.message}`);
      }
    }

    if (hasTrackChanges) {
      const crossrefResult = restoreCrossrefFromWord(wordText, projectDir);
      wordText = crossrefResult.text;
      if (crossrefResult.restored > 0) {
        console.log(`Restored ${crossrefResult.restored} crossref reference(s)`);
      }

      const imageRestoreResult = restoreImagesFromRegistry(wordText, projectDir, crossrefResult.restoredLabels);
      wordText = imageRestoreResult.text;
      if (imageRestoreResult.restored > 0) {
        console.log(`Restored ${imageRestoreResult.restored} image(s) from registry`);
      }

      const comments = extracted.comments || [];
      const anchors = extracted.anchors || new Map();
      if (comments.length > 0) {
        wordText = insertCommentsIntoMarkdown(wordText, comments, anchors);
        console.log(`Inserted ${comments.length} comment(s)`);
      }

      wordText = cleanupAnnotations(wordText);

      const insertions = (wordText.match(/\{\+\+/g) || []).length;
      const deletions = (wordText.match(/\{--/g) || []).length;
      const substitutions = (wordText.match(/\{~~/g) || []).length;
      const commentCount = (wordText.match(/\{>>/g) || []).length;

      return {
        annotated: wordText,
        stats: {
          insertions,
          deletions,
          substitutions,
          comments: commentCount,
          total: insertions + deletions + substitutions + commentCount,
        },
        extractedMedia,
      };
    }

    console.warn('Warning: No track changes detected in Word document.');
    console.warn('  For best results, reviewers should use Track Changes in Word.');
    console.warn('  Falling back to diff-based import (comparing against original MD).');
    console.warn('  This approach may produce less accurate change annotations.');

    const crossrefResult = restoreCrossrefFromWord(wordText, projectDir);
    wordText = crossrefResult.text;
    if (crossrefResult.restored > 0) {
      console.log(`Restored ${crossrefResult.restored} crossref reference(s)`);
    }

    const imageRestoreResult = restoreImagesFromRegistry(wordText, projectDir, crossrefResult.restoredLabels);
    wordText = imageRestoreResult.text;
    if (imageRestoreResult.restored > 0) {
      console.log(`Restored ${imageRestoreResult.restored} image(s) from registry`);
    }
  }

  // Read original markdown
  let originalMd = fs.readFileSync(originalMdPath, 'utf-8');

  // Strip existing annotations
  originalMd = stripAnnotations(originalMd, { keepComments: false });

  // Load image registry
  const imageRegistry = readImageRegistry(projectDir);

  // Generate diff
  let annotated = generateSmartDiff(originalMd, wordText, author, { wordTables, imageRegistry });

  // Clean up
  annotated = cleanupAnnotations(annotated);

  // Fix citation annotations
  annotated = fixCitationAnnotations(annotated, originalMd);

  // Convert visible comments
  annotated = convertVisibleComments(annotated);

  // Count changes
  const insertions = (annotated.match(/\{\+\+/g) || []).length;
  const deletions = (annotated.match(/\{--/g) || []).length;
  const substitutions = (annotated.match(/\{~~/g) || []).length;
  const comments = (annotated.match(/\{>>/g) || []).length;

  return {
    annotated,
    stats: {
      insertions,
      deletions,
      substitutions,
      comments,
      total: insertions + deletions + substitutions + comments,
    },
    extractedMedia,
  };
}

/**
 * Move extracted media files to a figures directory with better names
 */
export function moveExtractedMedia(
  mediaFiles: string[],
  figuresDir: string,
  prefix: string = 'figure'
): MoveExtractedMediaResult {
  const moved: MovedFile[] = [];
  const errors: string[] = [];

  if (!fs.existsSync(figuresDir)) {
    fs.mkdirSync(figuresDir, { recursive: true });
  }

  for (let i = 0; i < mediaFiles.length; i++) {
    const src = mediaFiles[i];
    const ext = path.extname(src).toLowerCase();
    const newName = `${prefix}${i + 1}${ext}`;
    const dest = path.join(figuresDir, newName);

    try {
      fs.copyFileSync(src, dest);
      moved.push({ from: src, to: dest, name: newName });
    } catch (err: any) {
      errors.push(`Failed to copy ${src}: ${err.message}`);
    }
  }

  return { moved, errors };
}
