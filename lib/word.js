/**
 * Word document extraction utilities
 * Handle reading text, comments, and anchors from .docx files
 */

import * as fs from 'fs';
import * as path from 'path';
import AdmZip from 'adm-zip';
import { parseString } from 'xml2js';
import { promisify } from 'util';

const parseXml = promisify(parseString);

/**
 * Extract comments from Word document's comments.xml
 * @param {string} docxPath
 * @returns {Promise<Array<{id: string, author: string, date: string, text: string}>>}
 */
export async function extractWordComments(docxPath) {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }

  const zip = new AdmZip(docxPath);
  const commentsEntry = zip.getEntry('word/comments.xml');

  if (!commentsEntry) {
    return []; // No comments in document
  }

  const commentsXml = zip.readAsText(commentsEntry);
  const parsed = await parseXml(commentsXml);

  if (!parsed['w:comments'] || !parsed['w:comments']['w:comment']) {
    return [];
  }

  const comments = [];
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
 * @param {string} docxPath
 * @returns {Promise<Map<string, {text: string, context: string}>>}
 */
export async function extractCommentAnchors(docxPath) {
  const zip = new AdmZip(docxPath);
  const documentEntry = zip.getEntry('word/document.xml');

  if (!documentEntry) {
    throw new Error('Invalid docx: no document.xml');
  }

  const documentXml = zip.readAsText(documentEntry);
  const anchors = new Map();

  // Find commentRangeStart and commentRangeEnd pairs
  // The text between them is what the comment is anchored to
  const startPattern = /<w:commentRangeStart w:id="(\d+)"\/>/g;
  const endPattern = /<w:commentRangeEnd w:id="(\d+)"\/>/g;

  let match;
  const starts = new Map();
  const ends = new Map();

  while ((match = startPattern.exec(documentXml)) !== null) {
    starts.set(match[1], match.index);
  }

  while ((match = endPattern.exec(documentXml)) !== null) {
    ends.set(match[1], match.index);
  }

  // For each comment, extract the text between start and end
  for (const [id, startPos] of starts) {
    const endPos = ends.get(id);
    if (!endPos) continue;

    const segment = documentXml.slice(startPos, endPos);

    // Extract all text content from the segment
    const textPattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let text = '';
    let textMatch;
    while ((textMatch = textPattern.exec(segment)) !== null) {
      text += textMatch[1];
    }

    // Get surrounding context (text before the anchor)
    const contextStart = Math.max(0, startPos - 500);
    const contextSegment = documentXml.slice(contextStart, startPos);
    let context = '';
    while ((textMatch = textPattern.exec(contextSegment)) !== null) {
      context += textMatch[1];
    }

    anchors.set(id, {
      text: text.trim(),
      context: context.slice(-100), // Last 100 chars of context
    });
  }

  return anchors;
}

/**
 * Extract plain text from Word document using mammoth
 * @param {string} docxPath
 * @returns {Promise<string>}
 */
export async function extractTextFromWord(docxPath) {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`File not found: ${docxPath}`);
  }

  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ path: docxPath });
  return result.value;
}

/**
 * Extract rich content from Word with basic formatting
 * @param {string} docxPath
 * @returns {Promise<{text: string, html: string}>}
 */
export async function extractFromWord(docxPath) {
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
 * @param {string} docxPath
 * @returns {Promise<{title?: string, author?: string, created?: string, modified?: string}>}
 */
export async function getWordMetadata(docxPath) {
  const zip = new AdmZip(docxPath);
  const coreEntry = zip.getEntry('docProps/core.xml');

  if (!coreEntry) {
    return {};
  }

  const coreXml = zip.readAsText(coreEntry);
  const metadata = {};

  // Extract common metadata fields
  const patterns = {
    title: /<dc:title>([^<]*)<\/dc:title>/,
    author: /<dc:creator>([^<]*)<\/dc:creator>/,
    created: /<dcterms:created[^>]*>([^<]*)<\/dcterms:created>/,
    modified: /<dcterms:modified[^>]*>([^<]*)<\/dcterms:modified>/,
  };

  for (const [key, pattern] of Object.entries(patterns)) {
    const match = coreXml.match(pattern);
    if (match) {
      metadata[key] = match[1];
    }
  }

  return metadata;
}

/**
 * Check if file is a valid Word document
 * @param {string} filePath
 * @returns {boolean}
 */
export function isWordDocument(filePath) {
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
 * @param {string} xml - XML string
 * @returns {string} Plain text content
 */
function extractTextFromXml(xml) {
  let text = '';
  // Match w:t elements (regular text)
  const textPattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let match;
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
 * @param {string} docxPath - Path to Word document
 * @returns {Promise<{hasTrackChanges: boolean, content: string, stats: {insertions: number, deletions: number}}>}
 */
export async function extractTrackChanges(docxPath) {
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
 * Extract Word document content with track changes preserved as CriticMarkup
 * Uses pandoc with track-changes=all option to preserve insertions/deletions
 *
 * @param {string} docxPath - Path to Word document
 * @param {object} options - Options
 * @param {string} options.mediaDir - Directory for extracted media
 * @returns {Promise<{text: string, hasTrackChanges: boolean, stats: object}>}
 */
export async function extractWithTrackChanges(docxPath, options = {}) {
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

  let text;
  try {
    text = execSync(`pandoc ${pandocArgs}`, {
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });
  } catch (err) {
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
