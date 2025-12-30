/**
 * Import functionality - convert Word docs to annotated Markdown
 */

import * as fs from 'fs';
import * as path from 'path';
import { diffWords } from 'diff';
import { stripAnnotations } from './annotations.js';
import { exec } from 'child_process';
import { promisify } from 'util';

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

  try {
    const zip = new AdmZip(docxPath);
    const commentsEntry = zip.getEntry('word/comments.xml');

    if (!commentsEntry) {
      return comments;
    }

    const commentsXml = commentsEntry.getData().toString('utf8');
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
    console.error('Error extracting comments:', err.message);
  }

  return comments;
}

/**
 * Extract comment anchor texts from document.xml with surrounding context
 * Returns map of comment ID -> {anchor, before, after} for better matching
 * @param {string} docxPath
 * @returns {Promise<Map<string, {anchor: string, before: string, after: string}>>}
 */
export async function extractCommentAnchors(docxPath) {
  const AdmZip = (await import('adm-zip')).default;
  const anchors = new Map();

  try {
    const zip = new AdmZip(docxPath);
    const docEntry = zip.getEntry('word/document.xml');

    if (!docEntry) {
      return anchors;
    }

    const docXml = docEntry.getData().toString('utf8');

    // Extract ALL text nodes in document order for context
    const allTextNodes = [...docXml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map(m => m[1]);
    const fullDocText = allTextNodes.join('');

    // Find commentRangeStart...commentRangeEnd pairs
    const rangePattern = /<w:commentRangeStart[^>]*w:id="(\d+)"[^>]*\/?>[\s\S]*?<w:commentRangeEnd[^>]*w:id="\1"[^>]*\/?>/g;

    let match;
    while ((match = rangePattern.exec(docXml)) !== null) {
      const id = match[1];
      const rangeContent = match[0];

      // Extract all w:t text within this range
      const textMatches = rangeContent.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g);
      let anchorText = '';
      for (const tm of textMatches) {
        anchorText += tm[1];
      }

      if (anchorText.trim()) {
        // Get surrounding context from full document
        const anchorPos = fullDocText.indexOf(anchorText.trim());
        let before = '';
        let after = '';

        if (anchorPos >= 0) {
          // Get ~100 chars before (up to sentence boundary)
          const beforeText = fullDocText.slice(Math.max(0, anchorPos - 150), anchorPos);
          const sentenceStart = beforeText.search(/[.!?]\s+[A-Z][^.!?]*$/);
          before = sentenceStart >= 0 ? beforeText.slice(sentenceStart + 2).trim() : beforeText.slice(-80).trim();

          // Get ~100 chars after (up to sentence boundary)
          const afterStart = anchorPos + anchorText.length;
          const afterText = fullDocText.slice(afterStart, afterStart + 150);
          const sentenceEnd = afterText.search(/[.!?]\s/);
          after = sentenceEnd >= 0 ? afterText.slice(0, sentenceEnd + 1).trim() : afterText.slice(0, 80).trim();
        }

        anchors.set(id, { anchor: anchorText.trim(), before, after });
      }
    }
  } catch (err) {
    console.error('Error extracting comment anchors:', err.message);
  }

  return anchors;
}

/**
 * Extract text from Word document using pandoc (preserves equations as LaTeX)
 * Falls back to mammoth if pandoc fails
 * @param {string} docxPath
 * @param {object} options - { mediaDir: string } - Directory to extract images to
 * @returns {Promise<{text: string, comments: Array, anchors: Map, extractedMedia: string[]}>}
 */
export async function extractFromWord(docxPath, options = {}) {
  let text;
  let messages = [];
  let extractedMedia = [];

  // Determine media extraction directory
  const docxDir = path.dirname(docxPath);
  const mediaDir = options.mediaDir || path.join(docxDir, 'media');

  // Try pandoc first (preserves OMML equations as LaTeX and extracts images)
  try {
    // Use --extract-media to save images from the Word document
    const { stdout } = await execAsync(
      `pandoc "${docxPath}" -t markdown --wrap=none --extract-media="${mediaDir}"`,
      { maxBuffer: 50 * 1024 * 1024 }
    );
    text = stdout;

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
  const { quiet = false } = options;
  let result = markdown;
  let unmatchedCount = 0;
  const duplicateWarnings = [];
  const usedPositions = new Set(); // For tie-breaking: track used positions

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

    const anchorLower = anchor.toLowerCase();
    const resultLower = result.toLowerCase();

    // Find ALL occurrences of anchor text
    const occurrences = [];
    let searchIdx = 0;
    while ((searchIdx = resultLower.indexOf(anchorLower, searchIdx)) !== -1) {
      occurrences.push(searchIdx);
      searchIdx += 1;
    }

    if (occurrences.length === 0) {
      // Try normalized whitespace match
      const normalizedAnchor = anchor.replace(/\s+/g, ' ').toLowerCase();
      const normalizedResult = result.replace(/\s+/g, ' ').toLowerCase();
      const normalizedIdx = normalizedResult.indexOf(normalizedAnchor);

      if (normalizedIdx !== -1) {
        return { ...c, pos: normalizedIdx + anchor.length, anchorText: anchor };
      }
      unmatchedCount++;
      return { ...c, pos: -1, anchorText: null };
    }

    if (occurrences.length === 1) {
      // Unique match - easy case
      return { ...c, pos: occurrences[0] + anchor.length, anchorText: anchor };
    }

    // Multiple occurrences - use context for disambiguation
    duplicateWarnings.push(`"${anchor.slice(0, 40)}${anchor.length > 40 ? '...' : ''}" appears ${occurrences.length} times`);

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
        const contextAfter = result.slice(pos + anchor.length, pos + anchor.length + after.length + 20).toLowerCase();
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

    return { ...c, pos: bestIdx + anchor.length, anchorText: anchor };
  }).filter((c) => c.pos > 0);

  // Sort by position descending (insert from end to avoid offset issues)
  commentsWithPositions.sort((a, b) => b.pos - a.pos);

  // Insert each comment
  for (const c of commentsWithPositions) {
    const commentMark = ` {>>${c.author}: ${c.text}<<}`;
    result = result.slice(0, c.pos) + commentMark + result.slice(c.pos);
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
function normalizeText(text) {
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
  const normalizedOriginal = normalizeText(originalMd);
  const normalizedWord = normalizeText(wordText);

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
 * Extract markdown prefix (headers, list markers) from a line
 * @param {string} line
 * @returns {{prefix: string, content: string}}
 */
function extractMarkdownPrefix(line) {
  // Headers
  const headerMatch = line.match(/^(#{1,6}\s+)/);
  if (headerMatch) {
    return { prefix: headerMatch[1], content: line.slice(headerMatch[1].length) };
  }

  // List items
  const listMatch = line.match(/^(\s*[-*+]\s+|\s*\d+\.\s+)/);
  if (listMatch) {
    return { prefix: listMatch[1], content: line.slice(listMatch[1].length) };
  }

  // Blockquotes
  const quoteMatch = line.match(/^(>\s*)/);
  if (quoteMatch) {
    return { prefix: quoteMatch[1], content: line.slice(quoteMatch[1].length) };
  }

  return { prefix: '', content: line };
}

/**
 * Protect figure/table anchors before diffing
 * Anchors like {#fig:heatmap} and {#tbl:results} should never be deleted
 * @param {string} md
 * @returns {{text: string, anchors: Array<{original: string, placeholder: string}>}}
 */
function protectAnchors(md) {
  const anchors = [];

  // Match {#fig:label}, {#tbl:label}, {#eq:label}, {#sec:label} etc.
  // Also match with additional attributes like {#fig:label width=50%}
  const text = md.replace(/\{#(fig|tbl|eq|sec|lst):[^}]+\}/g, (match) => {
    const idx = anchors.length;
    const placeholder = `ANCHORBLOCK${idx}ENDANCHOR`;
    anchors.push({ original: match, placeholder });
    return placeholder;
  });

  return { text, anchors };
}

/**
 * Restore anchors from placeholders
 * @param {string} text
 * @param {Array} anchors
 * @returns {string}
 */
function restoreAnchors(text, anchors) {
  for (const anchor of anchors) {
    // Handle case where anchor is inside a deletion annotation
    // {--...ANCHORBLOCK0ENDANCHOR--} should become {--...--}{#fig:label}
    const deletionPattern = new RegExp(`\\{--([^}]*?)${anchor.placeholder}([^}]*?)--\\}`, 'g');
    text = text.replace(deletionPattern, (match, before, after) => {
      const cleanBefore = before.trim();
      const cleanAfter = after.trim();
      let result = '';
      if (cleanBefore) result += `{--${cleanBefore}--}`;
      result += anchor.original;
      if (cleanAfter) result += `{--${cleanAfter}--}`;
      return result;
    });

    // Handle case where anchor is inside a substitution
    // {~~old ANCHORBLOCK0ENDANCHOR~>new~~} -> {~~old~>new~~}{#fig:label}
    const substitutionPattern = new RegExp(`\\{~~([^~]*?)${anchor.placeholder}([^~]*?)~>([^~]*)~~\\}`, 'g');
    text = text.replace(substitutionPattern, (match, oldBefore, oldAfter, newText) => {
      const cleanOldBefore = oldBefore.trim();
      const cleanOldAfter = oldAfter.trim();
      const cleanNew = newText.trim();
      const oldText = (cleanOldBefore + ' ' + cleanOldAfter).trim();
      let result = '';
      if (oldText !== cleanNew) {
        result += `{~~${oldText}~>${cleanNew}~~}`;
      } else {
        result += cleanNew;
      }
      result += anchor.original;
      return result;
    });

    // Normal replacement
    text = text.split(anchor.placeholder).join(anchor.original);
  }
  return text;
}

/**
 * Protect cross-references before diffing
 * References like @fig:label, @tbl:label should be preserved
 * @param {string} md
 * @returns {{text: string, crossrefs: Array<{original: string, placeholder: string}>}}
 */
function protectCrossrefs(md) {
  const crossrefs = [];

  // Match @fig:label, @tbl:label, @eq:label, @sec:label
  // Can appear as @fig:label or (@fig:label) or [@fig:label]
  const text = md.replace(/@(fig|tbl|eq|sec|lst):[a-zA-Z0-9_-]+/g, (match) => {
    const idx = crossrefs.length;
    const placeholder = `XREFBLOCK${idx}ENDXREF`;
    crossrefs.push({ original: match, placeholder });
    return placeholder;
  });

  return { text, crossrefs };
}

/**
 * Restore cross-references from placeholders
 * @param {string} text
 * @param {Array} crossrefs
 * @returns {string}
 */
function restoreCrossrefs(text, crossrefs) {
  for (const xref of crossrefs) {
    // Handle deletions - restore the reference even if marked deleted
    const deletionPattern = new RegExp(`\\{--([^}]*?)${xref.placeholder}([^}]*?)--\\}`, 'g');
    text = text.replace(deletionPattern, (match, before, after) => {
      const cleanBefore = before.trim();
      const cleanAfter = after.trim();
      let result = '';
      if (cleanBefore) result += `{--${cleanBefore}--}`;
      result += xref.original;
      if (cleanAfter) result += `{--${cleanAfter}--}`;
      return result;
    });

    // Handle substitutions where rendered form (Figure 1) replaced the reference
    // {~~XREFBLOCK0ENDXREF~>Figure 1~~} -> @fig:label
    const substitutionPattern = new RegExp(`\\{~~${xref.placeholder}~>[^~]+~~\\}`, 'g');
    text = text.replace(substitutionPattern, xref.original);

    // Normal replacement
    text = text.split(xref.placeholder).join(xref.original);
  }
  return text;
}

/**
 * Protect mathematical notation before diffing by replacing with placeholders
 * Handles both inline $...$ and display $$...$$ math
 * @param {string} md
 * @returns {{text: string, mathBlocks: Array<{original: string, placeholder: string, type: string, simplified: string}>}}
 */
function protectMath(md) {
  const mathBlocks = [];

  // First protect display math ($$...$$) - must be done before inline math
  let text = md.replace(/\$\$([^$]+)\$\$/g, (match, content) => {
    const idx = mathBlocks.length;
    const placeholder = `MATHBLOCK${idx}ENDMATH`;
    // Create simplified version for matching in Word text
    const simplified = simplifyMathForMatching(content);
    mathBlocks.push({ original: match, placeholder, type: 'display', simplified });
    return placeholder;
  });

  // Then protect inline math ($...$)
  text = text.replace(/\$([^$\n]+)\$/g, (match, content) => {
    const idx = mathBlocks.length;
    const placeholder = `MATHBLOCK${idx}ENDMATH`;
    const simplified = simplifyMathForMatching(content);
    mathBlocks.push({ original: match, placeholder, type: 'inline', simplified });
    return placeholder;
  });

  return { text, mathBlocks };
}

/**
 * Simplify LaTeX math for fuzzy matching against Word text
 * Word renders math as text, so we need to match the rendered form
 * @param {string} latex
 * @returns {string}
 */
function simplifyMathForMatching(latex) {
  return latex
    // Remove common LaTeX commands
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\hat\{([^}]+)\}/g, '$1')
    .replace(/\\bar\{([^}]+)\}/g, '$1')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2')
    .replace(/\\sum_([a-z])/g, 'Σ')
    .replace(/\\sum/g, 'Σ')
    .replace(/\\cdot/g, '·')
    .replace(/\\quad/g, ' ')
    .replace(/\\,/g, ' ')
    .replace(/\\_/g, '_')
    .replace(/\\{/g, '{')
    .replace(/\\}/g, '}')
    .replace(/\\/g, '')  // Remove remaining backslashes
    .replace(/[{}]/g, '')  // Remove braces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Restore math from placeholders
 * @param {string} text
 * @param {Array} mathBlocks
 * @returns {string}
 */
function restoreMath(text, mathBlocks) {
  for (const block of mathBlocks) {
    text = text.split(block.placeholder).join(block.original);
  }
  return text;
}

/**
 * Replace rendered math in Word text with matching placeholders
 * This is heuristic-based since Word can render math in various ways
 * @param {string} wordText
 * @param {Array} mathBlocks
 * @returns {string}
 */
function replaceRenderedMath(wordText, mathBlocks) {
  let result = wordText;

  for (const block of mathBlocks) {
    // For inline math, try to find the simplified form in Word text
    if (block.simplified.length >= 2) {
      // Try exact match first
      if (result.includes(block.simplified)) {
        result = result.replace(block.simplified, block.placeholder);
      }
    }
  }

  return result;
}

/**
 * Protect citations before diffing by replacing with placeholders
 * @param {string} md
 * @returns {{text: string, citations: string[]}}
 */
function protectCitations(md) {
  const citations = [];
  const text = md.replace(/\[@[^\]]+\]/g, (match) => {
    const idx = citations.length;
    citations.push(match);
    return `CITEREF${idx}ENDCITE`;
  });
  return { text, citations };
}

/**
 * Restore citations from placeholders
 * @param {string} text
 * @param {string[]} citations
 * @returns {string}
 */
function restoreCitations(text, citations) {
  for (let i = 0; i < citations.length; i++) {
    // Handle cases where placeholder might be inside annotations
    const placeholder = `CITEREF${i}ENDCITE`;
    text = text.split(placeholder).join(citations[i]);
  }
  return text;
}

/**
 * Remove rendered citations from Word text (replace with matching placeholders)
 * @param {string} wordText
 * @param {number} count
 * @returns {string}
 */
function replaceRenderedCitations(wordText, count) {
  // Match rendered citation patterns: (Author 2021), (Author et al. 2021), etc.
  const pattern = /\((?:[A-Z][a-zé]+(?:\s+et\s+al\.?)?(?:\s*[&,;]\s*[A-Z][a-zé]+(?:\s+et\s+al\.?)?)*\s+\d{4}(?:[a-z])?(?:\s*[,;]\s*(?:[A-Z][a-zé]+(?:\s+et\s+al\.?)?\s+)?\d{4}(?:[a-z])?)*)\)/g;

  let idx = 0;
  return wordText.replace(pattern, (match) => {
    if (idx < count) {
      const placeholder = `CITEREF${idx}ENDCITE`;
      idx++;
      return placeholder;
    }
    return match;
  });
}

/**
 * Smart paragraph-level diff that preserves markdown structure
 * @param {string} originalMd
 * @param {string} wordText
 * @param {string} author
 * @returns {string}
 */
export function generateSmartDiff(originalMd, wordText, author = 'Reviewer') {
  // Protection order matters: anchors first, then crossrefs, math, citations

  // Protect figure/table anchors (CRITICAL - these must never be deleted)
  const { text: mdWithAnchorsProtected, anchors: figAnchors } = protectAnchors(originalMd);

  // Protect cross-references (@fig:label, @tbl:label)
  const { text: mdWithXrefsProtected, crossrefs } = protectCrossrefs(mdWithAnchorsProtected);

  // Protect math (before citations, since citations might be inside math)
  const { text: mdWithMathProtected, mathBlocks } = protectMath(mdWithXrefsProtected);

  // Then protect citations
  const { text: mdProtected, citations } = protectCitations(mdWithMathProtected);

  // Replace rendered math and citations in Word text with matching placeholders
  let wordProtected = replaceRenderedMath(wordText, mathBlocks);
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
      const wordNormalized = normalizeText(word);

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
      result.push(`{--${orig}--}`);
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

  // Clean up double spaces
  text = text.replace(/  +/g, ' ');

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
 * Full import pipeline: Word doc → annotated MD
 * @param {string} docxPath - Path to Word document
 * @param {string} originalMdPath - Path to original markdown
 * @param {{author?: string, sectionContent?: string, figuresDir?: string}} options
 * @returns {Promise<{annotated: string, stats: object, extractedMedia: string[]}>}
 */
export async function importFromWord(docxPath, originalMdPath, options = {}) {
  const { author = 'Reviewer', sectionContent, figuresDir } = options;

  // Use provided section content or extract from Word
  let wordText;
  let extractedMedia = [];

  if (sectionContent !== undefined) {
    wordText = sectionContent;
  } else {
    // Determine media directory - use figuresDir if provided, otherwise extract next to docx
    const docxDir = path.dirname(docxPath);
    const mediaDir = figuresDir || docxDir;

    const extracted = await extractFromWord(docxPath, { mediaDir });
    wordText = extracted.text;
    extractedMedia = extracted.extractedMedia || [];

    // Log any messages
    for (const msg of extracted.messages || []) {
      if (msg.type === 'info') {
        console.log(msg.message);
      } else if (msg.type === 'warning') {
        console.warn(`Warning: ${msg.message}`);
      }
    }
  }

  // Read original markdown
  let originalMd = fs.readFileSync(originalMdPath, 'utf-8');

  // IMPORTANT: Strip any existing annotations to prevent nested annotations
  // This ensures we always diff clean text against Word text
  originalMd = stripAnnotations(originalMd, { keepComments: false });

  // Generate diff
  let annotated = generateSmartDiff(originalMd, wordText, author);

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
