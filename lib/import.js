/**
 * Import functionality - convert Word docs to annotated Markdown
 */

import * as fs from 'fs';
import * as path from 'path';
import { diffWords } from 'diff';

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
 * Extract comment anchor texts from document.xml
 * Returns map of comment ID -> anchor text (the text the comment refers to)
 * @param {string} docxPath
 * @returns {Promise<Map<string, string>>}
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

    // Find commentRangeStart...commentRangeEnd pairs
    // Pattern: <w:commentRangeStart w:id="X"/>...text...<w:commentRangeEnd w:id="X"/>
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
        anchors.set(id, anchorText.trim());
      }
    }
  } catch (err) {
    console.error('Error extracting comment anchors:', err.message);
  }

  return anchors;
}

/**
 * Extract text from Word document using mammoth
 * @param {string} docxPath
 * @returns {Promise<{text: string, comments: Array, anchors: Map}>}
 */
export async function extractFromWord(docxPath) {
  const mammoth = await import('mammoth');

  // Extract raw text
  const textResult = await mammoth.extractRawText({ path: docxPath });

  // Try to extract with messages (may include comments info)
  const htmlResult = await mammoth.convertToHtml({ path: docxPath });

  // Extract comments directly from docx XML
  const comments = await extractWordComments(docxPath);

  // Extract comment anchor texts
  const anchors = await extractCommentAnchors(docxPath);

  return {
    text: textResult.value,
    comments,
    anchors,
    messages: [...textResult.messages, ...htmlResult.messages],
  };
}

/**
 * Insert comments into markdown text based on anchor texts
 * @param {string} markdown - The markdown text
 * @param {Array} comments - Array of {id, author, text}
 * @param {Map} anchors - Map of comment id -> anchor text
 * @returns {string} - Markdown with comments inserted
 */
export function insertCommentsIntoMarkdown(markdown, comments, anchors) {
  let result = markdown;

  // Sort comments by anchor position (roughly) to avoid offset issues
  // Process in reverse order of position in text
  const commentsWithPositions = comments.map((c) => {
    const anchor = anchors.get(c.id);
    if (!anchor) return { ...c, pos: -1, anchor: null };

    // Find anchor in markdown (normalize whitespace for matching)
    const normalizedAnchor = anchor.replace(/\s+/g, '\\s+').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(normalizedAnchor.substring(0, Math.min(50, normalizedAnchor.length)), 'i');
    const match = result.match(regex);
    const pos = match ? result.indexOf(match[0]) + match[0].length : -1;

    return { ...c, pos, anchor };
  }).filter((c) => c.pos > 0);

  // Sort by position descending (insert from end to avoid offset issues)
  commentsWithPositions.sort((a, b) => b.pos - a.pos);

  // Insert each comment
  for (const c of commentsWithPositions) {
    const commentMark = ` {>>${c.author}: ${c.text}<<}`;
    result = result.slice(0, c.pos) + commentMark + result.slice(c.pos);
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
  // First protect math (before citations, since citations might be inside math)
  const { text: mdWithMathProtected, mathBlocks } = protectMath(originalMd);

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

  // Restore protected content (citations first, then math)
  let finalResult = result.join('\n\n');
  finalResult = restoreCitations(finalResult, citations);
  finalResult = restoreMath(finalResult, mathBlocks);

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
 * @param {{author?: string, sectionContent?: string}} options
 * @returns {Promise<{annotated: string, stats: object}>}
 */
export async function importFromWord(docxPath, originalMdPath, options = {}) {
  const { author = 'Reviewer', sectionContent } = options;

  // Use provided section content or extract from Word
  let wordText;
  if (sectionContent !== undefined) {
    wordText = sectionContent;
  } else {
    const extracted = await extractFromWord(docxPath);
    wordText = extracted.text;
  }

  // Read original markdown
  const originalMd = fs.readFileSync(originalMdPath, 'utf-8');

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
  };
}
