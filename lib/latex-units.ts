/**
 * Paragraph units of a LaTeX (`.tex`) or knitr (`.Rnw`) manuscript, and the
 * docx bookmark name each one carries through a review round trip.
 *
 * A unit is a run of source lines between blank lines, or starting at a
 * `% @p:<id>` paragraph marker. Its key is the marker id when it has one, and
 * otherwise `<previous marker id>+<n>`: the n-th unmarked prose paragraph
 * after the last marker (`+<n>` before the first marker). A key therefore
 * survives edits to the paragraph's own text and to every paragraph outside
 * the span of its marker.
 *
 * The build writes one bookmark per unit into the docx (latex-input.ts); sync
 * segments the current source the same way and anchors each Word comment to
 * the unit whose bookmark precedes it (latex-sync.ts). An `.Rnw` and the `.tex`
 * knitr writes from it segment to the same keys: text chunks pass through
 * knitr verbatim, code chunks (`<<>>= ... @`) and their output (`Schunk`) are
 * code regions, and a paragraph made only of code is a unit only when a
 * marker names it.
 */

import crypto from 'crypto';
import { commentStart, findCommands } from './tex-utils.js';

export type LatexSourceKind = 'tex' | 'rnw';

export interface LatexLine {
  /** Offset of the line's first character in the source. */
  offset: number;
  text: string;
  /** Inside a code chunk or a verbatim-like environment. */
  code: boolean;
}

export interface LatexUnit {
  key: string;
  markerId: string | null;
  /** All lines of the unit, marker and comment lines included. */
  lines: LatexLine[];
  /** Offset of the unit's first line that is neither a marker nor a comment. */
  contentOffset: number;
}

/**
 * Environments whose content is code or code output, never prose. `Schunk`,
 * `CodeChunk` and `knitrout` wrap what knitr writes for a chunk (including a
 * figure the chunk draws), which has no counterpart in the `.Rnw` text.
 */
export const CODE_REGION_ENVS = new Set([
  'Schunk', 'CodeChunk', 'knitrout',
  'Sinput', 'Soutput', 'Scode', 'Code', 'CodeInput', 'CodeOutput',
  'verbatim', 'Verbatim', 'lstlisting', 'minted', 'alltt',
]);

/** Environments inside which a blank line still separates paragraphs. */
const PARAGRAPH_CONTAINER_ENVS = new Set([
  'document', 'abstract', 'quote', 'quotation', 'center', 'flushleft', 'flushright', 'multicols', 'appendices',
]);

const MARKER_LINE = /^\s*%\s*@p:(\S+)\s*$/;
const RNW_CHUNK_START = /^\s*<<.*>>=\s*$/;
const RNW_CHUNK_END = /^\s*@\s*(%.*)?$/;

/** Source ranges that hold paragraphs: abstract-command arguments and the document body. */
function paragraphDomains(source: string, abstractCommands: string[]): Array<[number, number]> {
  const domains: Array<[number, number]> = [];
  for (const name of abstractCommands) {
    for (const cmd of findCommands(source, name, 1)) {
      const arg = cmd.args[0];
      if (arg) domains.push([arg.open + 1, arg.close]);
    }
  }
  const begin = source.indexOf('\\begin{document}');
  if (begin !== -1) {
    const bodyStart = begin + '\\begin{document}'.length;
    const end = source.indexOf('\\end{document}', bodyStart);
    domains.push([bodyStart, end === -1 ? source.length : end]);
  }
  return domains.sort((a, b) => a[0] - b[0]);
}

/** Split `source[start, end)` into lines carrying their absolute offsets. */
function linesOf(source: string, start: number, end: number): Array<{ offset: number; text: string }> {
  const out: Array<{ offset: number; text: string }> = [];
  let pos = start;
  while (pos < end) {
    const nl = source.indexOf('\n', pos);
    const lineEnd = nl === -1 || nl >= end ? end : nl;
    out.push({ offset: pos, text: source.slice(pos, lineEnd).replace(/\r$/, '') });
    pos = lineEnd + 1;
  }
  return out;
}

/**
 * Segment a manuscript into paragraph units, in document order. Abstract
 * commands are the class profile's (e.g. jss `\Abstract`), whose argument
 * holds paragraphs although it sits in the preamble.
 */
export function segmentLatexUnits(source: string, kind: LatexSourceKind, abstractCommands: string[] = []): LatexUnit[] {
  interface Draft { markerId: string | null; lines: LatexLine[]; contentOffset: number | null; prose: boolean }
  const drafts: Draft[] = [];

  for (const [start, end] of paragraphDomains(source, abstractCommands)) {
    const envStack: string[] = [];
    let codeEnv: string | null = null;
    let inChunk = false;
    let current: Draft | null = null;
    let pendingMarker: string | null = null;

    const close = () => {
      if (current) drafts.push(current);
      current = null;
    };
    const open = (): Draft => {
      if (!current) {
        current = { markerId: pendingMarker, lines: [], contentOffset: null, prose: false };
        pendingMarker = null;
      }
      return current;
    };
    const splittable = () => envStack.every(env => PARAGRAPH_CONTAINER_ENVS.has(env));

    for (const { offset, text } of linesOf(source, start, end)) {
      if (inChunk) {
        open().lines.push({ offset, text, code: true });
        if (RNW_CHUNK_END.test(text)) inChunk = false;
        continue;
      }
      if (codeEnv) {
        open().lines.push({ offset, text, code: true });
        if (text.includes(`\\end{${codeEnv}}`)) codeEnv = null;
        continue;
      }
      if (kind === 'rnw' && RNW_CHUNK_START.test(text)) {
        const unit = open();
        if (unit.contentOffset === null) unit.contentOffset = offset;
        unit.lines.push({ offset, text, code: true });
        inChunk = true;
        continue;
      }

      const marker = text.match(MARKER_LINE);
      if (marker && splittable()) {
        close();
        pendingMarker = marker[1]!;
        open().lines.push({ offset, text, code: false });
        continue;
      }
      if (!text.trim()) {
        if (splittable()) {
          // A marker followed by a blank line names the next paragraph.
          const draft = current as Draft | null;
          if (draft && draft.contentOffset === null && draft.markerId) {
            pendingMarker = draft.markerId;
            current = null;
          } else {
            close();
          }
        } else if (current) {
          (current as Draft).lines.push({ offset, text, code: false });
        }
        continue;
      }

      const unit = open();
      const cut = commentStart(text);
      const live = cut === -1 ? text : text.slice(0, cut);
      if (live.trim()) {
        if (unit.contentOffset === null) unit.contentOffset = offset;
        // Track environments in order along the line; a code environment
        // swallows the rest of the source until its \end.
        let isCode = false;
        for (const m of live.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
          const env = m[2]!;
          if (m[1] === 'begin') {
            if (CODE_REGION_ENVS.has(env)) {
              const rest = live.slice(m.index! + m[0].length);
              if (!rest.includes(`\\end{${env}}`)) codeEnv = env;
              isCode = true;
              break;
            }
            envStack.push(env);
          } else {
            const idx = envStack.lastIndexOf(env);
            if (idx !== -1) envStack.splice(idx);
          }
        }
        const before = live.split(/\\begin\{/)[0] ?? '';
        if (!isCode || before.trim()) unit.prose = true;
        unit.lines.push({ offset, text, code: isCode && !before.trim() });
      } else {
        unit.lines.push({ offset, text, code: false });
      }
    }
    close();
  }

  const units: LatexUnit[] = [];
  const seenMarkers = new Map<string, number>();
  let lastMarker = '';
  let ordinal = 0;
  for (const d of drafts) {
    if (d.contentOffset === null) continue;
    if (!d.prose && !d.markerId) continue;
    let key: string;
    if (d.markerId) {
      const n = (seenMarkers.get(d.markerId) ?? 0) + 1;
      seenMarkers.set(d.markerId, n);
      key = n === 1 ? d.markerId : `${d.markerId}#${n}`;
      lastMarker = key;
      ordinal = 0;
    } else {
      ordinal++;
      key = `${lastMarker}+${ordinal}`;
    }
    units.push({ key, markerId: d.markerId, lines: d.lines, contentOffset: d.contentOffset });
  }
  return units;
}

/** Word's limit on bookmark names. */
const BOOKMARK_NAME_MAX = 40;

/** Prefix of every unit bookmark, distinguishing them from pandoc's heading bookmarks. */
export const UNIT_BOOKMARK_PREFIX = 'rp_';

/**
 * The docx bookmark name for a unit key: letters and digits kept, every other
 * byte written as `_HH`, so distinct keys never share a name. A name past
 * Word's 40-character limit becomes a hash of the key.
 */
export function unitBookmarkName(key: string): string {
  let encoded = '';
  for (const byte of Buffer.from(key, 'utf-8')) {
    const ch = String.fromCharCode(byte);
    encoded += /[A-Za-z0-9]/.test(ch) ? ch : `_${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  const name = UNIT_BOOKMARK_PREFIX + encoded;
  if (name.length <= BOOKMARK_NAME_MAX) return name;
  return `${UNIT_BOOKMARK_PREFIX}h${crypto.createHash('sha1').update(key).digest('hex').slice(0, 20)}`;
}
