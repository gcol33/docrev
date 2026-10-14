/**
 * Parser and mechanical checks for information.md: the terms and populations a
 * reader must hold, checked against the manuscript's paragraphs.
 *
 * Format (Terms and Populations; other sections are read by people, not checked here):
 *
 *   ## Terms
 *   ### admissible-pair
 *   - forms: admissible pair; admissible pairs
 *   - as: a pair allowed by any distance limits
 *   - defined: @p:intro.pairs          (or `known`, or `none`)
 *   - avoid: the complete set of pairs
 *   - glossed: @p:<id>                 (abstract, caption, supplement, reminder: read alone)
 *   - accept: <check> [@p:<id>] ["<words>"]: <reason>
 *
 * Checks: `undefined` (no definition anchor and not `known`), `unresolved-anchor`,
 * `form-collision`, `circular-definition`, `gloss-order`, `synonym-drift` (an avoided
 * wording in the text), `use-before-define` and `unused-entry`. A form written in
 * lower case also matches with a capital first letter; one holding capitals matches
 * only as written. The abstract, captions and an entry's read-alone anchors are never
 * early.
 */

import { applyAccepts, isFrontMatter } from './journey.js';
import type { JourneyFinding, ManuscriptBlock, SidecarParseError } from './types.js';

const SECTION = /^##\s+(.+?)\s*$/;
const ENTRY = /^###\s+(\S+)\s*$/;
const FIELD = /^-\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/;
const REF = /@p:([\w.:-]*[\w-])/g;
const CHECKED = new Set(['Terms', 'Populations']);
const ALONE_KEYS = ['abstract', 'caption', 'supplement', 'reminder'];

export interface InformationEntry {
  id: string;
  section: string;
  forms: string[];
  as: string;
  /** Paragraph id of the definition, or null. */
  defined: string | null;
  /** `known`: the audience has the term; no definition expected. */
  known: boolean;
  glossed: string[];
  /** Paragraphs read on their own (abstract, caption, supplement, reminder anchors). */
  alone: string[];
  avoid: string[];
  accepts: string[];
  line: number;
}

const list = (value: string) => value.split(';').map((s) => s.trim().replace(/’/g, "'")).filter(Boolean);
const refs = (value: string) => [...value.matchAll(REF)].map((m) => m[1] as string);

/** Parse the Terms and Populations of information.md. Never throws. */
export function parseInformation(content: string, file = 'information.md'): { entries: InformationEntry[]; errors: SidecarParseError[] } {
  const entries: InformationEntry[] = [];
  const errors: SidecarParseError[] = [];
  let section = '';
  let current: InformationEntry | null = null;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? '';
    const s = raw.match(SECTION);
    if (s) {
      section = (s[1] || '').trim();
      current = null;
      continue;
    }
    const e = raw.match(ENTRY);
    if (e) {
      current = null;
      if (!CHECKED.has(section)) continue;
      current = { id: e[1] as string, section, forms: [], as: '', defined: null, known: false, glossed: [], alone: [],
                  avoid: [], accepts: [], line: i + 1 };
      entries.push(current);
      continue;
    }
    const f = raw.trim().match(FIELD);
    if (!f || !current) continue;
    const key = (f[1] || '').toLowerCase();
    const value = (f[2] || '').trim();
    if (key === 'forms') current.forms = list(value);
    else if (key === 'as') current.as = value;
    else if (key === 'defined') {
      current.defined = refs(value)[0] ?? null;
      current.known = !current.defined && /^known\b/i.test(value);
    } else if (key === 'glossed') current.glossed.push(...refs(value));
    else if (ALONE_KEYS.includes(key)) current.alone.push(...refs(value));
    else if (key === 'avoid') current.avoid.push(...list(value).filter((a) => !a.includes('(')));
    else if (key === 'accept') current.accepts.push(value);
  }
  for (const entry of entries) {
    if (entry.forms.length === 0) errors.push({ file, line: entry.line, message: `Entry "${entry.id}" has no forms` });
  }
  return { entries: entries.filter((e) => e.forms.length > 0), errors };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function formPattern(form: string): string {
  const body = form.split(/\s+/).map((w) => escape(w).replace(/'/g, "['’]")).join('\\s+');
  const first = form[0] as string;
  return form === form.toLowerCase() && /\p{Ll}/u.test(first) ? `[${first}${first.toUpperCase()}]` + body.slice(1) : body;
}

/** The text a reader reads: no comments, inline code, math or citation keys. */
function readable(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g, ' ')
    .replace(/\[@[^\]]*\]|@[\w:-]+/g, ' ')
    .replace(/’/g, "'");
}

/** The sentence of `text` holding position `at`; a full stop after "et al", "e.g", "Fig" does not end one. */
function sentenceAt(text: string, at: number): string {
  let start = 0;
  for (const m of text.matchAll(/[.!?](?=\s+[\p{Lu}(\d])/gu)) {
    const end = (m.index ?? 0) + 1;
    if (/\b(al|e\.g|i\.e|cf|vs|approx|Fig|Tab|Eq)$/i.test(text.slice(Math.max(0, end - 7), end - 1))) continue;
    if (end > at) return text.slice(start, end).replace(/\s+/g, ' ').trim();
    start = end;
  }
  return text.slice(start).replace(/\s+/g, ' ').trim();
}

interface Hit {
  entry: InformationEntry;
  avoid: boolean;
}

/**
 * Check information.md's terms against the manuscript. Findings carry the entry id
 * in `entryIds`, so `- accept:` lines on that entry overrule them.
 */
export function informationCheck(blocks: ManuscriptBlock[], entries: InformationEntry[]): JourneyFinding[] {
  const findings: JourneyFinding[] = [];
  const add = (kind: JourneyFinding['kind'], entry: InformationEntry, message: string, block?: ManuscriptBlock) =>
    findings.push({ kind, message, entryIds: [entry.id],
                    ...(block ? { file: block.file, line: block.line, ...(block.markerId ? { paragraph: block.markerId } : {}) }
                              : { line: entry.line }) });

  const position = new Map<string, number>();
  blocks.forEach((b, i) => { if (b.markerId && !position.has(b.markerId)) position.set(b.markerId, i); });

  const lexicon = new Map<string, Hit>();
  for (const entry of entries) {
    if (!entry.defined && !entry.known) add('undefined', entry, `"${entry.forms[0]}" has no definition in the text (defined: none or missing)`);
    for (const id of [entry.defined, ...entry.glossed, ...entry.alone]) {
      if (id && !position.has(id)) add('unresolved-anchor', entry, `"${entry.id}" points to @p:${id}, which no paragraph carries`);
    }
    for (const form of entry.forms) {
      const other = lexicon.get(form);
      if (other) {
        add('form-collision', entry, `"${form}" is also a form of "${other.entry.forms[0]}"`);
        add('form-collision', other.entry, `"${form}" is also a form of "${entry.forms[0]}"`);
      } else {
        lexicon.set(form, { entry, avoid: false });
      }
    }
  }
  for (const entry of entries) {
    for (const a of entry.avoid) if (!lexicon.has(a)) lexicon.set(a, { entry, avoid: true });
  }
  if (lexicon.size === 0) return findings;
  const alts = [...lexicon.keys()].sort((a, b) => b.length - a.length).map(formPattern);
  const termRe = new RegExp(`(?<![\\p{L}\\p{N}_\\-])(?:${alts.join('|')})(?![\\p{L}\\p{N}_\\-])`, 'gu');
  const lookup = (text: string): Hit | undefined => {
    const t = text.replace(/\s+/g, ' ').replace(/’/g, "'");
    return lexicon.get(t) ?? lexicon.get((t[0] as string).toLowerCase() + t.slice(1));
  };

  for (const entry of entries) {
    for (const m of entry.as.matchAll(termRe)) {
      const hit = lookup(m[0]);
      if (!hit || hit.avoid) continue;
      if (hit.entry === entry) {
        add('circular-definition', entry, `the gloss of "${entry.forms[0]}" uses its own name ("${m[0]}")`);
      } else if (entry.defined && hit.entry.defined &&
                 (position.get(hit.entry.defined) ?? -1) > (position.get(entry.defined) ?? Infinity)) {
        add('gloss-order', entry, `the gloss of "${entry.forms[0]}" relies on "${hit.entry.forms[0]}", which the text defines later`);
      }
    }
  }

  // the text introduces a term at its first gloss or its definition, whichever comes first
  const intro = new Map<InformationEntry, number>();
  for (const entry of entries) {
    const at = [entry.defined, ...entry.glossed].flatMap((id) => (id && position.has(id) ? [position.get(id) as number] : []));
    if (at.length) intro.set(entry, Math.min(...at));
  }
  const used = new Set<InformationEntry>();
  blocks.forEach((block, i) => {
    if (block.matter === 'back' || block.matter === 'metadata') return;
    // one early-use finding per term and paragraph: its first use there
    const earlyHere = new Set<InformationEntry>();
    const alone = isFrontMatter(block.section) || block.matter === 'front' || block.blockType === 'figure' ||
      block.blockType === 'table';
    const text = readable(block.text);
    for (const m of text.matchAll(termRe)) {
      const hit = lookup(m[0]);
      if (!hit) continue;
      const { entry } = hit;
      const where = block.markerId ? `@p:${block.markerId}` : `${block.file}:${block.line}`;
      const said = m[0].split(/\s+/).join(' ');
      if (hit.avoid) {
        add('synonym-drift', entry, `"${said}" at ${where}, write "${entry.forms[0]}": ${sentenceAt(text, m.index ?? 0)}`, block);
        continue;
      }
      used.add(entry);
      const start = intro.get(entry);
      if (start !== undefined && i < start && !alone && !(block.markerId && entry.alone.includes(block.markerId)) &&
          !earlyHere.has(entry)) {
        earlyHere.add(entry);
        add('use-before-define', entry, `"${said}" at ${where}, before the text introduces it: ${sentenceAt(text, m.index ?? 0)}`, block);
      }
    }
  });
  for (const entry of entries) {
    if (!used.has(entry)) add('unused-entry', entry, `no form of "${entry.forms[0]}" occurs in the text`);
  }
  return applyAccepts(findings, entries);
}
