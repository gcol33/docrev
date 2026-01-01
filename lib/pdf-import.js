/**
 * PDF comment extraction for docrev
 *
 * Extracts annotations (comments, highlights, sticky notes) from PDF files
 * and converts them to CriticMarkup format for insertion into markdown.
 * Also extracts the actual text content under highlights using pdfjs-dist.
 */

import * as fs from 'fs';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/**
 * Annotation types we care about
 */
const COMMENT_TYPES = [
  'Text',      // Sticky notes
  'FreeText',  // Text boxes
  'Highlight', // Highlighted text with comment
  'Underline', // Underlined text with comment
  'StrikeOut', // Strikethrough (deletion suggestion)
  'Squiggly',  // Squiggly underline
  'Popup',     // Popup comments (attached to other annotations)
];

/**
 * Extract raw annotations from a PDF file
 * @param {string} pdfPath - Path to PDF file
 * @returns {Promise<Array<{type: string, page: number, contents: string, author: string, date: string, rect: number[], quadPoints: number[]}>>}
 */
export async function extractPdfAnnotations(pdfPath) {
  const pdfBytes = fs.readFileSync(pdfPath);
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });

  const annotations = [];
  const pages = pdfDoc.getPages();

  for (let pageNum = 0; pageNum < pages.length; pageNum++) {
    const page = pages[pageNum];
    const annots = page.node.Annots();

    if (!annots) continue;

    const annotRefs = annots.asArray();

    for (const annotRef of annotRefs) {
      try {
        const annot = annotRef.dict || annotRef;
        if (!annot) continue;

        // Get annotation type
        const subtypeName = annot.get(pdfDoc.context.obj('Subtype'));
        const subtype = subtypeName?.toString?.()?.replace('/', '') || '';

        if (!COMMENT_TYPES.includes(subtype)) continue;

        // Extract contents (the comment text)
        const contentsObj = annot.get(pdfDoc.context.obj('Contents'));
        const contents = contentsObj?.toString?.() || contentsObj?.decodeText?.() || '';

        // Extract author (T field in PDF spec)
        const authorObj = annot.get(pdfDoc.context.obj('T'));
        const author = authorObj?.toString?.() || authorObj?.decodeText?.() || 'Unknown';

        // Extract modification date
        const dateObj = annot.get(pdfDoc.context.obj('M'));
        const dateStr = dateObj?.toString?.() || '';
        const date = parsePdfDate(dateStr);

        // Extract rectangle (position on page)
        const rectObj = annot.get(pdfDoc.context.obj('Rect'));
        const rect = rectObj?.asArray?.()?.map(n => n?.asNumber?.() || 0) || [0, 0, 0, 0];

        // Extract QuadPoints for highlights (the actual text bounds)
        const quadObj = annot.get(pdfDoc.context.obj('QuadPoints'));
        const quadPoints = quadObj?.asArray?.()?.map(n => n?.asNumber?.() || 0) || [];

        // Skip empty annotations
        if (!contents.trim() && subtype !== 'StrikeOut') continue;

        annotations.push({
          type: subtype,
          page: pageNum + 1,
          contents: cleanPdfString(contents),
          author: cleanPdfString(author),
          date,
          rect,
          quadPoints,
        });
      } catch (err) {
        // Skip malformed annotations
        continue;
      }
    }
  }

  // Sort by page, then by vertical position (top to bottom)
  annotations.sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    // Higher Y = higher on page in PDF coords
    return (b.rect[1] || 0) - (a.rect[1] || 0);
  });

  return annotations;
}

/**
 * Parse PDF date string (D:YYYYMMDDHHmmSS format)
 * @param {string} dateStr
 * @returns {string} ISO date string
 */
function parsePdfDate(dateStr) {
  if (!dateStr) return '';

  // Remove D: prefix and timezone info
  const clean = dateStr.replace(/^D:/, '').replace(/[Z+-].*$/, '');

  if (clean.length >= 8) {
    const year = clean.slice(0, 4);
    const month = clean.slice(4, 6);
    const day = clean.slice(6, 8);
    return `${year}-${month}-${day}`;
  }

  return '';
}

/**
 * Clean PDF string (remove parentheses, decode escape sequences)
 * @param {string} str
 * @returns {string}
 */
function cleanPdfString(str) {
  if (!str) return '';

  return str
    .replace(/^\(/, '')  // Remove leading paren
    .replace(/\)$/, '')  // Remove trailing paren
    .replace(/\\n/g, '\n')  // Newlines
    .replace(/\\r/g, '')    // Carriage returns
    .replace(/\\t/g, ' ')   // Tabs
    .replace(/\\\(/g, '(')  // Escaped parens
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\') // Escaped backslash
    .trim();
}

/**
 * Convert PDF annotations to CriticMarkup comments
 * @param {Array} annotations - From extractPdfAnnotations
 * @returns {Array<{author: string, text: string, page: number, type: string}>}
 */
export function annotationsToComments(annotations) {
  return annotations
    .filter(a => a.contents.trim())
    .map(a => ({
      author: a.author || 'Reviewer',
      text: a.contents,
      page: a.page,
      type: a.type,
      date: a.date,
    }));
}

/**
 * Extract comments from PDF and format for display
 * @param {string} pdfPath
 * @returns {Promise<Array<{author: string, text: string, page: number, type: string, date: string}>>}
 */
export async function extractPdfComments(pdfPath) {
  const annotations = await extractPdfAnnotations(pdfPath);
  return annotationsToComments(annotations);
}

/**
 * Insert PDF comments into markdown based on page/position heuristics
 * Since PDFs don't have direct text anchors like Word, we use page numbers
 * and append comments to the end of corresponding sections
 *
 * @param {string} markdown - The markdown content
 * @param {Array} comments - Comments from extractPdfComments
 * @param {object} options - { sectionPerPage: boolean }
 * @returns {string} Markdown with comments inserted
 */
export function insertPdfCommentsIntoMarkdown(markdown, comments, options = {}) {
  if (comments.length === 0) return markdown;

  // Group comments by page
  const commentsByPage = new Map();
  for (const c of comments) {
    if (!commentsByPage.has(c.page)) {
      commentsByPage.set(c.page, []);
    }
    commentsByPage.get(c.page).push(c);
  }

  // Strategy: Append all comments at the end with page references
  // This is the safest approach since we can't reliably map PDF positions to markdown
  const lines = markdown.split('\n');
  const commentBlock = [];

  commentBlock.push('');
  commentBlock.push('<!-- PDF Comments -->');

  for (const [page, pageComments] of commentsByPage) {
    for (const c of pageComments) {
      const authorPrefix = c.author ? `${c.author}: ` : '';
      const pageRef = `[p.${page}]`;
      commentBlock.push(`{>>${authorPrefix}${pageRef} ${c.text}<<}`);
    }
  }

  return lines.join('\n') + commentBlock.join('\n');
}

/**
 * Format PDF comments for CLI display
 * @param {Array} comments
 * @returns {string}
 */
export function formatPdfComments(comments) {
  if (comments.length === 0) {
    return 'No comments found in PDF.';
  }

  const lines = [];
  let currentPage = 0;

  for (const c of comments) {
    if (c.page !== currentPage) {
      if (currentPage > 0) lines.push('');
      lines.push(`Page ${c.page}:`);
      currentPage = c.page;
    }

    const typeIcon = getTypeIcon(c.type);
    const author = c.author || 'Unknown';
    lines.push(`  ${typeIcon} [${author}] ${c.text}`);
  }

  return lines.join('\n');
}

/**
 * Get icon for annotation type
 * @param {string} type
 * @returns {string}
 */
function getTypeIcon(type) {
  switch (type) {
    case 'Text': return '📝';      // Sticky note
    case 'FreeText': return '💬';  // Text box
    case 'Highlight': return '🖍️'; // Highlight
    case 'Underline': return '📍'; // Underline
    case 'StrikeOut': return '❌'; // Strikethrough
    case 'Squiggly': return '〰️';  // Squiggly
    default: return '💬';
  }
}

/**
 * Get statistics about PDF comments
 * @param {Array} comments
 * @returns {{total: number, byType: object, byAuthor: object, byPage: object}}
 */
export function getPdfCommentStats(comments) {
  const stats = {
    total: comments.length,
    byType: {},
    byAuthor: {},
    byPage: {},
  };

  for (const c of comments) {
    stats.byType[c.type] = (stats.byType[c.type] || 0) + 1;
    stats.byAuthor[c.author] = (stats.byAuthor[c.author] || 0) + 1;
    stats.byPage[c.page] = (stats.byPage[c.page] || 0) + 1;
  }

  return stats;
}

/**
 * Extract text content from a PDF page
 * @param {object} page - pdfjs page object
 * @returns {Promise<Array<{str: string, x: number, y: number, width: number, height: number}>>}
 */
async function getPageTextItems(page) {
  const textContent = await page.getTextContent();
  return textContent.items.map(item => ({
    str: item.str,
    x: item.transform[4],
    y: item.transform[5],
    width: item.width,
    height: item.height,
  }));
}

/**
 * Check if a point is inside a quadrilateral defined by QuadPoints
 * QuadPoints format: [x1,y1, x2,y2, x3,y3, x4,y4] for each quad
 * @param {number} x
 * @param {number} y
 * @param {number[]} quad - 8 numbers defining corners
 * @returns {boolean}
 */
function isPointInQuad(x, y, quad) {
  if (quad.length < 8) return false;

  // Get bounding box from quad points
  const xs = [quad[0], quad[2], quad[4], quad[6]];
  const ys = [quad[1], quad[3], quad[5], quad[7]];
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return x >= minX && x <= maxX && y >= minY && y <= maxY;
}

/**
 * Extract highlighted text from a PDF using QuadPoints
 * @param {string} pdfPath - Path to PDF file
 * @param {Array} annotations - Annotations with quadPoints from extractPdfAnnotations
 * @returns {Promise<Array<{...annotation, highlightedText: string}>>}
 */
export async function extractHighlightedText(pdfPath, annotations) {
  const pdfBytes = fs.readFileSync(pdfPath);
  const data = new Uint8Array(pdfBytes);

  // Load with pdfjs-dist for text extraction
  const loadingTask = getDocument({ data, useSystemFonts: true });
  const pdfDoc = await loadingTask.promise;

  const results = [];

  for (const annot of annotations) {
    // Only process text markup annotations (Highlight, Underline, StrikeOut, Squiggly)
    if (!['Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(annot.type)) {
      results.push({ ...annot, highlightedText: '' });
      continue;
    }

    if (!annot.quadPoints || annot.quadPoints.length < 8) {
      results.push({ ...annot, highlightedText: '' });
      continue;
    }

    try {
      const page = await pdfDoc.getPage(annot.page);
      const textItems = await getPageTextItems(page);

      // Split quadPoints into individual quads (8 numbers each)
      const quads = [];
      for (let i = 0; i < annot.quadPoints.length; i += 8) {
        quads.push(annot.quadPoints.slice(i, i + 8));
      }

      // Find text items that fall within any of the quads
      const matchedText = [];
      for (const item of textItems) {
        // Check if text item center is in any quad
        const centerX = item.x + (item.width || 0) / 2;
        const centerY = item.y + (item.height || 0) / 2;

        for (const quad of quads) {
          if (isPointInQuad(centerX, centerY, quad) || isPointInQuad(item.x, item.y, quad)) {
            matchedText.push(item.str);
            break;
          }
        }
      }

      results.push({
        ...annot,
        highlightedText: matchedText.join(' ').trim(),
      });
    } catch (err) {
      // If text extraction fails, just return empty
      results.push({ ...annot, highlightedText: '' });
    }
  }

  return results;
}

/**
 * Extract annotations with highlighted text in one call
 * @param {string} pdfPath
 * @returns {Promise<Array>}
 */
export async function extractPdfAnnotationsWithText(pdfPath) {
  const annotations = await extractPdfAnnotations(pdfPath);
  return extractHighlightedText(pdfPath, annotations);
}

/**
 * Format annotation with highlighted text for display
 * @param {object} annot - Annotation with highlightedText
 * @returns {string}
 */
export function formatAnnotationWithText(annot) {
  const typeIcon = getTypeIcon(annot.type);
  const author = annot.author || 'Unknown';
  const parts = [`${typeIcon} [${author}]`];

  if (annot.highlightedText) {
    parts.push(`"${annot.highlightedText}"`);
  }

  if (annot.contents) {
    parts.push(`→ ${annot.contents}`);
  }

  return parts.join(' ');
}
