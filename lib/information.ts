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
 *
 * Reuse checks: `many-names` (an entry whose forms are more than one name: shortenings
 * that drop words, plurals and an acronym of its expansion are one name), `unlisted-variant` (the plural
 * or singular of a form occurs but is listed under no entry, so the text uses the word
 * unchecked, often in another sense), `single-use-term` (a defined term no paragraph
 * uses after its definition) and `unused-acronym` (an acronym used in one paragraph only).
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

/** The text a reader reads: no comments, CriticMarkup comments or deletions, inline code, math or citation keys. */
function readable(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\{>>[\s\S]*?<<\}|\{--[\s\S]*?--\}/g, ' ')
    .replace(/\{\+\+([\s\S]*?)\+\+\}/g, '$1')
    .replace(/\{~~[\s\S]*?~>([\s\S]*?)~~\}/g, '$1')
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

const singular = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** A form's words, lower case and singular, parentheses, hyphens and symbols dropped. */
function formWords(form: string): string[] {
  return form.replace(/\([^)]*\)/g, ' ').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean).map(singular);
}

/** The short form's words appear in the long one in order: "macro-F1" of "macro-averaged F1". */
function shortens(long: string[], short: string[]): boolean {
  let at = 0;
  for (const w of short) {
    at = long.indexOf(w, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

/** "EVA" of "European Vegetation Archive", "MLP" of "multilayer perceptron": its letters in order, first first. */
function isAcronymOf(acronym: string, form: string): boolean {
  if (!/^\p{Lu}[\p{Lu}\p{N}]+s?$/u.test(acronym)) return false;
  const letters = acronym.replace(/s$/, '').toLowerCase();
  const long = formWords(form).join(' ');
  if (long[0] !== letters[0] || !long.includes(' ')) return false;
  let at = 0;
  for (const c of letters) {
    at = long.indexOf(c, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

/**
 * The distinct names among an entry's forms: a form containing a shorter form is that name
 * written out ("constant prediction" of "constant"), and an acronym is its expansion's name.
 */
export function entryNames(forms: string[]): string[] {
  const ws = [...new Map(forms.map((f) => [formWords(f).join(' '), f])).entries()]
    .filter(([w]) => w).map(([w, f]) => ({ w: w.split(' '), f }));
  const minimal = ws.filter((a) => !ws.some((b) => b !== a && b.w.length < a.w.length && shortens(a.w, b.w)));
  return minimal.filter((a) => !ws.some((b) => b !== a && isAcronymOf(a.f, b.f))).map((a) => a.f);
}

/** The other number of a form: "settings" for "setting", "fit" for "fits"; last word only. */
function otherNumber(form: string): string | null {
  const m = form.match(/^(.*?)(\p{Ll}+)$/u);
  if (!m || /\p{Lu}/u.test(m[2] as string)) return null;
  const last = m[2] as string;
  if (last.length < 4) return null;
  const other = last.endsWith('s') && !last.endsWith('ss') ? last.slice(0, -1) : /(s|x|ch|sh)$/.test(last) ? null : `${last}s`;
  return other ? (m[1] as string) + other : null;
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
    const names = entryNames(entry.forms);
    if (names.length > 1) {
      add('many-names', entry, `"${entry.forms[0]}" goes by ${names.length} names (${names.join('; ')}): keep one, move the others to avoid`);
    }
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
  const entryBlocks = new Map<InformationEntry, Set<number>>();
  const acronymBlocks = new Map<string, { entry: InformationEntry; at: Set<number> }>();
  const variants = new Map<string, InformationEntry>();
  for (const entry of entries) {
    for (const form of entry.forms) {
      const other = otherNumber(form);
      if (other && !lexicon.has(other) && !variants.has(other)) variants.set(other, entry);
    }
  }
  const variantRe = variants.size
    ? new RegExp(`(?<![\\p{L}\\p{N}_\\-])(?:${[...variants.keys()].sort((a, b) => b.length - a.length).map(formPattern).join('|')})(?![\\p{L}\\p{N}_\\-])`, 'gu')
    : null;
  const variantUses = new Map<string, { count: number; first: string }>();
  blocks.forEach((block, i) => {
    if (block.matter === 'back' || block.matter === 'metadata') return;
    // one early-use finding per term and paragraph: its first use there
    const earlyHere = new Set<InformationEntry>();
    const alone = isFrontMatter(block.section) || block.matter === 'front' || block.blockType === 'figure' ||
      block.blockType === 'table';
    const text = readable(block.text);
    if (variantRe) {
      const rest = text.replace(termRe, (s) => ' '.repeat(s.length));
      for (const m of rest.matchAll(variantRe)) {
        const said = m[0].split(/\s+/).join(' ');
        const key = variants.has(said) ? said : (said[0] as string).toLowerCase() + said.slice(1);
        const seen = variantUses.get(key);
        if (seen) seen.count++;
        else variantUses.set(key, { count: 1, first: `${block.markerId ? `@p:${block.markerId}` : `${block.file}:${block.line}`}: ${sentenceAt(text, m.index ?? 0)}` });
      }
    }
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
      if (!entryBlocks.has(entry)) entryBlocks.set(entry, new Set());
      (entryBlocks.get(entry) as Set<number>).add(i);
      if (/^\p{Lu}[\p{Lu}\p{N}]+s?$/u.test(said) && entry.forms.some((f) => f !== said && isAcronymOf(said, f))) {
        if (!acronymBlocks.has(said)) acronymBlocks.set(said, { entry, at: new Set() });
        (acronymBlocks.get(said) as { at: Set<number> }).at.add(i);
      }
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
    const at = entryBlocks.get(entry);
    const def = entry.defined ? position.get(entry.defined) : undefined;
    if (at && def !== undefined && ![...at].some((i) => i > def)) {
      add('single-use-term', entry, `"${entry.forms[0]}" is named at @p:${entry.defined} and not used after it: use the name, or say it there without one`);
    }
  }
  for (const [acronym, { entry, at }] of acronymBlocks) {
    if (at.size === 1) add('unused-acronym', entry, `"${acronym}" occurs in one paragraph only: drop it and write "${entry.forms[0]}"`);
  }
  for (const [variant, { count, first }] of variantUses) {
    const entry = variants.get(variant) as InformationEntry;
    add('unlisted-variant', entry, `"${variant}" occurs ${count}x but is listed under no entry; add it to the forms of "${entry.forms[0]}" or reword where it means something else. First at ${first}`);
  }
  return applyAccepts(findings, entries);
}
