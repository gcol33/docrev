/**
 * Realign comments from a reference DOCX to markdown
 * Uses paragraph-level matching with exact positions
 */

import * as fs from 'fs';
import AdmZip from 'adm-zip';
import { parseStringPromise } from 'xml2js';

interface CommentData {
  author: string;
  text: string;
}

interface CommentWithPosition {
  id: string;
  position: number;
  author: string;
  text: string;
}

interface Paragraph {
  text: string;
  comments: CommentWithPosition[];
}

interface MdParagraph {
  text: string;
  start: number;
  end: number;
}

interface ParagraphMatch {
  index: number;
  score: number;
  paragraph: MdParagraph;
}

interface WordContext {
  before: string[];
  after: string[];
}

interface CommentInsertion {
  position: number;
  text: string;
  commentText: string;
  hasReplies: boolean;
  debug: string;
}

interface RealignOptions {
  dryRun?: boolean;
  author?: string;
  replyAuthor?: string;
}

interface RealignResult {
  success: boolean;
  dryRun?: boolean;
  insertions: number;
  matched?: number;
  unmatched?: number;
}

interface RealignMarkdownOptions {
  author?: string;
  replyAuthor?: string;
}

interface RealignMarkdownResult {
  success: boolean;
  markdown: string;
  insertions: number;
  error?: string;
}

/**
 * Extract paragraphs with their full text and comment positions from DOCX
 */
export async function extractParagraphsWithComments(docxPath: string): Promise<Paragraph[]> {
  const zip = new AdmZip(docxPath);
  const doc = zip.readAsText('word/document.xml');
  const commentsXml = zip.readAsText('word/comments.xml');

  // Parse comments to get authors and texts
  const parsed = await parseStringPromise(commentsXml, { explicitArray: false });
  const commentNodes = parsed['w:comments']?.['w:comment'];
  if (!commentNodes) return [];

  const nodes = Array.isArray(commentNodes) ? commentNodes : [commentNodes];
  const commentData: Record<string, CommentData> = {};

  for (const c of nodes) {
    const id = c.$?.['w:id'] ?? '';
    const author = c.$?.['w:author'] ?? 'Unknown';
    let text = '';
    const extractT = (n: any): void => {
      if (!n) return;
      if (n['w:t']) {
        const t = n['w:t'];
        text += typeof t === 'string' ? t : (t._ || t);
      }
      if (n['w:r']) {
        (Array.isArray(n['w:r']) ? n['w:r'] : [n['w:r']]).forEach(extractT);
      }
      if (n['w:p']) {
        (Array.isArray(n['w:p']) ? n['w:p'] : [n['w:p']]).forEach(extractT);
      }
    };
    extractT(c);
    commentData[id] = { author, text: text.trim() };
  }

  // Extract paragraphs with comments
  const paragraphs: Paragraph[] = [];
  const paraPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let match;

  while ((match = paraPattern.exec(doc)) !== null) {
    const paraContent = match[1];
    const hasComments = /commentRangeStart/.test(paraContent);

    // Build paragraph text and track comment positions
    let text = '';
    const comments: CommentWithPosition[] = [];

    const tokenPattern = /<w:t[^>]*>([^<]*)<\/w:t>|<w:commentRangeStart[^>]*w:id="(\d+)"[^>]*\/?>/g;
    let tokenMatch;

    while ((tokenMatch = tokenPattern.exec(paraContent)) !== null) {
      if (tokenMatch[1] !== undefined) {
        text += tokenMatch[1];
      } else if (tokenMatch[2] !== undefined) {
        const cid = tokenMatch[2];
        const data = commentData[cid];
        if (data) {
          comments.push({
            id: cid,
            position: text.length,
            author: data.author,
            text: data.text,
          });
        }
      }
    }

    if (text.trim() || hasComments) {
      paragraphs.push({ text: text.trim(), comments });
    }
  }

  return paragraphs;
}

/**
 * Find best matching paragraph in markdown for a reference paragraph
 */
function findMatchingParagraph(refText: string, mdParagraphs: MdParagraph[]): ParagraphMatch | null {
  // Normalize for comparison
  const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const refNorm = normalize(refText);

  if (refNorm.length < 20) return null;

  let bestMatch: ParagraphMatch | null = null;
  let bestScore = 0;

  for (let i = 0; i < mdParagraphs.length; i++) {
    const mdNorm = normalize(mdParagraphs[i].text);

    // Calculate word overlap
    const refWords = new Set(refNorm.split(' ').filter((w) => w.length > 3));
    const mdWords = mdNorm.split(' ').filter((w) => w.length > 3);
    const overlap = mdWords.filter((w) => refWords.has(w)).length;
    const score = overlap / Math.max(refWords.size, 1);

    // Also check for substring containment (for section headers)
    const containsStart = mdNorm.includes(refNorm.slice(0, 50));

    if (score > bestScore || (containsStart && score > 0.3)) {
      bestScore = Math.max(score, containsStart ? 0.8 : score);
      bestMatch = { index: i, score: bestScore, paragraph: mdParagraphs[i] };
    }
  }

  return bestScore > 0.4 ? bestMatch : null;
}

/**
 * Extract paragraphs from markdown (split by blank lines)
 */
function parseMdParagraphs(markdown: string): MdParagraph[] {
  const paragraphs: MdParagraph[] = [];
  const parts = markdown.split(/\n\n+/);

  let pos = 0;
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) {
      const partStart = markdown.indexOf(part, pos);
      if (partStart !== -1) {
        paragraphs.push({
          text: trimmed,
          start: partStart,
          end: partStart + part.length,
        });
        pos = partStart + part.length;
      }
    }
  }

  return paragraphs;
}

/**
 * Strip existing comments from a specific author
 */
function stripAuthorComments(text: string, author: string): string {
  const pattern = new RegExp(`\\s*\\{>>${author}:[^<]*<<\\}`, 'g');
  return text.replace(pattern, '');
}

/**
 * Normalize text for matching (remove citations, extra whitespace)
 */
function normalizeForMatching(text: string): string {
  return text
    // Remove Word citation placeholders
    .replace(/\(\s*\$+\s*\)/g, '')
    .replace(/\$+/g, '')
    // Remove markdown citations
    .replace(/\[@[^\]]+\]/g, '')
    .replace(/@[A-Z][a-z]+\d{4}/g, '')
    // Remove rendered citations like "(Author et al. 2021)"
    .replace(/\([A-Z][a-z]+(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*[A-Z][a-z]+(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)/g, '')
    // Remove figure references like "Fig. 1" or "(Fig. 1)"
    .replace(/\(?Fig\.?\s*\d+[a-z]?\)?/gi, '')
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Find the word at or near a position in text
 */
function getWordAtPosition(text: string, pos: number): WordContext {
  const before = text.slice(Math.max(0, pos - 30), pos);
  const after = text.slice(pos, pos + 30);

  // Get the last complete word before position
  const beforeWords = before.split(/\s+/).filter(w => w.length > 2);
  const afterWords = after.split(/\s+/).filter(w => w.length > 2);

  return {
    before: beforeWords.slice(-3),
    after: afterWords.slice(0, 3)
  };
}

/**
 * Find position in markdown paragraph matching reference position
 * Uses the anchor word (word immediately before the comment) for precise matching
 */
function findMdPosition(refText: string, refPos: number, mdText: string): number {
  // Get the word(s) immediately before the comment position in reference
  const refWords = getWordAtPosition(refText, refPos);
  const normalizedMd = normalizeForMatching(mdText);

  // The "anchor word" is the last word before the comment
  const anchorWords = refWords.before;

  if (anchorWords.length === 0) {
    const ratio = refPos / Math.max(refText.length, 1);
    return Math.round(ratio * mdText.length);
  }

  // Try to find the anchor word(s) in markdown
  // Start with the most specific (all words), fall back to fewer
  for (let numWords = anchorWords.length; numWords >= 1; numWords--) {
    const searchWords = anchorWords.slice(-numWords);
    const pattern = searchWords.map(w =>
      w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ).join('\\s+');

    const regex = new RegExp(pattern, 'g');
    const matches = [...normalizedMd.matchAll(regex)];

    if (matches.length === 1) {
      // Unique match - use this position
      const matchEnd = matches[0].index! + matches[0][0].length;
      // Map back to original markdown position
      const ratio = matchEnd / Math.max(normalizedMd.length, 1);
      return Math.round(ratio * mdText.length);
    } else if (matches.length > 1) {
      // Multiple matches - use context after to disambiguate
      const afterWords = refWords.after;
      if (afterWords.length > 0) {
        const afterPattern = afterWords[0].toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        for (const match of matches) {
          const matchEnd = match.index! + match[0].length;
          const afterContext = normalizedMd.slice(matchEnd, matchEnd + 50);
          if (afterContext.includes(afterPattern)) {
            const ratio = matchEnd / Math.max(normalizedMd.length, 1);
            return Math.round(ratio * mdText.length);
          }
        }
      }
      // Fall back to first match
      const matchEnd = matches[0].index! + matches[0][0].length;
      const ratio = matchEnd / Math.max(normalizedMd.length, 1);
      return Math.round(ratio * mdText.length);
    }
  }

  // Fallback: proportional position
  const ratio = refPos / Math.max(refText.length, 1);
  return Math.round(ratio * mdText.length);
}

/**
 * Extract reply comments that follow a parent comment
 * Returns map of parent comment text -> array of reply texts
 */
function extractReplies(markdown: string, parentAuthor: string, replyAuthor: string): Map<string, string[]> {
  const replies = new Map<string, string[]>();
  const pattern = new RegExp(
    `\\{>>${parentAuthor}:\\s*([^<]+)<<\\}((?:\\s*\\{>>${replyAuthor}:[^<]+<<\\})*)`,
    'g'
  );

  let match;
  while ((match = pattern.exec(markdown)) !== null) {
    const parentText = match[1].trim();
    const replyBlock = match[2];

    if (replyBlock) {
      const replyPattern = new RegExp(`\\{>>${replyAuthor}:\\s*([^<]+)<<\\}`, 'g');
      const replyTexts: string[] = [];
      let replyMatch;
      while ((replyMatch = replyPattern.exec(replyBlock)) !== null) {
        replyTexts.push(replyMatch[1].trim());
      }
      if (replyTexts.length > 0) {
        replies.set(parentText.slice(0, 50), replyTexts); // Use first 50 chars as key
      }
    }
  }

  return replies;
}

/**
 * Realign comments from reference DOCX to markdown
 */
export async function realignComments(
  docxPath: string,
  markdownPath: string,
  options: RealignOptions = {}
): Promise<RealignResult> {
  const { dryRun = false, author = 'Guy Colling', replyAuthor = 'Gilles Colling' } = options;

  // Read original markdown to extract replies before stripping
  const originalMarkdown = fs.readFileSync(markdownPath, 'utf-8');

  // Extract reply relationships
  const replies = extractReplies(originalMarkdown, author, replyAuthor);
  console.log(`Found ${replies.size} ${author} comments with ${replyAuthor} replies`);

  // Extract reference paragraphs with comments
  const refParagraphs = await extractParagraphsWithComments(docxPath);
  const refWithComments = refParagraphs.filter(
    (p) => p.comments.length > 0 && p.comments.some((c) => c.author === author)
  );

  console.log(`Found ${refWithComments.length} paragraphs with ${author} comments in reference`);

  // Strip ALL comments (both authors) from markdown to start fresh
  let markdown = originalMarkdown;
  markdown = markdown.replace(/\s*\{>>[^<]+<<\}/g, '');
  console.log(`Stripped all comments from markdown`);

  // Parse markdown paragraphs
  const mdParagraphs = parseMdParagraphs(markdown);

  // Track insertions (position, text) - will insert from end to start
  const insertions: CommentInsertion[] = [];
  let matched = 0;
  let unmatched = 0;

  for (const refPara of refWithComments) {
    const match = findMatchingParagraph(refPara.text, mdParagraphs);

    if (!match) {
      console.log(`  No match for: "${refPara.text.slice(0, 60)}..."`);
      unmatched++;
      continue;
    }

    matched++;
    const mdPara = match.paragraph;

    // Get author's comments in this paragraph
    const authorComments = refPara.comments.filter((c) => c.author === author);

    for (const comment of authorComments) {
      // Find corresponding position in markdown paragraph
      const mdPos = findMdPosition(refPara.text, comment.position, mdPara?.text ?? '');
      const absolutePos = (mdPara?.start ?? 0) + mdPos;

      // Build comment mark with any replies
      let commentMark = ` {>>${comment.author}: ${comment.text}<<}`;

      // Check for replies
      const replyKey = comment.text.trim().slice(0, 50);
      const replyTexts = replies.get(replyKey);
      if (replyTexts) {
        for (const replyText of replyTexts) {
          commentMark += ` {>>${replyAuthor}: ${replyText}<<}`;
        }
      }

      insertions.push({
        position: absolutePos,
        text: commentMark,
        commentText: comment.text.slice(0, 30),
        hasReplies: !!replyTexts,
        debug: `"${(mdPara?.text ?? '').slice(Math.max(0, mdPos - 20), mdPos)}|HERE|${(mdPara?.text ?? '').slice(mdPos, mdPos + 20)}"`,
      });
    }
  }

  console.log(`Matched ${matched} paragraphs, ${unmatched} unmatched`);
  console.log(`Inserting ${insertions.length} comments (${insertions.filter((i) => i.hasReplies).length} with replies)`);

  if (dryRun) {
    console.log('\nDry run - would insert:');
    for (const ins of insertions.slice(0, 10)) {
      console.log(`  At ${ins.position}: ${ins.debug}`);
      console.log(`    Comment: "${ins.commentText}..."${ins.hasReplies ? ' (+ replies)' : ''}`);
    }
    return { success: true, dryRun: true, insertions: insertions.length };
  }

  // Sort by position descending and insert
  insertions.sort((a, b) => b.position - a.position);

  for (const ins of insertions) {
    markdown = markdown.slice(0, ins.position) + ins.text + markdown.slice(ins.position);
  }

  // Write result
  fs.writeFileSync(markdownPath, markdown);

  return { success: true, insertions: insertions.length, matched, unmatched };
}

/**
 * Realign comments in markdown string (in-memory, doesn't write to file)
 */
export async function realignMarkdown(
  docxPath: string,
  markdown: string,
  options: RealignMarkdownOptions = {}
): Promise<RealignMarkdownResult> {
  const { author = 'Guy Colling', replyAuthor = 'Gilles Colling' } = options;

  try {
    // Extract reply relationships from original markdown
    const replies = extractReplies(markdown, author, replyAuthor);

    // Extract reference paragraphs with comments
    const refParagraphs = await extractParagraphsWithComments(docxPath);
    const refWithComments = refParagraphs.filter(
      (p) => p.comments.length > 0 && p.comments.some((c) => c.author === author)
    );

    // Strip ALL comments from markdown
    let result = markdown.replace(/\s*\{>>[^<]+<<\}/g, '');

    // Parse markdown paragraphs
    const mdParagraphs = parseMdParagraphs(result);

    // Track insertions
    const insertions: Array<{ position: number; text: string }> = [];

    for (const refPara of refWithComments) {
      const match = findMatchingParagraph(refPara.text, mdParagraphs);
      if (!match) continue;

      const mdPara = match.paragraph;
      const authorComments = refPara.comments.filter((c) => c.author === author);

      for (const comment of authorComments) {
        const mdPos = findMdPosition(refPara.text, comment.position, mdPara?.text ?? '');
        const absolutePos = (mdPara?.start ?? 0) + mdPos;

        let commentMark = ` {>>${comment.author}: ${comment.text}<<}`;

        // Check for replies
        const replyKey = comment.text.trim().slice(0, 50);
        const replyTexts = replies.get(replyKey);
        if (replyTexts) {
          for (const replyText of replyTexts) {
            commentMark += ` {>>${replyAuthor}: ${replyText}<<}`;
          }
        }

        insertions.push({ position: absolutePos, text: commentMark });
      }
    }

    // Sort by position descending and insert
    insertions.sort((a, b) => b.position - a.position);

    for (const ins of insertions) {
      result = result.slice(0, ins.position) + ins.text + result.slice(ins.position);
    }

    return { success: true, markdown: result, insertions: insertions.length };
  } catch (err: any) {
    return { success: false, markdown, insertions: 0, error: err.message };
  }
}
