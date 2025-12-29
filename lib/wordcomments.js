/**
 * Word comment injection - injects CriticMarkup comments as proper Word comments
 *
 * This module takes a clean DOCX and injects Word comments based on
 * CriticMarkup annotations from the source markdown.
 */

import * as fs from 'fs';
import AdmZip from 'adm-zip';
import { getComments, stripAnnotations } from './annotations.js';

/**
 * Escape XML special characters
 * @param {string} str
 * @returns {string}
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generate a unique comment ID
 * @param {number} index
 * @returns {string}
 */
function generateCommentId(index) {
  return String(index);
}

/**
 * Create the comments.xml content
 * @param {Array<{id: string, author: string, text: string, replies?: Array}>} comments
 * @returns {string}
 */
function createCommentsXml(comments) {
  const now = new Date().toISOString();

  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  xml += '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ';
  xml += 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n';

  for (const comment of comments) {
    xml += `  <w:comment w:id="${comment.id}" w:author="${escapeXml(comment.author)}" w:date="${now}">\n`;
    xml += `    <w:p>\n`;
    xml += `      <w:r>\n`;
    xml += `        <w:t>${escapeXml(comment.text)}</w:t>\n`;
    xml += `      </w:r>\n`;
    xml += `    </w:p>\n`;
    xml += `  </w:comment>\n`;

    // Add replies as separate comments with parent reference
    if (comment.replies) {
      for (const reply of comment.replies) {
        xml += `  <w:comment w:id="${reply.id}" w:author="${escapeXml(reply.author)}" w:date="${now}">\n`;
        xml += `    <w:p>\n`;
        xml += `      <w:r>\n`;
        xml += `        <w:t>${escapeXml(reply.text)}</w:t>\n`;
        xml += `      </w:r>\n`;
        xml += `    </w:p>\n`;
        xml += `  </w:comment>\n`;
      }
    }
  }

  xml += '</w:comments>';
  return xml;
}

/**
 * Create commentsExtended.xml for reply threading
 * @param {Array<{id: string, replies?: Array}>} comments
 * @returns {string}
 */
function createCommentsExtendedXml(comments) {
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  xml += '<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">\n';

  for (const comment of comments) {
    // Mark the parent comment as done=0 (open)
    xml += `  <w15:commentEx w15:paraId="${comment.id}" w15:done="0"/>\n`;

    if (comment.replies) {
      for (const reply of comment.replies) {
        // Link replies to parent
        xml += `  <w15:commentEx w15:paraId="${reply.id}" w15:paraIdParent="${comment.id}" w15:done="0"/>\n`;
      }
    }
  }

  xml += '</w15:commentsEx>';
  return xml;
}

/**
 * Find text in document.xml and get surrounding context for anchor matching
 * @param {string} documentXml
 * @param {string} searchText
 * @param {number} startFrom - position to start searching from
 * @returns {{found: boolean, runIndex: number, textIndex: number, position: number}|null}
 */
function findTextPosition(documentXml, searchText, startFrom = 0) {
  // Normalize search text
  const normalized = searchText.trim().replace(/\s+/g, ' ');
  if (!normalized) return null;

  // Extract all text content and map to XML positions
  const textPattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let match;
  let fullText = '';
  const positions = [];

  while ((match = textPattern.exec(documentXml)) !== null) {
    if (match.index < startFrom) continue;

    positions.push({
      xmlStart: match.index,
      xmlEnd: match.index + match[0].length,
      textStart: fullText.length,
      text: match[1],
    });
    fullText += match[1];
  }

  // Find the search text in the combined text
  const idx = fullText.indexOf(normalized);
  if (idx === -1) {
    // Try partial match (first 50 chars)
    const partial = normalized.slice(0, 50);
    const partialIdx = fullText.indexOf(partial);
    if (partialIdx === -1) return null;

    // Find which position block contains this
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      if (pos.textStart <= partialIdx && pos.textStart + pos.text.length > partialIdx) {
        return {
          found: true,
          position: pos.xmlStart,
          runStart: pos.xmlStart,
          runEnd: pos.xmlEnd,
        };
      }
    }
  }

  // Find which position block contains the start of the match
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    if (pos.textStart <= idx && pos.textStart + pos.text.length > idx) {
      return {
        found: true,
        position: pos.xmlStart,
        runStart: pos.xmlStart,
        runEnd: pos.xmlEnd,
      };
    }
  }

  return null;
}

/**
 * Get context text before a comment in the markdown
 * @param {string} markdown
 * @param {number} commentPosition
 * @returns {string}
 */
function getAnchorText(markdown, commentPosition) {
  // Look backwards from comment position to find anchor text
  // The anchor is typically the text immediately before the comment
  const textBefore = markdown.slice(Math.max(0, commentPosition - 200), commentPosition);

  // Get the last sentence or phrase before the comment
  // Split on sentence boundaries
  const sentences = textBefore.split(/[.!?]\s+/);
  if (sentences.length > 0) {
    let anchor = sentences[sentences.length - 1].trim();
    // Clean up any markup
    anchor = stripAnnotations(anchor);
    // Take last 100 chars max
    if (anchor.length > 100) {
      anchor = anchor.slice(-100);
    }
    return anchor;
  }

  return textBefore.slice(-50);
}

/**
 * Parse CriticMarkup comments including replies
 * Format: {>>Author: comment<<} {>>Replier: reply<<}
 * @param {string} markdown
 * @returns {Array<{author: string, text: string, anchor: string, position: number, replies: Array}>}
 */
function parseCommentsWithReplies(markdown) {
  const comments = [];
  // Use non-greedy match to find content between {>> and <<}
  const commentPattern = /\{>>(.+?)<<\}/g;
  let match;

  while ((match = commentPattern.exec(markdown)) !== null) {
    const fullMatch = match[1];
    const position = match.index;

    // Parse author and text
    let author = 'Unknown';
    let text = fullMatch;

    const colonIdx = fullMatch.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) {
      author = fullMatch.slice(0, colonIdx).trim();
      text = fullMatch.slice(colonIdx + 1).trim();
    }

    // Check if this is a reply to the previous comment (immediately follows another comment)
    const textBefore = markdown.slice(Math.max(0, position - 5), position).trim();
    const isReply = textBefore.endsWith('<<}');

    if (isReply && comments.length > 0) {
      // Add as reply to previous comment
      const parent = comments[comments.length - 1];
      if (!parent.replies) parent.replies = [];
      parent.replies.push({ author, text });
    } else {
      // New comment
      const anchor = getAnchorText(markdown, position);
      comments.push({
        author,
        text,
        anchor,
        position,
        replies: [],
      });
    }
  }

  return comments;
}

/**
 * Inject comments into a DOCX file
 * @param {string} docxPath - Path to the clean DOCX
 * @param {string} markdown - Source markdown with CriticMarkup comments
 * @param {string} outputPath - Path for output DOCX with comments
 * @returns {Promise<{success: boolean, commentCount: number, error?: string}>}
 */
export async function injectComments(docxPath, markdown, outputPath) {
  try {
    if (!fs.existsSync(docxPath)) {
      return { success: false, commentCount: 0, error: `File not found: ${docxPath}` };
    }

    // Parse comments from markdown
    const parsedComments = parseCommentsWithReplies(markdown);

    if (parsedComments.length === 0) {
      // No comments to inject, just copy the file
      fs.copyFileSync(docxPath, outputPath);
      return { success: true, commentCount: 0 };
    }

    // Read the DOCX
    const zip = new AdmZip(docxPath);

    // Get document.xml
    const documentEntry = zip.getEntry('word/document.xml');
    if (!documentEntry) {
      return { success: false, commentCount: 0, error: 'Invalid DOCX: no document.xml' };
    }

    let documentXml = zip.readAsText(documentEntry);

    // Assign IDs to comments and replies
    let nextId = 0;
    const commentsWithIds = parsedComments.map(c => {
      const comment = {
        ...c,
        id: generateCommentId(nextId++),
      };
      if (c.replies) {
        comment.replies = c.replies.map(r => ({
          ...r,
          id: generateCommentId(nextId++),
        }));
      }
      return comment;
    });

    // Find anchor positions and inject comment ranges
    const injections = [];
    let searchFrom = 0;

    for (const comment of commentsWithIds) {
      const pos = findTextPosition(documentXml, comment.anchor, searchFrom);

      if (pos && pos.found) {
        // We'll inject the comment range around this position
        injections.push({
          comment,
          position: pos.position,
          runStart: pos.runStart,
          runEnd: pos.runEnd,
        });
        searchFrom = pos.position + 1;
      }
    }

    // Sort injections by position (reverse order for safe modification)
    injections.sort((a, b) => b.position - a.position);

    // Inject comment range markers into document.xml
    for (const inj of injections) {
      const { comment, runStart, runEnd } = inj;

      // Find the <w:r> element containing this text
      // Insert commentRangeStart before the run and commentRangeEnd after

      // Find the start of the <w:r> containing this position
      const rStartMatch = documentXml.lastIndexOf('<w:r', runStart);
      if (rStartMatch === -1) continue;

      // Find the end of this </w:r>
      const rEndMatch = documentXml.indexOf('</w:r>', runEnd);
      if (rEndMatch === -1) continue;
      const rEnd = rEndMatch + '</w:r>'.length;

      // Generate comment IDs list (main + replies for reference linking)
      const allIds = [comment.id];
      if (comment.replies) {
        allIds.push(...comment.replies.map(r => r.id));
      }

      // Insert commentRangeEnd and commentReference after the run
      let endMarker = `<w:commentRangeEnd w:id="${comment.id}"/>`;
      endMarker += `<w:r><w:commentReference w:id="${comment.id}"/></w:r>`;

      documentXml = documentXml.slice(0, rEnd) + endMarker + documentXml.slice(rEnd);

      // Insert commentRangeStart before the run
      const startMarker = `<w:commentRangeStart w:id="${comment.id}"/>`;
      documentXml = documentXml.slice(0, rStartMatch) + startMarker + documentXml.slice(rStartMatch);
    }

    // Update document.xml in the zip
    zip.updateFile('word/document.xml', Buffer.from(documentXml, 'utf-8'));

    // Create comments.xml
    const commentsXml = createCommentsXml(commentsWithIds);

    // Check if comments.xml already exists
    if (zip.getEntry('word/comments.xml')) {
      zip.updateFile('word/comments.xml', Buffer.from(commentsXml, 'utf-8'));
    } else {
      zip.addFile('word/comments.xml', Buffer.from(commentsXml, 'utf-8'));
    }

    // Create commentsExtended.xml for reply threading (Word 2013+)
    const hasReplies = commentsWithIds.some(c => c.replies && c.replies.length > 0);
    if (hasReplies) {
      const commentsExtXml = createCommentsExtendedXml(commentsWithIds);
      if (zip.getEntry('word/commentsExtended.xml')) {
        zip.updateFile('word/commentsExtended.xml', Buffer.from(commentsExtXml, 'utf-8'));
      } else {
        zip.addFile('word/commentsExtended.xml', Buffer.from(commentsExtXml, 'utf-8'));
      }
    }

    // Update [Content_Types].xml to include comments
    const contentTypesEntry = zip.getEntry('[Content_Types].xml');
    if (contentTypesEntry) {
      let contentTypes = zip.readAsText(contentTypesEntry);

      // Add comments content type if not present
      if (!contentTypes.includes('comments.xml')) {
        const insertPoint = contentTypes.lastIndexOf('</Types>');
        const commentType = '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>';
        contentTypes = contentTypes.slice(0, insertPoint) + commentType + '\n' + contentTypes.slice(insertPoint);
      }

      // Add commentsExtended if we have replies
      if (hasReplies && !contentTypes.includes('commentsExtended.xml')) {
        const insertPoint = contentTypes.lastIndexOf('</Types>');
        const extType = '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>';
        contentTypes = contentTypes.slice(0, insertPoint) + extType + '\n' + contentTypes.slice(insertPoint);
      }

      zip.updateFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf-8'));
    }

    // Update word/_rels/document.xml.rels to include comments relationship
    const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
    if (relsEntry) {
      let rels = zip.readAsText(relsEntry);

      // Find max rId
      const rIdMatches = rels.match(/rId(\d+)/g) || [];
      const maxId = rIdMatches.reduce((max, r) => {
        const num = parseInt(r.replace('rId', ''));
        return num > max ? num : max;
      }, 0);

      // Add comments relationship if not present
      if (!rels.includes('comments.xml')) {
        const insertPoint = rels.lastIndexOf('</Relationships>');
        const commentRel = `<Relationship Id="rId${maxId + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>`;
        rels = rels.slice(0, insertPoint) + commentRel + '\n' + rels.slice(insertPoint);
      }

      // Add commentsExtended relationship if needed
      if (hasReplies && !rels.includes('commentsExtended.xml')) {
        const insertPoint = rels.lastIndexOf('</Relationships>');
        const extRel = `<Relationship Id="rId${maxId + 2}" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>`;
        rels = rels.slice(0, insertPoint) + extRel + '\n' + rels.slice(insertPoint);
      }

      zip.updateFile('word/_rels/document.xml.rels', Buffer.from(rels, 'utf-8'));
    }

    // Write the output file
    zip.writeZip(outputPath);

    const totalComments = commentsWithIds.reduce((sum, c) => {
      return sum + 1 + (c.replies ? c.replies.length : 0);
    }, 0);

    return { success: true, commentCount: totalComments };

  } catch (err) {
    return { success: false, commentCount: 0, error: err.message };
  }
}

/**
 * Build DOCX with proper Word comments from markdown
 * @param {string} cleanDocxPath - Path to clean DOCX (built without comments)
 * @param {string} markdownPath - Path to markdown with CriticMarkup comments
 * @param {string} outputPath - Path for output DOCX with Word comments
 * @returns {Promise<{success: boolean, commentCount: number, error?: string}>}
 */
export async function buildWithComments(cleanDocxPath, markdownPath, outputPath) {
  const markdown = fs.readFileSync(markdownPath, 'utf-8');
  return injectComments(cleanDocxPath, markdown, outputPath);
}
