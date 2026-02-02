/**
 * Import functionality - convert Word docs to annotated Markdown
 */

import * as fs from 'fs';
import * as path from 'path';
import { diffWords } from 'diff';
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

const execAsync = promisify(exec);

/**
 * Extract comments directly from Word docx comments.xml
 * @param {string} docxPath
 * @returns {Promise<Array<{id: string, author: string, date: string, text: string}>>}
 */
export async function extractWordComments(docxPath) {
  const AdmZip = (await import('adm-zip')).default;
  const { parseStringPromise } = await import('xml2js');

  const comments = [];

  // Validate file exists
  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }

  try {
    let zip;
    try {
      zip = new AdmZip(docxPath);
    } catch (err) {
      throw new Error(`Invalid Word document (not a valid .docx file): ${err.message}`);
    }

    const commentsEntry = zip.getEntry('word/comments.xml');

    if (!commentsEntry) {
      return comments;
    }

    let commentsXml;
    try {
      commentsXml = commentsEntry.getData().toString('utf8');
    } catch (err) {
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
      const extractText = (node) => {
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
  } catch (err) {
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
 *
 * Uses separate start/end marker collection instead of regex pairing to handle:
 * - Nested comment ranges (parent contains child)
 * - Interleaved comment ranges
 * - Comments on deleted text (w:del sections)
 * - Point comments with empty selection
 *
 * @param {string} docxPath
 * @returns {Promise<{anchors: Map, fullDocText: string}>}
 */
export async function extractCommentAnchors(docxPath) {
  const AdmZip = (await import('adm-zip')).default;
  const anchors = new Map();
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
    const textNodes = [];
    let textPosition = 0;
    let nodeMatch;

    while ((nodeMatch = textNodePattern.exec(docXml)) !== null) {
      const rawText = nodeMatch[1];
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
    function xmlPosToTextPos(xmlPos) {
      for (let i = 0; i < textNodes.length; i++) {
        const node = textNodes[i];
        if (xmlPos >= node.xmlStart && xmlPos < node.xmlEnd) {
          return node.textStart;
        }
        if (xmlPos < node.xmlStart) {
          return node.textStart;
        }
      }
      return textNodes.length > 0 ? textNodes[textNodes.length - 1].textEnd : 0;
    }

    // Helper: extract context before a position
    function getContextBefore(position, maxLength = 150) {
      const beforeText = fullDocText.slice(Math.max(0, position - maxLength), position);
      const sentenceStart = beforeText.search(/[.!?]\s+[A-Z][^.!?]*$/);
      return sentenceStart >= 0
        ? beforeText.slice(sentenceStart + 2).trim()
        : beforeText.slice(-80).trim();
    }

    // Helper: extract context after a position
    function getContextAfter(position, maxLength = 150) {
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

    const starts = new Map();  // id -> position after start tag
    const ends = new Map();    // id -> position before end tag

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
  } catch (err) {
    console.error('Error extracting comment anchors:', err.message);
    return { anchors, fullDocText: '' };
  }

  return { anchors, fullDocText };
}

/**
 * Decode XML entities in text
 * @param {string} text
 * @returns {string}
 */
function decodeXmlEntities(text) {
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
 * Extract text content from a Word XML cell, handling:
 * - Regular text (w:t)
 * - Math equations (m:oMath) - converted to placeholder
 * - Multiple paragraphs within cell
 * @param {string} cellXml
 * @returns {string}
 */
function extractCellText(cellXml) {
  const parts = [];

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
 * @param {string} rowXml
 * @param {number} expectedCols - Expected column count (from grid or previous rows)
 * @returns {{cells: string[], colSpans: number[]}}
 */
function parseTableRow(rowXml, expectedCols) {
  // Match cells - handle both <w:tc> and <w:tc ...>
  const cellMatches = rowXml.match(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g) || [];
  const cells = [];
  const colSpans = [];

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
 * @param {string} tableXml
 * @returns {number}
 */
function getTableGridCols(tableXml) {
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
 * Handles: merged cells (gridSpan, vMerge), math, special characters, empty cells
 * @param {string} docxPath
 * @returns {Promise<Array<{markdown: string, rowCount: number, colCount: number}>>}
 */
export async function extractWordTables(docxPath) {
  const AdmZip = (await import('adm-zip')).default;
  const tables = [];

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
      const rows = [];

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
  } catch (err) {
    console.error('Error extracting tables from Word:', err.message);
  }

  return tables;
}

/**
 * Convert array of rows (each row is array of cell strings) to markdown pipe table
 * @param {string[][]} rows
 * @returns {string}
 */
function convertRowsToMarkdownTable(rows) {
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
  const lines = [];

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
 * Uses --track-changes=all to preserve insertions/deletions as CriticMarkup
 * Falls back to mammoth if pandoc fails
 * @param {string} docxPath
 * @param {object} options - { mediaDir: string } - Directory to extract images to
 * @returns {Promise<{text: string, comments: Array, anchors: Map, extractedMedia: string[], tables: Array, hasTrackChanges: boolean, trackChangeStats: object}>}
 */
export async function extractFromWord(docxPath, options = {}) {
  let text;
  let messages = [];
  let extractedMedia = [];
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
  // This outputs insertions as [text]{.insertion} and deletions as [text]{.deletion}
  try {
    // Build pandoc command
    // Use --track-changes=all to preserve track changes
    // Only use --extract-media if we need to extract images
    let pandocCmd = `pandoc "${docxPath}" -t markdown --wrap=none --track-changes=all`;
    if (!skipMediaExtraction) {
      pandocCmd += ` --extract-media="${mediaDir}"`;
    }

    const { stdout } = await execAsync(pandocCmd, { maxBuffer: 50 * 1024 * 1024 });
    text = stdout;

    // Convert pandoc's track change format to CriticMarkup
    // Insertions: [text]{.insertion author="..."} -> {++text++}
    // Deletions: [text]{.deletion author="..."} -> {--text--}
    // Note: Content may contain nested brackets, so we need to handle them carefully
    const origLength = text.length;

    // Use a more robust pattern that handles nested content
    // Match [...]{.insertion ...} where content can have nested brackets
    // Also handle empty brackets [] and single-char content like [;]
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

    // Handle any remaining pandoc track change patterns that slipped through
    // This catches edge cases like escaped brackets, multiline content, etc.
    // Process multiple times until no more changes
    let prevText;
    do {
      prevText = text;
      // Match even empty brackets or single chars
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

    // Handle pandoc comment patterns: [anchor]{.comment-start id="N" author="..." date="..."}
    // These are inline comments attached to anchor text
    // Convert to CriticMarkup: {>>author: extracted comment text from comments<<}[anchor]{.mark}
    // Note: The actual comment text is in comments.xml, extracted separately
    // For now, we just clean up these patterns since comments are handled via extractWordComments
    text = text.replace(/\[([^\]]*)\]\{\.comment-start[^}]*author="([^"]*)"[^}]*\}/g, (match, anchor, author) => {
      // Keep the anchor text, the actual comment is inserted from comments.xml later
      return anchor;
    });
    text = text.replace(/\[\]\{\.comment-end[^}]*\}/g, '');

    // Also handle {.mark} spans that pandoc uses for tracking
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
  } catch (pandocErr) {
    // Fall back to mammoth if pandoc fails
    messages.push({ type: 'warning', message: 'Pandoc failed, using mammoth (equations and images may not be preserved)' });
    const mammoth = await import('mammoth');
    const textResult = await mammoth.extractRawText({ path: docxPath });
    const htmlResult = await mammoth.convertToHtml({ path: docxPath });
    text = textResult.value;
    messages = [...textResult.messages, ...htmlResult.messages];
  }

  // Extract comments directly from docx XML
  const comments = await extractWordComments(docxPath);

  // Extract comment anchor texts
  const anchors = await extractCommentAnchors(docxPath);

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
 * Uses sentence context for disambiguation and tie-breaks for duplicates
 * @param {string} markdown - The markdown text
 * @param {Array} comments - Array of {id, author, text}
 * @param {Map} anchors - Map of comment id -> {anchor, before, after} or string (legacy)
 * @param {object} options - Options {quiet: boolean}
 * @returns {string} - Markdown with comments inserted
 */
export function insertCommentsIntoMarkdown(markdown, comments, anchors, options = {}) {
  const { quiet = false, sectionBoundary = null } = options;
  let result = markdown;
  let unmatchedCount = 0;
  const duplicateWarnings = [];
  const usedPositions = new Set(); // For tie-breaking: track used positions

  // Helper: Strip CriticMarkup from text to get "clean" version for matching
  // This helps when anchor contains text that's been marked as insertion/deletion
  function stripCriticMarkup(text) {
    return text
      .replace(/\{\+\+([^+]*)\+\+\}/g, '$1')  // insertions: keep inserted text
      .replace(/\{--([^-]*)--\}/g, '')         // deletions: remove deleted text
      .replace(/\{~~([^~]*)~>([^~]*)~~\}/g, '$2')  // substitutions: keep new text
      .replace(/\{>>[^<]*<<\}/g, '')           // comments: remove
      .replace(/\[([^\]]*)\]\{\.mark\}/g, '$1'); // marked text: keep text
  }

  // Helper: Find anchor in text with multiple fallback strategies
  function findAnchorInText(anchor, text, before = '', after = '') {
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
      // Map position back to original text (approximate)
      return { occurrences, matchedAnchor: anchor, strategy: 'stripped', stripped: true };
    }

    // Strategy 4: First N words of anchor (for long anchors)
    const words = anchor.split(/\s+/);
    if (words.length > 3) {
      for (let n = Math.min(6, words.length); n >= 3; n--) {
        const partialAnchor = words.slice(0, n).join(' ').toLowerCase();
        if (partialAnchor.length >= 15) {  // At least 15 chars
          occurrences = findAllOccurrences(textLower, partialAnchor);
          if (occurrences.length > 0) {
            return { occurrences, matchedAnchor: words.slice(0, n).join(' '), strategy: 'partial-start' };
          }
          // Also try in stripped version
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

      // Try to find context in the text
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
        // Find the last occurrence of before context
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

    // Strategy 6: Try splitting anchor on common transition words and matching parts
    // This handles cases like "neophyte alien" where old and new text are concatenated
    const splitPatterns = [' ', ', ', '. ', ' - ', ' – '];
    for (const sep of splitPatterns) {
      if (anchor.includes(sep)) {
        const parts = anchor.split(sep).filter(p => p.length >= 4);
        for (const part of parts) {
          const partLower = part.toLowerCase();
          occurrences = findAllOccurrences(textLower, partLower);
          if (occurrences.length > 0 && occurrences.length < 5) {  // Avoid too common terms
            return { occurrences, matchedAnchor: part, strategy: 'split-match' };
          }
        }
      }
    }

    return { occurrences: [], matchedAnchor: null, strategy: 'failed' };
  }

  // Helper: Find all occurrences of needle in haystack
  function findAllOccurrences(haystack, needle) {
    // Prevent infinite loop on empty needle
    if (!needle || needle.length === 0) {
      return [];
    }
    const occurrences = [];
    let idx = 0;
    while ((idx = haystack.indexOf(needle, idx)) !== -1) {
      occurrences.push(idx);
      idx += 1;
    }
    return occurrences;
  }

  // Get all positions in order (for sequential tie-breaking)
  const commentsWithPositions = comments.map((c) => {
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

    // ========================================
    // STRATEGY 0: Position-based insertion (most reliable)
    // Use the exact position from Word XML when section boundary is available
    // ========================================
    if (sectionBoundary && docPosition !== undefined) {
      const sectionLength = sectionBoundary.end - sectionBoundary.start;
      if (sectionLength > 0) {
        // Calculate relative position within section
        let relativePos;
        if (docPosition < sectionBoundary.start) {
          // Comment is before section start (e.g., "outside" comments placed in first section)
          relativePos = 0;
        } else {
          relativePos = docPosition - sectionBoundary.start;
        }

        // Map to markdown position using proportion
        const proportion = Math.min(relativePos / sectionLength, 1.0);
        const markdownPos = Math.floor(proportion * result.length);

        // Find a good insertion point (end of word/sentence nearby)
        let insertPos = markdownPos;

        // Look for nearby word boundary (within 50 chars)
        const searchWindow = result.slice(Math.max(0, markdownPos - 25), Math.min(result.length, markdownPos + 25));
        const spaceIdx = searchWindow.indexOf(' ', 25);
        if (spaceIdx !== -1 && spaceIdx < 50) {
          insertPos = Math.max(0, markdownPos - 25) + spaceIdx;
        }

        // If we have anchor text, still try to find it near this position for marking
        if (anchor && !isEmpty) {
          const searchStart = Math.max(0, insertPos - 200);
          const searchEnd = Math.min(result.length, insertPos + 200);
          const localSearch = result.slice(searchStart, searchEnd).toLowerCase();
          const anchorLower = anchor.toLowerCase();
          const localIdx = localSearch.indexOf(anchorLower);
          if (localIdx !== -1) {
            // Found anchor near calculated position - use exact position
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

        // Use position-only (no anchor marking)
        return { ...c, pos: insertPos, anchorText: null, strategy: 'position-only' };
      }
    }

    // Handle empty anchors - use position-based matching with context
    if (!anchor || isEmpty) {
      // Try to find position using context (before/after text)
      if (before || after) {
        const { occurrences } = findAnchorInText('', result, before, after);
        if (occurrences.length > 0) {
          return { ...c, pos: occurrences[0], anchorText: null, isEmpty: true };
        }
      }
      unmatchedCount++;
      return { ...c, pos: -1, anchorText: null, isEmpty: true };
    }

    // ========================================
    // FALLBACK: Text-based matching strategies
    // ========================================
    const { occurrences, matchedAnchor, strategy, stripped } = findAnchorInText(anchor, result, before, after);

    if (occurrences.length === 0) {
      unmatchedCount++;
      return { ...c, pos: -1, anchorText: null };
    }

    // Use the matchedAnchor (which may be partial) for positioning
    const anchorLen = matchedAnchor ? matchedAnchor.length : 0;

    if (occurrences.length === 1) {
      // Unique match - easy case
      // Position at START of anchor (comment goes before, anchor gets marked)
      if (matchedAnchor) {
        return { ...c, pos: occurrences[0], anchorText: matchedAnchor, anchorEnd: occurrences[0] + anchorLen };
      } else {
        // Context-based match - no anchor text to mark
        return { ...c, pos: occurrences[0], anchorText: null };
      }
    }

    // Multiple occurrences - use context for disambiguation
    if (matchedAnchor) {
      duplicateWarnings.push(`"${matchedAnchor.slice(0, 40)}${matchedAnchor.length > 40 ? '...' : ''}" appears ${occurrences.length} times`);
    }

    // Score each occurrence based on context match
    // Initialize to first UNUSED occurrence (for tie-break correctness)
    let bestIdx = occurrences.find(p => !usedPositions.has(p)) ?? occurrences[0];
    let bestScore = -1; // Start at -1 so first valid candidate wins

    for (const pos of occurrences) {
      // Skip positions already used by previous comments
      if (usedPositions.has(pos)) continue;

      let score = 0;

      // Check context before
      if (before) {
        const contextBefore = result.slice(Math.max(0, pos - before.length - 20), pos).toLowerCase();
        const beforeLower = before.toLowerCase();
        // Check if context contains parts of 'before'
        const beforeWords = beforeLower.split(/\s+/).filter(w => w.length > 3);
        for (const word of beforeWords) {
          if (contextBefore.includes(word)) score += 2;
        }
        // Bonus for full match
        if (contextBefore.includes(beforeLower.slice(-30))) score += 5;
      }

      // Check context after
      if (after) {
        const contextAfter = result.slice(pos + anchorLen, pos + anchorLen + after.length + 20).toLowerCase();
        const afterLower = after.toLowerCase();
        // Check if context contains parts of 'after'
        const afterWords = afterLower.split(/\s+/).filter(w => w.length > 3);
        for (const word of afterWords) {
          if (contextAfter.includes(word)) score += 2;
        }
        // Bonus for full match
        if (contextAfter.includes(afterLower.slice(0, 30))) score += 5;
      }

      // Tie-break: prefer earlier unused occurrence (document order)
      if (score > bestScore || (score === bestScore && pos < bestIdx)) {
        bestScore = score;
        bestIdx = pos;
      }
    }

    // Mark this position as used for tie-breaking subsequent comments
    usedPositions.add(bestIdx);

    // Position at START of anchor (comment goes before, anchor gets marked)
    if (matchedAnchor) {
      return { ...c, pos: bestIdx, anchorText: matchedAnchor, anchorEnd: bestIdx + anchorLen };
    } else {
      return { ...c, pos: bestIdx, anchorText: null };
    }
  }).filter((c) => c.pos >= 0);

  // Sort by position descending (insert from end to avoid offset issues)
  commentsWithPositions.sort((a, b) => b.pos - a.pos);

  // Insert each comment with anchor marking
  for (const c of commentsWithPositions) {
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
 * Normalize text for comparison (handle whitespace differences)
 * @param {string} text
 * @returns {string}
 */
function normalizeWhitespace(text) {
  return text
    .replace(/\r\n/g, '\n') // Normalize line endings
    .replace(/\t/g, '    ') // Tabs to spaces
    .replace(/ +/g, ' ') // Collapse multiple spaces
    .trim();
}

/**
 * Fix citation and math annotations by preserving original markdown syntax
 * When Word renders [@Author2021] as "(Author et al. 2021)" or $p$ as "p", we preserve markdown
 * @param {string} text - Annotated text
 * @param {string} originalMd - Original markdown with proper citations and math
 * @returns {string}
 */
function fixCitationAnnotations(text, originalMd) {
  // Step 0: Fix math annotations - preserve inline and display math
  // Deletions of inline math should keep the math: {--$p$--} -> $p$
  text = text.replace(/\{--(\$[^$]+\$)--\}/g, '$1');
  text = text.replace(/\{--(\$\$[^$]+\$\$)--\}/g, '$1');

  // Substitutions where math was "changed" to rendered form: {~~$p$~>p~~} -> $p$
  text = text.replace(/\{~~(\$[^$]+\$)~>[^~]+~~\}/g, '$1');
  text = text.replace(/\{~~(\$\$[^$]+\$\$)~>[^~]+~~\}/g, '$1');

  // Extract all citations from original markdown with positions
  const citationPattern = /\[@[^\]]+\]/g;
  const originalCitations = [...originalMd.matchAll(citationPattern)].map(m => m[0]);

  // Step 1: Fix substitutions where left side has markdown citation
  // {~~[@Author]~>rendered~~} -> [@Author]
  text = text.replace(/\{~~(\[@[^\]]+\])~>[^~]+~~\}/g, '$1');

  // Step 2: Fix substitutions where left side STARTS with markdown citation
  // {~~[@Author] more text~>rendered more~~} -> [@Author] {~~more text~>more~~}
  text = text.replace(/\{~~(\[@[^\]]+\])\s*([^~]*)~>([^~]*)~~\}/g, (match, cite, oldText, newText) => {
    // If old and new text are similar (just whitespace/formatting), keep cite + new
    if (oldText.trim() === '' && newText.trim() === '') {
      return cite;
    }
    // Otherwise, keep citation and create substitution for the rest
    if (oldText.trim() || newText.trim()) {
      return cite + (oldText.trim() !== newText.trim() ? ` {~~${oldText.trim()}~>${newText.trim()}~~}` : ` ${newText}`);
    }
    return cite;
  });

  // Step 3: Fix deletions of markdown citations (should keep them)
  text = text.replace(/\{--(\[@[^\]]+\])--\}/g, '$1');

  // Step 4: Fix insertions of rendered citations (usually duplicates, remove)
  // {++(Author et al. 2021)++} or {++(Author 2021)++}
  text = text.replace(/\{\+\+\([A-Z][^)]*\d{4}[^)]*\)\+\+\}/g, '');

  // Step 5: Clean up broken multi-part substitutions involving citations
  // Pattern: {~~[@cite~>rendered~~} {~~text~>more~~} -> [@cite] {~~text~>more~~}
  text = text.replace(/\{~~(@[A-Za-z]+\d{4})~>[^~]+~~\}/g, '[$1]');

  // Step 6: Fix citations split across substitution boundaries
  // {~~[@~>something~~}Author2021] -> [@Author2021]
  text = text.replace(/\{~~\[@~>[^~]*~~\}([A-Za-z]+\d{4})\]/g, '[@$1]');

  // Step 7: Clean up any remaining partial citations in substitutions
  // {~~; @Author2021]~>something~~} -> ; [@Author2021]
  text = text.replace(/\{~~;\s*@([A-Za-z]+\d{4})\]~>[^~]*~~\}/g, '; [@$1]');

  // Step 8: Remove rendered citation insertions (fragments left over from citation matching)
  // These are leftover pieces of rendered citations that didn't match placeholders
  // Use \p{L} for Unicode letters to handle accented chars (š, é, ü, etc.)

  // Full rendered citations in parentheses: {++(Author et al. 2021)++}
  text = text.replace(/\{\+\+\(\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)\+\+\}/gu, '');
  text = text.replace(/\{\+\+\(\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)\.\s*\+\+\}/gu, '');

  // Trailing citation fragments: {++2019; IPBES 2023). ++} or {++2008b; Rouget et al. 2016). ++}
  text = text.replace(/\{\+\+\d{4}[a-z]?(?:[;,]\s*(?:\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+)?\d{4}[a-z]?)*\)\.\s*\+\+\}/gu, '');
  text = text.replace(/\{\+\+\d{4}[a-z]?(?:[;,]\s*(?:\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+)?\d{4}[a-z]?)*\)\s*\+\+\}/gu, '');

  // Just year with closing paren: {++2021)++} or {++2021).++}
  text = text.replace(/\{\+\+\d{4}[a-z]?\)\.\s*\+\+\}/g, '');
  text = text.replace(/\{\+\+\d{4}[a-z]?\)\s*\+\+\}/g, '');

  // Leading citation fragments: {++Author et al.++} or {++(Author++}
  text = text.replace(/\{\+\+\(?\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s*\+\+\}/gu, '');

  // Semicolon-separated author-year fragments: {++; Author 2021++}
  text = text.replace(/\{\+\+[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?\+\+\}/gu, '');

  // Year ranges with authors: {++Author 2019; Other 2020)++}
  text = text.replace(/\{\+\+\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)\s*\+\+\}/gu, '');
  text = text.replace(/\{\+\+\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)\.\s*\+\+\}/gu, '');

  // Step 9: Clean up double spaces and orphaned punctuation
  text = text.replace(/  +/g, ' ');
  text = text.replace(/\s+\./g, '.');
  text = text.replace(/\s+,/g, ',');

  // Step 10: Final cleanup - remove empty annotations
  text = text.replace(/\{~~\s*~>\s*~~\}/g, '');
  text = text.replace(/\{\+\+\s*\+\+\}/g, '');
  text = text.replace(/\{--\s*--\}/g, '');

  return text;
}

/**
 * Strip markdown syntax to get plain text (for comparison with Word output)
 * @param {string} md
 * @returns {string}
 */
function stripMarkdownSyntax(md) {
  return md
    // Remove YAML front matter
    .replace(/^---[\s\S]*?---\n*/m, '')
    // Headers: # Title → Title
    .replace(/^#{1,6}\s+/gm, '')
    // Bold/italic: **text** or *text* or __text__ or _text_ → text
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    // Links: [text](url) → text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Images: ![alt](url) → (remove entirely or keep alt)
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
    // Inline code: `code` → code
    .replace(/`([^`]+)`/g, '$1')
    // Code blocks: ```...``` → (remove)
    .replace(/```[\s\S]*?```/g, '')
    // Blockquotes: > text → text
    .replace(/^>\s*/gm, '')
    // Horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // List markers: - item or * item or 1. item → item
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Citations: [@Author2020] → (keep as-is, Word might have them)
    // Tables: simplified handling
    .replace(/\|/g, ' ')
    .replace(/^[-:]+$/gm, '')
    // Clean up extra whitespace
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Generate annotated markdown by diffing original MD against Word text
 * @param {string} originalMd - Original markdown content
 * @param {string} wordText - Text extracted from Word
 * @param {string} author - Author name for the changes
 * @returns {string} Annotated markdown with CriticMarkup
 */
export function generateAnnotatedDiff(originalMd, wordText, author = 'Reviewer') {
  // Normalize both texts
  const normalizedOriginal = normalizeWhitespace(originalMd);
  const normalizedWord = normalizeWhitespace(wordText);

  // Compute word-level diff
  const changes = diffWords(normalizedOriginal, normalizedWord);

  let result = '';

  for (const part of changes) {
    if (part.added) {
      // Insertion
      result += `{++${part.value}++}`;
    } else if (part.removed) {
      // Deletion
      result += `{--${part.value}--}`;
    } else {
      // Unchanged
      result += part.value;
    }
  }

  return result;
}

/**
 * Inject Word tables (extracted from XML) into pandoc text output
 * Replaces pandoc's broken plain-text table rendering with proper markdown tables
 * @param {string} pandocText - Text from pandoc (with broken tables)
 * @param {Array<{markdown: string, rowCount: number, colCount: number}>} wordTables - Tables extracted from Word XML
 * @returns {string}
 */
function injectWordTables(pandocText, wordTables) {
  if (!wordTables || wordTables.length === 0) {
    return pandocText;
  }

  let result = pandocText;

  // For each Word table, find where pandoc put it (as broken text) and replace
  for (const table of wordTables) {
    // Get first cell content from the markdown table (header cell)
    const firstLine = table.markdown.split('\n')[0];
    const headerCells = firstLine
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);

    if (headerCells.length === 0) continue;

    // Find the header cell in pandoc output - this marks start of table region
    const firstCell = headerCells[0];
    const startIdx = result.indexOf(firstCell);

    if (startIdx === -1) continue;

    // Get last cell content from the table
    const lastLine = table.markdown.split('\n').pop();
    const lastCells = lastLine
      .split('|')
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    const lastCell = lastCells[lastCells.length - 1] || lastCells[0];

    // Find where the table ends in pandoc output
    const endIdx = result.indexOf(lastCell, startIdx);
    if (endIdx === -1) continue;

    // Find paragraph boundaries around the table region
    let regionStart = result.lastIndexOf('\n\n', startIdx);
    if (regionStart === -1) regionStart = 0;
    else regionStart += 2;

    let regionEnd = result.indexOf('\n\n', endIdx + lastCell.length);
    if (regionEnd === -1) regionEnd = result.length;

    // Replace the broken table region with proper markdown table
    result = result.slice(0, regionStart) + table.markdown + '\n\n' + result.slice(regionEnd);
  }

  return result;
}

/**
 * Smart paragraph-level diff that preserves markdown structure
 * @param {string} originalMd
 * @param {string} wordText
 * @param {string} author
 * @param {object} options - { wordTables: Array } - Tables extracted from Word XML
 * @returns {string}
 */
export function generateSmartDiff(originalMd, wordText, author = 'Reviewer', options = {}) {
  const { wordTables = [], imageRegistry = null } = options;

  // FIRST: Inject Word tables into pandoc output to fix broken table rendering
  // This replaces pandoc's plain-text table garbage with proper markdown tables from Word XML
  let wordTextWithTables = injectWordTables(wordText, wordTables);

  // Protection order matters: tables first, then images (atomic blocks), then anchors, crossrefs, math, citations

  // Protect markdown tables as atomic blocks (CRITICAL - tables must not be diffed)
  const { text: mdWithTablesProtected, tables } = protectTables(originalMd);

  // Also protect tables in the Word text (now that they're proper markdown)
  const { text: wordWithTablesProtected, tables: wordTableBlocks } = protectTables(wordTextWithTables);

  // Protect images as atomic blocks (CRITICAL - images must not be diffed character-by-character)
  const { text: mdWithImagesProtected, images: origImages } = protectImages(mdWithTablesProtected, imageRegistry);

  // Also protect images in Word text
  const { text: wordWithImagesProtected, images: wordImages } = protectImages(wordWithTablesProtected, imageRegistry);

  // Match Word images to original images and normalize placeholders
  const imageMapping = matchWordImagesToOriginal(origImages, wordImages, imageRegistry);

  // Replace Word image placeholders with matching original placeholders
  let wordWithMappedImages = wordWithImagesProtected;
  for (const [wordPlaceholder, origPlaceholder] of imageMapping) {
    wordWithMappedImages = wordWithMappedImages.split(wordPlaceholder).join(origPlaceholder);
  }

  // Protect figure/table anchors (CRITICAL - these must never be deleted)
  const { text: mdWithAnchorsProtected, anchors: figAnchors } = protectAnchors(mdWithImagesProtected);

  // Protect cross-references (@fig:label, @tbl:label)
  const { text: mdWithXrefsProtected, crossrefs } = protectCrossrefs(mdWithAnchorsProtected);

  // Protect math (before citations, since citations might be inside math)
  const { text: mdWithMathProtected, mathBlocks } = protectMath(mdWithXrefsProtected);

  // Then protect citations
  const { text: mdProtected, citations } = protectCitations(mdWithMathProtected);

  // Replace rendered elements in Word text with matching placeholders
  let wordProtected = wordWithMappedImages;
  wordProtected = replaceRenderedMath(wordProtected, mathBlocks);
  wordProtected = replaceRenderedCitations(wordProtected, citations.length);

  // Split into paragraphs
  const originalParas = mdProtected.split(/\n\n+/);
  const wordParas = wordProtected.split(/\n\n+/);

  const result = [];

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
      // Simple similarity: count common words
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
      // No match found - paragraph was deleted or heavily modified
      // Check if it's just a header that Word converted
      if (mdPrefix && wordIdx < wordParas.length) {
        const wordPara = wordParas[wordIdx];
        if (wordPara.toLowerCase().includes(origContent.toLowerCase().slice(0, 20))) {
          // Word paragraph contains the header content - match them
          bestMatch = wordIdx;
        }
      }
    }

    if (bestMatch >= 0) {
      const word = wordParas[bestMatch];

      // Strip markdown from original for clean comparison
      const origStripped = stripMarkdownSyntax(orig);
      const wordNormalized = normalizeWhitespace(word);

      if (origStripped === wordNormalized) {
        // Unchanged (ignoring markdown syntax)
        result.push(orig);
      } else {
        // Modified - diff the content, preserve markdown prefix
        const changes = diffWords(origStripped, wordNormalized);
        let annotated = mdPrefix; // Preserve header/list marker

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
      // CRITICAL: Never delete section headers (# Header) - they are structural
      // Headers are lost during Word round-trip but must be preserved
      if (mdPrefix && mdPrefix.match(/^#{1,6}\s+/)) {
        // This is a header - keep it, don't mark as deleted
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

  // Restore protected content (reverse order of protection)
  let finalResult = result.join('\n\n');
  finalResult = restoreCitations(finalResult, citations);
  finalResult = restoreMath(finalResult, mathBlocks);
  finalResult = restoreCrossrefs(finalResult, crossrefs);
  finalResult = restoreAnchors(finalResult, figAnchors);
  finalResult = restoreImages(finalResult, origImages);
  // Note: Word images that matched originals were already mapped to original placeholders
  // Unmatched Word images will remain as their Word version
  finalResult = restoreImages(finalResult, wordImages);
  finalResult = restoreTables(finalResult, tables);
  // Also restore Word tables (tables that exist in Word but not in original md)
  finalResult = restoreTables(finalResult, wordTableBlocks);

  return finalResult;
}

/**
 * Clean up redundant adjacent annotations
 * e.g., {--old--}{++new++} → {~~old~>new~~}
 * @param {string} text
 * @returns {string}
 */
export function cleanupAnnotations(text) {
  // Convert adjacent delete+insert to substitution (with possible whitespace between)
  // Pattern: {--something--} {++something else++}
  text = text.replace(/\{--(.+?)--\}\s*\{\+\+(.+?)\+\+\}/g, '{~~$1~>$2~~}');

  // Also handle insert+delete (less common but possible)
  text = text.replace(/\{\+\+(.+?)\+\+\}\s*\{--(.+?)--\}/g, '{~~$2~>$1~~}');

  // Fix malformed patterns where {-- got merged with ~>
  // {--key~>critical~~} → {~~key~>critical~~}
  text = text.replace(/\{--([^}]+?)~>([^}]+?)~~\}/g, '{~~$1~>$2~~}');

  // Fix malformed substitutions that got split
  // {~~word --} ... {++other~~} patterns
  text = text.replace(/\{~~([^~]+)\s*--\}/g, '{--$1--}');
  text = text.replace(/\{\+\+([^+]+)~~\}/g, '{++$1++}');

  // Clean up empty annotations
  text = text.replace(/\{--\s*--\}/g, '');
  text = text.replace(/\{\+\+\s*\+\+\}/g, '');

  // Clean up double spaces in prose, but preserve table formatting
  // Simple markdown tables use multiple spaces for column alignment
  // Format:
  //   Header1                  Header2
  //   ------------------------ --------------------------
  //   Data value               Another value
  //   (blank line)
  //   More data                More values
  //   ------------------------ --------------------------
  //
  // Tables start with a separator line (dashes with spaces) and end with another separator
  // Blank lines within tables should be preserved, not treated as end of table
  const lines = text.split('\n');
  let inTable = false;

  const processedLines = lines.map((line, idx) => {
    // Detect table separator lines: sequences of dashes separated by spaces
    // e.g., "---- ---- ----" or "------------------------ --------------------------"
    const isSeparator = /^[-]+(\s+[-]+)+\s*$/.test(line.trim());

    // Check if this line looks like a table row (multiple words/values separated by 2+ spaces)
    const looksLikeTableRow = /\S+\s{2,}\S+/.test(line);

    // Start of table: separator line
    if (isSeparator) {
      if (!inTable) {
        inTable = true;
      }
      return line;
    }

    // If we're in a table, check if we should exit
    if (inTable) {
      // Blank line - check if we're still in a table by looking ahead
      if (line.trim() === '') {
        // Look ahead for more table content (rows with column spacing or separator)
        let lookAhead = idx + 1;
        let foundTableContent = false;
        let foundEndSeparator = false;

        while (lookAhead < lines.length && lookAhead < idx + 20) {
          const nextLine = lines[lookAhead].trim();

          if (nextLine === '') {
            lookAhead++;
            continue;
          }

          // Found another separator - this is end of current table section
          if (/^[-]+(\s+[-]+)+\s*$/.test(nextLine)) {
            foundEndSeparator = true;
            break;
          }

          // Found a line that looks like a table row (has column spacing)
          if (/\S+\s{2,}\S+/.test(nextLine)) {
            foundTableContent = true;
            break;
          }

          // Found a table category header (italicized text like *Life cycle*)
          // These don't have column spacing but are still part of the table
          if (/^\*[^*]+\*\s*$/.test(nextLine)) {
            foundTableContent = true;
            break;
          }

          // Found a line with leading spaces (typical of table rows)
          // Check if it's followed by more table content
          if (lines[lookAhead].startsWith('  ')) {
            // Keep looking - might be table content
            lookAhead++;
            continue;
          }

          // Found prose (no column spacing, no leading spaces) - table has ended
          break;
        }

        if (foundTableContent || foundEndSeparator) {
          return line; // Still in table, preserve blank line
        }

        // No more table content found - end the table
        inTable = false;
        return line;
      }

      // Non-blank line - preserve spacing (we're in a table)
      return line;
    }

    // Not in table - check if this might be a table header row (before separator)
    // Look ahead to see if next non-blank line is a separator
    if (looksLikeTableRow) {
      let nextIdx = idx + 1;
      while (nextIdx < lines.length && lines[nextIdx].trim() === '') {
        nextIdx++;
      }
      if (nextIdx < lines.length && /^[-]+(\s+[-]+)+\s*$/.test(lines[nextIdx].trim())) {
        // This is a table header row, preserve it
        return line;
      }
    }

    // Also preserve pipe tables
    if (line.trim().startsWith('|')) {
      return line;
    }

    // Only collapse double spaces in regular prose
    return line.replace(/  +/g, ' ');
  });
  text = processedLines.join('\n');

  return text;
}

/**
 * Parse visible comment markers from Word text
 * Format: [Author: comment text]
 * @param {string} text
 * @returns {Array<{author: string, text: string, position: number}>}
 */
export function parseVisibleComments(text) {
  const comments = [];
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
 * @param {string} text
 * @returns {string}
 */
export function convertVisibleComments(text) {
  return text.replace(/\[([^\]:]+):\s*([^\]]+)\]/g, '{>>$1: $2<<}');
}

/**
 * Restore pandoc-crossref figure/table references from Word-rendered format
 *
 * When pandoc-crossref builds a DOCX, references like @fig:map become "Figure 1".
 * When pandoc extracts back from Word, they become "[Figure]{.mark} [1]{.mark}" or just "Figure 1".
 * This function converts them back to @fig:label format using the crossref registry.
 *
 * Also handles:
 * - Duplicate image captions (Word shows image + caption text below)
 * - Image tags with "Figure N:" prefix in caption
 *
 * @param {string} text - Word-extracted markdown text
 * @param {string} projectDir - Project directory containing .rev/image-registry.json
 * @returns {{text: string, restored: number, messages: string[]}}
 */
export function restoreCrossrefFromWord(text, projectDir, restoredLabels = null) {
  const messages = [];
  let restored = 0;
  let result = text;

  // Try to load the image registry for label lookups
  const registry = readImageRegistry(projectDir);

  // Track which figure/table labels have already been restored to avoid duplicates
  // This is important when track changes contains both old and new versions of content
  // Accept external set to share state between restore functions
  if (!restoredLabels) {
    restoredLabels = new Set();
  }

  // Pattern 1: [Figure]{.mark} [N]{.mark} or [Table]{.mark} [N]{.mark}
  // This is how pandoc exports tracked/marked references from Word
  result = result.replace(/\[(Figure|Table|Fig\.?)\]\{\.mark\}\s*\[(\d+|S\d+)\]\{\.mark\}/gi, (match, type, num) => {
    const prefix = type.toLowerCase().startsWith('tab') ? 'tbl' : 'fig';
    // Try to find the label from registry
    if (registry) {
      const entry = registry.byNumber?.get(`${prefix}:${num}`);
      if (entry && entry.label) {
        restored++;
        return `@${prefix}:${entry.label}`;
      }
    }
    // Fallback: can't restore label, keep as @fig:figN placeholder
    restored++;
    messages.push(`Restored ${type} ${num} (no label found, using placeholder)`);
    return `@${prefix}:fig${num}`;
  });

  // Pattern 2: Plain "Figure N" or "Fig. N" at word boundaries (not in image captions)
  // Be careful not to match inside ![Figure N: caption](path)
  result = result.replace(/(?<!!)\b(Figure|Fig\.?|Table|Tbl\.?)\s+(\d+|S\d+)\b(?!\s*:)/gi, (match, type, num) => {
    const prefix = type.toLowerCase().startsWith('tab') ? 'tbl' : 'fig';
    if (registry) {
      const entry = registry.byNumber?.get(`${prefix}:${num}`);
      if (entry && entry.label) {
        restored++;
        return `@${prefix}:${entry.label}`;
      }
    }
    return match; // Keep as-is if no registry match
  });

  // Pattern 3: Remove duplicate plain-text captions after images
  // Word shows: ![Figure N: Caption](path){width="..."} followed by "Figure N: Caption" on next line
  // The {width=...} or other attributes may appear after the path
  result = result.replace(/(\!\[[^\]]+\]\([^)]+\)(?:\{[^}]*\})?)\s*\n+\s*(?:Figure|Fig\.?|Table|Tbl\.?)\s+\d+[:\.]?\s*[^\n]+/gi, '$1');

  // Pattern 4: Clean up image captions that start with "Figure N: "
  // Convert ![Figure 3: Actual caption](path) to ![Actual caption](path){#fig:label}
  // ONLY for the first occurrence of each figure (avoid duplicates from track changes)
  result = result.replace(/!\[(Figure|Fig\.?|Table|Tbl\.?)\s+(\d+|S\d+)[:\.]?\s*([^\]]*)\]\(([^)]+)\)(?:\{[^}]*\})?/gi,
    (match, type, num, caption, imgPath) => {
      const prefix = type.toLowerCase().startsWith('tab') ? 'tbl' : 'fig';
      const labelKey = `${prefix}:${num}`;

      if (registry) {
        const entry = registry.byNumber?.get(labelKey);
        if (entry) {
          // Check if we've already restored this label
          if (restoredLabels.has(labelKey)) {
            // Already restored - just clean up the caption, don't add {#fig:label}
            messages.push(`Skipped duplicate ${prefix}:${entry.label} (already restored)`);
            return `![${entry.caption}](${entry.path})`;
          }
          // First occurrence - restore with label
          restoredLabels.add(labelKey);
          restored++;
          messages.push(`Restored image ${prefix}:${entry.label} from Figure ${num}`);
          return `![${entry.caption}](${entry.path}){#${prefix}:${entry.label}}`;
        }
      }
      // No registry match - keep caption without "Figure N:" prefix
      const cleanCaption = caption.trim();
      return `![${cleanCaption}](${imgPath})`;
    });

  return { text: result, restored, messages, restoredLabels };
}

/**
 * Restore proper markdown image syntax from Word-extracted text using image registry
 *
 * When Pandoc extracts from Word, images lose their original paths and labels:
 * - Original: ![Caption text](figures/fig_map.png){#fig:map}
 * - Extracted: ![](media/image1.png) or just caption text with no image syntax
 *
 * This function restores proper syntax by:
 * 1. Looking up images by their @fig:label references in text
 * 2. Matching by caption text (first 50 chars)
 * 3. Matching by figure number ("Figure 1", "Fig. 1")
 *
 * @param {string} text - Word-extracted markdown text
 * @param {string} projectDir - Project directory containing .rev/image-registry.json
 * @returns {{text: string, restored: number, messages: string[]}}
 */
export function restoreImagesFromRegistry(text, projectDir, restoredLabels = null) {
  const messages = [];
  let restored = 0;

  // Try to load the image registry
  const registry = readImageRegistry(projectDir);
  if (!registry || !registry.figures || registry.figures.length === 0) {
    return { text, restored: 0, messages: ['No image registry found'] };
  }

  // Track which labels have been restored to avoid duplicates
  // Accept external set to share state with restoreCrossrefFromWord
  if (!restoredLabels) {
    restoredLabels = new Set();
  }

  let result = text;

  // Pattern 1: Caption-like text that should be an image
  // Matches patterns like:
  // - "@fig:label: Caption text here"
  // - "Figure 1: Caption text here" (at start of line or after blank line)
  // - Tables with just caption text (from broken Word export)
  const captionPatterns = [
    // @fig:label followed by colon and caption (broken Word export format)
    /@(fig|tbl):([a-zA-Z0-9_-]+):\s*([^\n]+)/gi,
    // Standalone caption lines that look like figure captions
    /^(Figure|Fig\.?)\s+(\d+|S\d+)[.:]\s*([^\n]+)/gim,
    // Table-wrapped captions (from broken Word export)
    /\|\s*@(fig|tbl):([a-zA-Z0-9_-]+):\s*([^|]+)\s*\|/gi,
  ];

  // Pattern 2: Broken image syntax with generic media paths
  // Matches: ![...](media/image1.png) or ![](media/imageN.ext)
  const genericImagePattern = /!\[([^\]]*)\]\(media\/[^)]+\)/g;

  // First, fix @fig:label: caption patterns (most specific)
  result = result.replace(captionPatterns[0], (match, type, label, caption) => {
    const key = `${type}:${label}`;
    const entry = registry.byLabel.get(key);
    if (entry) {
      // Check for duplicates
      if (restoredLabels.has(key)) {
        messages.push(`Skipped duplicate ${key} (already restored)`);
        return `![${entry.caption}](${entry.path})`;
      }
      restoredLabels.add(key);
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
      // Check for duplicates
      if (restoredLabels.has(key)) {
        messages.push(`Skipped duplicate ${key} from table wrapper`);
        return `![${entry.caption}](${entry.path})`;
      }
      restoredLabels.add(key);
      restored++;
      messages.push(`Restored ${type}:${label} from table wrapper`);
      return `![${entry.caption}](${entry.path}){#${type}:${label}}`;
    }
    return match;
  });

  // Clean up any remaining empty table structures from broken caption export
  // | |
  // |:--:|
  // | @fig:label: ... |
  result = result.replace(/\|\s*\|\s*\n\|:--:\|\s*\n/g, '');

  // Fix "Figure N:" standalone lines (fallback using number lookup)
  result = result.replace(captionPatterns[1], (match, prefix, num, caption) => {
    const numKey = `fig:${num}`;
    const entry = registry.byNumber.get(numKey);
    if (entry) {
      const labelKey = `fig:${entry.label}`;
      // Check for duplicates
      if (restoredLabels.has(labelKey)) {
        messages.push(`Skipped duplicate Figure ${num} (already restored)`);
        return `![${entry.caption}](${entry.path})`;
      }
      restoredLabels.add(labelKey);
      restored++;
      messages.push(`Restored Figure ${num} by number lookup`);
      return `![${entry.caption}](${entry.path}){#fig:${entry.label}}`;
    }
    return match;
  });

  // Fix generic media paths by matching caption text
  result = result.replace(genericImagePattern, (match, caption) => {
    if (!caption || caption.trim() === '') {
      // No caption to match - try to match by order (risky, skip for now)
      return match;
    }

    const captionKey = caption.slice(0, 50).toLowerCase().trim();
    const entry = registry.byCaption.get(captionKey);
    if (entry) {
      const labelKey = entry.label ? `${entry.type}:${entry.label}` : null;
      // Check for duplicates (only if we have a label)
      if (labelKey && restoredLabels.has(labelKey)) {
        messages.push(`Skipped duplicate by caption match: ${captionKey.slice(0, 30)}...`);
        return `![${entry.caption}](${entry.path})`;
      }
      if (labelKey) {
        restoredLabels.add(labelKey);
      }
      restored++;
      messages.push(`Restored image by caption match: ${captionKey.slice(0, 30)}...`);
      const anchor = (entry.label && !restoredLabels.has(labelKey)) ? `{#${entry.type}:${entry.label}}` : '';
      return `![${entry.caption}](${entry.path})${anchor}`;
    }
    return match;
  });

  return { text: result, restored, messages };
}

/**
 * Import Word document with track changes directly as CriticMarkup
 * This is the PRIMARY import function - extracts content from Word with track changes
 * preserved as CriticMarkup annotations. Does NOT diff against original MD.
 *
 * Workflow:
 * 1. Author exports MD to DOCX, sends to reviewer
 * 2. Reviewer makes changes with track changes enabled, adds comments
 * 3. Author imports DOCX → gets clean MD with CriticMarkup annotations
 *
 * @param {string} docxPath - Path to Word document with track changes
 * @param {object} options - { mediaDir?: string, projectDir?: string }
 * @returns {Promise<{text: string, stats: object, extractedMedia: string[], comments: Array}>}
 */
export async function importWordWithTrackChanges(docxPath, options = {}) {
  const { mediaDir, projectDir } = options;
  const docxDir = path.dirname(docxPath);
  const targetMediaDir = mediaDir || path.join(docxDir, 'media');
  const targetProjectDir = projectDir || docxDir;

  // Check if we have an image registry with existing figures
  const registry = readImageRegistry(targetProjectDir);
  const hasRegistry = registry && registry.figures && registry.figures.length > 0;

  // First pass: extract WITHOUT media to count images in Word doc
  // We need to know how many images are in the Word doc vs how many we have in registry
  const { stdout: rawText } = await execAsync(
    `pandoc "${docxPath}" -t markdown --wrap=none --track-changes=all`,
    { maxBuffer: 50 * 1024 * 1024 }
  );

  // Count images in Word doc
  const wordImageCount = (rawText.match(/!\[[^\]]*\]\(media\/[^)]+\)/g) || []).length;
  const registryCount = hasRegistry ? registry.figures.length : 0;

  // Only extract media if Word has MORE images than registry (reviewer added new ones)
  const needsMediaExtraction = wordImageCount > registryCount;

  if (hasRegistry) {
    console.log(`Registry has ${registryCount} figures, Word doc has ${wordImageCount} images`);
    if (needsMediaExtraction) {
      console.log(`Extracting media (${wordImageCount - registryCount} new image(s) detected)`);
    } else {
      console.log(`Using existing figures from registry`);
    }
  }

  // Extract from Word with track changes preserved
  const extracted = await extractFromWord(docxPath, {
    mediaDir: targetMediaDir,
    skipMediaExtraction: !needsMediaExtraction,
  });

  let text = extracted.text;
  const extractedMedia = extracted.extractedMedia || [];
  const comments = extracted.comments || [];
  const anchors = extracted.anchors || new Map();

  // Log extraction messages
  for (const msg of extracted.messages || []) {
    if (msg.type === 'info') {
      console.log(msg.message);
    } else if (msg.type === 'warning') {
      console.warn(`Warning: ${msg.message}`);
    }
  }

  // Restore crossref figure/table references from Word format
  const crossrefResult = restoreCrossrefFromWord(text, targetProjectDir);
  text = crossrefResult.text;
  if (crossrefResult.restored > 0) {
    console.log(`Restored ${crossrefResult.restored} crossref reference(s)`);
  }

  // Restore images from registry (if available)
  // Pass restoredLabels from crossref to avoid duplicates from track changes
  const imageRestoreResult = restoreImagesFromRegistry(text, targetProjectDir, crossrefResult.restoredLabels);
  text = imageRestoreResult.text;
  if (imageRestoreResult.restored > 0) {
    console.log(`Restored ${imageRestoreResult.restored} image(s) from registry`);
  }

  // Insert comments as CriticMarkup
  if (comments.length > 0) {
    text = insertCommentsIntoMarkdown(text, comments, anchors);
    console.log(`Inserted ${comments.length} comment(s)`);
  }

  // Clean up annotations (merge adjacent del/ins to substitutions)
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
 * DEPRECATED: Use importWordWithTrackChanges() for importing reviewer feedback
 * This function is kept for edge cases where diffing is needed (e.g., Word docs without track changes)
 *
 * @param {string} docxPath - Path to Word document
 * @param {string} originalMdPath - Path to original markdown
 * @param {{author?: string, sectionContent?: string, figuresDir?: string, wordTables?: Array}} options
 * @returns {Promise<{annotated: string, stats: object, extractedMedia: string[]}>}
 */
export async function importFromWord(docxPath, originalMdPath, options = {}) {
  const { author = 'Reviewer', sectionContent, figuresDir } = options;
  const projectDir = path.dirname(originalMdPath);

  // Use provided section content or extract from Word
  let wordText;
  let extractedMedia = [];
  let wordTables = options.wordTables || [];
  let hasTrackChanges = false;

  if (sectionContent !== undefined) {
    // sectionContent is already processed (crossref restoration done on full text before splitting)
    // Just clean up and return - no diffing needed
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
    // Determine media directory - use figuresDir if provided, otherwise extract next to docx
    const docxDir = path.dirname(docxPath);
    const mediaDir = figuresDir || docxDir;

    const extracted = await extractFromWord(docxPath, { mediaDir });
    wordText = extracted.text;
    extractedMedia = extracted.extractedMedia || [];
    wordTables = extracted.tables || [];
    hasTrackChanges = extracted.hasTrackChanges || false;

    // Log any messages
    for (const msg of extracted.messages || []) {
      if (msg.type === 'info') {
        console.log(msg.message);
      } else if (msg.type === 'warning') {
        console.warn(`Warning: ${msg.message}`);
      }
    }

    // If Word doc has track changes, just return the extracted text with CriticMarkup
    // No need to diff against original - the track changes ARE the annotations
    if (hasTrackChanges) {
      // Restore crossref and images
      const crossrefResult = restoreCrossrefFromWord(wordText, projectDir);
      wordText = crossrefResult.text;
      if (crossrefResult.restored > 0) {
        console.log(`Restored ${crossrefResult.restored} crossref reference(s)`);
      }

      // Pass restoredLabels from crossref to avoid duplicates
      const imageRestoreResult = restoreImagesFromRegistry(wordText, projectDir, crossrefResult.restoredLabels);
      wordText = imageRestoreResult.text;
      if (imageRestoreResult.restored > 0) {
        console.log(`Restored ${imageRestoreResult.restored} image(s) from registry`);
      }

      // Insert comments
      const comments = extracted.comments || [];
      const anchors = extracted.anchors || new Map();
      if (comments.length > 0) {
        wordText = insertCommentsIntoMarkdown(wordText, comments, anchors);
        console.log(`Inserted ${comments.length} comment(s)`);
      }

      // Clean up annotations
      wordText = cleanupAnnotations(wordText);

      // Count changes
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

    // No track changes - proceed with diff-based approach
    // Warn user that this is a fallback and may not produce ideal results
    console.warn('Warning: No track changes detected in Word document.');
    console.warn('  For best results, reviewers should use Track Changes in Word.');
    console.warn('  Falling back to diff-based import (comparing against original MD).');
    console.warn('  This approach may produce less accurate change annotations.');

    // Restore crossref figure/table references from Word format
    const crossrefResult = restoreCrossrefFromWord(wordText, projectDir);
    wordText = crossrefResult.text;
    if (crossrefResult.restored > 0) {
      console.log(`Restored ${crossrefResult.restored} crossref reference(s)`);
    }

    // Restore images from registry (if available)
    // This fixes broken image syntax from Word round-trip
    // Pass restoredLabels from crossref to avoid duplicates
    const imageRestoreResult = restoreImagesFromRegistry(wordText, projectDir, crossrefResult.restoredLabels);
    wordText = imageRestoreResult.text;
    if (imageRestoreResult.restored > 0) {
      console.log(`Restored ${imageRestoreResult.restored} image(s) from registry`);
    }
  }

  // Read original markdown
  let originalMd = fs.readFileSync(originalMdPath, 'utf-8');

  // IMPORTANT: Strip any existing annotations to prevent nested annotations
  // This ensures we always diff clean text against Word text
  originalMd = stripAnnotations(originalMd, { keepComments: false });

  // Load image registry for image matching during diff
  const imageRegistry = readImageRegistry(projectDir);

  // Generate diff with Word tables and image registry for proper handling
  let annotated = generateSmartDiff(originalMd, wordText, author, { wordTables, imageRegistry });

  // Clean up adjacent del/ins to substitutions
  annotated = cleanupAnnotations(annotated);

  // Fix citation-related annotations (preserve markdown citations)
  annotated = fixCitationAnnotations(annotated, originalMd);

  // Convert any visible comments
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
 * @param {string[]} mediaFiles - Paths to extracted media files
 * @param {string} figuresDir - Target figures directory
 * @param {string} prefix - Prefix for renamed files (e.g., 'fig')
 * @returns {{moved: string[], errors: string[]}}
 */
export function moveExtractedMedia(mediaFiles, figuresDir, prefix = 'figure') {
  const moved = [];
  const errors = [];

  // Create figures directory if it doesn't exist
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
    } catch (err) {
      errors.push(`Failed to copy ${src}: ${err.message}`);
    }
  }

  return { moved, errors };
}
