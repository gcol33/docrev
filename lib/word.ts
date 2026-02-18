/**
 * Word document extraction utilities
 * Handle reading text, comments, and anchors from .docx files
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { parseString } from 'xml2js';
import { promisify } from 'util';
import type { WordComment, CommentAnchor, WordContent, WordMetadata, TrackChangesResult } from './types.js';

const parseXml = promisify(parseString);

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

  const zip = new AdmZip(docxPath);
  const commentsEntry = zip.getEntry('word/comments.xml');

  if (!commentsEntry) {
    return []; // No comments in document
  }

  const commentsXml = zip.readAsText(commentsEntry);
  const parsed = await parseXml(commentsXml) as any;

  if (!parsed?.['w:comments'] || !parsed['w:comments']['w:comment']) {
    return [];
  }

  const comments: WordComment[] = [];
  const rawComments = parsed['w:comments']['w:comment'];

  for (const comment of rawComments) {
    const id = comment.$?.['w:id'];
    const author = comment.$?.['w:author'] || 'Unknown';
    const date = comment.$?.['w:date'];

    // Extract text from all paragraphs in comment
    let text = '';
    const paragraphs = comment['w:p'] || [];
    for (const para of paragraphs) {
      const runs = para['w:r'] || [];
      for (const run of runs) {
        const texts = run['w:t'] || [];
        for (const t of texts) {
          text += typeof t === 'string' ? t : (t._ || '');
        }
      }
    }

    if (id && text.trim()) {
      comments.push({
        id,
        author,
        date,
        text: text.trim(),
      });
    }
  }

  return comments;
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

  const zip = new AdmZip(docxPath);
  const documentEntry = zip.getEntry('word/document.xml');

  if (!documentEntry) {
    throw new Error('Invalid docx: no document.xml');
  }

  const documentXml = zip.readAsText(documentEntry);
  const anchors = new Map<string, CommentAnchor>();

  // Find commentRangeStart and commentRangeEnd pairs
  // The text between them is what the comment is anchored to
  const startPattern = /<w:commentRangeStart w:id="(\d+)"\/>/g;
  const endPattern = /<w:commentRangeEnd w:id="(\d+)"\/>/g;

  let match: RegExpExecArray | null;
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();

  while ((match = startPattern.exec(documentXml)) !== null) {
    if (match[1]) {
      starts.set(match[1], match.index);
    }
  }

  while ((match = endPattern.exec(documentXml)) !== null) {
    if (match[1]) {
      ends.set(match[1], match.index);
    }
  }

  // For each comment, extract the text between start and end
  for (const [id, startPos] of starts) {
    const endPos = ends.get(id);
    if (!endPos) continue;

    const segment = documentXml.slice(startPos, endPos);

    // Extract all text content from the segment
    const textPattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let text = '';
    let textMatch: RegExpExecArray | null;
    while ((textMatch = textPattern.exec(segment)) !== null) {
      text += textMatch[1] ?? '';
    }

    // Get surrounding context (text before the anchor)
    const contextStart = Math.max(0, startPos - CONTEXT_BEFORE_SIZE);
    const contextSegment = documentXml.slice(contextStart, startPos);
    let context = '';
    while ((textMatch = textPattern.exec(contextSegment)) !== null) {
      context += textMatch[1] ?? '';
    }

    anchors.set(id, {
      text: text.trim(),
      context: context.slice(-ANCHOR_CONTEXT_SIZE),
    });
  }

  return anchors;
}

/**
 * Extract plain text from Word document using mammoth
 * @param docxPath - Path to .docx file
 * @returns Extracted plain text
 * @throws {TypeError} If docxPath is not a string
 * @throws {Error} If file not found
 */
export async function extractTextFromWord(docxPath: string): Promise<string> {
  if (typeof docxPath !== 'string') {
    throw new TypeError(`docxPath must be a string, got ${typeof docxPath}`);
  }
  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }

  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: docxPath });
  return result.value;
}

/**
 * Extract rich content from Word with basic formatting
 * @param docxPath - Path to .docx file
 * @returns Text and HTML content
 * @throws {TypeError} If docxPath is not a string
 * @throws {Error} If file not found
 */
export async function extractFromWord(docxPath: string): Promise<WordContent> {
  if (typeof docxPath !== 'string') {
    throw new TypeError(`docxPath must be a string, got ${typeof docxPath}`);
  }
  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }

  const mammoth = await import('mammoth');

  const [textResult, htmlResult] = await Promise.all([
    mammoth.extractRawText({ path: docxPath }),
    mammoth.convertToHtml({ path: docxPath }),
  ]);

  return {
    text: textResult.value,
    html: htmlResult.value,
  };
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

  const zip = new AdmZip(docxPath);
  const docEntry = zip.getEntry('word/document.xml');

  if (!docEntry) {
    throw new Error('Invalid docx: no document.xml');
  }

  let xml = docEntry.getData().toString('utf8');
  let insertions = 0;
  let deletions = 0;

  // Use unique markers (null bytes) that won't appear in normal text
  const INS_S = '\x00IS\x00';
  const INS_E = '\x00IE\x00';
  const DEL_S = '\x00DS\x00';
  const DEL_E = '\x00DE\x00';

  // Step 1: Replace <w:ins> with marker-wrapped text injected as <w:t>
  xml = xml.replace(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g, (_match, content: string) => {
    const texts: string[] = [];
    const tPat = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m: RegExpExecArray | null;
    while ((m = tPat.exec(content)) !== null) {
      texts.push(m[1] || '');
    }
    const text = texts.join('');
    if (text.trim()) {
      insertions++;
      return `<w:r><w:t>${INS_S}${text}${INS_E}</w:t></w:r>`;
    }
    return '';
  });

  // Step 2: Replace <w:del> similarly (uses w:delText inside)
  xml = xml.replace(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/g, (_match, content: string) => {
    const texts: string[] = [];
    // Try w:delText first, then w:t as fallback
    const tPat = /<w:delText[^>]*>([^<]*)<\/w:delText>|<w:t[^>]*>([^<]*)<\/w:t>/g;
    let m: RegExpExecArray | null;
    while ((m = tPat.exec(content)) !== null) {
      texts.push(m[1] || m[2] || '');
    }
    const text = texts.join('');
    if (text.trim()) {
      deletions++;
      return `<w:r><w:t>${DEL_S}${text}${DEL_E}</w:t></w:r>`;
    }
    return '';
  });

  // Step 3: Extract text paragraph by paragraph
  const paragraphs: string[] = [];
  const paraPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm: RegExpExecArray | null;

  while ((pm = paraPattern.exec(xml)) !== null) {
    const paraXml = pm[1];

    // Detect heading level from paragraph style
    let headingLevel = 0;
    const styleMatch = paraXml.match(/<w:pStyle\s+w:val="Heading(\d)"/i);
    if (styleMatch && styleMatch[1]) {
      headingLevel = parseInt(styleMatch[1], 10);
    }

    // Extract all <w:t> text in order
    const texts: string[] = [];
    const tPat = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let tm: RegExpExecArray | null;
    while ((tm = tPat.exec(paraXml)) !== null) {
      texts.push(tm[1] || '');
    }

    let paraText = texts.join('');

    // Decode XML entities
    paraText = paraText
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");

    // Convert markers to CriticMarkup
    paraText = paraText
      .split(INS_S).join('{++')
      .split(INS_E).join('++}')
      .split(DEL_S).join('{--')
      .split(DEL_E).join('--}');

    if (paraText.trim()) {
      if (headingLevel > 0 && headingLevel <= 6) {
        paragraphs.push('#'.repeat(headingLevel) + ' ' + paraText.trim());
      } else {
        paragraphs.push(paraText);
      }
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
