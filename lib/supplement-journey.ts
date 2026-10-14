/**
 * Parser and checker for supplement/journey.md, the supporting information's
 * journey: one entry per table, figure, appendix or unnumbered section, in the
 * order the supplement prints them (gcol33/docrev#21).
 *
 * Format:
 *
 *   # Journey: Supporting Information
 *
 *   (preamble prose, ignored)
 *
 *   ## Interpolation and transfer           <- a part of the document
 *
 *   ### tbl.transfer-paired  [S3]           <- tbl. / fig. / app. / sec. + name, then arcs
 *   - title: Leave-one-database-out transfer on identical plots
 *   - file: transfer_paired.md              <- section file that prints it
 *   - tier: evidence                        <- evidence | reference | development | archive
 *   - supports: @p:fig.transfer; @p:res.transfer.databases
 *   - configuration: ...
 *   - status: ...
 *   - source: ...
 *   - accept: <check>: <reason>             (repeatable)
 *
 * Section text cites an item by key, `Table [[tbl:transfer-paired]]`; the
 * supplement's own build resolves keys to labels by position: S1, S2, ... per
 * kind, A1, A2, ... per kind for `archive` items, none for `sec`. The
 * manuscript writes the literal labels, which the build records in a lock file
 * (`numbers.json` beside the journey, key -> label).
 */

import { ENTRY_HEADING, FIELD_LINE, H2_HEADING, applyAccepts } from './journey.js';
import type {
  JourneyFinding,
  SidecarParseError,
  StoryDoc,
  SupplementItem,
  SupplementItemKind,
  SupplementJourneyDoc,
  SupplementTier,
} from './types.js';

const H1_TITLE = /^#\s+Journey:\s*(.*)$/i;

/** The word a literal reference uses for each numbered kind. */
export const SUPPLEMENT_KIND_WORD: Record<SupplementItemKind, string | null> = {
  tbl: 'Table',
  fig: 'Figure',
  app: 'Appendix',
  sec: null,
};

const TIERS = new Set<SupplementTier>(['evidence', 'reference', 'development', 'archive']);

/** A key placeholder in section text: `[[tbl:transfer-paired]]`. */
const KEY_PLACEHOLDER = /\[\[((?:tbl|fig|app):[\w-]+)\]\]/g;

/**
 * A literal reference: a kind word, then one or more numbers joined by "and",
 * a comma, "to" or an en dash. A list may mix manuscript numbers in
 * ("Tables 2 and S29"); only its S and A labels are supplement items.
 */
const LITERAL_REF = /\b(Tables?|Figures?|Appendix|Appendices)\s+([SA]?\d+(?:(?:\s*,\s*|\s+and\s+|\s+to\s+|–)[SA]?\d+)*)/g;

const KIND_OF_WORD: Record<string, SupplementItemKind> = {
  Table: 'tbl',
  Tables: 'tbl',
  Figure: 'fig',
  Figures: 'fig',
  Appendix: 'app',
  Appendices: 'app',
};

function emptyItem(id: string, kind: SupplementItemKind, part: string, arcs: string[], line: number): SupplementItem {
  const name = id.slice(id.indexOf('.') + 1);
  return {
    id,
    key: `${kind}:${name}`,
    kind,
    part,
    arcs,
    title: '',
    file: '',
    tier: null,
    supports: [],
    configuration: '',
    status: '',
    source: '',
    accepts: [],
    line,
  };
}

/**
 * Parse supplement/journey.md. Lines outside an entry (the preamble, a part's
 * introduction) are prose and ignored; inside an entry every non-blank line is
 * a `- field: value` line.
 */
export function parseSupplementJourney(
  content: string,
  file: string
): { doc: SupplementJourneyDoc; errors: SidecarParseError[] } {
  const errors: SidecarParseError[] = [];
  const doc: SupplementJourneyDoc = { title: '', items: [] };
  const seen = new Set<string>();
  let part = '';
  let current: SupplementItem | null = null;

  const closeItem = () => {
    if (!current) return;
    if (!current.file) errors.push({ file, line: current.line, message: `${current.id} names no file` });
    if (!current.tier) errors.push({ file, line: current.line, message: `${current.id} has no tier` });
    doc.items.push(current);
    current = null;
  };

  content.split(/\r?\n/).forEach((raw, i) => {
    const lineNo = i + 1;
    const line = raw.trim();

    const h1 = raw.match(H1_TITLE);
    if (h1) {
      doc.title = (h1[1] || '').trim();
      return;
    }
    const h2 = raw.match(H2_HEADING);
    if (h2) {
      closeItem();
      part = (h2[1] || '').trim();
      return;
    }
    const heading = raw.match(ENTRY_HEADING);
    if (heading) {
      closeItem();
      const id = heading[1] || '';
      const kind = id.slice(0, id.indexOf('.')) as SupplementItemKind;
      if (!(kind in SUPPLEMENT_KIND_WORD) || id.indexOf('.') === id.length - 1) {
        errors.push({ file, line: lineNo, message: `Entry "${id}" does not start with tbl., fig., app. or sec. and a name` });
        return;
      }
      if (seen.has(id)) errors.push({ file, line: lineNo, message: `Duplicate entry id "${id}"` });
      seen.add(id);
      current = emptyItem(id, kind, part, (heading[2] || '').split(/[\s,]+/).filter(Boolean), lineNo);
      return;
    }

    if (!line || !current) return;
    const item: SupplementItem = current;
    const field = line.match(FIELD_LINE);
    if (!field) {
      errors.push({ file, line: lineNo, message: `Expected a "- field: value" line inside an entry, got "${line}"` });
      return;
    }
    const value = (field[2] || '').trim();
    switch ((field[1] || '').toLowerCase()) {
      case 'title':
        item.title = value;
        break;
      case 'file':
        item.file = value;
        break;
      case 'tier':
        if (TIERS.has(value as SupplementTier)) item.tier = value as SupplementTier;
        else errors.push({ file, line: lineNo, message: `Tier "${value}" is not one of ${[...TIERS].join(', ')}` });
        break;
      case 'supports':
        item.supports = value
          .split(/[;,\s]+/)
          .filter(Boolean)
          .map((s) => s.replace(/^@p:/, ''));
        break;
      case 'configuration':
        item.configuration = value;
        break;
      case 'status':
        item.status = value;
        break;
      case 'source':
        item.source = value;
        break;
      case 'accept':
        item.accepts.push(value);
        break;
      default:
        errors.push({ file, line: lineNo, message: `Unknown entry field "${field[1]}"` });
    }
  });
  closeItem();

  return { doc, errors };
}

/** Each numbered item's label by key: S1, S2, ... per kind, A1, A2, ... per kind in the archive. */
export function supplementLabels(items: SupplementItem[]): Map<string, string> {
  const count = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const item of items) {
    if (SUPPLEMENT_KIND_WORD[item.kind] === null) continue;
    const archive = item.tier === 'archive';
    const slot = `${item.kind}:${archive}`;
    const n = (count.get(slot) ?? 0) + 1;
    count.set(slot, n);
    labels.set(item.key, `${archive ? 'A' : 'S'}${n}`);
  }
  return labels;
}

/** A text the supplement checks read: its path (for messages) and content. */
export interface SourceText {
  file: string;
  content: string;
}

export interface SupplementCheckInput {
  /** Every `.md` file in the supplement sections directory, by name relative to it. */
  sectionFiles: Map<string, string>;
  /** Manuscript section files: they cite items by literal label and may never cite the archive. */
  manuscript: SourceText[];
  /** story.md, journey.md: they cite items too, as evidence and provenance. */
  sidecars: SourceText[];
  /** `@p:` marker IDs present in the manuscript. */
  markerIds: Set<string>;
  story?: StoryDoc | null;
  /** The supplement build's last labels (numbers.json), when it keeps one. */
  lock?: Record<string, string> | null;
}

function lineAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/** The literal S/A labels a text cites, with the kind they name. */
function literalLabels(content: string): Array<{ kind: SupplementItemKind; label: string; text: string; line: number }> {
  const out: Array<{ kind: SupplementItemKind; label: string; text: string; line: number }> = [];
  for (const m of content.matchAll(LITERAL_REF)) {
    const word = m[1] ?? '';
    const kind = KIND_OF_WORD[word];
    if (!kind) continue;
    for (const label of (m[2] ?? '').match(/[SA]\d+/g) ?? []) {
      out.push({ kind, label, text: `${word} ${label}`, line: lineAt(content, m.index ?? 0) });
    }
  }
  return out;
}

function hasKey(content: string, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\[\\[${escaped}\\]\\]|\\{#${escaped}[\\s}]`).test(content);
}

/**
 * Check supplement/journey.md against the supplement's section files, the
 * manuscript that cites it, and story.md. Findings carry the item's `id` in
 * `entryIds`, so an `- accept:` line on that item can overrule them.
 */
export function supplementCheck(doc: SupplementJourneyDoc, input: SupplementCheckInput): JourneyFinding[] {
  const findings: JourneyFinding[] = [];
  const { sectionFiles, manuscript, sidecars, markerIds, story = null, lock = null } = input;
  const itemByKey = new Map(doc.items.map((item) => [item.key, item]));
  const labels = supplementLabels(doc.items);
  const keyOfLabel = new Map([...labels].map(([key, label]) => [`${key.slice(0, 3)}:${label}`, key]));
  const arcIds = new Set(story?.arcs.map((a) => a.id) ?? []);

  // 1. Every file the journey names exists and holds its item; every section file is placed.
  const placed = new Set(doc.items.map((item) => item.file));
  for (const item of doc.items) {
    if (!item.file) continue;
    const content = sectionFiles.get(item.file);
    if (content === undefined) {
      findings.push({
        kind: 'supplement-missing-file',
        message: `${item.id} names ${item.file}, which is not in the supplement sections directory`,
        line: item.line,
        entryIds: [item.id],
      });
    } else if (item.kind !== 'sec' && !hasKey(content, item.key)) {
      findings.push({
        kind: 'supplement-missing-key',
        message: `${item.file} prints no [[${item.key}]] (or {#${item.key}}) for ${item.id}`,
        file: item.file,
        line: item.line,
        entryIds: [item.id],
      });
    }
  }
  for (const file of sectionFiles.keys()) {
    if (!placed.has(file)) {
      findings.push({
        kind: 'supplement-unplaced-file',
        message: `${file} is in the supplement sections directory but no journey entry places it`,
        file,
      });
    }
  }

  // 2. Every key and literal label cited resolves to an item; the manuscript never cites the archive.
  const texts: Array<SourceText & { mayCiteArchive: boolean }> = [
    ...[...sectionFiles].map(([file, content]) => ({ file, content, mayCiteArchive: true })),
    ...sidecars.map((s) => ({ ...s, mayCiteArchive: true })),
    ...manuscript.map((s) => ({ ...s, mayCiteArchive: false })),
  ];
  for (const { file, content, mayCiteArchive } of texts) {
    for (const m of content.matchAll(KEY_PLACEHOLDER)) {
      const key = m[1] ?? '';
      const item = itemByKey.get(key);
      const line = lineAt(content, m.index ?? 0);
      if (!item) {
        findings.push({ kind: 'supplement-unknown-key', message: `${file}:${line} cites [[${key}]], which no supplement journey entry has`, file, line });
      } else if (item.tier === 'archive' && !mayCiteArchive) {
        findings.push({
          kind: 'supplement-archive-cited',
          message: `${file}:${line} cites archive item ${item.id}; promote it to the supplement or drop the citation`,
          file,
          line,
          entryIds: [item.id],
        });
      }
    }
    for (const ref of literalLabels(content)) {
      const key = keyOfLabel.get(`${ref.kind}:${ref.label}`);
      if (!key) {
        findings.push({ kind: 'supplement-unresolved-label', message: `${file}:${ref.line} cites ${ref.text}, which no supplement item carries`, file, line: ref.line });
      } else if (ref.label.startsWith('A') && !mayCiteArchive) {
        const item = itemByKey.get(key) as SupplementItem;
        findings.push({
          kind: 'supplement-archive-cited',
          message: `${file}:${ref.line} cites ${ref.text} (${item.id}) from the development archive; promote it to the supplement or drop the citation`,
          file,
          line: ref.line,
          entryIds: [item.id],
        });
      }
    }
  }

  // 3. Every item supports a manuscript claim that exists, under arcs story.md has.
  for (const item of doc.items) {
    if (item.tier === 'evidence' && item.supports.length === 0) {
      findings.push({
        kind: 'supplement-no-support',
        message: `${item.id} is evidence but names no manuscript paragraph it supports`,
        line: item.line,
        entryIds: [item.id],
      });
    }
    for (const id of item.supports) {
      if (!markerIds.has(id)) {
        findings.push({
          kind: 'supplement-dangling-support',
          message: `${item.id} supports @p:${id}, which no manuscript paragraph carries`,
          line: item.line,
          entryIds: [item.id],
        });
      }
    }
    if (story) {
      for (const arc of item.arcs) {
        if (!arcIds.has(arc)) {
          findings.push({
            kind: 'supplement-unknown-arc',
            message: `${item.id} claims arc "${arc}", which story.md does not define`,
            line: item.line,
            entryIds: [item.id],
          });
        }
      }
    }
  }

  // 4. The build's lock holds the labels the journey's order gives.
  if (lock) {
    const moved = [...new Set([...labels.keys(), ...Object.keys(lock)])]
      .filter((key) => labels.get(key) !== lock[key])
      .map((key) => `${key} ${lock[key] ?? '-'} -> ${labels.get(key) ?? '-'}`);
    if (moved.length > 0) {
      findings.push({
        kind: 'supplement-stale-lock',
        message: `numbers.json differs from the journey's order (${moved.slice(0, 5).join('; ')}${moved.length > 5 ? `; +${moved.length - 5} more` : ''}); rebuild the supplement`,
      });
    }
  }

  return applyAccepts(findings, doc.items);
}
