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
  findSections,
  buildRegistry,
} from './context.js';
import { parseStory } from '../story.js';
import {
  parseJourney,
  journeyCheck,
  assignParagraphIds,
  scaffoldJourneyEntries,
  serializeJourney,
  FINDING_LABEL,
} from '../journey.js';
import { parseManuscriptBlocks } from '../paragraph-markers.js';
import type { BuildConfig } from '../build.js';
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

/**
 * Resolve the section files journey commands read, in the same order and from
 * the same source `rev build` uses (rev.yaml `sections:`, then `sections.yaml`,
 * then a directory scan) — see gcol33/docrev#18. `sections.yaml` is the
 * Word-import header/alias map; it is a fallback here, never the primary
 * source, so journey never reads bare import-map names when rev.yaml lists
 * the real build paths.
 */
function resolveSections(dir: string, config: BuildConfig): { sections: string[]; missing: string[] } {
  const missing: string[] = [];
  const sections = findSections(dir, config.sections, (file) => missing.push(file));
  return { sections, missing };
}

function missingSectionErrors(missing: string[]): SidecarParseError[] {
  return missing.map((file) => ({
    file,
    line: 0,
    message: `Section file not found: ${file} (listed in rev.yaml/sections.yaml but missing on disk)`,
  }));
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
// A marker goes on its own line above a paragraph, and right after the list marker of an item
// in a list whose items carry their own markers.
function applyMarkerInsertions(filePath: string, insertions: Array<{ line: number; marker: string; listItem: boolean }>): void {
  if (insertions.length === 0) return;
  const content = fs.readFileSync(filePath, 'utf-8');
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const sorted = [...insertions].sort((a, b) => b.line - a.line);
  for (const { line, marker, listItem } of sorted) {
    if (listItem) lines[line - 1] = (lines[line - 1] ?? '').replace(/^(\s*(?:\d+[.)]|[-*+])\s+)/, `$1${marker} `);
    else lines.splice(line - 1, 0, marker);
  }
  fs.writeFileSync(filePath, lines.join(eol), 'utf-8');
}

function printParseErrors(errors: SidecarParseError[]): void {
  for (const err of errors) {
    console.log(chalk.red(`  ✗ ${err.file}:${err.line} ${err.message}`));
  }
}

function printFindings(findings: JourneyFinding[]): void {
  for (const finding of findings) {
    console.log(`  ${chalk.yellow('⚠')} ${chalk.dim(`[${FINDING_LABEL[finding.kind]}]`)} ${finding.message}`);
  }
}

function printAccepted(findings: JourneyFinding[]): void {
  for (const finding of findings) {
    console.log(chalk.dim(`  ✓ [${FINDING_LABEL[finding.kind]}, accepted] ${finding.message}: ${finding.accepted}`));
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
      const { sections, missing } = resolveSections(dir, config);
      if (sections.length === 0) {
        console.error(chalk.red('No section files found.'));
        process.exit(1);
      }
      if (missing.length > 0) {
        console.log(fmt.header('Journey init'));
        console.log();
        printParseErrors(missingSectionErrors(missing));
        console.error(chalk.red(`\n${missing.length} section file(s) listed but missing on disk. Fix the list, then rerun.`));
        process.exit(1);
      }

      const journeyFile = sidecarPath(dir, config, 'journey');
      let existingById = new Map<string, JourneyEntry>();
      if (fs.existsSync(journeyFile)) {
        const { doc, errors } = parseJourney(fs.readFileSync(journeyFile, 'utf-8'), path.basename(journeyFile));
        if (errors.length > 0) {
          console.log(fmt.header('Existing journey.md has errors'));
          printParseErrors(errors);
          console.error(chalk.red(`\nNot rewriting ${path.basename(journeyFile)}: a rewrite keeps only the lines it can parse. Fix the lines above, then rerun.`));
          process.exit(1);
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

        const insertions: Array<{ line: number; marker: string; listItem: boolean }> = [];
        fileBlocks.forEach((block, i) => {
          const original = originalBlocks[i];
          if (original && !original.markerId && block.markerId) {
            insertions.push({ line: original.line, marker: `<!-- @p:${block.markerId} -->`, listItem: !!original.listItem });
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
      const { sections, missing } = resolveSections(dir, config);
      const storyFile = sidecarPath(dir, config, 'story');
      const journeyFile = sidecarPath(dir, config, 'journey');

      const parseErrors: SidecarParseError[] = [...missingSectionErrors(missing)];
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
      const allFindings = journeyCheck(blocks, journeyDoc, { story, registry });
      const findings = allFindings.filter((f) => !f.accepted);
      const accepted = allFindings.filter((f) => f.accepted);

      if (jsonMode) {
        jsonOutput({
          errors: parseErrors,
          findings,
          accepted,
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
      if (accepted.length > 0) {
        console.log();
        printAccepted(accepted);
      }

      if (parseErrors.length > 0) process.exit(1);
    });
}
