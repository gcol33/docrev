/**
 * Reader load: how many of information.md's terms a reader holds at each paragraph.
 *
 * A term is introduced at its definition or first gloss, whichever comes first, and is
 * held from there to its last use: the reader has to keep it until the text stops using
 * it. A term the text uses but never introduces is held from its first use. Entries marked
 * `known` cost the audience nothing and are left out. Only the body is profiled: front
 * matter, captions and tables are read on their own, back matter is not read for the
 * argument.
 */

import { isFrontMatter } from './journey.js';
import { readable, termLexicon } from './information.js';
import type { InformationEntry } from './information.js';
import type { ManuscriptBlock } from './types.js';

export interface LoadRow {
  id: string | null;
  file: string;
  line: number;
  section: string;
  /** Words of the body before this paragraph. */
  at: number;
  words: number;
  /** Terms introduced here (definition or first gloss). */
  introduced: string[];
  /** Terms used here before the text introduces them, or never introduced. */
  early: string[];
  /** Terms used here. */
  used: string[];
  /** Terms the reader holds at this paragraph. */
  held: number;
}

export interface LoadProfile {
  rows: LoadRow[];
  /** Body words. */
  words: number;
  /** Terms profiled (every entry but `known` ones that the body uses). */
  terms: number;
  /** Body word at which each term is first met (introduced or used), by term. */
  met: Array<{ term: string; at: number; introduced: boolean }>;
  peak: { held: number; id: string | null; line: number; file: string } | null;
}

function profiled(block: ManuscriptBlock): boolean {
  if (block.matter && block.matter !== 'body') return false;
  if (isFrontMatter(block.section)) return false;
  return block.blockType !== 'figure' && block.blockType !== 'table';
}

export function readerLoad(blocks: ManuscriptBlock[], entries: InformationEntry[]): LoadProfile {
  const counted = entries.filter((e) => !e.known);
  const body = blocks.filter(profiled);
  const index = new Map<string, number>();
  body.forEach((b, i) => { if (b.markerId && !index.has(b.markerId)) index.set(b.markerId, i); });

  const { termRe, lookup } = termLexicon(counted);
  const uses = body.map((block) => {
    const here = new Set<InformationEntry>();
    if (!termRe) return here;
    for (const m of readable(block.text).matchAll(termRe)) {
      const hit = lookup(m[0]);
      if (hit && !hit.avoid) here.add(hit.entry);
    }
    return here;
  });

  const intro = new Map<InformationEntry, number>();
  for (const entry of counted) {
    const at = [entry.defined, ...entry.glossed].flatMap((id) => (id && index.has(id) ? [index.get(id) as number] : []));
    if (at.length) intro.set(entry, Math.min(...at));
  }
  const first = new Map<InformationEntry, number>();
  const last = new Map<InformationEntry, number>();
  uses.forEach((here, i) => here.forEach((e) => {
    if (!first.has(e)) first.set(e, i);
    last.set(e, i);
  }));

  const words: number[] = body.map((b) => readable(b.text).split(/\s+/).filter(Boolean).length);
  const offset: number[] = [];
  words.reduce((sum, w, i) => { offset[i] = sum; return sum + w; }, 0);

  const span = new Map<InformationEntry, [number, number]>();
  for (const entry of counted) {
    if (!first.has(entry)) continue;
    const start = Math.min(intro.get(entry) ?? Infinity, first.get(entry) as number);
    span.set(entry, [start, Math.max(last.get(entry) as number, start)]);
  }

  const rows: LoadRow[] = body.map((block, i) => {
    const used = [...uses[i] as Set<InformationEntry>];
    return {
      id: block.markerId,
      file: block.file,
      line: block.line,
      section: block.section,
      at: offset[i] as number,
      words: words[i] as number,
      introduced: counted.filter((e) => span.has(e) && intro.get(e) === i).map((e) => e.forms[0] as string),
      early: used.filter((e) => (intro.has(e) ? i < (intro.get(e) as number) : first.get(e) === i)).map((e) => e.forms[0] as string),
      used: used.map((e) => e.forms[0] as string),
      held: [...span.values()].filter(([a, b]) => a <= i && i <= b).length,
    };
  });

  const peakRow = rows.reduce<LoadRow | null>((best, r) => (!best || r.held > best.held ? r : best), null);
  const met = [...span.entries()]
    .map(([e, [a]]) => ({ term: e.forms[0] as string, at: offset[a] as number, introduced: intro.get(e) === a }))
    .sort((x, y) => x.at - y.at);
  return {
    rows,
    words: words.reduce((a, b) => a + b, 0),
    terms: span.size,
    met,
    peak: peakRow ? { held: peakRow.held, id: peakRow.id, line: peakRow.line, file: peakRow.file } : null,
  };
}
