/**
 * Write Word comments back into a LaTeX (`.tex`) or knitr (`.Rnw`) source.
 *
 * A docx built from the source carries one bookmark per paragraph unit
 * (latex-input.ts, latex-units.ts). Each comment belongs to the unit whose
 * bookmark precedes it in the document, so its paragraph is found by key, not
 * by matching text: the reviewer may have edited the words around it, and
 * the author the source since the build. For an `.Rnw` the comments go into
 * the `.Rnw`, never the knitted `.tex`.
 *
 * Each thread becomes one LaTeX comment line in CriticMarkup, placed above
 * the source line where its anchor text starts:
 *
 *   % {==anchor text==}{>>Reviewer: comment<<}{>>↪ Author: reply<<}
 *
 * A comment line inside a paragraph does not change the typeset output, and
 * `docrev comments` reads it like any other CriticMarkup.
 */

import * as fs from 'fs';
import { openDocx, readPartText, extractComments, buildCommentBookmarkModel, type ExtractedComment } from './ooxml.js';
import { formatCommentThread } from './annotations.js';
import { profileFor } from './latex-classes.js';
import { segmentLatexUnits, unitBookmarkName, UNIT_BOOKMARK_PREFIX, type LatexUnit } from './latex-units.js';
import { latexSourceKind } from './latex-input.js';
import { texToProse } from './tex-utils.js';

export interface LatexSyncOptions {
  dryRun?: boolean;
}

export interface LatexSyncResult {
  /** Threads written above the line holding their anchor text. */
  placed: number;
  /** Threads written at the start of their paragraph, the anchor text not being found in it. */
  atParagraphStart: number;
  /** Threads already present in the source from an earlier sync. */
  deduped: number;
  /** Threads whose paragraph is not in the source any more, written before `\end{document}`. */
  unanchored: number;
  /** Tracked insertions and deletions in the docx, which this sync does not apply. */
  trackedChanges: number;
  /** The source after the sync. */
  content: string;
}

/** Single-line form of a comment or anchor text, safe inside a `%` line. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function normalize(text: string): string {
  return oneLine(text).toLowerCase();
}

/**
 * Offset of the start of the line in `unit` where `anchor` begins, or null.
 * Lines are compared as prose (commands and math stripped), first with the
 * whole anchor, then with its first 40 characters, then its first four words.
 */
export function findAnchorLine(unit: LatexUnit, anchor: string): number | null {
  const lines = unit.lines.filter(l => !l.code && l.text.trim() && !/^\s*%/.test(l.text));
  let joined = '';
  const starts: Array<{ at: number; offset: number }> = [];
  for (const line of lines) {
    starts.push({ at: joined.length, offset: line.offset });
    joined += normalize(texToProse(line.text, true)) + ' ';
  }
  const target = normalize(anchor);
  if (!target) return null;
  const needles = [target, target.slice(0, 40), target.split(' ').slice(0, 4).join(' ')];
  for (const needle of needles) {
    if (!needle) continue;
    const at = joined.indexOf(needle);
    if (at === -1) continue;
    let offset = starts[0]!.offset;
    for (const s of starts) if (s.at <= at) offset = s.offset;
    return offset;
  }
  return null;
}

/** Threads in document order: each root comment with its replies. */
function threads(comments: ExtractedComment[]): Array<{ root: ExtractedComment; replies: ExtractedComment[] }> {
  const byId = new Map(comments.map(c => [c.id, c]));
  const rootOf = (c: ExtractedComment): ExtractedComment => {
    const seen = new Set<string>();
    let cur = c;
    while (cur.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      const parent = byId.get(cur.parentId);
      if (!parent || parent === cur) break;
      cur = parent;
    }
    return cur;
  };
  const out = new Map<string, { root: ExtractedComment; replies: ExtractedComment[] }>();
  for (const c of comments) {
    const root = rootOf(c);
    if (!out.has(root.id)) out.set(root.id, { root, replies: [] });
    if (root !== c) out.get(root.id)!.replies.push(c);
  }
  return [...out.values()];
}

/** Sync the comments of `docxPath` into the LaTeX source at `sourcePath`. */
export function syncLatexComments(docxPath: string, sourcePath: string, options: LatexSyncOptions = {}): LatexSyncResult {
  const zip = openDocx(docxPath);
  const documentXml = readPartText(zip, 'word/document.xml');
  if (documentXml === null) throw new Error(`${docxPath} has no word/document.xml`);
  const model = buildCommentBookmarkModel(documentXml, name => name.startsWith(UNIT_BOOKMARK_PREFIX));
  const placement = new Map(model.comments.map(c => [c.id, c]));

  const source = fs.readFileSync(sourcePath, 'utf-8');
  const units = segmentLatexUnits(source, latexSourceKind(sourcePath), profileFor(source).abstract);
  const unitByBookmark = new Map(units.map(u => [unitBookmarkName(u.key), u]));

  const result: LatexSyncResult = { placed: 0, atParagraphStart: 0, deduped: 0, unanchored: 0, trackedChanges: model.trackedChanges, content: source };
  const inserts: Array<[number, string]> = [];
  const unanchoredLines: string[] = [];

  for (const { root, replies } of threads(extractComments(zip))) {
    const where = placement.get(root.id);
    const thread = formatCommentThread(
      { author: root.author, text: oneLine(root.text) },
      replies.map(r => ({ author: r.author, text: oneLine(r.text) }))
    );
    const anchor = oneLine(where?.anchor ?? '');
    const line = `% ${anchor ? `{==${anchor}==}` : ''}${thread}`;
    const count = 1 + replies.length;

    const unit = where?.bookmark ? unitByBookmark.get(where.bookmark) : undefined;
    if (!unit) {
      if (source.includes(thread)) result.deduped += count;
      else {
        unanchoredLines.push(line);
        result.unanchored += count;
      }
      continue;
    }

    const last = unit.lines[unit.lines.length - 1]!;
    const unitText = source.slice(unit.lines[0]!.offset, last.offset + last.text.length);
    if (unitText.includes(thread)) {
      result.deduped += count;
      continue;
    }
    const lineOffset = anchor ? findAnchorLine(unit, anchor) : null;
    const at = lineOffset ?? unit.contentOffset;
    const indent = source.slice(at).match(/^[ \t]*/)![0];
    inserts.push([at, `${indent}${line}\n`]);
    if (lineOffset === null) result.atParagraphStart += count;
    else result.placed += count;
  }

  if (unanchoredLines.length > 0) {
    const end = source.lastIndexOf('\\end{document}');
    const at = end === -1 ? source.length : end;
    const prefix = end === -1 && !source.endsWith('\n') ? '\n' : '';
    inserts.push([at, `${prefix}${unanchoredLines.join('\n')}\n`]);
  }

  // Insert from the end so earlier offsets stay valid; stable for equal offsets.
  let content = source;
  inserts
    .map((ins, i) => ({ ins, i }))
    .sort((a, b) => b.ins[0] - a.ins[0] || b.i - a.i)
    .forEach(({ ins: [at, text] }) => {
      content = content.slice(0, at) + text + content.slice(at);
    });
  result.content = content;

  if (!options.dryRun && content !== source) fs.writeFileSync(sourcePath, content, 'utf-8');
  return result;
}
