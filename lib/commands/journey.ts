/**
 * Journey commands: init, check, ack
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
} from './context.js';
import {
  parseJourney,
  assignParagraphIds,
  scaffoldJourneyEntries,
  serializeJourney,
  FINDING_LABEL,
  paragraphHash,
  pinNegotiated,
} from '../journey.js';
import { parseManuscript } from '../paragraph-markers.js';
import { checkJourneyProject } from '../journey-project.js';
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
  return parseManuscript(
    sections
      .filter((file) => fs.existsSync(path.join(dir, file)))
      .map((file) => ({ file, content: fs.readFileSync(path.join(dir, file), 'utf-8') }))
  );
}

/**
 * Resolve the section files journey commands read, in the same order and from
 * the same source `docrev build` uses (rev.yaml `sections:`, then `sections.yaml`,
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

      const allBlocks = collectManuscriptBlocks(dir, sections);
      const perFile = new Map<string, ManuscriptBlock[]>();
      for (const block of allBlocks) perFile.set(block.file, [...(perFile.get(block.file) || []), block]);
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
    .description('Check the manuscript against story.md, journey.md and supplement/journey.md')
    .option('-d, --dir <directory>', 'Project directory', '.')
    .action((options: JourneyOptions) => {
      const dir = path.resolve(options.dir);
      if (!fs.existsSync(dir)) {
        console.error(chalk.red(`Directory not found: ${dir}`));
        process.exit(1);
      }

      const config = loadBuildConfig(dir);
      const { sections, missing } = resolveSections(dir, config);
      const result = checkJourneyProject(dir, config, sections);
      const parseErrors = [...missingSectionErrors(missing), ...result.parseErrors];

      if (!result.journey && !result.supplement && !result.information) {
        const journeyFile = sidecarPath(dir, config, 'journey');
        if (jsonMode) {
          jsonOutput({ error: `No journey file found at ${path.relative(dir, journeyFile)}`, findings: [], errors: parseErrors });
          return;
        }
        console.log(fmt.status('warning', `No journey file found at ${path.relative(dir, journeyFile)}. Run "docrev journey init" first.`));
        return;
      }

      const split = (findings: JourneyFinding[]) => ({
        findings: findings.filter((f) => !f.accepted),
        accepted: findings.filter((f) => f.accepted),
      });
      const main = split(result.journey?.findings ?? []);
      const supplement = result.supplement ? { ...split(result.supplement.findings), file: result.supplement.file, summary: result.supplement.summary } : null;
      const information = result.information ? { ...split(result.information.findings), file: result.information.file, summary: result.information.summary } : null;

      if (jsonMode) {
        jsonOutput({
          errors: parseErrors,
          findings: main.findings,
          accepted: main.accepted,
          summary: result.journey?.summary ?? null,
          supplement,
          information,
        });
        if (parseErrors.length > 0) process.exit(1);
        return;
      }

      console.log(fmt.header('Journey Check'));
      console.log();

      if (parseErrors.length > 0) {
        console.log(chalk.red.bold(`${parseErrors.length} parse error(s):`));
        printParseErrors(parseErrors);
        console.log();
      }

      const report = (part: { findings: JourneyFinding[]; accepted: JourneyFinding[] }) => {
        if (part.findings.length === 0) {
          console.log(chalk.green('✓ No findings'));
        } else {
          printFindings(part.findings);
          console.log();
          console.log(chalk.dim(`${part.findings.length} finding(s) — structure decisions made visible, not errors.`));
        }
        if (part.accepted.length > 0) {
          console.log();
          printAccepted(part.accepted);
        }
      };

      if (result.journey) report(main);
      if (supplement) {
        if (result.journey) console.log();
        console.log(chalk.bold(`Supplement (${supplement.file}, ${supplement.summary.items} item(s))`));
        report(supplement);
      }
      if (information) {
        if (result.journey || supplement) console.log();
        console.log(chalk.bold(`Information (${information.file}, ${information.summary.terms} term(s))`));
        report(information);
      }

      if (parseErrors.length > 0) process.exit(1);
    });

  // ==========================================================================
  // JOURNEY ACK - reconfirm paragraphs settled with a co-author
  // ==========================================================================

  journey
    .command('ack')
    .description('Pin the current text of negotiated paragraphs: the change since the decision is reconfirmed')
    .argument('<ids...>', 'paragraph ids whose `- negotiated:` lines to pin')
    .option('-d, --dir <directory>', 'Project directory', '.')
    .action((ids: string[], options: JourneyOptions) => {
      const dir = path.resolve(options.dir);
      const config = loadBuildConfig(dir);
      const journeyFile = sidecarPath(dir, config, 'journey');
      if (!fs.existsSync(journeyFile)) {
        console.error(chalk.red(`No journey file found at ${path.relative(dir, journeyFile)}`));
        process.exit(1);
      }
      const { sections } = resolveSections(dir, config);
      const blocks = collectManuscriptBlocks(dir, sections);
      const hashes = new Map<string, string>();
      const unknown: string[] = [];
      for (const id of ids) {
        const block = blocks.find((b) => b.markerId === id);
        if (block) hashes.set(id, paragraphHash(block.text));
        else unknown.push(id);
      }
      const { content, pinned } = pinNegotiated(fs.readFileSync(journeyFile, 'utf-8'), hashes);
      if (pinned.length > 0) fs.writeFileSync(journeyFile, content, 'utf-8');
      if (jsonMode) {
        jsonOutput({ pinned, unknown });
      } else {
        for (const id of pinned) console.log(chalk.green(`  ✓ ${id} pinned`));
        for (const id of ids.filter((i) => !pinned.includes(i) && !unknown.includes(i))) {
          console.log(chalk.dim(`  - ${id}: no negotiated line to change`));
        }
        for (const id of unknown) console.log(chalk.red(`  ✗ ${id}: no paragraph carries this id`));
      }
      if (unknown.length > 0) process.exit(1);
    });
}
