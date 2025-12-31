/**
 * Word comment injection with reply threading
 *
 * Flow:
 * 1. prepareMarkdownWithMarkers() - Parse comments, detect reply relationships
 *    - First comment in a cluster = parent (gets markers: ⟦CMS:n⟧anchor⟦CME:n⟧)
 *    - Subsequent adjacent comments = replies (no markers, attach to parent)
 * 2. Pandoc converts to DOCX
 * 3. injectCommentsAtMarkers() - Insert comment ranges for parents only
 *    - Replies go in comments.xml with parent reference in commentsExtended.xml
 */

import * as fs from 'fs';
import AdmZip from 'adm-zip';

const MARKER_START_PREFIX = '⟦CMS:';
const MARKER_END_PREFIX = '⟦CME:';
const MARKER_SUFFIX = '⟧';

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateParaId(commentIdx, paraNum) {
  // Generate 8-character uppercase hex ID matching Word format
  // Word uses IDs like "3F25BC58", "0331C187"
  // Must be deterministic - same inputs always produce same output
  const id = 0x10000000 + (commentIdx * 0x00100000) + (paraNum * 0x00001000);
  return id.toString(16).toUpperCase().padStart(8, '0');
}

/**
 * Parse comments and create markers
 *
 * Returns:
 * - markedMarkdown: markdown with markers for parent comments only
 * - comments: array with author, text, isReply, parentIdx
 */
export function prepareMarkdownWithMarkers(markdown) {
  // Match all comments with optional anchor
  const commentPattern = /\{>>(.+?)<<\}(?:\s*\[([^\]]+)\]\{\.mark\})?/g;

  const rawMatches = [];
  let match;
  while ((match = commentPattern.exec(markdown)) !== null) {
    const content = match[1];
    let author = 'Unknown';
    let text = content;
    const colonIdx = content.indexOf(':');
    if (colonIdx > 0 && colonIdx < 30) {
      author = content.slice(0, colonIdx).trim();
      text = content.slice(colonIdx + 1).trim();
    }

    rawMatches.push({
      author,
      text,
      anchor: match[2] || null,
      start: match.index,
      end: match.index + match[0].length,
      fullMatch: match[0]
    });
  }

  if (rawMatches.length === 0) {
    return { markedMarkdown: markdown, comments: [] };
  }

  // Detect reply relationships based on adjacency
  // First comment in a cluster = parent, all subsequent = replies to that parent
  // Comments are "adjacent" if there's only whitespace between them (< 50 chars)
  const ADJACENT_THRESHOLD = 50;
  const comments = [];
  let clusterParentIdx = -1;  // Index of first comment in current cluster
  let lastCommentEnd = -1;

  for (let i = 0; i < rawMatches.length; i++) {
    const m = rawMatches[i];

    // Check if this comment is adjacent to the previous one
    const gap = lastCommentEnd >= 0 ? m.start - lastCommentEnd : Infinity;
    const isAdjacent = gap < ADJACENT_THRESHOLD;

    // Reset cluster if there's a gap (comments not in same cluster)
    if (!isAdjacent) {
      clusterParentIdx = -1;
    }

    if (clusterParentIdx === -1) {
      // First comment in cluster = parent (regardless of author)
      comments.push({
        ...m,
        isReply: false,
        parentIdx: null,
        commentIdx: comments.length
      });
      clusterParentIdx = comments.length - 1;
    } else {
      // Subsequent comment in cluster = reply to first comment
      comments.push({
        ...m,
        isReply: true,
        parentIdx: clusterParentIdx,
        commentIdx: comments.length
      });
    }

    lastCommentEnd = m.end;
  }

  // Build marked markdown - only parent comments get markers
  // Process from end to start to preserve positions
  let markedMarkdown = markdown;

  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];

    if (c.isReply) {
      // Reply: remove from document entirely (will be in comments.xml only)
      // Also consume leading whitespace to avoid double spaces
      let removeStart = c.start;
      while (removeStart > 0 && /\s/.test(markedMarkdown[removeStart - 1])) {
        removeStart--;
      }
      markedMarkdown = markedMarkdown.slice(0, removeStart) + markedMarkdown.slice(c.end);
    } else {
      // Parent comment: replace with markers
      const anchor = c.anchor || '';
      const replacement = `${MARKER_START_PREFIX}${i}${MARKER_SUFFIX}${anchor}${MARKER_END_PREFIX}${i}${MARKER_SUFFIX}`;
      markedMarkdown = markedMarkdown.slice(0, c.start) + replacement + markedMarkdown.slice(c.end);
    }
  }

  return { markedMarkdown, comments };
}

function createCommentsXml(comments) {
  // Word expects date without milliseconds: 2025-12-30T08:33:00Z
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  // Minimal namespaces matching golden file structure
  xml += '<w:comments xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w14 w15">';

  // Use a consistent rsid (8-char hex) for all comments in this batch
  const rsid = '00' + (Date.now() % 0xFFFFFF).toString(16).toUpperCase().padStart(6, '0');

  for (const comment of comments) {
    xml += `<w:comment w:id="${comment.id}" w:author="${escapeXml(comment.author)}" w:date="${now}" w:initials="${comment.author.split(' ').map(n => n[0]).join('')}">`;
    // First paragraph: rsidRDefault="00000000", annotationRef without rStyle wrapper
    xml += `<w:p w14:paraId="${comment.paraId}" w14:textId="77777777" w:rsidR="${rsid}" w:rsidRDefault="00000000">`;
    xml += `<w:r><w:annotationRef/></w:r>`;
    xml += `<w:r><w:t>${escapeXml(comment.text)}</w:t></w:r>`;
    xml += `</w:p>`;
    if (comment.isReply) {
      // Second empty paragraph: rsidRDefault matches rsidR
      xml += `<w:p w14:paraId="${comment.paraId2}" w14:textId="77777777" w:rsidR="${rsid}" w:rsidRDefault="${rsid}"/>`;
    }
    xml += `</w:comment>`;
  }

  xml += '</w:comments>';
  return xml;
}

function createCommentsExtendedXml(comments) {
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  // Minimal namespaces matching golden file structure
  xml += '<w15:commentsEx xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" mc:Ignorable="w14 w15">';

  for (const comment of comments) {
    if (comment.isReply && comment.parentParaId) {
      // Reply: use paraId2 (the second/empty paragraph) and link to parent's paraId
      xml += `<w15:commentEx w15:paraId="${comment.paraId2}" w15:paraIdParent="${comment.parentParaId}" w15:done="0"/>`;
    } else {
      // Parent comment: use paraId (first paragraph)
      xml += `<w15:commentEx w15:paraId="${comment.paraId}" w15:done="0"/>`;
    }
  }

  xml += '</w15:commentsEx>';
  return xml;
}

function generateDurableId(index) {
  // Generate unique 8-char hex ID for durableId
  // CRITICAL: Must stay within signed 32-bit range (< 0x7FFFFFFF = 2147483647)
  // Word interprets durableIds as signed 32-bit integers
  const base = 0x10000000 + (Date.now() % 0x40000000); // Base between 0x10000000 and 0x50000000
  const id = (base + index * 0x01000000) % 0x7FFFFFFF; // Keep under signed 32-bit max
  return id.toString(16).toUpperCase().padStart(8, '0');
}

function createCommentsIdsXml(comments) {
  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  // Minimal namespaces matching golden file structure
  xml += '<w16cid:commentsIds ';
  xml += 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ';
  xml += 'xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid" ';
  xml += 'mc:Ignorable="w16cid">';

  for (const comment of comments) {
    // ONE entry per comment using the LAST paragraph's paraId:
    // - Parent comments (1 paragraph): use paraId
    // - Reply comments (2 paragraphs): use paraId2 (the second/empty paragraph)
    const useParaId = comment.isReply ? comment.paraId2 : comment.paraId;
    xml += `<w16cid:commentId w16cid:paraId="${useParaId}" w16cid:durableId="${comment.durableId}"/>`;
  }

  xml += '</w16cid:commentsIds>';
  return xml;
}

function createCommentsExtensibleXml(comments) {
  const now = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  // Minimal namespaces matching golden file structure
  xml += '<w16cex:commentsExtensible ';
  xml += 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ';
  xml += 'xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex" ';
  xml += 'mc:Ignorable="w16cex">';

  for (const comment of comments) {
    // ONE entry per comment using the durableId
    xml += `<w16cex:commentExtensible w16cex:durableId="${comment.durableId}" w16cex:dateUtc="${now}"/>`;
  }

  xml += '</w16cex:commentsExtensible>';
  return xml;
}

// Generate deterministic user IDs for authors (no hardcoded personal data)

function createPeopleXml(comments) {
  // Extract unique authors
  const authors = [...new Set(comments.map(c => c.author))];

  let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  xml += '<w15:people ';
  xml += 'xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ';
  xml += 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ';
  xml += 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ';
  xml += 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ';
  xml += 'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" ';
  xml += 'xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml" ';
  xml += 'xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex" ';
  xml += 'xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid" ';
  xml += 'xmlns:w16="http://schemas.microsoft.com/office/word/2018/wordml" ';
  xml += 'xmlns:w16sdtdh="http://schemas.microsoft.com/office/word/2020/wordml/sdtdatahash" ';
  xml += 'xmlns:w16se="http://schemas.microsoft.com/office/word/2015/wordml/symex" ';
  xml += 'mc:Ignorable="w14 w15 w16se w16cid w16 w16cex w16sdtdh">';

  for (const author of authors) {
    const userId = generateUserId(author);
    xml += `<w15:person w15:author="${escapeXml(author)}">`;
    xml += `<w15:presenceInfo w15:providerId="Windows Live" w15:userId="${userId}"/>`;
    xml += `</w15:person>`;
  }

  xml += '</w15:people>';
  return xml;
}

function generateUserId(author) {
  // Generate a deterministic 16-char hex ID from author name
  let hash = 0;
  for (let i = 0; i < author.length; i++) {
    hash = ((hash << 5) - hash) + author.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(16, '0').slice(0, 16);
}

/**
 * Inject comments at marker positions
 */
export async function injectCommentsAtMarkers(docxPath, comments, outputPath) {
  try {
    if (!fs.existsSync(docxPath)) {
      return { success: false, commentCount: 0, skippedComments: 0, error: `File not found: ${docxPath}` };
    }

    if (comments.length === 0) {
      fs.copyFileSync(docxPath, outputPath);
      return { success: true, commentCount: 0, skippedComments: 0 };
    }

    const zip = new AdmZip(docxPath);
    const documentEntry = zip.getEntry('word/document.xml');
    if (!documentEntry) {
      return { success: false, commentCount: 0, skippedComments: 0, error: 'Invalid DOCX: no document.xml' };
    }

    let documentXml = zip.readAsText(documentEntry);

    // Assign IDs and paraIds (IDs start at 1, not 0 - Word convention)
    const commentsWithIds = comments.map((c, idx) => ({
      ...c,
      id: String(idx + 1),
      paraId: generateParaId(idx, 1),       // First paragraph (e.g., 10000001)
      paraId2: generateParaId(idx, 2),      // Second paragraph (e.g., 10000002)
      durableId: generateDurableId(idx),    // Unique ID for commentsIds/commentsExtensible
    }));

    // Link replies to parent paraIds
    for (const c of commentsWithIds) {
      if (c.isReply && c.parentIdx !== null) {
        c.parentParaId = commentsWithIds[c.parentIdx].paraId;
      }
    }

    const injectedIds = new Set();

    // Process only parent comments (non-replies) for document ranges
    const parentComments = commentsWithIds.filter(c => !c.isReply);

    for (let i = parentComments.length - 1; i >= 0; i--) {
      const comment = parentComments[i];
      const idx = comment.commentIdx;

      const startMarker = `${MARKER_START_PREFIX}${idx}${MARKER_SUFFIX}`;
      const endMarker = `${MARKER_END_PREFIX}${idx}${MARKER_SUFFIX}`;

      const startPos = documentXml.indexOf(startMarker);
      const endPos = documentXml.indexOf(endMarker);

      if (startPos === -1 || endPos === -1) continue;

      // Find the <w:r> containing the markers
      const rStartBefore = documentXml.lastIndexOf('<w:r>', startPos);
      const rStartOpen = documentXml.lastIndexOf('<w:r ', startPos);
      const rStart = Math.max(rStartBefore, rStartOpen);
      const rEndPos = documentXml.indexOf('</w:r>', endPos);

      if (rStart === -1 || rEndPos === -1) continue;

      const rEnd = rEndPos + '</w:r>'.length;
      const runContent = documentXml.slice(rStart, rEnd);

      // Extract styling
      const rPrMatch = runContent.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
      const rPr = rPrMatch ? rPrMatch[0] : '';

      // Extract text
      const textMatch = runContent.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/);
      if (!textMatch) continue;

      const fullText = textMatch[1];
      const tElement = textMatch[0].match(/<w:t[^>]*>/)[0];

      const startInText = fullText.indexOf(startMarker);
      const endInText = fullText.indexOf(endMarker);
      if (startInText === -1 || endInText === -1) continue;

      let textBefore = fullText.slice(0, startInText);
      const anchorText = fullText.slice(startInText + startMarker.length, endInText);
      let textAfter = fullText.slice(endInText + endMarker.length);

      // When anchor is empty, normalize double spaces to single space
      if (!anchorText && textBefore.endsWith(' ') && textAfter.startsWith(' ')) {
        textAfter = textAfter.slice(1); // Remove leading space from textAfter
      }

      // Build replacement
      let replacement = '';

      if (textBefore) {
        replacement += `<w:r>${rPr}${tElement}${textBefore}</w:t></w:r>`;
      }

      // Find replies to this comment
      const replies = commentsWithIds.filter(c => c.isReply && c.parentIdx === comment.commentIdx);

      // Start ranges for parent AND all replies (nested)
      replacement += `<w:commentRangeStart w:id="${comment.id}"/>`;
      for (const reply of replies) {
        replacement += `<w:commentRangeStart w:id="${reply.id}"/>`;
      }

      // Anchor text
      if (anchorText) {
        replacement += `<w:r>${rPr}${tElement}${anchorText}</w:t></w:r>`;
      }

      // End parent range and reference (NO rStyle wrapper - required for threading)
      replacement += `<w:commentRangeEnd w:id="${comment.id}"/>`;
      replacement += `<w:r><w:commentReference w:id="${comment.id}"/></w:r>`;

      // End reply ranges and references (same position as parent, NO rStyle wrapper)
      for (const reply of replies) {
        replacement += `<w:commentRangeEnd w:id="${reply.id}"/>`;
        replacement += `<w:r><w:commentReference w:id="${reply.id}"/></w:r>`;
        injectedIds.add(reply.id);
      }

      if (textAfter) {
        replacement += `<w:r>${rPr}${tElement}${textAfter}</w:t></w:r>`;
      }

      documentXml = documentXml.slice(0, rStart) + replacement + documentXml.slice(rEnd);
      injectedIds.add(comment.id);
    }

    // Add required namespaces to document.xml for comment threading
    const requiredNs = {
      'xmlns:w14': 'http://schemas.microsoft.com/office/word/2010/wordml',
      'xmlns:w15': 'http://schemas.microsoft.com/office/word/2012/wordml',
      'xmlns:w16cid': 'http://schemas.microsoft.com/office/word/2016/wordml/cid',
      'xmlns:w16cex': 'http://schemas.microsoft.com/office/word/2018/wordml/cex',
      'xmlns:mc': 'http://schemas.openxmlformats.org/markup-compatibility/2006',
    };

    // Find <w:document and add namespaces
    const docTagMatch = documentXml.match(/<w:document[^>]*>/);
    if (docTagMatch) {
      let docTag = docTagMatch[0];
      let modified = false;
      for (const [attr, val] of Object.entries(requiredNs)) {
        if (!docTag.includes(attr)) {
          docTag = docTag.replace('>', ` ${attr}="${val}">`);
          modified = true;
        }
      }
      // Add mc:Ignorable if mc namespace was added
      if (modified && !docTag.includes('mc:Ignorable')) {
        docTag = docTag.replace('>', ' mc:Ignorable="w14 w15 w16cid w16cex">');
      }
      documentXml = documentXml.replace(docTagMatch[0], docTag);
    }

    // Update document.xml
    zip.updateFile('word/document.xml', Buffer.from(documentXml, 'utf-8'));

    // All comments (parents + replies) go in comments.xml
    // But only include if parent was injected
    const includedComments = commentsWithIds.filter(c => {
      if (!c.isReply) {
        return injectedIds.has(c.id);
      } else {
        // Include reply if its parent was injected
        return c.parentIdx !== null && injectedIds.has(commentsWithIds[c.parentIdx].id);
      }
    });

    // Create comments.xml
    const commentsXml = createCommentsXml(includedComments);
    if (zip.getEntry('word/comments.xml')) {
      zip.updateFile('word/comments.xml', Buffer.from(commentsXml, 'utf-8'));
    } else {
      zip.addFile('word/comments.xml', Buffer.from(commentsXml, 'utf-8'));
    }

    // Create commentsExtended.xml with reply threading
    const commentsExtXml = createCommentsExtendedXml(includedComments);
    if (zip.getEntry('word/commentsExtended.xml')) {
      zip.updateFile('word/commentsExtended.xml', Buffer.from(commentsExtXml, 'utf-8'));
    } else {
      zip.addFile('word/commentsExtended.xml', Buffer.from(commentsExtXml, 'utf-8'));
    }

    // Create commentsIds.xml (Word 2016+)
    const commentsIdsXml = createCommentsIdsXml(includedComments);
    if (zip.getEntry('word/commentsIds.xml')) {
      zip.updateFile('word/commentsIds.xml', Buffer.from(commentsIdsXml, 'utf-8'));
    } else {
      zip.addFile('word/commentsIds.xml', Buffer.from(commentsIdsXml, 'utf-8'));
    }

    // Create commentsExtensible.xml (Word 2018+)
    const commentsExtensibleXml = createCommentsExtensibleXml(includedComments);
    if (zip.getEntry('word/commentsExtensible.xml')) {
      zip.updateFile('word/commentsExtensible.xml', Buffer.from(commentsExtensibleXml, 'utf-8'));
    } else {
      zip.addFile('word/commentsExtensible.xml', Buffer.from(commentsExtensibleXml, 'utf-8'));
    }

    // Create people.xml (author definitions with Windows Live IDs)
    const peopleXml = createPeopleXml(includedComments);
    if (zip.getEntry('word/people.xml')) {
      zip.updateFile('word/people.xml', Buffer.from(peopleXml, 'utf-8'));
    } else {
      zip.addFile('word/people.xml', Buffer.from(peopleXml, 'utf-8'));
    }

    // Update [Content_Types].xml
    const contentTypesEntry = zip.getEntry('[Content_Types].xml');
    if (contentTypesEntry) {
      let contentTypes = zip.readAsText(contentTypesEntry);

      if (!contentTypes.includes('comments.xml')) {
        const insertPoint = contentTypes.lastIndexOf('</Types>');
        contentTypes = contentTypes.slice(0, insertPoint) +
          '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>\n' +
          contentTypes.slice(insertPoint);
      }

      if (!contentTypes.includes('commentsExtended.xml')) {
        const insertPoint = contentTypes.lastIndexOf('</Types>');
        contentTypes = contentTypes.slice(0, insertPoint) +
          '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>\n' +
          contentTypes.slice(insertPoint);
      }

      if (!contentTypes.includes('commentsIds.xml')) {
        const insertPoint = contentTypes.lastIndexOf('</Types>');
        contentTypes = contentTypes.slice(0, insertPoint) +
          '<Override PartName="/word/commentsIds.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsIds+xml"/>\n' +
          contentTypes.slice(insertPoint);
      }

      if (!contentTypes.includes('commentsExtensible.xml')) {
        const insertPoint = contentTypes.lastIndexOf('</Types>');
        contentTypes = contentTypes.slice(0, insertPoint) +
          '<Override PartName="/word/commentsExtensible.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtensible+xml"/>\n' +
          contentTypes.slice(insertPoint);
      }

      if (!contentTypes.includes('people.xml')) {
        const insertPoint = contentTypes.lastIndexOf('</Types>');
        contentTypes = contentTypes.slice(0, insertPoint) +
          '<Override PartName="/word/people.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.people+xml"/>\n' +
          contentTypes.slice(insertPoint);
      }

      zip.updateFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf-8'));
    }

    // Update relationships
    const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
    if (relsEntry) {
      let rels = zip.readAsText(relsEntry);

      const rIdMatches = rels.match(/rId(\d+)/g) || [];
      const maxId = rIdMatches.reduce((max, r) => Math.max(max, parseInt(r.replace('rId', ''))), 0);

      if (!rels.includes('comments.xml')) {
        const insertPoint = rels.lastIndexOf('</Relationships>');
        rels = rels.slice(0, insertPoint) +
          `<Relationship Id="rId${maxId + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>\n` +
          rels.slice(insertPoint);
      }

      if (!rels.includes('commentsExtended.xml')) {
        const insertPoint = rels.lastIndexOf('</Relationships>');
        rels = rels.slice(0, insertPoint) +
          `<Relationship Id="rId${maxId + 2}" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>\n` +
          rels.slice(insertPoint);
      }

      if (!rels.includes('commentsIds.xml')) {
        const insertPoint = rels.lastIndexOf('</Relationships>');
        rels = rels.slice(0, insertPoint) +
          `<Relationship Id="rId${maxId + 3}" Type="http://schemas.microsoft.com/office/2016/09/relationships/commentsIds" Target="commentsIds.xml"/>\n` +
          rels.slice(insertPoint);
      }

      if (!rels.includes('commentsExtensible.xml')) {
        const insertPoint = rels.lastIndexOf('</Relationships>');
        rels = rels.slice(0, insertPoint) +
          `<Relationship Id="rId${maxId + 4}" Type="http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible" Target="commentsExtensible.xml"/>\n` +
          rels.slice(insertPoint);
      }

      if (!rels.includes('people.xml')) {
        const insertPoint = rels.lastIndexOf('</Relationships>');
        rels = rels.slice(0, insertPoint) +
          `<Relationship Id="rId${maxId + 5}" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="people.xml"/>\n` +
          rels.slice(insertPoint);
      }

      zip.updateFile('word/_rels/document.xml.rels', Buffer.from(rels, 'utf-8'));
    }

    zip.writeZip(outputPath);

    const parentCount = includedComments.filter(c => !c.isReply).length;
    const replyCount = includedComments.filter(c => c.isReply).length;

    return {
      success: true,
      commentCount: parentCount,
      replyCount: replyCount,
      skippedComments: comments.length - includedComments.length,
    };

  } catch (err) {
    return { success: false, commentCount: 0, skippedComments: 0, error: err.message };
  }
}

export async function injectComments(docxPath, markdown, outputPath) {
  console.warn('Warning: Use prepareMarkdownWithMarkers + injectCommentsAtMarkers instead');
  return { success: false, commentCount: 0, skippedComments: 0, error: 'Use marker-based flow' };
}

export async function buildWithComments(cleanDocxPath, comments, outputPath) {
  return injectCommentsAtMarkers(cleanDocxPath, comments, outputPath);
}
