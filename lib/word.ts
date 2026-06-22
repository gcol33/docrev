/**
 * Word document extraction utilities
 * Handle reading text, comments, and anchors from .docx files
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import type { WordComment, CommentAnchor, WordMetadata, TrackChangesResult } from './types.js';
import {
  openDocx,
  readPartText,
  buildCommentAnchorModel,
  extractComments,
  walkBody,
  type FlowItem,
} from './ooxml.js';

// =============================================================================
// Constants
// =============================================================================

/** Characters of context to extract around comment anchors */
const ANCHOR_CONTEXT_SIZE = 100;

/** Characters of context before comment range start */
const CONTEXT_BEFORE_SIZE = 500;

// =============================================================================
// Public API
// =============================================================================

/**
 * Extract comments from Word document's comments.xml
 * @param docxPath - Path to .docx file
 * @returns Array of extracted comments
 * @throws {TypeError} If docxPath is not a string
 * @throws {Error} If file not found or invalid docx
 */
export async function extractWordComments(docxPath: string): Promise<WordComment[]> {
  if (typeof docxPath !== 'string') {
    throw new TypeError(`docxPath must be a string, got ${typeof docxPath}`);
  }
  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }

  const zip = openDocx(docxPath);
  return extractComments(zip)
    .filter((c) => c.id && c.text)
    .map((c) => ({ id: c.id, author: c.author, date: c.date, text: c.text }));
}

/**
 * Extract comment anchors (where comments are attached) from document.xml
 * Returns mapping of comment ID to the text they're anchored to
 * @param docxPath - Path to .docx file
 * @returns Map of comment ID to anchor info
 * @throws {TypeError} If docxPath is not a string
 * @throws {Error} If invalid docx structure
 */
export async function extractCommentAnchors(docxPath: string): Promise<Map<string, CommentAnchor>> {
  if (typeof docxPath !== 'string') {
    throw new TypeError(`docxPath must be a string, got ${typeof docxPath}`);
  }

  const zip = openDocx(docxPath);
  if (!zip.getEntry('word/document.xml')) {
    throw new Error('Invalid docx: no document.xml');
  }

  const { fullDocText, comments } = buildCommentAnchorModel(zip);
  const anchors = new Map<string, CommentAnchor>();

  for (const range of comments) {
    anchors.set(range.id, {
      text: range.anchor,
      context: fullDocText.slice(Math.max(0, range.start - CONTEXT_BEFORE_SIZE), range.start).slice(-ANCHOR_CONTEXT_SIZE),
    });
  }

  return anchors;
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

  const zip = new AdmZip(docxPath);
  const coreEntry = zip.getEntry('docProps/core.xml');

  if (!coreEntry) {
    return {};
  }

  const coreXml = zip.readAsText(coreEntry);
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
 * Check if file is a valid Word document
 * @param filePath - Path to file to check
 * @returns True if valid .docx file
 */
export function isWordDocument(filePath: string): boolean {
  if (typeof filePath !== 'string') return false;
  if (!fs.existsSync(filePath)) return false;
  if (!filePath.toLowerCase().endsWith('.docx')) return false;

  try {
    const zip = new AdmZip(filePath);
    return zip.getEntry('word/document.xml') !== null;
  } catch {
    return false;
  }
}

/**
 * Extract text content from XML element, handling nested elements
 * @param xml - XML string
 * @returns Plain text content
 */
function extractTextFromXml(xml: string): string {
  let text = '';
  // Match w:t elements (regular text)
  const textPattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = textPattern.exec(xml)) !== null) {
    text += match[1];
  }
  // Also match w:delText (deleted text)
  const delTextPattern = /<w:delText[^>]*>([^<]*)<\/w:delText>/g;
  while ((match = delTextPattern.exec(xml)) !== null) {
    text += match[1];
  }
  return text;
}

/**
 * Extract track changes (insertions and deletions) from Word document
 * Converts Word's w:ins and w:del elements to CriticMarkup format
 *
 * @param docxPath - Path to Word document
 * @returns Track changes result with content and stats
 */
export async function extractTrackChanges(docxPath: string): Promise<TrackChangesResult> {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }

  const zip = new AdmZip(docxPath);
  const documentEntry = zip.getEntry('word/document.xml');

  if (!documentEntry) {
    throw new Error('Invalid docx: no document.xml');
  }

  let xml = zip.readAsText(documentEntry);
  let insertions = 0;
  let deletions = 0;

  // Check if there are any track changes
  const hasInsertions = xml.includes('<w:ins ');
  const hasDeletions = xml.includes('<w:del ');

  if (!hasInsertions && !hasDeletions) {
    return { hasTrackChanges: false, content: null, stats: { insertions: 0, deletions: 0 } };
  }

  // Process insertions: <w:ins ...>...</w:ins> -> {++...++}
  // Match the full w:ins element including nested content
  xml = xml.replace(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g, (match, content) => {
    const text = extractTextFromXml(content);
    if (text.trim()) {
      insertions++;
      return `{++${text}++}`;
    }
    return text;
  });

  // Process deletions: <w:del ...>...</w:del> -> {--...--}
  xml = xml.replace(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/g, (match, content) => {
    const text = extractTextFromXml(content);
    if (text.trim()) {
      deletions++;
      return `{--${text}--}`;
    }
    return '';
  });

  return {
    hasTrackChanges: true,
    content: xml,
    stats: { insertions, deletions },
  };
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

interface ExtractWithTrackChangesOptions {
  mediaDir?: string;
}

/**
 * Extract Word document content with track changes preserved as CriticMarkup
 * Uses pandoc with track-changes=all option to preserve insertions/deletions
 *
 * @param docxPath - Path to Word document
 * @param options - Options
 * @returns Track changes result with text and stats
 */
export async function extractWithTrackChanges(
  docxPath: string,
  options: ExtractWithTrackChangesOptions = {}
): Promise<{ text: string; hasTrackChanges: boolean; stats: { insertions: number; deletions: number } }> {
  const { mediaDir } = options;

  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }

  const { execSync } = await import('child_process');

  // Use pandoc with --track-changes=all to preserve track changes
  // This outputs insertions as [insertion]{.insertion} and deletions as [deletion]{.deletion}
  let pandocArgs = `"${docxPath}" -t markdown --wrap=none --track-changes=all`;
  if (mediaDir) {
    pandocArgs += ` --extract-media="${mediaDir}"`;
  }

  let text: string;
  try {
    text = execSync(`pandoc ${pandocArgs}`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err: any) {
    throw new Error(`Pandoc extraction failed: ${err.message}`);
  }

  // Count track changes from pandoc output
  let insertions = 0;
  let deletions = 0;

  // Pandoc outputs track changes as:
  // [inserted text]{.insertion author="..."}
  // [deleted text]{.deletion author="..."}

  // Convert pandoc's track change format to CriticMarkup
  // Insertions: [text]{.insertion ...} -> {++text++}
  text = text.replace(/\[([^\]]*)\]\{\.insertion[^}]*\}/g, (match, content) => {
    if (content.trim()) {
      insertions++;
      return `{++${content}++}`;
    }
    return '';
  });

  // Deletions: [text]{.deletion ...} -> {--text--}
  text = text.replace(/\[([^\]]*)\]\{\.deletion[^}]*\}/g, (match, content) => {
    if (content.trim()) {
      deletions++;
      return `{--${content}--}`;
    }
    return '';
  });

  const hasTrackChanges = insertions > 0 || deletions > 0;

  return {
    text,
    hasTrackChanges,
    stats: { insertions, deletions },
  };
}
