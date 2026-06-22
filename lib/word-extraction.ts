/**
 * Word document data extraction - raw extraction from .docx files
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { buildDocTextModel, buildCommentAnchorModel, extractComments, openDocx, readPartText } from './ooxml.js';

const execAsync = promisify(exec);

// ============================================
// Type Definitions
// ============================================

export interface WordComment {
  id: string;
  author: string;
  date: string;
  text: string;
  /**
   * Parent comment id when this is a reply in a Word comment thread.
   * Resolved from `commentsExtended.xml`'s `w15:paraIdParent` field.
   * `undefined` for top-level comments.
   */
  parentId?: string;
}

export interface TextNode {
  xmlStart: number;
  xmlEnd: number;
  textStart: number;
  textEnd: number;
  text: string;
}

export interface CommentAnchorData {
  anchor: string;
  before: string;
  after: string;
  docPosition: number;
  docLength: number;
  isEmpty: boolean;
}

export interface CommentAnchorsResult {
  anchors: Map<string, CommentAnchorData>;
  fullDocText: string;
}

export interface DocxHeading {
  /** Heading style name from `<w:pStyle>`, e.g. "Heading1" */
  style: string;
  /** Heading depth: 1, 2, 3, ... (parsed from style name; 0 if unknown) */
  level: number;
  /** Concatenated text content of the heading paragraph */
  text: string;
  /** Position in fullDocText (same coordinate system as CommentAnchorData.docPosition) */
  docPosition: number;
}

export interface WordTable {
  markdown: string;
  rowCount: number;
  colCount: number;
}

export interface ParsedRow {
  cells: string[];
  colSpans: number[];
}

export interface ExtractFromWordOptions {
  mediaDir?: string;
  skipMediaExtraction?: boolean;
}

export interface ExtractMessage {
  type: 'info' | 'warning';
  message: string;
}

export interface ExtractFromWordResult {
  text: string;
  comments: WordComment[];
  anchors: Map<string, CommentAnchorData>;
  messages: ExtractMessage[];
  extractedMedia: string[];
  tables: WordTable[];
  hasTrackChanges: boolean;
  trackChangeStats: { insertions: number; deletions: number };
}

// ============================================
// Functions
// ============================================

/**
 * Extract comments directly from Word docx comments.xml
 */
export async function extractWordComments(docxPath: string): Promise<WordComment[]> {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }

  const zip = openDocx(docxPath);
  // Word truncates the stored date to its day for display; keep that contract.
  return extractComments(zip).map((c) => ({
    id: c.id,
    author: c.author,
    date: c.date.slice(0, 10),
    text: c.text,
    parentId: c.parentId,
  }));
}

/**
 * Extract comment anchor texts from document.xml with surrounding context
 * Returns map of comment ID -> {anchor, before, after, docPosition, isEmpty} for better matching
 * Also returns fullDocText for section boundary matching
 */
export async function extractCommentAnchors(docxPath: string): Promise<CommentAnchorsResult> {
  const anchors = new Map<string, CommentAnchorData>();

  const zip = openDocx(docxPath);
  const { fullDocText, comments } = buildCommentAnchorModel(zip);
  if (!fullDocText && comments.length === 0) {
    return { anchors, fullDocText: '' };
  }

  // Context surrounding the anchor, taken from the same plain-text coordinate
  // system as docPosition so the placement engine can compare like with like.
  function getContextBefore(position: number, maxLength: number = 150): string {
    const beforeText = fullDocText.slice(Math.max(0, position - maxLength), position);
    const sentenceStart = beforeText.search(/[.!?]\s+[A-Z][^.!?]*$/);
    return sentenceStart >= 0
      ? beforeText.slice(sentenceStart + 2).trim()
      : beforeText.slice(-80).trim();
  }

  function getContextAfter(position: number, maxLength: number = 150): string {
    const afterText = fullDocText.slice(position, position + maxLength);
    const sentenceEnd = afterText.search(/[.!?]\s/);
    return sentenceEnd >= 0
      ? afterText.slice(0, sentenceEnd + 1).trim()
      : afterText.slice(0, 80).trim();
  }

  for (const range of comments) {
    anchors.set(range.id, {
      anchor: range.anchor,
      before: getContextBefore(range.start),
      after: getContextAfter(range.end),
      docPosition: range.start,
      docLength: fullDocText.length,
      isEmpty: range.isEmpty,
    });
  }

  return { anchors, fullDocText };
}

/**
 * Extract heading paragraphs from a docx, with their text positions in the
 * same coordinate system as `extractCommentAnchors`'s `fullDocText` and
 * `CommentAnchorData.docPosition`.
 *
 * Headings are paragraphs whose `<w:pStyle>` is a Heading style. Reading
 * styles directly is more reliable than keyword-matching the concatenated
 * body text — there, paragraph boundaries are gone, so the literal string
 * "Methods" can appear inside prose ("results across countries") and the
 * structured-abstract label "Methods:" loses its colon when text runs are
 * concatenated.
 */
export async function extractHeadings(docxPath: string): Promise<DocxHeading[]> {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }

  const zip = openDocx(docxPath);
  const docXml = readPartText(zip, 'word/document.xml');
  if (docXml === null) return [];

  return buildDocTextModel(docXml).headings.map((h) => ({
    style: h.style,
    level: h.level,
    text: h.text,
    docPosition: h.position,
  }));
}

/**
 * Decode XML entities in text
 */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

/**
 * Extract text content from a Word XML cell
 */
function extractCellText(cellXml: string): string {
  const parts: string[] = [];

  // Check for OMML math - replace with [math] placeholder
  if (cellXml.includes('<m:oMath')) {
    // Try to extract the text representation of math
    const mathTextMatches = cellXml.match(/<m:t>([^<]*)<\/m:t>/g) || [];
    if (mathTextMatches.length > 0) {
      const mathText = mathTextMatches.map((t) => t.replace(/<[^>]+>/g, '')).join('');
      parts.push(mathText);
    } else {
      parts.push('[math]');
    }
  }

  // Extract regular text from w:t elements
  const textMatches = cellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
  for (const match of textMatches) {
    const text = match.replace(/<[^>]+>/g, '');
    if (text) {
      parts.push(text);
    }
  }

  let result = parts.join('').trim();
  result = decodeXmlEntities(result);

  // Escape pipe characters in cell content (would break table)
  result = result.replace(/\|/g, '\\|');

  return result;
}

/**
 * Parse a table row, handling merged cells (gridSpan)
 */
function parseTableRow(rowXml: string, expectedCols: number): ParsedRow {
  // Match cells - handle both <w:tc> and <w:tc ...>
  const cellMatches = rowXml.match(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g) || [];
  const cells: string[] = [];
  const colSpans: number[] = [];

  for (const cellXml of cellMatches) {
    // Check for horizontal merge (gridSpan)
    const gridSpanMatch = cellXml.match(/<w:gridSpan\s+w:val="(\d+)"/);
    const span = gridSpanMatch ? parseInt(gridSpanMatch[1], 10) : 1;

    // Check for vertical merge continuation (vMerge without restart)
    // If vMerge is present without w:val="restart", it's a continuation - use empty
    const vMergeMatch = cellXml.match(/<w:vMerge(?:\s+w:val="([^"]+)")?/);
    const isVMergeContinuation = vMergeMatch && vMergeMatch[1] !== 'restart';

    const cellText = isVMergeContinuation ? '' : extractCellText(cellXml);

    // Add the cell content
    cells.push(cellText);
    colSpans.push(span);

    // For gridSpan > 1, add empty cells to maintain column alignment
    for (let i = 1; i < span; i++) {
      cells.push('');
      colSpans.push(0); // 0 indicates this is a spanned cell
    }
  }

  return { cells, colSpans };
}

/**
 * Determine table grid column count from table XML
 */
function getTableGridCols(tableXml: string): number {
  // Try to get from tblGrid
  const gridColMatches = tableXml.match(/<w:gridCol/g) || [];
  if (gridColMatches.length > 0) {
    return gridColMatches.length;
  }

  // Fallback: count max cells in any row
  const rowMatches = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
  let maxCols = 0;
  for (const rowXml of rowMatches) {
    const { cells } = parseTableRow(rowXml, 0);
    maxCols = Math.max(maxCols, cells.length);
  }
  return maxCols;
}

/**
 * Extract tables directly from Word document XML and convert to markdown pipe tables
 */
export async function extractWordTables(docxPath: string): Promise<WordTable[]> {
  const AdmZip = (await import('adm-zip')).default;
  const tables: WordTable[] = [];

  try {
    const zip = new AdmZip(docxPath);
    const docEntry = zip.getEntry('word/document.xml');

    if (!docEntry) {
      return tables;
    }

    const xml = docEntry.getData().toString('utf8');

    // Find all table elements
    const tableMatches = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];

    for (const tableXml of tableMatches) {
      // Determine expected column count from grid
      const expectedCols = getTableGridCols(tableXml);

      // Extract rows
      const rowMatches = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
      const rows: string[][] = [];

      for (const rowXml of rowMatches) {
        const { cells } = parseTableRow(rowXml, expectedCols);
        if (cells.length > 0) {
          rows.push(cells);
        }
      }

      if (rows.length > 0) {
        // Convert to markdown pipe table
        const markdown = convertRowsToMarkdownTable(rows);
        tables.push({ markdown, rowCount: rows.length, colCount: expectedCols || rows[0]?.length || 0 });
      }
    }
  } catch (err: any) {
    console.error('Error extracting tables from Word:', err.message);
  }

  return tables;
}

/**
 * Convert array of rows (each row is array of cell strings) to markdown pipe table
 */
function convertRowsToMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return '';

  // Normalize column count (use max across all rows)
  const colCount = Math.max(...rows.map((r) => r.length));

  // Pad rows to have consistent column count
  const normalizedRows = rows.map((row) => {
    while (row.length < colCount) {
      row.push('');
    }
    return row;
  });

  // Build markdown table
  const lines: string[] = [];

  // Header row
  const header = normalizedRows[0];
  lines.push('| ' + header.join(' | ') + ' |');

  // Separator row
  lines.push('|' + header.map(() => '---').join('|') + '|');

  // Data rows
  for (let i = 1; i < normalizedRows.length; i++) {
    lines.push('| ' + normalizedRows[i].join(' | ') + ' |');
  }

  return lines.join('\n');
}

/**
 * Extract text from Word document using pandoc with track changes preserved
 */
export async function extractFromWord(
  docxPath: string,
  options: ExtractFromWordOptions = {}
): Promise<ExtractFromWordResult> {
  let text: string;
  let messages: ExtractMessage[] = [];
  let extractedMedia: string[] = [];
  let hasTrackChanges = false;
  let trackChangeStats = { insertions: 0, deletions: 0 };

  // Determine media extraction directory
  const docxDir = path.dirname(docxPath);
  const mediaDir = options.mediaDir || path.join(docxDir, 'media');

  // Skip media extraction if figures already exist (e.g., when re-importing with existing source)
  const skipMediaExtraction = options.skipMediaExtraction || false;

  // Extract tables directly from Word XML (reliable, no heuristics)
  const wordTables = await extractWordTables(docxPath);

  // Try pandoc first with --track-changes=all to preserve reviewer edits
  try {
    // Build pandoc command
    let pandocCmd = `pandoc "${docxPath}" -t markdown --wrap=none --track-changes=all`;
    if (!skipMediaExtraction) {
      pandocCmd += ` --extract-media="${mediaDir}"`;
    }

    const { stdout } = await execAsync(pandocCmd, { maxBuffer: 50 * 1024 * 1024 });
    text = stdout;

    // Convert pandoc's track change format to CriticMarkup
    const origLength = text.length;

    // Use a more robust pattern that handles nested content
    text = text.replace(/\[([^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*)\]\{\.insertion[^}]*\}/g, (match, content) => {
      if (content.trim()) {
        trackChangeStats.insertions++;
        return `{++${content}++}`;
      }
      return ''; // Empty insertions are removed
    });

    text = text.replace(/\[([^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*)\]\{\.deletion[^}]*\}/g, (match, content) => {
      if (content.trim()) {
        trackChangeStats.deletions++;
        return `{--${content}--}`;
      }
      return ''; // Empty deletions are removed
    });

    // Handle any remaining pandoc track change patterns
    let prevText;
    do {
      prevText = text;
      text = text.replace(/\[([^\]]*)\]\{\.insertion[^}]*\}/g, (match, content) => {
        if (content.trim()) {
          trackChangeStats.insertions++;
          return `{++${content}++}`;
        }
        return '';
      });
      text = text.replace(/\[([^\]]*)\]\{\.deletion[^}]*\}/g, (match, content) => {
        if (content.trim()) {
          trackChangeStats.deletions++;
          return `{--${content}--}`;
        }
        return '';
      });
    } while (text !== prevText);

    // Handle pandoc comment patterns - remove comment text from body
    text = text.replace(/\[[^\]]*\]\{\.comment-start[^}]*\}/g, '');
    text = text.replace(/\[\]\{\.comment-end[^}]*\}/g, '');

    // Also handle {.mark} spans
    text = text.replace(/\[([^\]]*)\]\{\.mark\}/g, '$1');

    hasTrackChanges = trackChangeStats.insertions > 0 || trackChangeStats.deletions > 0;

    if (hasTrackChanges) {
      messages.push({
        type: 'info',
        message: `Found ${trackChangeStats.insertions} insertion(s) and ${trackChangeStats.deletions} deletion(s) from track changes`
      });
    }

    // Find extracted media files
    const mediaSubdir = path.join(mediaDir, 'media');
    if (fs.existsSync(mediaSubdir)) {
      extractedMedia = fs.readdirSync(mediaSubdir)
        .filter(f => /\.(png|jpg|jpeg|gif|svg|emf|wmf|tiff?)$/i.test(f))
        .map(f => path.join(mediaSubdir, f));

      if (extractedMedia.length > 0) {
        messages.push({
          type: 'info',
          message: `Extracted ${extractedMedia.length} image(s) to ${mediaSubdir}`
        });
      }
    }
  } catch (pandocErr: any) {
    // Pandoc not available — use XML-based extraction with track change support
    const { extractPlainTextWithTrackChanges } = await import('./word.js');
    const { getInstallInstructions } = await import('./dependencies.js');
    const installCmd = getInstallInstructions('pandoc');

    const xmlResult = await extractPlainTextWithTrackChanges(docxPath);
    text = xmlResult.text;
    hasTrackChanges = xmlResult.hasTrackChanges;
    trackChangeStats = xmlResult.stats;

    if (hasTrackChanges) {
      messages.push({
        type: 'warning',
        message: `Pandoc not installed. Using built-in XML extractor (${trackChangeStats.insertions} insertions, ${trackChangeStats.deletions} deletions preserved). Formatting may differ. Install pandoc for best results: ${installCmd}`
      });
    } else {
      messages.push({
        type: 'warning',
        message: `Pandoc not installed. Using built-in XML extractor (no track changes found). Install pandoc for better formatting: ${installCmd}`
      });
    }
  }

  // Extract comments directly from docx XML
  const comments = await extractWordComments(docxPath);

  // Extract comment anchor texts
  const { anchors } = await extractCommentAnchors(docxPath);

  return {
    text,
    comments,
    anchors,
    messages,
    extractedMedia,
    tables: wordTables,
    hasTrackChanges,
    trackChangeStats,
  };
}
