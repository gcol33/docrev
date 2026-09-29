/**
 * Journey commands: init, check
 *
 * Story and journey sidecars (gcol33/docrev#12): story.md records the
 * paper's argument as a handful of arcs, journey.md records how each
 * paragraph/float moves the reader through it. Neither file is ever part of
 * a build.
 */

import type { Command } from 'commander';
import {
  chalk,
  fs,
  path,
  fmt,
  jsonMode,
  jsonOutput,
  loadBuildConfig,
  resolveSectionsConfig,
  getOrderedSections,
  buildRegistry,
} from './context.js';
import { parseStory } from '../story.js';
import {
  parseJourney,
  journeyCheck,
  assignParagraphIds,
  scaffoldJourneyEntries,
  serializeJourney,
} from '../journey.js';
import { parseManuscriptBlocks } from '../paragraph-markers.js';
import type { JourneyEntry, JourneyFinding, ManuscriptBlock, SidecarParseError } from '../types.js';

interface JourneyOptions {
  dir: string;
}

/**
 * Read every section file (in project order) and return its manuscript
 * blocks, in reading order across the whole project.
 */
function collectManuscriptBlocks(dir: string, sections: string[]): ManuscriptBlock[] {
  const blocks: ManuscriptBlock[] = [];
  for (const file of sections) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, 'utf-8');
    const fallback = path.basename(file, '.md');
    blocks.push(...parseManuscriptBlocks(content, file, fallback));
  }
  return blocks;
}

function resolveSections(dir: string): string[] {
  const resolved = resolveSectionsConfig(dir);
  if (resolved) return getOrderedSections(resolved.config);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !['paper.md', 'README.md', 'CLAUDE.md'].includes(f));
}

function sidecarPath(dir: string, config: { story?: string; journey?: string }, kind: 'story' | 'journey'): string {
  const filename = kind === 'story' ? config.story || 'story.md' : config.journey || 'journey.md';
  return path.join(dir, filename);
}

function collectExistingMarkerIds(blocks: ManuscriptBlock[]): Set<string> {
  const ids = new Set<string>();
  for (const block of blocks) {
    if (block.markerId) ids.add(block.markerId);
  }
  return ids;
}

/**
 * Write a file's marker insertions back to disk. `insertions` maps a block's
 * original (pre-insertion) 1-based line number to the marker line to insert
 * immediately before it. Processed in descending line order so earlier
 * insertions don't shift later ones.
 */
function applyMarkerInsertions(filePath: string, insertions: Array<{ line: number; markerLine: string }>): void {
  if (insertions.length === 0) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const sorted = [...insertions].sort((a, b) => b.line - a.line);
  for (const { line, markerLine } of sorted) {
    lines.splice(line - 1, 0, markerLine);
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
}

function printParseErrors(errors: SidecarParseError[]): void {
  for (const err of errors) {
    console.log(chalk.red(`  ✗ ${err.file}:${err.line} ${err.message}`));
  }
}

const FINDING_LABEL: Record<JourneyFinding['kind'], string> = {
  'missing-marker': 'no marker',
  'missing-entry': 'no journey entry',
  'orphan-marker': 'no matching paragraph',
  'order-mismatch': 'out of order',
  'multi-sentence-job': 'job not one sentence',
  'orphan-entry': 'no arc',
  'unclaimed-arc': 'arc never made',
  'needs-violation': 'introduced too early',
  'unresolved-evidence': 'unresolved evidence',
  'todo-evidence': 'TODO evidence',
  'near-duplicate': 'near-duplicate',
  'unlisted-float': 'float has no entry',
};

function printFindings(findings: JourneyFinding[]): void {
  for (const finding of findings) {
    console.log(`  ${chalk.yellow('⚠')} ${chalk.dim(`[${FINDING_LABEL[finding.kind]}]`)} ${finding.message}`);
  }
}

export function register(program: Command): void {
  const journey = program.command('journey').description('Story and journey sidecars for the manuscript');

  // ==========================================================================
  // JOURNEY INIT - assign paragraph IDs, scaffold journey.md
  // ==========================================================================

  journey
    .command('init')
    .description('Assign <!-- @p:id --> markers to unmarked paragraphs/floats and scaffold journey.md')
    .option('-d, --dir <directory>', 'Project directory', '.')
    .action((options: JourneyOptions) => {
      const dir = path.resolve(options.dir);
      if (!fs.existsSync(dir)) {
        console.error(chalk.red(`Directory not found: ${dir}`));
        process.exit(1);
      }

      const config = loadBuildConfig(dir);
      const sections = resolveSections(dir);
      if (sections.length === 0) {
        console.error(chalk.red('No section files found.'));
        process.exit(1);
      }

      const journeyFile = sidecarPath(dir, config, 'journey');
      let existingById = new Map<string, JourneyEntry>();
      if (fs.existsSync(journeyFile)) {
        const { doc, errors } = parseJourney(fs.readFileSync(journeyFile, 'utf-8'), path.basename(journeyFile));
        if (errors.length > 0) {
          console.log(fmt.header('Existing journey.md has errors'));
          printParseErrors(errors);
          console.log();
        }
        existingById = new Map(doc.entries.map((e) => [e.id, e]));
      }

      const perFile = new Map<string, ManuscriptBlock[]>();
      for (const file of sections) {
        const filePath = path.join(dir, file);
        if (!fs.existsSync(filePath)) continue;
        const content = fs.readFileSync(filePath, 'utf-8');
        perFile.set(file, parseManuscriptBlocks(content, file, path.basename(file, '.md')));
      }

      const allBlocks = sections.flatMap((f) => perFile.get(f) || []);
      const existingIds = new Set<string>([...collectExistingMarkerIds(allBlocks), ...existingById.keys()]);
      const { updated, newIds } = assignParagraphIds(allBlocks, existingIds);

      // Write marker insertions back into each section file.
      let filesTouched = 0;
      let cursor = 0;
      for (const file of sections) {
        const originalBlocks = perFile.get(file) || [];
        const fileBlocks = updated.slice(cursor, cursor + originalBlocks.length);
        cursor += originalBlocks.length;

        const insertions: Array<{ line: number; markerLine: string }> = [];
        fileBlocks.forEach((block, i) => {
          const original = originalBlocks[i];
          if (original && !original.markerId && block.markerId) {
            insertions.push({ line: original.line, markerLine: `<!-- @p:${block.markerId} -->` });
          }
        });
        if (insertions.length > 0) {
          applyMarkerInsertions(path.join(dir, file), insertions);
          filesTouched++;
        }
      }

      const entries = scaffoldJourneyEntries(updated, existingById);
      const journeyContent = serializeJourney(config.title || 'Untitled', entries);
      fs.writeFileSync(journeyFile, journeyContent, 'utf-8');

      if (jsonMode) {
        jsonOutput({
          newMarkers: newIds,
          filesTouched,
          journeyFile: path.relative(dir, journeyFile),
          entries: entries.length,
        });
        return;
      }

      console.log(fmt.header('Journey init'));
      console.log();
      console.log(`  ${chalk.green(newIds.length.toString())} new marker(s) assigned across ${filesTouched} file(s)`);
      console.log(`  ${chalk.green(entries.length.toString())} entries in ${path.relative(dir, journeyFile)}`);
      if (newIds.length > 0) {
        console.log();
        console.log(chalk.dim('  New IDs are scaffolded, not named — rename them to something semantic:'));
        for (const id of newIds.slice(0, 10)) console.log(chalk.dim(`    ${id}`));
        if (newIds.length > 10) console.log(chalk.dim(`    ... and ${newIds.length - 10} more`));
      }
    });

  // ==========================================================================
  // JOURNEY CHECK - run the gcol33/docrev#12 checks
  // ==========================================================================

  journey
    .command('check')
    .description('Check the manuscript against story.md and journey.md')
    .option('-d, --dir <directory>', 'Project directory', '.')
    .action((options: JourneyOptions) => {
      const dir = path.resolve(options.dir);
      if (!fs.existsSync(dir)) {
        console.error(chalk.red(`Directory not found: ${dir}`));
        process.exit(1);
      }

      const config = loadBuildConfig(dir);
      const sections = resolveSections(dir);
      const storyFile = sidecarPath(dir, config, 'story');
      const journeyFile = sidecarPath(dir, config, 'journey');

      const parseErrors: SidecarParseError[] = [];
      const story = fs.existsSync(storyFile)
        ? (() => {
            const { doc, errors } = parseStory(fs.readFileSync(storyFile, 'utf-8'), path.basename(storyFile));
            parseErrors.push(...errors);
            return doc;
          })()
        : null;

      if (!fs.existsSync(journeyFile)) {
        if (jsonMode) {
          jsonOutput({ error: `No journey file found at ${path.relative(dir, journeyFile)}`, findings: [], errors: [] });
          return;
        }
        console.log(fmt.status('warning', `No journey file found at ${path.relative(dir, journeyFile)}. Run "rev journey init" first.`));
        return;
      }

      const { doc: journeyDoc, errors: journeyErrors } = parseJourney(
        fs.readFileSync(journeyFile, 'utf-8'),
        path.basename(journeyFile)
      );
      parseErrors.push(...journeyErrors);

      const blocks = collectManuscriptBlocks(dir, sections);
      const registry = buildRegistry(dir, sections);
      const findings = journeyCheck(blocks, journeyDoc, { story, registry });

      if (jsonMode) {
        jsonOutput({
          errors: parseErrors,
          findings,
          summary: { blocks: blocks.length, entries: journeyDoc.entries.length, arcs: story?.arcs.length ?? 0 },
        });
        return;
      }

      console.log(fmt.header('Journey Check'));
      console.log();

      if (parseErrors.length > 0) {
        console.log(chalk.red.bold(`${parseErrors.length} parse error(s):`));
        printParseErrors(parseErrors);
        console.log();
      }

      if (findings.length === 0) {
        console.log(chalk.green('✓ No findings'));
      } else {
        printFindings(findings);
        console.log();
        console.log(chalk.dim(`${findings.length} finding(s) — structure decisions made visible, not errors.`));
      }

      if (parseErrors.length > 0) process.exit(1);
    });
}
