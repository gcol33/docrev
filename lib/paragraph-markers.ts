/**
 * `<!-- @p:id -->` paragraph markers (gcol33/docrev#12).
 *
 * A marker sits on its own line immediately before a paragraph or float in a
 * section .md file and gives it a stable, semantic ID that a journey.md entry
 * can reference. Two concerns live here:
 *
 * - Segmenting a section file into the paragraph/float units journey.md talks
 *   about ({@link parseManuscriptBlocks}), for `rev journey init`/`check`.
 * - Carrying markers through a Word round-trip. The marker is an HTML
 *   comment, so it is dropped by pandoc from every non-HTML build output
 *   ({@link stripParagraphMarkers} makes that explicit rather than relying on
 *   pandoc's default) — which means it never appears in a reviewed docx.
 *   `rev sync`'s OOXML reconstruction path rebuilds a section's annotated
 *   markdown straight from the docx, so the marker has to be reattached by
 *   matching the reconstructed paragraphs back against the on-disk original
 *   ({@link reattachParagraphMarkers}). The legacy diff-based import path (no
 *   track changes) instead protects/restores the marker like any other
 *   invisible anchor (see `protect-restore.ts`), because there the original
 *   text — marker included — is a real operand of the diff.
 */

import { stripAnnotations } from './annotations.js';
import { wordOverlapSimilarity } from './anchor-match.js';
import type { JourneyEntryType, ManuscriptBlock } from './types.js';

/** Matches a marker line on its own, e.g. `<!-- @p:intro.memory -->`. */
export const PARAGRAPH_MARKER_LINE = /^<!--\s*@p:(\S+?)\s*-->\s*$/;

/** Matches a marker anywhere (used to strip it from build output). */
const PARAGRAPH_MARKER_GLOBAL = /<!--\s*@p:\S+?\s*-->\n?/g;

const HEADING_LINE = /^(#{1,6})\s+(.+)$/;
const FENCE_LINE = /^\s*(```+|~~~+)/;
const MIN_REATTACH_SCORE = 0.3;
const REATTACH_LOOKAHEAD = 6;

interface RawBlock {
  text: string;
  /** 0-based index of the block's first line in the split-by-\n content. */
  startLineIdx: number;
}

/**
 * Split content into blank-line-separated blocks, treating fenced code
 * blocks as atomic (a blank line inside a fence never splits it).
 */
function splitIntoRawBlocks(content: string): RawBlock[] {
  const lines = content.split('\n');
  const blocks: RawBlock[] = [];
  let current: string[] = [];
  let currentStart = -1;
  let inFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (FENCE_LINE.test(line)) inFence = !inFence;

    if (line.trim() === '' && !inFence) {
      if (current.length > 0) {
        blocks.push({ text: current.join('\n'), startLineIdx: currentStart });
        current = [];
        currentStart = -1;
      }
      continue;
    }

    if (current.length === 0) currentStart = i;
    current.push(line);
  }
  if (current.length > 0) blocks.push({ text: current.join('\n'), startLineIdx: currentStart });

  return blocks;
}

/**
 * Classify a block's content (marker line already stripped) into the
 * journey.md type tags: `(figure)`, `(table)`, `(equation)`, `(code)`, or
 * plain paragraph.
 */
export function classifyBlock(text: string): JourneyEntryType {
  const trimmed = text.trim();
  if (/^```/.test(trimmed) || /^~~~/.test(trimmed)) return 'code';
  if (/^\$\$/.test(trimmed)) return 'equation';
  if (/^!\[/.test(trimmed) || /^\\begin\{figure\*?\}/.test(trimmed)) return 'figure';
  if (/^\\begin\{table\*?\}/.test(trimmed)) return 'table';

  const lines = trimmed.split('\n');
  if (
    lines.length >= 2 &&
    (lines[0] ?? '').includes('|') &&
    /^[\s|:-]+$/.test(lines[1] ?? '') &&
    (lines[1] ?? '').includes('-')
  ) {
    return 'table';
  }

  return 'paragraph';
}

/**
 * Segment a section file's content into the ordered paragraph/float units
 * journey.md entries correspond to. Headings update the running `section`
 * name (used to group entries under `## <Section>` in journey.md) but never
 * produce a block of their own.
 */
export function parseManuscriptBlocks(
  content: string,
  file: string,
  fallbackSection: string
): ManuscriptBlock[] {
  const raw = splitIntoRawBlocks(content);
  const result: ManuscriptBlock[] = [];
  let section = fallbackSection;

  for (const block of raw) {
    const lines = block.text.split('\n');
    const first = lines[0] ?? '';

    if (lines.length === 1) {
      const heading = first.match(HEADING_LINE);
      if (heading) {
        section = (heading[2] || '').replace(/\s*\{[^}]*\}\s*$/, '').trim();
        continue;
      }
    }

    let markerId: string | null = null;
    let bodyLines = lines;
    const markerMatch = first.match(PARAGRAPH_MARKER_LINE);
    if (markerMatch) {
      markerId = markerMatch[1] ?? null;
      bodyLines = lines.slice(1);
    }

    const text = bodyLines.join('\n').trim();
    if (!text) continue;

    result.push({
      file,
      section,
      blockType: classifyBlock(text),
      markerId,
      text,
      line: block.startLineIdx + 1,
    });
  }

  return result;
}

/**
 * Remove `<!-- @p:id -->` markers from content bound for a build. Pandoc
 * already drops block-level HTML comments from non-HTML output on its own;
 * this makes the contract explicit and future-proof rather than relying on
 * that default.
 */
export function stripParagraphMarkers(content: string): string {
  return content.replace(PARAGRAPH_MARKER_GLOBAL, '');
}

/**
 * Re-attach markers from `originalMd` onto the matching paragraphs of
 * `reconstructedMd` (annotated markdown rebuilt from a reviewed docx's
 * OOXML, which never carried the markers). Matching is by word-overlap
 * similarity between the marker's original paragraph and each candidate,
 * scanned in document order with a small lookahead window — the same
 * technique `diff-engine.ts:generateSmartDiff` uses to line up paragraphs
 * across a revision. A paragraph rewritten too heavily to match keeps no
 * marker; `rev journey init` re-assigns one on the next run.
 */
export function reattachParagraphMarkers(originalMd: string, reconstructedMd: string): string {
  const originalBlocks = splitIntoRawBlocks(originalMd)
    .map((block) => {
      const lines = block.text.split('\n');
      const match = (lines[0] ?? '').match(PARAGRAPH_MARKER_LINE);
      if (!match) return null;
      const plain = stripAnnotations(lines.slice(1).join('\n')).trim();
      if (!plain) return null;
      return { id: match[1] ?? '', plain };
    })
    .filter((b): b is { id: string; plain: string } => b !== null);

  if (originalBlocks.length === 0) return reconstructedMd;

  const targetBlocks = splitIntoRawBlocks(reconstructedMd).filter(
    (b) => !HEADING_LINE.test((b.text.split('\n')[0] ?? '').trim())
  );
  const targetPlain = targetBlocks.map((b) => stripAnnotations(b.text));

  const used = new Set<number>();
  const markerForIndex = new Map<number, string>();
  let cursor = 0;

  for (const orig of originalBlocks) {
    let bestPos = -1;
    let bestScore = 0;
    const limit = Math.min(targetBlocks.length, cursor + REATTACH_LOOKAHEAD);
    for (let p = cursor; p < limit; p++) {
      if (used.has(p)) continue;
      const score = wordOverlapSimilarity(orig.plain, targetPlain[p] ?? '');
      if (score > bestScore) {
        bestScore = score;
        bestPos = p;
      }
    }
    if (bestPos !== -1 && bestScore >= MIN_REATTACH_SCORE) {
      markerForIndex.set(bestPos, orig.id);
      used.add(bestPos);
      cursor = bestPos + 1;
    }
  }

  if (markerForIndex.size === 0) return reconstructedMd;

  const lines = reconstructedMd.split('\n');
  const insertions = [...markerForIndex.entries()]
    .map(([pos, id]) => ({ startLineIdx: targetBlocks[pos].startLineIdx, id }))
    .sort((a, b) => b.startLineIdx - a.startLineIdx);

  for (const { startLineIdx, id } of insertions) {
    lines.splice(startLineIdx, 0, `<!-- @p:${id} -->`);
  }

  return lines.join('\n');
}
