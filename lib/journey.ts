/**
 * Parser and checker for journey.md — one entry per paragraph/float, in
 * reading order (see skill/SKILL.md "Story and journey sidecars",
 * gcol33/docrev#12).
 *
 * Format:
 *
 *   # Journey: <title>
 *
 *   ## Introduction
 *
 *   ### intro.memory  [S1]
 *   - idea: memory sets the bound
 *   - job: ...
 *   - support: ...
 *   - leaves: ...
 *   - warning: <finding>          (repeatable)
 *   - accept: <check>: <reason>   (repeatable)
 *
 *   ### fig.headline  [S2 S4]  (figure)
 *   - job: ...
 */

import { detectDynamicRefs } from './crossref.js';
import { wordOverlapSimilarity } from './anchor-match.js';
import type {
  JourneyDoc,
  JourneyEntry,
  JourneyEntryType,
  JourneyFinding,
  ManuscriptBlock,
  Registry,
  SidecarParseError,
  StoryDoc,
} from './types.js';

const H1_TITLE = /^#\s+Journey:\s*(.*)$/i;
const H2_HEADING = /^##\s+(.+?)\s*$/;
const ENTRY_HEADING = /^###\s+(\S+)\s*(?:\[([^\]]*)\])?\s*(?:\(([^)]*)\))?\s*$/;
const FIELD_LINE = /^-\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/;

const VALID_TYPES = new Set<JourneyEntryType>(['paragraph', 'figure', 'table', 'equation', 'code']);

const FRONT_MATTER = /^(abstract|summary|author summary|significance( statement)?|highlights|graphical abstract|key ?words)$/i;

/** A section read on its own before the text: abstract, summary, significance statement, highlights. */
export function isFrontMatter(section: string): boolean {
  return FRONT_MATTER.test(section.replace(/^\d+(\.\d+)*\s+/, '').trim());
}

function emptyEntry(id: string, section: string, arcs: string[], entryType: JourneyEntryType, line: number): JourneyEntry {
  return { id, section, arcs, entryType, idea: '', job: '', support: '', leaves: '', warnings: [], accepts: [], line };
}

/**
 * Parse a journey.md document. Never throws: malformed lines become
 * {@link SidecarParseError}s the caller can surface as findings.
 */
export function parseJourney(content: string, file = 'journey.md'): { doc: JourneyDoc; errors: SidecarParseError[] } {
  const errors: SidecarParseError[] = [];
  const lines = content.split(/\r?\n/);

  const doc: JourneyDoc = { title: '', entries: [] };
  let section = '';
  let current: JourneyEntry | null = null;
  const seenIds = new Set<string>();

  const closeEntry = () => {
    if (current) doc.entries.push(current);
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i] ?? '';
    const line = raw.trim();

    const h1 = raw.match(H1_TITLE);
    if (h1) {
      doc.title = (h1[1] || '').trim();
      continue;
    }

    const h2 = raw.match(H2_HEADING);
    if (h2) {
      closeEntry();
      section = (h2[1] || '').trim();
      continue;
    }

    const entryMatch = raw.match(ENTRY_HEADING);
    if (entryMatch) {
      closeEntry();
      const id = entryMatch[1] || '';
      const arcs = (entryMatch[2] || '').split(/\s+/).filter(Boolean);
      const typeRaw = (entryMatch[3] || '').trim().toLowerCase();
      let entryType: JourneyEntryType = 'paragraph';
      if (typeRaw) {
        if (VALID_TYPES.has(typeRaw as JourneyEntryType)) {
          entryType = typeRaw as JourneyEntryType;
        } else {
          errors.push({ file, line: lineNo, message: `Unknown entry type "(${entryMatch[3]})"` });
        }
      }
      if (seenIds.has(id)) {
        errors.push({ file, line: lineNo, message: `Duplicate entry id "${id}"` });
      }
      seenIds.add(id);
      current = emptyEntry(id, section, arcs, entryType, lineNo);
      continue;
    }

    if (!line) continue;

    const field = line.match(FIELD_LINE);
    if (!field) {
      errors.push({ file, line: lineNo, message: `Expected a "- field: value" line inside an entry, got "${line}"` });
      continue;
    }
    if (!current) {
      errors.push({ file, line: lineNo, message: `Field "${field[1]}" appears before any entry heading` });
      continue;
    }
    const key = (field[1] || '').toLowerCase();
    const value = (field[2] || '').trim();
    switch (key) {
      case 'idea':
        current.idea = value;
        break;
      case 'job':
        current.job = value;
        break;
      case 'support':
        current.support = value;
        break;
      case 'leaves':
        current.leaves = value;
        break;
      case 'warning':
        current.warnings.push(value);
        break;
      case 'accept':
        current.accepts.push(value);
        break;
      default:
        errors.push({ file, line: lineNo, message: `Unknown entry field "${field[1]}"` });
    }
  }

  closeEntry();
  return { doc, errors };
}

/**
 * Serialize a single journey entry back to its `### id [arcs] (type)` +
 * field-list form, used by `rev journey init` to append scaffolded entries.
 */
export function formatJourneyEntry(entry: JourneyEntry): string {
  const arcTag = entry.arcs.length > 0 ? `  [${entry.arcs.join(' ')}]` : '';
  const typeTag = entry.entryType !== 'paragraph' ? `  (${entry.entryType})` : '';
  const lines = [`### ${entry.id}${arcTag}${typeTag}`];
  if (entry.idea) lines.push(`- idea: ${entry.idea}`);
  lines.push(`- job: ${entry.job}`);
  if (entry.support) lines.push(`- support: ${entry.support}`);
  if (entry.leaves) lines.push(`- leaves: ${entry.leaves}`);
  for (const warning of entry.warnings) lines.push(`- warning: ${warning}`);
  for (const accept of entry.accepts) lines.push(`- accept: ${accept}`);
  return lines.join('\n');
}

/** Serialize a full journey doc, grouping consecutive entries by section. */
export function serializeJourney(title: string, entries: JourneyEntry[]): string {
  const lines: string[] = [`# Journey: ${title}`, ''];
  let lastSection: string | null = null;
  for (const entry of entries) {
    if (entry.section !== lastSection) {
      lines.push(`## ${entry.section || 'Untitled'}`, '');
      lastSection = entry.section;
    }
    lines.push(formatJourneyEntry(entry), '');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

const SECTION_ALIASES: Record<string, string> = {
  introduction: 'intro',
  discussion: 'disc',
  methods: 'methods',
  materials: 'methods',
  results: 'res',
  conclusion: 'concl',
  conclusions: 'concl',
  abstract: 'abs',
  appendix: 'app',
  supplementary: 'supp',
  background: 'bg',
};

const TYPE_ABBR: Record<JourneyEntryType, string> = {
  paragraph: 'p',
  figure: 'fig',
  table: 'tbl',
  equation: 'eq',
  code: 'code',
};

/** A short, stable slug for a section heading — the ID prefix "intro" in "intro.p3". */
export function sectionSlug(section: string): string {
  const words = section
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'sec';
  const first = words[0] as string;
  return SECTION_ALIASES[first] || first.slice(0, 8);
}

/** First sentence of a block's text, stripped of markdown markup — the seed for a draft `job`. */
export function firstSentence(text: string): string {
  const plain = text
    .replace(/\n+/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)(?:\{[^}]*\})?/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  const match = plain.match(/^(.*?[.!?])(\s|$)/);
  const sentence = match ? (match[1] as string) : plain;
  return sentence.length > 200 ? `${sentence.slice(0, 197)}...` : sentence;
}

/**
 * Assign a fresh `<sectionSlug>.<type><n>` ID to every block missing one,
 * unique against `existingIds` (every marker already used anywhere in the
 * project). IDs are a scaffold, not a final name — `journey init`'s job is
 * to make every paragraph addressable, not to name it well; the semantic
 * rename is left to whoever fills in the scaffolded entry.
 */
export function assignParagraphIds(
  blocks: ManuscriptBlock[],
  existingIds: Iterable<string>
): { updated: ManuscriptBlock[]; newIds: string[] } {
  const used = new Set(existingIds);
  const counters = new Map<string, number>();
  const newIds: string[] = [];

  const updated = blocks.map((block) => {
    if (block.markerId) {
      used.add(block.markerId);
      return block;
    }
    const slug = sectionSlug(block.section);
    const abbr = TYPE_ABBR[block.blockType];
    const counterKey = `${slug}.${abbr}`;
    let n = (counters.get(counterKey) ?? 0) + 1;
    let id = `${slug}.${abbr}${n}`;
    while (used.has(id)) {
      n++;
      id = `${slug}.${abbr}${n}`;
    }
    counters.set(counterKey, n);
    used.add(id);
    newIds.push(id);
    return { ...block, markerId: id };
  });

  return { updated, newIds };
}

/**
 * Build the full set of journey entries for `init`: every marked block gets
 * an entry, reusing the hand-authored fields of an existing entry with the
 * same ID (arcs, support, leaves) and only refreshing its scaffolded
 * bookkeeping (section, type). A block with no prior entry gets a fresh
 * draft: no arcs, `job` seeded from its first sentence.
 */
export function scaffoldJourneyEntries(
  blocks: ManuscriptBlock[],
  existingById: Map<string, JourneyEntry>
): JourneyEntry[] {
  return blocks
    .filter((b): b is ManuscriptBlock & { markerId: string } => b.markerId !== null)
    .map((block) => {
      const prior = existingById.get(block.markerId);
      if (prior) {
        return { ...prior, section: block.section, entryType: block.blockType };
      }
      return {
        id: block.markerId,
        section: block.section,
        arcs: [],
        entryType: block.blockType,
        idea: '',
        job: firstSentence(block.text),
        support: '',
        leaves: '',
        warnings: [],
        accepts: [],
        line: 0,
      };
    });
}

// A sentence boundary: '.', '!' or '?' followed by whitespace/end, not
// preceded by a common abbreviation or a decimal point between digits.
const SENTENCE_END = /[.!?](?:\s+|$)/g;

/** Rough sentence count for the "job is one sentence" check. */
function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  // Collapse common abbreviations and decimal numbers so they don't count
  // as sentence boundaries (e.g. "e.g." or "3.5").
  const collapsed = trimmed
    .replace(/\b(e\.g|i\.e|etc|cf|vs|et al|Fig|Eq|Tbl|approx|Dr|Mr|Mrs|Ms)\./gi, '$1\u0000')
    .replace(/(\d)\.(\d)/g, '$1\u0000$2');
  const matches = collapsed.match(SENTENCE_END);
  return matches ? matches.length : 1;
}

export interface JourneyCheckOptions {
  story?: StoryDoc | null;
  registry?: Registry | null;
}

/**
 * Run the checks from gcol33/docrev#12 against a manuscript's blocks, its
 * journey.md entries, and (optionally) its story.md arcs. Findings are
 * structure decisions made visible, not hard errors — the caller decides
 * what to do with them.
 */
export function journeyCheck(
  blocks: ManuscriptBlock[],
  journey: JourneyDoc,
  options: JourneyCheckOptions = {}
): JourneyFinding[] {
  const findings: JourneyFinding[] = [];
  const { story = null, registry = null } = options;

  const entryById = new Map(journey.entries.map((e) => [e.id, e]));
  const blocksWithMarker = blocks.filter((b) => b.markerId);
  const blockById = new Map(blocksWithMarker.map((b) => [b.markerId as string, b]));

  // 1. Every paragraph has an ID and an entry; no entry without a paragraph;
  //    order matches.
  for (const block of blocks) {
    if (!block.markerId) {
      findings.push({
        kind: 'missing-marker',
        message: `${block.blockType} at ${block.file}:${block.line} has no <!-- @p:id --> marker`,
        file: block.file,
        line: block.line,
      });
    } else if (!entryById.has(block.markerId)) {
      findings.push({
        kind: 'missing-entry',
        message: `${block.file}:${block.line} is marked "${block.markerId}" but journey.md has no entry for it`,
        file: block.file,
        line: block.line,
        entryIds: [block.markerId],
      });
    }
  }
  for (const entry of journey.entries) {
    if (!blockById.has(entry.id)) {
      findings.push({
        kind: 'orphan-marker',
        message: `journey.md entry "${entry.id}" (line ${entry.line}) has no matching paragraph in the manuscript`,
        line: entry.line,
        entryIds: [entry.id],
      });
    }
  }

  const sharedOrder = blocksWithMarker
    .map((b) => b.markerId as string)
    .filter((id) => entryById.has(id));
  const journeyOrder = journey.entries.map((e) => e.id).filter((id) => blockById.has(id));
  for (let i = 1; i < sharedOrder.length; i++) {
    const prevJourneyIdx = journeyOrder.indexOf(sharedOrder[i - 1] as string);
    const curJourneyIdx = journeyOrder.indexOf(sharedOrder[i] as string);
    if (prevJourneyIdx !== -1 && curJourneyIdx !== -1 && curJourneyIdx < prevJourneyIdx) {
      findings.push({
        kind: 'order-mismatch',
        message: `journey.md lists "${sharedOrder[i]}" before "${sharedOrder[i - 1]}", but the manuscript reads them in the opposite order`,
        entryIds: [sharedOrder[i - 1] as string, sharedOrder[i] as string],
      });
      break; // one out-of-order pair is enough to flag; avoid a flood of echoes
    }
  }

  // 2. `job` is one sentence.
  for (const entry of journey.entries) {
    if (entry.job && countSentences(entry.job) > 1) {
      findings.push({
        kind: 'multi-sentence-job',
        message: `"${entry.id}" job is more than one sentence — split candidate: ${entry.job}`,
        line: entry.line,
        entryIds: [entry.id],
      });
    }
  }

  // 3. Every entry has an arc; every arc has an entry.
  const arcIds = new Set(story?.arcs.map((a) => a.id) ?? []);
  for (const entry of journey.entries) {
    if (entry.arcs.length === 0) {
      findings.push({
        kind: 'orphan-entry',
        message: `"${entry.id}" (line ${entry.line}) serves no arc`,
        line: entry.line,
        entryIds: [entry.id],
      });
    }
  }
  if (story) {
    const claimed = new Set(journey.entries.flatMap((e) => e.arcs));
    for (const arc of story.arcs) {
      if (!claimed.has(arc.id)) {
        findings.push({
          kind: 'unclaimed-arc',
          message: `Arc "${arc.id} ${arc.title}" has no journey entry — the claim is never made`,
          arcId: arc.id,
        });
      }
    }
    // Arc IDs a journey entry claims that story.md doesn't define.
    for (const entry of journey.entries) {
      for (const claimedArc of entry.arcs) {
        if (!arcIds.has(claimedArc)) {
          findings.push({
            kind: 'orphan-entry',
            message: `"${entry.id}" claims arc "${claimedArc}", which story.md does not define`,
            line: entry.line,
            entryIds: [entry.id],
            arcId: claimedArc,
          });
        }
      }
    }
  }

  // 4. Arc order respects `needs:`. The abstract and the other summaries read before the text
  // state every arc at once, so the order is taken from the body.
  if (story) {
    const firstEntryIndexOfArc = new Map<string, number>();
    journey.entries.forEach((entry, idx) => {
      if (isFrontMatter(entry.section)) return;
      for (const arc of entry.arcs) {
        if (!firstEntryIndexOfArc.has(arc)) firstEntryIndexOfArc.set(arc, idx);
      }
    });
    for (const arc of story.arcs) {
      const arcIdx = firstEntryIndexOfArc.get(arc.id);
      for (const needed of arc.needs) {
        const neededIdx = firstEntryIndexOfArc.get(needed);
        if (arcIdx === undefined || neededIdx === undefined) continue; // covered by unclaimed-arc
        if (neededIdx >= arcIdx) {
          findings.push({
            kind: 'needs-violation',
            message: `Arc "${arc.id}" needs "${needed}" but the first entry serving "${needed}" comes no earlier than the first entry serving "${arc.id}"`,
            arcId: arc.id,
          });
        }
      }
    }
  }

  // 5. Evidence fields resolve; TODO evidence reported.
  if (story) {
    for (const arc of story.arcs) {
      if (!arc.evidence) continue;
      if (/\bTODO\b/i.test(arc.evidence)) {
        findings.push({
          kind: 'todo-evidence',
          message: `Arc "${arc.id}" evidence is still TODO: ${arc.evidence}`,
          line: arc.line,
          arcId: arc.id,
        });
        continue;
      }
      if (registry) {
        for (const ref of detectDynamicRefs(arc.evidence)) {
          const collection =
            ref.type === 'fig' ? registry.figures : ref.type === 'tbl' ? registry.tables : registry.equations;
          if (!collection.has(ref.label)) {
            findings.push({
              kind: 'unresolved-evidence',
              message: `Arc "${arc.id}" evidence references @${ref.type}:${ref.label}, which does not exist in the manuscript`,
              line: arc.line,
              arcId: arc.id,
            });
          }
        }
      }
    }
  }

  // 6. Duplicate report: near-identical job/leaves across sections.
  const DUPLICATE_THRESHOLD = 0.75;
  for (let i = 0; i < journey.entries.length; i++) {
    for (let j = i + 1; j < journey.entries.length; j++) {
      const a = journey.entries[i];
      const b = journey.entries[j];
      if (!a || !b || a.section === b.section) continue;
      for (const field of ['job', 'leaves'] as const) {
        const va = a[field];
        const vb = b[field];
        if (!va || !vb) continue;
        if (wordOverlapSimilarity(va, vb) >= DUPLICATE_THRESHOLD) {
          findings.push({
            kind: 'near-duplicate',
            message: `"${a.id}" (${a.section}) and "${b.id}" (${b.section}) have near-identical ${field}: "${va}" / "${vb}"`,
            entryIds: [a.id, b.id],
          });
        }
      }
    }
  }

  // 7. Figures/tables/equations present in the manuscript but absent from
  //    the journey. Cross-checked against the @fig:/@tbl:/@eq: anchor
  //    registry independently of block scanning, since an anchor can sit
  //    inline in prose rather than as its own block.
  if (registry) {
    const anchorPattern = (type: string, label: string) =>
      new RegExp(`\\{#${type}:${label}\\b`);
    const refPattern = (type: string, label: string) => new RegExp(`@${type}:${label}\\b`);

    const checkCollection = (type: 'fig' | 'tbl' | 'eq', collection: Registry['figures']) => {
      for (const label of collection.keys()) {
        const owningBlock = blocks.find((b) => anchorPattern(type, label).test(b.text));
        const covered = owningBlock
          ? !!(owningBlock.markerId && entryById.has(owningBlock.markerId))
          : journey.entries.some((e) => refPattern(type, label).test(`${e.job} ${e.support} ${e.leaves}`));
        if (!covered) {
          findings.push({
            kind: 'unlisted-float',
            message: `@${type}:${label} appears in the manuscript but has no journey.md entry`,
          });
        }
      }
    };
    checkCollection('fig', registry.figures);
    checkCollection('tbl', registry.tables);
    checkCollection('eq', registry.equations);
  }

  return findings;
}
