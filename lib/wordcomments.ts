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
import { escapeXml } from './utils.js';

const MARKER_START_PREFIX = '⟦CMS:';
const MARKER_END_PREFIX = '⟦CME:';
const MARKER_SUFFIX = '⟧';

interface ParsedComment {
  author: string;
  text: string;
  anchor: string | null;
  start: number;
  end: number;
  fullMatch: string;
}

interface PreparedComment extends ParsedComment {
  isReply: boolean;
  parentIdx: number | null;
  commentIdx: number;
  anchorFromReply?: boolean;
  placesParentMarkers?: boolean;
}

interface PrepareResult {
  markedMarkdown: string;
  comments: PreparedComment[];
}

interface CommentWithIds extends PreparedComment {
  id: string;
  paraId: string;
  paraId2: string;
  durableId: string;
  parentParaId?: string;
}

interface InjectionResult {
  success: boolean;
  commentCount: number;
  replyCount?: number;
  skippedComments: number;
  error?: string;
}

function generateParaId(commentIdx: number, paraNum: number): string {
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
export function prepareMarkdownWithMarkers(markdown: string): PrepareResult {
  // Match all comments with optional anchor
  const commentPattern = /\{>>(.+?)<<\}(?:\s*\[([^\]]+)\]\{\.mark\})?/g;

  const rawMatches: ParsedComment[] = [];
  let match: RegExpExecArray | null;
  while ((match = commentPattern.exec(markdown)) !== null) {
    const content = match[1] ?? '';
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
  // Comments are "adjacent" if there's minimal text between them (< 10 chars)
  const ADJACENT_THRESHOLD = 10;
  const comments: PreparedComment[] = [];
  let clusterParentIdx = -1;  // Index of first comment in current cluster
  let lastCommentEnd = -1;

  for (let i = 0; i < rawMatches.length; i++) {
    const m = rawMatches[i];
    if (!m) continue;

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
        author: m.author,
        text: m.text,
        anchor: m.anchor,
        start: m.start,
        end: m.end,
        fullMatch: m.fullMatch,
        isReply: false,
        parentIdx: null,
        commentIdx: comments.length
      });
      clusterParentIdx = comments.length - 1;
    } else {
      // Subsequent comment in cluster = reply to first comment
      comments.push({
        author: m.author,
        text: m.text,
        anchor: m.anchor,
        start: m.start,
        end: m.end,
        fullMatch: m.fullMatch,
        isReply: true,
        parentIdx: clusterParentIdx,
        commentIdx: comments.length
      });
    }

    lastCommentEnd = m.end;
  }

  // Propagate anchors from replies to parents
  // If a reply has an anchor but its parent doesn't, move the anchor to the parent
  // Track flags for special handling during marker generation
  for (const c of comments) {
    if (c.isReply && c.anchor && c.parentIdx !== null) {
      const parent = comments[c.parentIdx];
      if (parent && !parent.anchor) {
        parent.anchor = c.anchor;
        parent.anchorFromReply = true;  // Parent's anchor came from a reply (markers placed by reply)
        c.placesParentMarkers = true;   // This reply should place the parent's markers
        c.anchor = null;
      }
    }
  }

  // Build marked markdown - only parent comments get markers
  // Process from end to start to preserve positions
  let markedMarkdown = markdown;

  for (let i = comments.length - 1; i >= 0; i--) {
    const c = comments[i];
    if (!c) continue;

    if (c.isReply) {
      // Reply: remove from document entirely (will be in comments.xml only)
      // Also consume one preceding whitespace char to avoid double spaces.
      // We deliberately consume at most one — walking arbitrarily backwards
      // would shift positions that lower-index comments still depend on.
      let removeStart = c.start;
      if (removeStart > 0 && /\s/.test(markedMarkdown[removeStart - 1] ?? '')) {
        removeStart--;
      }

      // If this reply places parent's markers (anchor was propagated)
      if (c.placesParentMarkers && c.parentIdx !== null) {
        // Extract anchor text from the original match
        const anchorMatch = c.fullMatch.match(/\[([^\]]+)\]\{\.mark\}$/);
        if (anchorMatch) {
          const anchorText = anchorMatch[1] ?? '';
          // Output markers with PARENT's index around the anchor text
          const parentIdx = c.parentIdx;
          const replacement = `${MARKER_START_PREFIX}${parentIdx}${MARKER_SUFFIX}${anchorText}${MARKER_END_PREFIX}${parentIdx}${MARKER_SUFFIX}`;
          markedMarkdown = markedMarkdown.slice(0, removeStart) + replacement + markedMarkdown.slice(c.end);
        } else {
          markedMarkdown = markedMarkdown.slice(0, removeStart) + markedMarkdown.slice(c.end);
        }
      } else {
        markedMarkdown = markedMarkdown.slice(0, removeStart) + markedMarkdown.slice(c.end);
      }
    } else {
      // Parent comment
      if (c.anchorFromReply) {
        // Anchor markers are placed by the reply, just remove this comment.
        // Consume one preceding whitespace char only (see reply branch above).
        let removeStart = c.start;
        if (removeStart > 0 && /\s/.test(markedMarkdown[removeStart - 1] ?? '')) {
          removeStart--;
        }
        markedMarkdown = markedMarkdown.slice(0, removeStart) + markedMarkdown.slice(c.end);
      } else {
        // Normal case: replace with markers
        const anchor = c.anchor || '';
        const replacement = `${MARKER_START_PREFIX}${i}${MARKER_SUFFIX}${anchor}${MARKER_END_PREFIX}${i}${MARKER_SUFFIX}`;
        markedMarkdown = markedMarkdown.slice(0, c.start) + replacement + markedMarkdown.slice(c.end);
      }
    }
  }

  return { markedMarkdown, comments };
}

function createCommentsXml(comments: CommentWithIds[]): string {
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

function createCommentsExtendedXml(comments: CommentWithIds[]): string {
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

function generateDurableId(index: number): string {
  // Generate unique 8-char hex ID for durableId
  // CRITICAL: Must stay within signed 32-bit range (< 0x7FFFFFFF = 2147483647)
  // Word interprets durableIds as signed 32-bit integers
  const base = 0x10000000 + (Date.now() % 0x40000000); // Base between 0x10000000 and 0x50000000
  const id = (base + index * 0x01000000) % 0x7FFFFFFF; // Keep under signed 32-bit max
  return id.toString(16).toUpperCase().padStart(8, '0');
}

function createCommentsIdsXml(comments: CommentWithIds[]): string {
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

function createCommentsExtensibleXml(comments: CommentWithIds[]): string {
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

function createPeopleXml(comments: CommentWithIds[]): string {
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

function generateUserId(author: string): string {
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
export async function injectCommentsAtMarkers(
  docxPath: string,
  comments: PreparedComment[],
  outputPath: string
): Promise<InjectionResult> {
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
    const commentsWithIds: CommentWithIds[] = comments.map((c, idx) => ({
      ...c,
      id: String(idx + 1),
      paraId: generateParaId(idx, 1),       // First paragraph (e.g., 10000001)
      paraId2: generateParaId(idx, 2),      // Second paragraph (e.g., 10000002)
      durableId: generateDurableId(idx),    // Unique ID for commentsIds/commentsExtensible
    }));

    // Link replies to parent paraIds
    for (const c of commentsWithIds) {
      if (c.isReply && c.parentIdx !== null) {
        const parent = commentsWithIds[c.parentIdx];
        if (parent) {
          c.parentParaId = parent.paraId;
        }
      }
    }

    const injectedIds = new Set<string>();

    // Process only parent comments (non-replies) for document ranges
    const parentComments = commentsWithIds.filter(c => !c.isReply);

    for (let i = parentComments.length - 1; i >= 0; i--) {
      const comment = parentComments[i];
      if (!comment) continue;
      const idx = comment.commentIdx;

      const startMarker = `${MARKER_START_PREFIX}${idx}${MARKER_SUFFIX}`;
      const endMarker = `${MARKER_END_PREFIX}${idx}${MARKER_SUFFIX}`;

      const startPos = documentXml.indexOf(startMarker);
      const endPos = documentXml.indexOf(endMarker, startPos + startMarker.length);

      if (startPos === -1 || endPos === -1) continue;

      // Find the runs containing each marker. Pandoc may split a single
      // markdown anchor across multiple <w:r> blocks when it applies styling
      // mid-anchor (smart-quote substitution, *italic*, `code`, **bold**).
      // The same-run path (current happy path) collapses into the multi-run
      // path when start and end runs coincide.
      const startRunOpen = Math.max(
        documentXml.lastIndexOf('<w:r>', startPos),
        documentXml.lastIndexOf('<w:r ', startPos),
      );
      const startRunCloseIdx = documentXml.indexOf('</w:r>', startPos);
      const endRunOpen = Math.max(
        documentXml.lastIndexOf('<w:r>', endPos),
        documentXml.lastIndexOf('<w:r ', endPos),
      );
      const endRunCloseIdx = documentXml.indexOf('</w:r>', endPos);

      if (
        startRunOpen === -1 || startRunCloseIdx === -1 ||
        endRunOpen === -1 || endRunCloseIdx === -1
      ) continue;

      const startRunClose = startRunCloseIdx + '</w:r>'.length;
      const endRunClose = endRunCloseIdx + '</w:r>'.length;

      const startRunFull = documentXml.slice(startRunOpen, startRunClose);
      const endRunFull = documentXml.slice(endRunOpen, endRunClose);

      // Extract <w:rPr> and <w:t> element shape from each run. Both pieces
      // are needed verbatim so a textBefore split keeps its original styling
      // and so the post-anchor textAfter render keeps the end run's styling.
      function dissectRun(runXml: string, marker: string): {
        rPr: string;
        tElement: string;
        textBefore: string;
        textAfter: string;
      } | null {
        const rPrMatch = runXml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/);
        const tMatch = runXml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/);
        if (!tMatch) return null;
        const tOpenMatch = tMatch[0].match(/<w:t[^>]*>/);
        if (!tOpenMatch) return null;
        const tContent = tMatch[1] ?? '';
        const markerInT = tContent.indexOf(marker);
        if (markerInT === -1) return null;
        return {
          rPr: rPrMatch ? rPrMatch[0] : '',
          tElement: tOpenMatch[0],
          textBefore: tContent.slice(0, markerInT),
          textAfter: tContent.slice(markerInT + marker.length),
        };
      }

      let replacement = '';
      const replies = commentsWithIds.filter(c => c.isReply && c.parentIdx === comment?.commentIdx);

      const emitRangeStarts = () => {
        replacement += `<w:commentRangeStart w:id="${comment.id}"/>`;
        for (const reply of replies) {
          replacement += `<w:commentRangeStart w:id="${reply.id}"/>`;
        }
      };

      const emitRangeEnds = () => {
        replacement += `<w:commentRangeEnd w:id="${comment.id}"/>`;
        replacement += `<w:r><w:commentReference w:id="${comment.id}"/></w:r>`;
        for (const reply of replies) {
          replacement += `<w:commentRangeEnd w:id="${reply.id}"/>`;
          replacement += `<w:r><w:commentReference w:id="${reply.id}"/></w:r>`;
          injectedIds.add(reply.id);
        }
      };

      if (startRunOpen === endRunOpen) {
        // Same-run path: both markers live inside one <w:t>. Original logic.
        const startInfo = dissectRun(startRunFull, startMarker);
        if (!startInfo) continue;
        const fullText = startInfo.textBefore + startMarker + startInfo.textAfter;
        const endInTextRel = startInfo.textAfter.indexOf(endMarker);
        if (endInTextRel === -1) continue;
        const anchorTextSame = startInfo.textAfter.slice(0, endInTextRel);
        let textAfter = startInfo.textAfter.slice(endInTextRel + endMarker.length);
        let anchorText = anchorTextSame;
        let textBefore = startInfo.textBefore;

        // Empty anchor: borrow the next word so the comment has something
        // to anchor on. Then normalize the trailing double space.
        if (!anchorText && textAfter) {
          const wordMatch = textAfter.match(/^\s*(\S+)/);
          if (wordMatch) {
            anchorText = wordMatch[1] ?? '';
            textAfter = textAfter.slice(wordMatch[0].length);
          }
        }
        if (!anchorText && textBefore.endsWith(' ') && textAfter.startsWith(' ')) {
          textAfter = textAfter.slice(1);
        }
        // Suppress unused warning for pre-empty-anchor fullText var
        void fullText;

        if (textBefore) {
          replacement += `<w:r>${startInfo.rPr}${startInfo.tElement}${textBefore}</w:t></w:r>`;
        }
        emitRangeStarts();
        if (anchorText) {
          replacement += `<w:r>${startInfo.rPr}${startInfo.tElement}${anchorText}</w:t></w:r>`;
        }
        emitRangeEnds();
        if (textAfter) {
          replacement += `<w:r>${startInfo.rPr}${startInfo.tElement}${textAfter}</w:t></w:r>`;
        }
        documentXml = documentXml.slice(0, startRunOpen) + replacement + documentXml.slice(startRunClose);
        injectedIds.add(comment.id);
        continue;
      }

      // Multi-run path: markers sit in different <w:r> blocks because pandoc
      // applied mid-anchor styling. Split the start run at the start marker,
      // keep all middle runs verbatim (they carry the styled anchor portions),
      // split the end run at the end marker.
      const startInfo = dissectRun(startRunFull, startMarker);
      const endInfo = dissectRun(endRunFull, endMarker);
      if (!startInfo || !endInfo) continue;

      const middle = documentXml.slice(startRunClose, endRunOpen);

      if (startInfo.textBefore) {
        replacement += `<w:r>${startInfo.rPr}${startInfo.tElement}${startInfo.textBefore}</w:t></w:r>`;
      }
      emitRangeStarts();
      if (startInfo.textAfter) {
        replacement += `<w:r>${startInfo.rPr}${startInfo.tElement}${startInfo.textAfter}</w:t></w:r>`;
      }
      replacement += middle;
      if (endInfo.textBefore) {
        replacement += `<w:r>${endInfo.rPr}${endInfo.tElement}${endInfo.textBefore}</w:t></w:r>`;
      }
      emitRangeEnds();
      if (endInfo.textAfter) {
        replacement += `<w:r>${endInfo.rPr}${endInfo.tElement}${endInfo.textAfter}</w:t></w:r>`;
      }

      documentXml = documentXml.slice(0, startRunOpen) + replacement + documentXml.slice(endRunClose);
      injectedIds.add(comment.id);
    }

    // Add required namespaces to document.xml for comment threading
    const requiredNs: Record<string, string> = {
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
        const parent = c.parentIdx !== null ? commentsWithIds[c.parentIdx] : undefined;
        return parent && injectedIds.has(parent.id);
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

  } catch (err: any) {
    return { success: false, commentCount: 0, skippedComments: 0, error: err.message };
  }
}
