/**
 * Parser for story.md — the paper's argument as a handful of arcs.
 *
 * Format (see skill/SKILL.md "Story and journey sidecars"):
 *
 *   # Story: <title>
 *
 *   ## Claim
 *   ## Audience
 *   ## Problem
 *   ## Question
 *
 *   ## Arcs
 *
 *   ### S1 Some title
 *   - question: ...
 *   - answer: ...
 *   - payoff: ...
 *   - evidence: ...
 *   - limits: ...
 *   - needs: S0
 *
 *   ## Terms
 *   - term: definition
 *
 *   ## Constraints
 *   - ...
 *
 *   ## Open
 *   - ...
 *
 * Parsing never throws: malformed input becomes a {@link SidecarParseError}
 * pointing at file:line, and the caller decides whether to surface it as a
 * check finding or a hard failure.
 */

import type { SidecarParseError, StoryArc, StoryDoc, StoryTerm } from './types.js';

const FIELD_LINE = /^-\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/;
const BULLET_LINE = /^-\s*(.*)$/;
const ARC_HEADING = /^###\s+(\S+)\s*(.*)$/;
const H1_TITLE = /^#\s+Story:\s*(.*)$/i;
const H2_HEADING = /^##\s+(.+?)\s*$/;

/** Sections whose body is running prose, joined into one string. */
const PROSE_SECTIONS = ['claim', 'audience', 'problem', 'question'] as const;
type ProseSection = (typeof PROSE_SECTIONS)[number];
type StorySection = 'none' | ProseSection | 'arcs' | 'terms' | 'constraints' | 'open';
const SECTION_NAMES = new Set<string>([...PROSE_SECTIONS, 'arcs', 'terms', 'constraints', 'open']);

function emptyArc(id: string, title: string, line: number): StoryArc {
  return { id, title, question: '', answer: '', payoff: '', evidence: '', limits: '', needs: [], line };
}

/**
 * Parse a story.md document. Returns the best-effort parsed structure
 * alongside any structural errors found along the way.
 */
export function parseStory(content: string, file = 'story.md'): { doc: StoryDoc; errors: SidecarParseError[] } {
  const errors: SidecarParseError[] = [];
  const lines = content.split(/\r?\n/);

  const doc: StoryDoc = {
    title: '',
    claim: '',
    audience: '',
    problem: '',
    question: '',
    arcs: [],
    terms: [],
    constraints: [],
    open: [],
  };

  let section: StorySection = 'none';
  let currentArc: StoryArc | null = null;
  const prose: Record<ProseSection, string[]> = { claim: [], audience: [], problem: [], question: [] };
  const seenArcIds = new Set<string>();

  const closeArc = () => {
    if (currentArc) doc.arcs.push(currentArc);
    currentArc = null;
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
      closeArc();
      const name = (h2[1] || '').trim().toLowerCase();
      if (SECTION_NAMES.has(name)) section = name as StorySection;
      else {
        section = 'none';
        errors.push({ file, line: lineNo, message: `Unknown story section "${h2[1]}"` });
      }
      continue;
    }

    if (section === 'arcs') {
      const arcMatch = raw.match(ARC_HEADING);
      if (arcMatch) {
        closeArc();
        const id = arcMatch[1] || '';
        const title = (arcMatch[2] || '').trim();
        if (seenArcIds.has(id)) {
          errors.push({ file, line: lineNo, message: `Duplicate arc id "${id}"` });
        }
        seenArcIds.add(id);
        currentArc = emptyArc(id, title, lineNo);
        continue;
      }

      if (!line) continue;

      const field = line.match(FIELD_LINE);
      if (!field) {
        errors.push({ file, line: lineNo, message: `Expected a "- field: value" line inside an arc, got "${line}"` });
        continue;
      }
      if (!currentArc) {
        errors.push({ file, line: lineNo, message: `Field "${field[1]}" appears before any arc heading` });
        continue;
      }
      const key = (field[1] || '').toLowerCase();
      const value = (field[2] || '').trim();
      switch (key) {
        case 'question':
          currentArc.question = value;
          break;
        case 'answer':
          currentArc.answer = value;
          break;
        case 'payoff':
          currentArc.payoff = value;
          break;
        case 'evidence':
          currentArc.evidence = value;
          break;
        case 'limits':
          currentArc.limits = value;
          break;
        case 'needs':
          currentArc.needs = value.split(/[\s,]+/).filter(Boolean);
          break;
        default:
          errors.push({ file, line: lineNo, message: `Unknown arc field "${field[1]}"` });
      }
      continue;
    }

    if ((PROSE_SECTIONS as readonly string[]).includes(section)) {
      if (line) prose[section as ProseSection].push(line);
      continue;
    }

    if (section === 'terms') {
      if (!line) continue;
      const bullet = line.match(BULLET_LINE);
      if (!bullet) continue;
      const body = bullet[1] || '';
      const idx = body.indexOf(':');
      const term: StoryTerm = idx === -1
        ? { term: body.trim(), definition: '' }
        : { term: body.slice(0, idx).trim(), definition: body.slice(idx + 1).trim() };
      doc.terms.push(term);
      continue;
    }

    if (section === 'constraints') {
      if (!line) continue;
      const bullet = line.match(BULLET_LINE);
      if (bullet) doc.constraints.push((bullet[1] || '').trim());
      continue;
    }

    if (section === 'open') {
      if (!line) continue;
      const bullet = line.match(BULLET_LINE);
      if (bullet) doc.open.push((bullet[1] || '').trim());
      continue;
    }
  }

  closeArc();
  for (const key of PROSE_SECTIONS) doc[key] = prose[key].join(' ').trim();

  return { doc, errors };
}
