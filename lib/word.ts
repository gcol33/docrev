/**
 * Word document extraction utilities
 * Handle reading text, comments, and anchors from .docx files
 */

import * as fs from 'fs';
import type { CommentAnchor, WordMetadata } from './types.js';
import {
  openDocx,
  readPartText,
  walkBody,
  type FlowItem,
} from './ooxml.js';
import { extractCommentAnchors as extractAnchorsWithContext } from './word-extraction.js';

// =============================================================================
// Public API
// =============================================================================

/**
 * Extract comments from Word document's comments.xml.
 * Re-exported from word-extraction.ts — the single implementation the CLI
 * ships — so this public entry cannot drift from what commands use (the
 * earlier local copy had already lost reply threading via `parentId`).
 */
export { extractWordComments } from './word-extraction.js';

/**
 * Extract comment anchors (where comments are attached) from document.xml
 * Returns mapping of comment ID to the text they're anchored to.
 *
 * Thin shape adapter over word-extraction.ts's richer anchor model so the
 * extraction logic exists exactly once.
 * @param docxPath - Path to .docx file
 * @returns Map of comment ID to anchor info
 * @throws {TypeError} If docxPath is not a string
 * @throws {Error} If invalid docx structure
 */
export async function extractCommentAnchors(docxPath: string): Promise<Map<string, CommentAnchor>> {
  if (typeof docxPath !== 'string') {
    throw new TypeError(`docxPath must be a string, got ${typeof docxPath}`);
  }

  const { anchors } = await extractAnchorsWithContext(docxPath);
  const result = new Map<string, CommentAnchor>();
  for (const [id, data] of anchors) {
    result.set(id, { text: data.anchor, context: data.before });
  }
  return result;
}

/**
 * Extract plain text from Word document (strips track change markup)
 * @param docxPath - Path to .docx file
 * @returns Extracted plain text (accepted changes applied)
 * @throws {TypeError} If docxPath is not a string
 * @throws {Error} If file not found
 */
export async function extractTextFromWord(docxPath: string): Promise<string> {
  if (typeof docxPath !== 'string') {
    throw new TypeError(`docxPath must be a string, got ${typeof docxPath}`);
  }
  const result = await extractPlainTextWithTrackChanges(docxPath);
  // Strip CriticMarkup: accept insertions, remove deletions, apply substitutions
  let text = result.text;
  text = text.replace(/\{~~[^~]*~>([^~]*)~~\}/g, '$1');  // substitutions → new
  text = text.replace(/\{\+\+([^+]*)\+\+\}/g, '$1');      // insertions → keep
  text = text.replace(/\{--[^}]*--\}/g, '');               // deletions → remove
  return text;
}

/**
 * Get document metadata from Word file
 * @param docxPath - Path to .docx file
 * @returns Document metadata
 * @throws {TypeError} If docxPath is not a string
 */
export async function getWordMetadata(docxPath: string): Promise<WordMetadata> {
  if (typeof docxPath !== 'string') {
    throw new TypeError(`docxPath must be a string, got ${typeof docxPath}`);
  }

  const zip = openDocx(docxPath);
  const coreXml = readPartText(zip, 'docProps/core.xml');

  if (coreXml === null) {
    return {};
  }

  const metadata: WordMetadata = {};

  // Extract common metadata fields
  const patterns: Record<string, RegExp> = {
    title: /<dc:title>([^<]*)<\/dc:title>/,
    author: /<dc:creator>([^<]*)<\/dc:creator>/,
    created: /<dcterms:created[^>]*>([^<]*)<\/dcterms:created>/,
    modified: /<dcterms:modified[^>]*>([^<]*)<\/dcterms:modified>/,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = coreXml.match(pattern);
    if (match) {
      (metadata as any)[key] = match[1];
    }
  }

  return metadata;
}

/**
 * Check if file is a valid Word document: an existing OOXML package that
 * actually contains `word/document.xml`. Content-based, so a valid docx
 * with a wrong extension is still recognized and a renamed non-zip is not.
 * @param filePath - Path to file to check
 * @returns True if valid Word document
 */
export function isWordDocument(filePath: string): boolean {
  if (typeof filePath !== 'string') return false;
  if (!fs.existsSync(filePath)) return false;

  try {
    return openDocx(filePath).getEntry('word/document.xml') !== null;
  } catch {
    return false;
  }
}

/**
 * Extract a single marker's content starting at position i.
 * Returns { content, end } where end is the position after the closing marker,
 * or null if no valid closing marker found.
 */
function extractMarker(text: string, i: number, open: string, close: string): { content: string; end: number } | null {
  if (!text.startsWith(open, i)) return null;
  const start = i + open.length;
  const closeIdx = text.indexOf(close, start);
  if (closeIdx === -1) return null;
  return { content: text.slice(start, closeIdx), end: closeIdx + close.length };
}

/**
 * Greedily collect consecutive markers of the same type.
 * E.g. {++a++}{++b++}{++c++} → "abc", advancing past all three.
 */
function collectConsecutive(text: string, i: number, open: string, close: string): { content: string; end: number } | null {
  const first = extractMarker(text, i, open, close);
  if (!first) return null;

  let content = first.content;
  let end = first.end;

  while (end < text.length) {
    const next = extractMarker(text, end, open, close);
    if (!next) break;
    content += next.content;
    end = next.end;
  }

  return { content, end };
}

/**
 * Scan text for adjacent CriticMarkup markers and:
 * 1. Merge consecutive same-type markers: {++a++}{++b++} → {++ab++}
 * 2. Merge adjacent del+ins or ins+del into substitutions: {--old--}{++new++} → {~~old~>new~~}
 *
 * Uses a linear scanner — no regex backtracking, no ambiguity.
 */
function mergeAdjacentMarkers(text: string): string {
  let result = '';
  let i = 0;

  while (i < text.length) {
    // --- Deletion block ---
    if (text.startsWith('{--', i)) {
      const del = collectConsecutive(text, i, '{--', '--}');
      if (!del) { result += text[i]; i++; continue; }

      // Skip spaces, then check for adjacent insertion
      let j = del.end;
      while (j < text.length && text[j] === ' ') j++;

      const ins = collectConsecutive(text, j, '{++', '++}');
      if (ins) {
        // Merge into substitution
        const trailing = del.content.endsWith(' ') || ins.content.endsWith(' ');
        result += `{~~${del.content.trimEnd()}~>${ins.content.trimEnd()}~~}${trailing ? ' ' : ''}`;
        i = ins.end;
      } else {
        // Emit merged deletion
        result += `{--${del.content}--}`;
        i = del.end;
      }
      continue;
    }

    // --- Insertion block ---
    if (text.startsWith('{++', i)) {
      const ins = collectConsecutive(text, i, '{++', '++}');
      if (!ins) { result += text[i]; i++; continue; }

      // Skip spaces, then check for adjacent deletion
      let j = ins.end;
      while (j < text.length && text[j] === ' ') j++;

      const del = collectConsecutive(text, j, '{--', '--}');
      if (del) {
        // Merge into substitution (del → ins order in output)
        const trailing = del.content.endsWith(' ') || ins.content.endsWith(' ');
        result += `{~~${del.content.trimEnd()}~>${ins.content.trimEnd()}~~}${trailing ? ' ' : ''}`;
        i = del.end;
      } else {
        // Emit merged insertion
        result += `{++${ins.content}++}`;
        i = ins.end;
      }
      continue;
    }

    result += text[i];
    i++;
  }

  return result;
}

/**
 * Extract plain text from Word XML with track changes preserved as CriticMarkup.
 * This is a pandoc-free fallback that reads document.xml directly.
 *
 * Converts:
 *   <w:ins> content </w:ins>  →  {++text++}
 *   <w:del> content </w:del>  →  {--text--}
 *
 * Also detects headings (w:pStyle Heading1-6) and outputs markdown # syntax.
 *
 * @param docxPath - Path to Word document
 * @returns Plain text with CriticMarkup and stats
 */
export async function extractPlainTextWithTrackChanges(docxPath: string): Promise<{
  text: string;
  hasTrackChanges: boolean;
  stats: { insertions: number; deletions: number };
}> {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }

  const zip = openDocx(docxPath);
  const docXml = readPartText(zip, 'word/document.xml');
  if (docXml === null) {
    throw new Error('Invalid docx: no document.xml');
  }

  let insertions = 0;
  let deletions = 0;
  const paragraphs: string[] = [];

  // One ordered walk drives everything: paragraph and heading boundaries,
  // run text (entities already decoded, tabs/breaks rendered), and the
  // track-change spans that become CriticMarkup. Field codes (w:instrText)
  // never reach the text because the walker only reads w:t / w:delText.
  let paraOut = '';
  let headingLevel = 0;
  let mode: 'normal' | 'ins' | 'del' = 'normal';
  let buffer = '';

  const flushSpan = (open: string, close: string, isIns: boolean) => {
    if (buffer.trim()) {
      if (isIns) insertions++;
      else deletions++;
      paraOut += `${open}${buffer}${close}`;
    } else if (buffer.length > 0) {
      // Whitespace-only edits are kept as plain text to preserve spacing.
      paraOut += buffer;
    }
    buffer = '';
  };

  const endParagraph = () => {
    let text = mergeAdjacentMarkers(paraOut);
    text = text.replace(/ {2,}/g, ' ');
    if (text.trim()) {
      paragraphs.push(
        headingLevel >= 1 && headingLevel <= 6 ? '#'.repeat(headingLevel) + ' ' + text.trim() : text,
      );
    }
    paraOut = '';
    headingLevel = 0;
    mode = 'normal';
    buffer = '';
  };

  for (const item of walkBody(docXml) as FlowItem[]) {
    switch (item.kind) {
      case 'paraStart':
        paraOut = '';
        headingLevel = item.level;
        mode = 'normal';
        buffer = '';
        break;
      case 'paraEnd':
        endParagraph();
        break;
      case 'text':
        if (mode === 'normal') paraOut += item.text;
        else buffer += item.text;
        break;
      case 'insStart':
        mode = 'ins';
        buffer = '';
        break;
      case 'insEnd':
        flushSpan('{++', '++}', true);
        mode = 'normal';
        break;
      case 'delStart':
        mode = 'del';
        buffer = '';
        break;
      case 'delEnd':
        flushSpan('{--', '--}', false);
        mode = 'normal';
        break;
      default:
        break;
    }
  }

  return {
    text: paragraphs.join('\n\n'),
    hasTrackChanges: insertions > 0 || deletions > 0,
    stats: { insertions, deletions },
  };
}

