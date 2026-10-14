/**
 * Run every sidecar check of a project in one place: journey.md against the
 * manuscript and story.md, and supplement/journey.md against the supporting
 * information's section files and the manuscript that cites it, and
 * information.md's terms against the manuscript. Shared by
 * `rev journey check` and `rev check`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { buildRegistry } from './crossref.js';
import { journeyCheck, parseJourney } from './journey.js';
import { informationCheck, parseInformation } from './information.js';
import { parseManuscript } from './paragraph-markers.js';
import { parseStory } from './story.js';
import { parseSupplementJourney, supplementCheck, supplementLabels } from './supplement-journey.js';
import type { BuildConfig } from './build.js';
import type { JourneyFinding, SidecarParseError, StoryDoc } from './types.js';

export interface JourneyProjectResult {
  parseErrors: SidecarParseError[];
  /** journey.md findings; null when the project has no journey.md. */
  journey: { file: string; findings: JourneyFinding[]; summary: { blocks: number; entries: number; arcs: number } } | null;
  /** supplement/journey.md findings; null when the project has no supplement journey. */
  supplement: { file: string; findings: JourneyFinding[]; summary: { items: number; labelled: number; sectionFiles: number } } | null;
  /** information.md findings; null when the project has no information.md. */
  information: { file: string; findings: JourneyFinding[]; summary: { terms: number } } | null;
}

function readIfExists(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
}

/** The supplement build's label lock (key -> label), or null when there is none or it does not parse. */
function readLock(file: string, name: string, errors: SidecarParseError[]): Record<string, string> | null {
  const text = readIfExists(file);
  if (text === null) return null;
  try {
    return JSON.parse(text) as Record<string, string>;
  } catch (err) {
    errors.push({ file: name, line: 0, message: `Not valid JSON: ${(err as Error).message}` });
    return null;
  }
}

function supplementSectionFiles(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!fs.existsSync(dir)) return files;
  for (const name of fs.readdirSync(dir).sort()) {
    if (name.endsWith('.md')) files.set(name, fs.readFileSync(path.join(dir, name), 'utf-8'));
  }
  return files;
}

/**
 * Check a project's sidecars. `sections` are the manuscript's section files
 * relative to `dir`, in build order, as `rev build` resolves them.
 */
export function checkJourneyProject(
  dir: string,
  config: Pick<BuildConfig, 'story' | 'journey' | 'supplementJourney' | 'supplementSections' | 'information'>,
  sections: string[]
): JourneyProjectResult {
  const parseErrors: SidecarParseError[] = [];
  const storyName = config.story || 'story.md';
  const journeyName = config.journey || 'journey.md';
  const supplementName = config.supplementJourney || 'supplement/journey.md';

  const storyText = readIfExists(path.join(dir, storyName));
  let story: StoryDoc | null = null;
  if (storyText !== null) {
    const parsed = parseStory(storyText, storyName);
    parseErrors.push(...parsed.errors);
    story = parsed.doc;
  }

  const existing = sections.filter((file) => fs.existsSync(path.join(dir, file)));
  const manuscript = existing.map((file) => ({ file, content: fs.readFileSync(path.join(dir, file), 'utf-8') }));
  const blocks = parseManuscript(manuscript);

  const result: JourneyProjectResult = { parseErrors, journey: null, supplement: null, information: null };

  const journeyText = readIfExists(path.join(dir, journeyName));
  if (journeyText !== null) {
    const { doc, errors } = parseJourney(journeyText, path.basename(journeyName));
    parseErrors.push(...errors);
    const registry = buildRegistry(dir, existing);
    result.journey = {
      file: journeyName,
      findings: journeyCheck(blocks, doc, { story, registry }),
      summary: { blocks: blocks.length, entries: doc.entries.length, arcs: story?.arcs.length ?? 0 },
    };
  }

  const supplementText = readIfExists(path.join(dir, supplementName));
  if (supplementText !== null) {
    const { doc, errors } = parseSupplementJourney(supplementText, supplementName);
    parseErrors.push(...errors);
    const sectionFiles = supplementSectionFiles(path.join(dir, config.supplementSections || 'supplement/sections'));
    const lockName = path.join(path.dirname(supplementName), 'numbers.json');
    const lock = readLock(path.join(dir, lockName), lockName, parseErrors);
    const sidecars = [storyName, journeyName]
      .map((file) => ({ file, content: readIfExists(path.join(dir, file)) }))
      .filter((s): s is { file: string; content: string } => s.content !== null);
    result.supplement = {
      file: supplementName,
      findings: supplementCheck(doc, {
        sectionFiles,
        manuscript,
        sidecars,
        markerIds: new Set(blocks.flatMap((b) => (b.markerId ? [b.markerId] : []))),
        story,
        lock,
      }),
      summary: { items: doc.items.length, labelled: supplementLabels(doc.items).size, sectionFiles: sectionFiles.size },
    };
  }

  const informationName = config.information || 'information.md';
  const informationText = readIfExists(path.join(dir, informationName));
  if (informationText !== null) {
    const { entries, errors } = parseInformation(informationText, path.basename(informationName));
    parseErrors.push(...errors);
    result.information = {
      file: informationName,
      findings: informationCheck(blocks, entries),
      summary: { terms: entries.length },
    };
  }

  return result;
}
