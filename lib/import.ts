/**
 * Import functionality - convert Word docs to annotated Markdown
 */

import * as fs from 'fs';
import * as path from 'path';
import { diffWords, Change } from 'diff';
import { stripAnnotations } from './annotations.js';
import { readImageRegistry } from './image-registry.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  extractMarkdownPrefix,
  protectAnchors,
  restoreAnchors,
  protectCrossrefs,
  restoreCrossrefs,
  simplifyMathForMatching,
  protectMath,
  restoreMath,
  replaceRenderedMath,
  protectCitations,
  restoreCitations,
  replaceRenderedCitations,
  protectImages,
  restoreImages,
  matchWordImagesToOriginal,
  protectTables,
  restoreTables,
} from './protect-restore.js';
import { normalizeWhitespace } from './utils.js';

const execAsync = promisify(exec);

// ============================================
// Type Definitions
// ============================================

interface WordComment {
  id: string;
  author: string;
  date: string;
  text: string;
}

interface TextNode {
  xmlStart: number;
  xmlEnd: number;
  textStart: number;
  textEnd: number;
  text: string;
}

interface CommentAnchorData {
  anchor: string;
  before: string;
  after: string;
  docPosition: number;
  docLength: number;
  isEmpty: boolean;
}

interface CommentAnchorsResult {
  anchors: Map<string, CommentAnchorData>;
  fullDocText: string;
}

interface WordTable {
  markdown: string;
  rowCount: number;
  colCount: number;
}

interface ParsedRow {
  cells: string[];
  colSpans: number[];
}

interface ExtractFromWordOptions {
  mediaDir?: string;
  skipMediaExtraction?: boolean;
}

interface ExtractMessage {
  type: 'info' | 'warning';
  message: string;
}

interface ExtractFromWordResult {
  text: string;
  comments: WordComment[];
  anchors: Map<string, CommentAnchorData>;
  messages: ExtractMessage[];
  extractedMedia: string[];
  tables: WordTable[];
  hasTrackChanges: boolean;
  trackChangeStats: { insertions: number; deletions: number };
}

interface InsertCommentsOptions {
  quiet?: boolean;
  sectionBoundary?: { start: number; end: number } | null;
}

interface CommentWithPos {
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

interface AnchorSearchResult {
  occurrences: number[];
  matchedAnchor: string | null;
  strategy: string;
  stripped?: boolean;
}

interface MarkdownPrefixResult {
  prefix: string;
  content: string;
}

interface GenerateSmartDiffOptions {
  wordTables?: WordTable[];
  imageRegistry?: any;
}

interface RestoreCrossrefResult {
  text: string;
  restored: number;
  messages: string[];
  restoredLabels: Set<string>;
}

interface RestoreImagesResult {
  text: string;
  restored: number;
  messages: string[];
}

interface ImportWordWithTrackChangesOptions {
  mediaDir?: string;
  projectDir?: string;
}

interface ImportWordWithTrackChangesResult {
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

interface ImportFromWordOptions {
  author?: string;
  sectionContent?: string;
  figuresDir?: string;
  wordTables?: WordTable[];
}

interface ImportFromWordResult {
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

interface MovedFile {
  from: string;
  to: string;
  name: string;
}

interface MoveExtractedMediaResult {
  moved: MovedFile[];
  errors: string[];
}

// ============================================
// Functions
// ============================================

/**
 * Extract comments directly from Word docx comments.xml
 */
export async function extractWordComments(docxPath: string): Promise<WordComment[]> {
  const AdmZip = (await import('adm-zip')).default;
  const { parseStringPromise } = await import('xml2js');

  const comments: WordComment[] = [];

  // Validate file exists
  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }

  try {
    let zip;
    try {
      zip = new AdmZip(docxPath);
    } catch (err: any) {
      throw new Error(`Invalid Word document (not a valid .docx file): ${err.message}`);
    }

    const commentsEntry = zip.getEntry('word/comments.xml');

    if (!commentsEntry) {
      return comments;
    }

    let commentsXml;
    try {
      commentsXml = commentsEntry.getData().toString('utf8');
    } catch (err: any) {
      throw new Error(`Failed to read comments from document: ${err.message}`);
    }

    const parsed = await parseStringPromise(commentsXml, { explicitArray: false });

    const ns = 'w:';
    const commentsRoot = parsed['w:comments'];
    if (!commentsRoot || !commentsRoot['w:comment']) {
      return comments;
    }

    // Ensure it's an array
    const commentNodes = Array.isArray(commentsRoot['w:comment'])
      ? commentsRoot['w:comment']
      : [commentsRoot['w:comment']];

    for (const comment of commentNodes) {
      const id = comment.$?.['w:id'] || '';
      const author = comment.$?.['w:author'] || 'Unknown';
      const date = comment.$?.['w:date'] || '';

      // Extract text from nested w:p/w:r/w:t elements
      let text = '';
      const extractText = (node: any): void => {
        if (!node) return;
        if (typeof node === 'string') {
          text += node;
          return;
        }
        if (node['w:t']) {
          const t = node['w:t'];
          text += typeof t === 'string' ? t : (t._ || t);
        }
        if (node['w:r']) {
          const runs = Array.isArray(node['w:r']) ? node['w:r'] : [node['w:r']];
          runs.forEach(extractText);
        }
        if (node['w:p']) {
          const paras = Array.isArray(node['w:p']) ? node['w:p'] : [node['w:p']];
          paras.forEach(extractText);
        }
      };
      extractText(comment);

      comments.push({ id, author, date: date.slice(0, 10), text: text.trim() });
    }
  } catch (err: any) {
    // Re-throw with more context if it's already an Error we created
    if (err.message.includes('Invalid Word document') || err.message.includes('File not found')) {
      throw err;
    }
    throw new Error(`Error extracting comments from ${path.basename(docxPath)}: ${err.message}`);
  }

  return comments;
}

/**
 * Extract comment anchor texts from document.xml with surrounding context
 * Returns map of comment ID -> {anchor, before, after, docPosition, isEmpty} for better matching
 * Also returns fullDocText for section boundary matching
 */
export async function extractCommentAnchors(docxPath: string): Promise<CommentAnchorsResult> {
  const AdmZip = (await import('adm-zip')).default;
  const anchors = new Map<string, CommentAnchorData>();
  let fullDocText = '';

  try {
    const zip = new AdmZip(docxPath);
    const docEntry = zip.getEntry('word/document.xml');

    if (!docEntry) {
      return { anchors, fullDocText };
    }

    const docXml = docEntry.getData().toString('utf8');

    // ========================================
    // STEP 1: Build text position mapping
    // ========================================
    const textNodePattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    const textNodes: TextNode[] = [];
    let textPosition = 0;
    let nodeMatch;

    while ((nodeMatch = textNodePattern.exec(docXml)) !== null) {
      const rawText = nodeMatch[1] ?? '';
      const decodedText = decodeXmlEntities(rawText);
      textNodes.push({
        xmlStart: nodeMatch.index,
        xmlEnd: nodeMatch.index + nodeMatch[0].length,
        textStart: textPosition,
        textEnd: textPosition + decodedText.length,
        text: decodedText
      });
      textPosition += decodedText.length;
    }

    fullDocText = textNodes.map(n => n.text).join('');

    // Helper: convert XML position to text position
    function xmlPosToTextPos(xmlPos: number): number {
      for (let i = 0; i < textNodes.length; i++) {
        const node = textNodes[i];
        if (!node) continue;
        if (xmlPos >= node.xmlStart && xmlPos < node.xmlEnd) {
          return node.textStart;
        }
        if (xmlPos < node.xmlStart) {
          return node.textStart;
        }
      }
      const lastNode = textNodes[textNodes.length - 1];
      return lastNode ? lastNode.textEnd : 0;
    }

    // Helper: extract context before a position
    function getContextBefore(position: number, maxLength: number = 150): string {
      const beforeText = fullDocText.slice(Math.max(0, position - maxLength), position);
      const sentenceStart = beforeText.search(/[.!?]\s+[A-Z][^.!?]*$/);
      return sentenceStart >= 0
        ? beforeText.slice(sentenceStart + 2).trim()
        : beforeText.slice(-80).trim();
    }

    // Helper: extract context after a position
    function getContextAfter(position: number, maxLength: number = 150): string {
      const afterText = fullDocText.slice(position, position + maxLength);
      const sentenceEnd = afterText.search(/[.!?]\s/);
      return sentenceEnd >= 0
        ? afterText.slice(0, sentenceEnd + 1).trim()
        : afterText.slice(0, 80).trim();
    }

    // ========================================
    // STEP 2: Collect all start/end markers separately
    // ========================================
    const startPattern = /<w:commentRangeStart[^>]*w:id="(\d+)"[^>]*\/?>/g;
    const endPattern = /<w:commentRangeEnd[^>]*w:id="(\d+)"[^>]*\/?>/g;

    const starts = new Map<string, number>();  // id -> position after start tag
    const ends = new Map<string, number>();    // id -> position before end tag

    let match;
    while ((match = startPattern.exec(docXml)) !== null) {
      const id = match[1];
      if (!starts.has(id)) {
        starts.set(id, match.index + match[0].length);
      }
    }

    while ((match = endPattern.exec(docXml)) !== null) {
      const id = match[1];
      if (!ends.has(id)) {
        ends.set(id, match.index);
      }
    }

    // ========================================
    // STEP 3: Process each comment range by ID
    // ========================================
    for (const [id, startXmlPos] of starts) {
      const endXmlPos = ends.get(id);

      // Missing end marker - skip with warning
      if (endXmlPos === undefined) {
        console.warn(`Comment ${id}: missing end marker`);
        continue;
      }

      // Calculate text position
      const docPosition = xmlPosToTextPos(startXmlPos);

      // Handle empty or inverted ranges
      if (endXmlPos <= startXmlPos) {
        anchors.set(id, {
          anchor: '',
          before: getContextBefore(docPosition),
          after: getContextAfter(docPosition),
          docPosition,
          docLength: fullDocText.length,
          isEmpty: true
        });
        continue;
      }

      // Extract XML segment between markers
      const segment = docXml.slice(startXmlPos, endXmlPos);

      // Extract text from w:t (regular) AND w:delText (deleted text in track changes)
      const textInRangePattern = /<w:t[^>]*>([^<]*)<\/w:t>|<w:delText[^>]*>([^<]*)<\/w:delText>/g;
      let anchorText = '';
      let tm;
      while ((tm = textInRangePattern.exec(segment)) !== null) {
        anchorText += tm[1] || tm[2] || '';
      }
      anchorText = decodeXmlEntities(anchorText);

      // Get context
      const anchorLength = anchorText.length;
      const before = getContextBefore(docPosition);
      const after = getContextAfter(docPosition + anchorLength);

      // ALWAYS add entry (even if anchor is empty)
      anchors.set(id, {
        anchor: anchorText.trim(),
        before,
        after,
        docPosition,
        docLength: fullDocText.length,
        isEmpty: !anchorText.trim()
      });
    }
  } catch (err: any) {
    console.error('Error extracting comment anchors:', err.message);
    return { anchors, fullDocText: '' };
  }

  return { anchors, fullDocText };
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

/**
 * Insert comments into markdown text based on anchor texts with context
 */
export function insertCommentsIntoMarkdown(
  markdown: string,
  comments: WordComment[],
  anchors: Map<string, CommentAnchorData | string>,
  options: InsertCommentsOptions = {}
): string {
  const { quiet = false, sectionBoundary = null } = options;
  let result = markdown;
  let unmatchedCount = 0;
  const duplicateWarnings: string[] = [];
  const usedPositions = new Set<number>(); // For tie-breaking: track used positions

  // Helper: Strip CriticMarkup from text to get "clean" version for matching
  function stripCriticMarkup(text: string): string {
    return text
      .replace(/\{\+\+([^+]*)\+\+\}/g, '$1')  // insertions: keep inserted text
      .replace(/\{--([^-]*)--\}/g, '')         // deletions: remove deleted text
      .replace(/\{~~([^~]*)~>([^~]*)~~\}/g, '$2')  // substitutions: keep new text
      .replace(/\{>>[^<]*<<\}/g, '')           // comments: remove
      .replace(/\[([^\]]*)\]\{\.mark\}/g, '$1'); // marked text: keep text
  }

  // Helper: Find anchor in text with multiple fallback strategies
  function findAnchorInText(anchor: string, text: string, before: string = '', after: string = ''): AnchorSearchResult {
    // If anchor is empty, skip directly to context-based matching
    if (!anchor || anchor.trim().length === 0) {
      // Jump to context-based strategies (Strategy 5)
      if (before || after) {
        const beforeLower = (before || '').toLowerCase();
        const afterLower = (after || '').toLowerCase();
        const textLower = text.toLowerCase();

        if (before && after) {
          const beforeIdx = textLower.indexOf(beforeLower.slice(-50));
          if (beforeIdx !== -1) {
            const searchStart = beforeIdx + beforeLower.slice(-50).length;
            const afterIdx = textLower.indexOf(afterLower.slice(0, 50), searchStart);
            if (afterIdx !== -1 && afterIdx - searchStart < 500) {
              return { occurrences: [searchStart], matchedAnchor: null, strategy: 'context-both' };
            }
          }
        }

        if (before) {
          const beforeIdx = textLower.lastIndexOf(beforeLower.slice(-30));
          if (beforeIdx !== -1) {
            return { occurrences: [beforeIdx + beforeLower.slice(-30).length], matchedAnchor: null, strategy: 'context-before' };
          }
        }

        if (after) {
          const afterIdx = textLower.indexOf(afterLower.slice(0, 30));
          if (afterIdx !== -1) {
            return { occurrences: [afterIdx], matchedAnchor: null, strategy: 'context-after' };
          }
        }
      }
      return { occurrences: [], matchedAnchor: null, strategy: 'empty-anchor' };
    }

    const anchorLower = anchor.toLowerCase();
    const textLower = text.toLowerCase();

    // Strategy 1: Direct match
    let occurrences = findAllOccurrences(textLower, anchorLower);
    if (occurrences.length > 0) {
      return { occurrences, matchedAnchor: anchor, strategy: 'direct' };
    }

    // Strategy 2: Normalized whitespace
    const normalizedAnchor = anchor.replace(/\s+/g, ' ').toLowerCase();
    const normalizedText = text.replace(/\s+/g, ' ').toLowerCase();
    let idx = normalizedText.indexOf(normalizedAnchor);
    if (idx !== -1) {
      return { occurrences: [idx], matchedAnchor: anchor, strategy: 'normalized' };
    }

    // Strategy 3: Try matching in stripped CriticMarkup version
    const strippedText = stripCriticMarkup(text);
    const strippedLower = strippedText.toLowerCase();
    occurrences = findAllOccurrences(strippedLower, anchorLower);
    if (occurrences.length > 0) {
      return { occurrences, matchedAnchor: anchor, strategy: 'stripped', stripped: true };
    }

    // Strategy 4: First N words of anchor (for long anchors)
    const words = anchor.split(/\s+/);
    if (words.length > 3) {
      for (let n = Math.min(6, words.length); n >= 3; n--) {
        const partialAnchor = words.slice(0, n).join(' ').toLowerCase();
        if (partialAnchor.length >= 15) {
          occurrences = findAllOccurrences(textLower, partialAnchor);
          if (occurrences.length > 0) {
            return { occurrences, matchedAnchor: words.slice(0, n).join(' '), strategy: 'partial-start' };
          }
          occurrences = findAllOccurrences(strippedLower, partialAnchor);
          if (occurrences.length > 0) {
            return { occurrences, matchedAnchor: words.slice(0, n).join(' '), strategy: 'partial-start-stripped', stripped: true };
          }
        }
      }
    }

    // Strategy 5: Use context (before/after) to find approximate position
    if (before || after) {
      const beforeLower = before.toLowerCase();
      const afterLower = after.toLowerCase();

      if (before && after) {
        const beforeIdx = textLower.indexOf(beforeLower.slice(-50));
        if (beforeIdx !== -1) {
          const searchStart = beforeIdx + beforeLower.slice(-50).length;
          const afterIdx = textLower.indexOf(afterLower.slice(0, 50), searchStart);
          if (afterIdx !== -1 && afterIdx - searchStart < 500) {
            return { occurrences: [searchStart], matchedAnchor: null, strategy: 'context-both' };
          }
        }
      }

      if (before) {
        const beforeIdx = textLower.lastIndexOf(beforeLower.slice(-30));
        if (beforeIdx !== -1) {
          return { occurrences: [beforeIdx + beforeLower.slice(-30).length], matchedAnchor: null, strategy: 'context-before' };
        }
      }

      if (after) {
        const afterIdx = textLower.indexOf(afterLower.slice(0, 30));
        if (afterIdx !== -1) {
          return { occurrences: [afterIdx], matchedAnchor: null, strategy: 'context-after' };
        }
      }
    }

    // Strategy 6: Try splitting anchor on common transition words
    const splitPatterns = [' ', ', ', '. ', ' - ', ' – '];
    for (const sep of splitPatterns) {
      if (anchor.includes(sep)) {
        const parts = anchor.split(sep).filter(p => p.length >= 4);
        for (const part of parts) {
          const partLower = part.toLowerCase();
          occurrences = findAllOccurrences(textLower, partLower);
          if (occurrences.length > 0 && occurrences.length < 5) {
            return { occurrences, matchedAnchor: part, strategy: 'split-match' };
          }
        }
      }
    }

    return { occurrences: [], matchedAnchor: null, strategy: 'failed' };
  }

  // Helper: Find all occurrences of needle in haystack
  function findAllOccurrences(haystack: string, needle: string): number[] {
    if (!needle || needle.length === 0) {
      return [];
    }
    const occurrences: number[] = [];
    let idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) !== -1) {
      occurrences.push(idx);
      idx += 1;
    }
    return occurrences;
  }

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

        let insertPos = markdownPos;

        // Look for nearby word boundary
        const searchWindow = result.slice(Math.max(0, markdownPos - 25), Math.min(result.length, markdownPos + 25));
        const spaceIdx = searchWindow.indexOf(' ', 25);
        if (spaceIdx !== -1 && spaceIdx < 50) {
          insertPos = Math.max(0, markdownPos - 25) + spaceIdx;
        }

        // If we have anchor text, try to find it near this position
        if (anchor && !isEmpty) {
          const searchStart = Math.max(0, insertPos - 200);
          const searchEnd = Math.min(result.length, insertPos + 200);
          const localSearch = result.slice(searchStart, searchEnd).toLowerCase();
          const anchorLower = anchor.toLowerCase();
          const localIdx = localSearch.indexOf(anchorLower);
          if (localIdx !== -1) {
            return { ...c, pos: searchStart + localIdx, anchorText: anchor, anchorEnd: searchStart + localIdx + anchor.length, strategy: 'position+text' };
          }
          // Try first few words
          const words = anchor.split(/\s+/).slice(0, 4).join(' ').toLowerCase();
          if (words.length >= 10) {
            const partialIdx = localSearch.indexOf(words);
            if (partialIdx !== -1) {
              return { ...c, pos: searchStart + partialIdx, anchorText: words, anchorEnd: searchStart + partialIdx + words.length, strategy: 'position+partial' };
            }
          }
        }

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

    let bestIdx = occurrences.find(p => !usedPositions.has(p)) ?? occurrences[0];
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

    usedPositions.add(bestIdx);

    if (matchedAnchor) {
      return { ...c, pos: bestIdx, anchorText: matchedAnchor, anchorEnd: bestIdx + anchorLen };
    } else {
      return { ...c, pos: bestIdx, anchorText: null };
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

  // Insert each comment with anchor marking
  for (const c of matched) {
    const comment = `{>>${c.author}: ${c.text}<<}`;
    if (c.anchorText && c.anchorEnd) {
      // Replace anchor text with: {>>comment<<}[anchor]{.mark}
      const before = result.slice(0, c.pos);
      const anchor = result.slice(c.pos, c.anchorEnd);
      const after = result.slice(c.anchorEnd);
      result = before + comment + `[${anchor}]{.mark}` + after;
    } else {
      // No anchor - just insert comment at position
      result = result.slice(0, c.pos) + ` ${comment}` + result.slice(c.pos);
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
 * Fix citation and math annotations by preserving original markdown syntax
 */
function fixCitationAnnotations(text: string, originalMd: string): string {
  // Fix math annotations - preserve inline and display math
  text = text.replace(/\{--(\$[^$]+\$)--\}/g, '$1');
  text = text.replace(/\{--(\$\$[^$]+\$\$)--\}/g, '$1');

  text = text.replace(/\{~~(\$[^$]+\$)~>[^~]+~~\}/g, '$1');
  text = text.replace(/\{~~(\$\$[^$]+\$\$)~>[^~]+~~\}/g, '$1');

  // Extract all citations from original markdown
  const citationPattern = /\[@[^\]]+\]/g;
  const originalCitations = [...originalMd.matchAll(citationPattern)].map(m => m[0]);

  // Fix substitutions where left side has markdown citation
  text = text.replace(/\{~~(\[@[^\]]+\])~>[^~]+~~\}/g, '$1');

  // Fix substitutions where left side STARTS with markdown citation
  text = text.replace(/\{~~(\[@[^\]]+\])\s*([^~]*)~>([^~]*)~~\}/g, (match, cite, oldText, newText) => {
    if (oldText.trim() === '' && newText.trim() === '') {
      return cite;
    }
    if (oldText.trim() || newText.trim()) {
      return cite + (oldText.trim() !== newText.trim() ? ` {~~${oldText.trim()}~>${newText.trim()}~~}` : ` ${newText}`);
    }
    return cite;
  });

  // Fix deletions of markdown citations
  text = text.replace(/\{--(\[@[^\]]+\])--\}/g, '$1');

  // Fix insertions of rendered citations
  text = text.replace(/\{\+\+\([A-Z][^)]*\d{4}[^)]*\)\+\+\}/g, '');

  // Clean up broken multi-part substitutions
  text = text.replace(/\{~~(@[A-Za-z]+\d{4})~>[^~]+~~\}/g, '[$1]');

  // Fix citations split across substitution boundaries
  text = text.replace(/\{~~\[@~>[^~]*~~\}([A-Za-z]+\d{4})\]/g, '[@$1]');

  // Clean up any remaining partial citations
  text = text.replace(/\{~~;\s*@([A-Za-z]+\d{4})\]~>[^~]*~~\}/g, '; [@$1]');

  // Remove rendered citation insertions (with Unicode support)
  text = text.replace(/\{\+\+\(\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)\+\+\}/gu, '');
  text = text.replace(/\{\+\+\(\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)\.\s*\+\+\}/gu, '');

  // Trailing citation fragments
  text = text.replace(/\{\+\+\d{4}[a-z]?(?:[;,]\s*(?:\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+)?\d{4}[a-z]?)*\)\.\s*\+\+\}/gu, '');
  text = text.replace(/\{\+\+\d{4}[a-z]?(?:[;,]\s*(?:\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+)?\d{4}[a-z]?)*\)\s*\+\+\}/gu, '');

  // Just year with closing paren
  text = text.replace(/\{\+\+\d{4}[a-z]?\)\.\s*\+\+\}/g, '');
  text = text.replace(/\{\+\+\d{4}[a-z]?\)\s*\+\+\}/g, '');

  // Leading citation fragments
  text = text.replace(/\{\+\+\(?\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s*\+\+\}/gu, '');

  // Semicolon-separated fragments
  text = text.replace(/\{\+\+[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?\+\+\}/gu, '');

  // Year ranges with authors
  text = text.replace(/\{\+\+\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)\s*\+\+\}/gu, '');
  text = text.replace(/\{\+\+\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)\.\s*\+\+\}/gu, '');

  // Clean up double spaces and orphaned punctuation
  text = text.replace(/  +/g, ' ');
  text = text.replace(/\s+\./g, '.');
  text = text.replace(/\s+,/g, ',');

  // Final cleanup - remove empty annotations
  text = text.replace(/\{~~\s*~>\s*~~\}/g, '');
  text = text.replace(/\{\+\+\s*\+\+\}/g, '');
  text = text.replace(/\{--\s*--\}/g, '');

  return text;
}

/**
 * Strip markdown syntax to get plain text
 */
function stripMarkdownSyntax(md: string): string {
  return md
    .replace(/^---[\s\S]*?---\n*/m, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^>\s*/gm, '')
    .replace(/^[-*_]{3,}\s*$/gm, '')
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    .replace(/\|/g, ' ')
    .replace(/^[-:]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Generate annotated markdown by diffing original MD against Word text
 */
export function generateAnnotatedDiff(originalMd: string, wordText: string, author: string = 'Reviewer'): string {
  const normalizedOriginal = normalizeWhitespace(originalMd);
  const normalizedWord = normalizeWhitespace(wordText);

  const changes = diffWords(normalizedOriginal, normalizedWord);

  let result = '';

  for (const part of changes) {
    if (part.added) {
      result += `{++${part.value}++}`;
    } else if (part.removed) {
      result += `{--${part.value}--}`;
    } else {
      result += part.value;
    }
  }

  return result;
}

/**
 * Inject Word tables (extracted from XML) into pandoc text output
 */
function injectWordTables(pandocText: string, wordTables: WordTable[]): string {
  if (!wordTables || wordTables.length === 0) {
    return pandocText;
  }

  let result = pandocText;

  for (const table of wordTables) {
    const firstLine = table.markdown.split('\n')[0];
    const headerCells = firstLine
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (headerCells.length === 0) continue;

    const firstCell = headerCells[0];
    const startIdx = result.indexOf(firstCell);

    if (startIdx === -1) continue;

    const lastLine = table.markdown.split('\n').pop();
    const lastCells = lastLine!
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    const lastCell = lastCells[lastCells.length - 1] || lastCells[0];

    const endIdx = result.indexOf(lastCell, startIdx);
    if (endIdx === -1) continue;

    let regionStart = result.lastIndexOf('\n\n', startIdx);
    if (regionStart === -1) regionStart = 0;
    else regionStart += 2;

    let regionEnd = result.indexOf('\n\n', endIdx + lastCell.length);
    if (regionEnd === -1) regionEnd = result.length;

    result = result.slice(0, regionStart) + table.markdown + '\n\n' + result.slice(regionEnd);
  }

  return result;
}

/**
 * Smart paragraph-level diff that preserves markdown structure
 */
export function generateSmartDiff(
  originalMd: string,
  wordText: string,
  author: string = 'Reviewer',
  options: GenerateSmartDiffOptions = {}
): string {
  const { wordTables = [], imageRegistry = null } = options;

  // Inject Word tables into pandoc output
  let wordTextWithTables = injectWordTables(wordText, wordTables);

  // Protect markdown tables
  const { text: mdWithTablesProtected, tables } = protectTables(originalMd);

  // Also protect tables in Word text
  const { text: wordWithTablesProtected, tables: wordTableBlocks } = protectTables(wordTextWithTables);

  // Protect images
  const { text: mdWithImagesProtected, images: origImages } = protectImages(mdWithTablesProtected, imageRegistry);

  const { text: wordWithImagesProtected, images: wordImages } = protectImages(wordWithTablesProtected, imageRegistry);

  // Match Word images to original images
  const imageMapping = matchWordImagesToOriginal(origImages, wordImages, imageRegistry);

  // Replace Word image placeholders with matching original placeholders
  let wordWithMappedImages = wordWithImagesProtected;
  for (const [wordPlaceholder, origPlaceholder] of imageMapping) {
    wordWithMappedImages = wordWithMappedImages.split(wordPlaceholder).join(origPlaceholder);
  }

  // Protect figure/table anchors
  const { text: mdWithAnchorsProtected, anchors: figAnchors } = protectAnchors(mdWithImagesProtected);

  // Protect cross-references
  const { text: mdWithXrefsProtected, crossrefs } = protectCrossrefs(mdWithAnchorsProtected);

  // Protect math
  const { text: mdWithMathProtected, mathBlocks } = protectMath(mdWithXrefsProtected);

  // Protect citations
  const { text: mdProtected, citations } = protectCitations(mdWithMathProtected);

  // Replace rendered elements in Word text
  let wordProtected = wordWithMappedImages;
  wordProtected = replaceRenderedMath(wordProtected, mathBlocks);
  wordProtected = replaceRenderedCitations(wordProtected, citations.length);

  // Split into paragraphs
  const originalParas = mdProtected.split(/\n\n+/);
  const wordParas = wordProtected.split(/\n\n+/);

  const result: string[] = [];

  // Try to match paragraphs intelligently
  let wordIdx = 0;

  for (let i = 0; i < originalParas.length; i++) {
    const orig = originalParas[i] || '';
    const { prefix: mdPrefix, content: origContent } = extractMarkdownPrefix(orig.split('\n')[0]);

    // Find best matching word paragraph
    let bestMatch = -1;
    let bestScore = 0;

    for (let j = wordIdx; j < Math.min(wordIdx + 3, wordParas.length); j++) {
      const wordPara = wordParas[j] || '';
      const origWords = new Set(origContent.toLowerCase().split(/\s+/));
      const wordWords = wordPara.toLowerCase().split(/\s+/);
      const common = wordWords.filter((w) => origWords.has(w)).length;
      const score = common / Math.max(origWords.size, wordWords.length);

      if (score > bestScore && score > 0.3) {
        bestScore = score;
        bestMatch = j;
      }
    }

    if (bestMatch === -1) {
      if (mdPrefix && wordIdx < wordParas.length) {
        const wordPara = wordParas[wordIdx];
        if (wordPara.toLowerCase().includes(origContent.toLowerCase().slice(0, 20))) {
          bestMatch = wordIdx;
        }
      }
    }

    if (bestMatch >= 0) {
      const word = wordParas[bestMatch];

      const origStripped = stripMarkdownSyntax(orig);
      const wordNormalized = normalizeWhitespace(word);

      if (origStripped === wordNormalized) {
        result.push(orig);
      } else {
        const changes = diffWords(origStripped, wordNormalized);
        let annotated = mdPrefix;

        for (const part of changes) {
          if (part.added) {
            annotated += `{++${part.value}++}`;
          } else if (part.removed) {
            annotated += `{--${part.value}--}`;
          } else {
            annotated += part.value;
          }
        }

        result.push(annotated);
      }

      wordIdx = bestMatch + 1;
    } else {
      // Paragraph deleted entirely
      if (mdPrefix && mdPrefix.match(/^#{1,6}\s+/)) {
        result.push(orig);
      } else {
        result.push(`{--${orig}--}`);
      }
    }
  }

  // Any remaining word paragraphs are additions
  for (let j = wordIdx; j < wordParas.length; j++) {
    const word = wordParas[j];
    if (word.trim()) {
      result.push(`{++${word}++}`);
    }
  }

  // Restore protected content
  let finalResult = result.join('\n\n');
  finalResult = restoreCitations(finalResult, citations);
  finalResult = restoreMath(finalResult, mathBlocks);
  finalResult = restoreCrossrefs(finalResult, crossrefs);
  finalResult = restoreAnchors(finalResult, figAnchors);
  finalResult = restoreImages(finalResult, origImages);
  finalResult = restoreImages(finalResult, wordImages);
  finalResult = restoreTables(finalResult, tables);
  finalResult = restoreTables(finalResult, wordTableBlocks);

  return finalResult;
}

/**
 * Clean up redundant adjacent annotations
 */
export function cleanupAnnotations(text: string): string {
  // Convert adjacent delete+insert to substitution
  text = text.replace(/\{--(.+?)--\}\s*\{\+\+(.+?)\+\+\}/g, '{~~$1~>$2~~}');

  // Also handle insert+delete
  text = text.replace(/\{\+\+(.+?)\+\+\}\s*\{--(.+?)--\}/g, '{~~$2~>$1~~}');

  // Fix malformed patterns
  text = text.replace(/\{--([^}]+?)~>([^}]+?)~~\}/g, '{~~$1~>$2~~}');

  // Fix malformed substitutions that got split
  text = text.replace(/\{~~([^~]+)\s*--\}/g, '{--$1--}');
  text = text.replace(/\{\+\+([^+]+)~~\}/g, '{++$1++}');

  // Clean up empty annotations
  text = text.replace(/\{--\s*--\}/g, '');
  text = text.replace(/\{\+\+\s*\+\+\}/g, '');

  // Clean up double spaces in prose, but preserve table formatting
  const lines = text.split('\n');
  let inTable = false;

  const processedLines = lines.map((line, idx) => {
    const isSeparator = /^[-]+(\s+[-]+)+\s*$/.test(line.trim());

    const looksLikeTableRow = /\S+\s{2,}\S+/.test(line);

    if (isSeparator) {
      if (!inTable) {
        inTable = true;
      }
      return line;
    }

    if (inTable) {
      if (line.trim() === '') {
        let lookAhead = idx + 1;
        let foundTableContent = false;
        let foundEndSeparator = false;

        while (lookAhead < lines.length && lookAhead < idx + 20) {
          const nextLine = lines[lookAhead].trim();

          if (nextLine === '') {
            lookAhead++;
            continue;
          }

          if (/^[-]+(\s+[-]+)+\s*$/.test(nextLine)) {
            foundEndSeparator = true;
            break;
          }

          if (/\S+\s{2,}\S+/.test(nextLine)) {
            foundTableContent = true;
            break;
          }

          if (/^\*[^*]+\*\s*$/.test(nextLine)) {
            foundTableContent = true;
            break;
          }

          if (lines[lookAhead].startsWith('  ')) {
            lookAhead++;
            continue;
          }

          break;
        }

        if (foundTableContent || foundEndSeparator) {
          return line;
        }

        inTable = false;
        return line;
      }

      return line;
    }

    if (looksLikeTableRow) {
      let nextIdx = idx + 1;
      while (nextIdx < lines.length && lines[nextIdx].trim() === '') {
        nextIdx++;
      }
      if (nextIdx < lines.length && /^[-]+(\s+[-]+)+\s*$/.test(lines[nextIdx].trim())) {
        return line;
      }
    }

    if (line.trim().startsWith('|')) {
      return line;
    }

    return line.replace(/  +/g, ' ');
  });
  text = processedLines.join('\n');

  return text;
}

/**
 * Parse visible comment markers from Word text
 */
export function parseVisibleComments(text: string): Array<{ author: string; text: string; position: number }> {
  const comments: Array<{ author: string; text: string; position: number }> = [];
  const pattern = /\[([^\]:]+):\s*([^\]]+)\]/g;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    comments.push({
      author: match[1].trim(),
      text: match[2].trim(),
      position: match.index,
    });
  }

  return comments;
}

/**
 * Convert visible comments to CriticMarkup format
 */
export function convertVisibleComments(text: string): string {
  return text.replace(/\[([^\]:]+):\s*([^\]]+)\]/g, '{>>$1: $2<<}');
}

/**
 * Restore pandoc-crossref figure/table references from Word-rendered format
 */
export function restoreCrossrefFromWord(
  text: string,
  projectDir: string,
  restoredLabels: Set<string> | null = null
): RestoreCrossrefResult {
  const messages: string[] = [];
  let restored = 0;
  let result = text;

  const registry = readImageRegistry(projectDir);

  if (!restoredLabels) {
    restoredLabels = new Set<string>();
  }

  // Pattern 1: [Figure]{.mark} [N]{.mark}
  result = result.replace(/\[(Figure|Table|Fig\.?)\]\{\.mark\}\s*\[(\d+|S\d+)\]\{\.mark\}/gi, (match, type, num) => {
    const prefix = type.toLowerCase().startsWith('tab') ? 'tbl' : 'fig';
    if (registry) {
      const entry = registry.byNumber?.get(`${prefix}:${num}`);
      if (entry && entry.label) {
        restored++;
        return `@${prefix}:${entry.label}`;
      }
    }
    restored++;
    messages.push(`Restored ${type} ${num} (no label found, using placeholder)`);
    return `@${prefix}:fig${num}`;
  });

  // Pattern 2: Plain "Figure N" or "Fig. N"
  result = result.replace(/(?<!!)\b(Figure|Fig\.?|Table|Tbl\.?)\s+(\d+|S\d+)\b(?!\s*:)/gi, (match, type, num) => {
    const prefix = type.toLowerCase().startsWith('tab') ? 'tbl' : 'fig';
    if (registry) {
      const entry = registry.byNumber?.get(`${prefix}:${num}`);
      if (entry && entry.label) {
        restored++;
        return `@${prefix}:${entry.label}`;
      }
    }
    return match;
  });

  // Pattern 3: Remove duplicate plain-text captions
  result = result.replace(/(\!\[[^\]]+\]\([^)]+\)(?:\{[^}]*\})?)\s*\n+\s*(?:Figure|Fig\.?|Table|Tbl\.?)\s+\d+[:\.]?\s*[^\n]+/gi, '$1');

  // Pattern 4: Clean up image captions that start with "Figure N: "
  result = result.replace(/!\[(Figure|Fig\.?|Table|Tbl\.?)\s+(\d+|S\d+)[:\.]?\s*([^\]]*)\]\(([^)]+)\)(?:\{[^}]*\})?/gi,
    (match, type, num, caption, imgPath) => {
      const prefix = type.toLowerCase().startsWith('tab') ? 'tbl' : 'fig';
      const labelKey = `${prefix}:${num}`;

      if (registry) {
        const entry = registry.byNumber?.get(labelKey);
        if (entry) {
          if (restoredLabels!.has(labelKey)) {
            messages.push(`Skipped duplicate ${prefix}:${entry.label} (already restored)`);
            return `![${entry.caption}](${entry.path})`;
          }
          restoredLabels!.add(labelKey);
          restored++;
          messages.push(`Restored image ${prefix}:${entry.label} from Figure ${num}`);
          return `![${entry.caption}](${entry.path}){#${prefix}:${entry.label}}`;
        }
      }
      const cleanCaption = caption.trim();
      return `![${cleanCaption}](${imgPath})`;
    });

  return { text: result, restored, messages, restoredLabels };
}

/**
 * Restore proper markdown image syntax from Word-extracted text using image registry
 */
export function restoreImagesFromRegistry(
  text: string,
  projectDir: string,
  restoredLabels: Set<string> | null = null
): RestoreImagesResult {
  const messages: string[] = [];
  let restored = 0;

  const registry = readImageRegistry(projectDir);
  if (!registry || !registry.figures || registry.figures.length === 0) {
    return { text, restored: 0, messages: ['No image registry found'] };
  }

  if (!restoredLabels) {
    restoredLabels = new Set<string>();
  }

  let result = text;

  // Pattern 1: Caption-like text
  const captionPatterns = [
    /@(fig|tbl):([a-zA-Z0-9_-]+):\s*([^\n]+)/gi,
    /^(Figure|Fig\.?)\s+(\d+|S\d+)[.:]\s*([^\n]+)/gim,
    /\|\s*@(fig|tbl):([a-zA-Z0-9_-]+):\s*([^|]+)\s*\|/gi,
  ];

  // Fix @fig:label: caption patterns
  result = result.replace(captionPatterns[0], (match, type, label, caption) => {
    const key = `${type}:${label}`;
    const entry = registry.byLabel.get(key);
    if (entry) {
      if (restoredLabels!.has(key)) {
        messages.push(`Skipped duplicate ${key} (already restored)`);
        return `![${entry.caption}](${entry.path})`;
      }
      restoredLabels!.add(key);
      restored++;
      messages.push(`Restored ${type}:${label} from registry`);
      return `![${entry.caption}](${entry.path}){#${type}:${label}}`;
    }
    return match;
  });

  // Fix table-wrapped captions
  result = result.replace(captionPatterns[2], (match, type, label, caption) => {
    const key = `${type}:${label}`;
    const entry = registry.byLabel.get(key);
    if (entry) {
      if (restoredLabels!.has(key)) {
        messages.push(`Skipped duplicate ${key} from table wrapper`);
        return `![${entry.caption}](${entry.path})`;
      }
      restoredLabels!.add(key);
      restored++;
      messages.push(`Restored ${type}:${label} from table wrapper`);
      return `![${entry.caption}](${entry.path}){#${type}:${label}}`;
    }
    return match;
  });

  // Clean up empty table structures
  result = result.replace(/\|\s*\|\s*\n\|:--:\|\s*\n/g, '');

  // Fix "Figure N:" standalone lines
  result = result.replace(captionPatterns[1], (match, prefix, num, caption) => {
    const numKey = `fig:${num}`;
    const entry = registry.byNumber.get(numKey);
    if (entry) {
      const labelKey = `fig:${entry.label}`;
      if (restoredLabels!.has(labelKey)) {
        messages.push(`Skipped duplicate Figure ${num} (already restored)`);
        return `![${entry.caption}](${entry.path})`;
      }
      restoredLabels!.add(labelKey);
      restored++;
      messages.push(`Restored Figure ${num} by number lookup`);
      return `![${entry.caption}](${entry.path}){#fig:${entry.label}}`;
    }
    return match;
  });

  // Fix generic media paths by matching caption text
  const genericImagePattern = /!\[([^\]]*)\]\(media\/[^)]+\)/g;
  result = result.replace(genericImagePattern, (match, caption) => {
    if (!caption || caption.trim() === '') {
      return match;
    }

    const captionKey = caption.slice(0, 50).toLowerCase().trim();
    const entry = registry.byCaption.get(captionKey);
    if (entry) {
      const labelKey = entry.label ? `${entry.type}:${entry.label}` : null;
      if (labelKey && restoredLabels!.has(labelKey)) {
        messages.push(`Skipped duplicate by caption match: ${captionKey.slice(0, 30)}...`);
        return `![${entry.caption}](${entry.path})`;
      }
      if (labelKey) {
        restoredLabels!.add(labelKey);
      }
      restored++;
      messages.push(`Restored image by caption match: ${captionKey.slice(0, 30)}...`);
      const anchor = (entry.label && !restoredLabels!.has(labelKey!)) ? `{#${entry.type}:${entry.label}}` : '';
      return `![${entry.caption}](${entry.path})${anchor}`;
    }
    return match;
  });

  return { text: result, restored, messages };
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
