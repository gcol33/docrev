/**
 * SYNC command: Import feedback from Word/PDF back to section files
 *
 * Split from sections.ts for maintainability.
 */

import {
  chalk,
  fs,
  path,
  fmt,
  findFiles,
  resolveSectionsConfig,
  getOrderedSections,
  extractSectionsFromText,
  countAnnotations,
  buildRegistry,
  convertHardcodedRefs,
  inlineDiffPreview,
} from './context.js';
import type { Command } from 'commander';
import type { SectionsConfig } from '../types.js';
import * as readline from 'readline';

interface ImportStats {
  insertions: number;
  deletions: number;
  substitutions: number;
  comments: number;
  total: number;
}

interface SyncOptions {
  config: string;
  dir: string;
  crossref?: boolean;
  diff?: boolean;
  force?: boolean;
  dryRun?: boolean;
  /** Commander maps `--comments-only` (a positive flag) cleanly. `--no-overwrite`
   * conflicts with the existing `overwrite` semantics in `--force`-style flags
   * and Commander's `--no-X` convention assigns `options.x === false`. */
  commentsOnly?: boolean;
}

/**
 * Register the sync command with the program
 */
export function register(program: Command): void {
  // ==========================================================================
  // SYNC command - Import with section awareness
  // ==========================================================================

  program
    .command('sync')
    .alias('sections')
    .description('Sync feedback from Word/PDF back to section files')
    .argument('[file]', 'Word (.docx) or PDF file from reviewer (default: most recent)')
    .argument('[sections...]', 'Specific sections to sync (default: all)')
    .option('-c, --config <file>', 'Sections config file', 'sections.yaml')
    .option('-d, --dir <directory>', 'Directory with section files', '.')
    .option('--no-crossref', 'Skip converting hardcoded figure/table refs')
    .option('--no-diff', 'Skip showing diff preview')
    .option('--force', 'Overwrite files without conflict warning')
    .option('--dry-run', 'Preview without writing files')
    .option('--comments-only', 'Insert comments at fuzzy-matched anchors only; never modify existing prose or apply track changes (use when markdown was revised after the docx was sent for review)')
    .action(async (docx: string | undefined, sections: string[], options: SyncOptions) => {
      // Auto-detect most recent docx or pdf if not provided
      if (!docx) {
        const docxFiles = findFiles('.docx');
        const pdfFiles = findFiles('.pdf');
        const allFiles = [...docxFiles, ...pdfFiles];

        if (allFiles.length === 0) {
          console.error(fmt.status('error', 'No .docx or .pdf files found in current directory.'));
          process.exit(1);
        }
        const sorted = allFiles
          .map(f => ({ name: f, mtime: fs.statSync(f).mtime }))
          .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
        docx = sorted[0].name;
        console.log(fmt.status('info', `Using most recent: ${docx}`));
        console.log();
      }

      if (!fs.existsSync(docx)) {
        console.error(fmt.status('error', `File not found: ${docx}`));
        process.exit(1);
      }

      // Handle PDF files
      if (docx.toLowerCase().endsWith('.pdf')) {
        const { extractPdfComments, formatPdfComments, getPdfCommentStats } = await import('../pdf-import.js');

        const spin = fmt.spinner(`Extracting comments from ${path.basename(docx)}...`).start();

        try {
          const comments = await extractPdfComments(docx);
          spin.stop();

          if (comments.length === 0) {
            console.log(fmt.status('info', 'No comments found in PDF.'));
            return;
          }

          const stats = getPdfCommentStats(comments);
          console.log(fmt.header(`PDF Comments from ${path.basename(docx)}`));
          console.log();
          console.log(formatPdfComments(comments));
          console.log();

          const authorList = Object.entries(stats.byAuthor)
            .map(([author, count]) => `${author} (${count})`)
            .join(', ');
          console.log(chalk.dim(`Total: ${stats.total} comments from ${authorList}`));
          console.log();

          const resolved = resolveSectionsConfig(options.dir, options.config);
          if (resolved && !options.dryRun) {
            const mainSection = getOrderedSections(resolved.config)[0];

            if (mainSection) {
              const mainPath = path.join(options.dir, mainSection);
              if (fs.existsSync(mainPath)) {
                console.log(chalk.dim(`Use 'rev pdf-comments ${docx} --append ${mainSection}' to add comments to markdown.`));
              }
            }
          }
        } catch (err) {
          spin.stop();
          const error = err as Error;
          console.error(fmt.status('error', `Failed to extract PDF comments: ${error.message}`));
          if (process.env.DEBUG) console.error(error.stack);
          process.exit(1);
        }
        return;
      }

      // Resolve the section config: an explicit sections.yaml if present,
      // otherwise the `sections:` list in rev.yaml (single source of truth).
      const resolved = resolveSectionsConfig(options.dir, options.config);
      if (!resolved) {
        console.error(fmt.status('error', `No section config found in ${path.resolve(options.dir)}`));
        console.error(chalk.dim('  Add a `sections:` list to rev.yaml, or run "rev init" to generate sections.yaml.'));
        process.exit(1);
      }
      const sectionsConfig = resolved.config;

      // --comments-only: import comments only, never modify existing prose.
      // Use this when the markdown has been revised since the docx was sent
      // out — track changes from a stale draft would clobber newer edits.
      if (options.commentsOnly) {
        await syncCommentsOnly(docx, sections, options, sectionsConfig);
        return;
      }

      // Check pandoc availability upfront and warn
      const { hasPandoc, getInstallInstructions } = await import('../dependencies.js');
      if (!hasPandoc()) {
        console.log(fmt.status('warning', `Pandoc not installed. Track changes will be extracted from XML (formatting may differ).`));
        console.log(chalk.dim(`  Install for best results: ${getInstallInstructions('pandoc')}`));
        console.log();
      }

      const spin = fmt.spinner(`Importing ${path.basename(docx)}...`).start();

      try {
        const config = sectionsConfig;
        const { importFromWord, extractWordComments, extractCommentAnchors, insertCommentsIntoMarkdown, extractFromWord, extractHeadings } = await import('../import.js');
        const { computeSectionBoundaries } = await import('./section-boundaries.js');

        let registry = null;
        let totalRefConversions = 0;
        if (options.crossref !== false) {
          registry = buildRegistry(options.dir);
        }

        const comments = await extractWordComments(docx);
        const { anchors, fullDocText: xmlDocText } = await extractCommentAnchors(docx);

        // Extract Word text (uses pandoc if available, falls back to XML extraction)
        const wordExtraction = await extractFromWord(docx, { mediaDir: options.dir });
        let wordText = wordExtraction.text;
        const wordTables = wordExtraction.tables || [];

        // Log extraction messages (warnings about pandoc, track change stats, etc.)
        for (const msg of wordExtraction.messages || []) {
          if (msg.type === 'warning') {
            spin.stop();
            console.log(fmt.status('warning', msg.message));
            spin.start();
          }
        }

        // Restore crossref on FULL text BEFORE splitting into sections
        // This ensures duplicate labels from track changes are handled correctly
        // (the same figure may appear multiple times in old/new versions)
        const { restoreCrossrefFromWord, restoreImagesFromRegistry } = await import('../import.js');
        const crossrefResult = restoreCrossrefFromWord(wordText, options.dir);
        wordText = crossrefResult.text;
        if (crossrefResult.restored > 0) {
          console.log(`Restored ${crossrefResult.restored} crossref reference(s)`);
        }

        // Also restore images from registry using shared restoredLabels
        const imageRestoreResult = restoreImagesFromRegistry(wordText, options.dir, crossrefResult.restoredLabels);
        wordText = imageRestoreResult.text;
        if (imageRestoreResult.restored > 0) {
          console.log(`Restored ${imageRestoreResult.restored} image(s) from registry`);
        }

        let wordSections = extractSectionsFromText(wordText, config.sections);

        if (wordSections.length === 0) {
          spin.stop();
          console.error(fmt.status('warning', 'No sections detected in Word document.'));
          console.error(chalk.dim('  Check that headings match sections.yaml'));
          process.exit(1);
        }

        if (sections && sections.length > 0) {
          const onlyList = sections.map(s => s.trim().toLowerCase());
          wordSections = wordSections.filter(section => {
            const fileName = section.file.replace(/\.md$/i, '').toLowerCase();
            const header = section.header.toLowerCase();
            return onlyList.some(name => fileName === name || fileName.includes(name) || header.includes(name));
          });
          if (wordSections.length === 0) {
            spin.stop();
            console.error(fmt.status('error', `No sections matched: ${sections.join(', ')}`));
            console.error(chalk.dim(`  Available: ${extractSectionsFromText(wordText, config.sections).map(s => s.file.replace(/\.md$/i, '')).join(', ')}`));
            process.exit(1);
          }
        }

        spin.stop();
        console.log(fmt.header(`Import from ${path.basename(docx)}`));
        console.log();

        // Conflict detection
        if (!options.force && !options.dryRun) {
          const conflicts: Array<{ file: string; annotations: number }> = [];
          for (const section of wordSections) {
            const sectionPath = path.join(options.dir, section.file);
            if (fs.existsSync(sectionPath)) {
              const existing = fs.readFileSync(sectionPath, 'utf-8');
              const existingCounts = countAnnotations(existing);
              if (existingCounts.total > 0) {
                conflicts.push({
                  file: section.file,
                  annotations: existingCounts.total,
                });
              }
            }
          }

          if (conflicts.length > 0) {
            console.log(fmt.status('warning', 'Files with existing annotations will be overwritten:'));
            for (const c of conflicts) {
              console.log(chalk.yellow(`  - ${c.file} (${c.annotations} annotations)`));
            }
            console.log();

            const rl = readline.createInterface({
              input: process.stdin,
              output: process.stdout,
            });

            const answer = await new Promise<string>((resolve) =>
              rl.question(chalk.cyan('Continue and overwrite? [y/N] '), resolve)
            );
            rl.close();

            if (answer.toLowerCase() !== 'y') {
              console.log(chalk.dim('Aborted. Use --force to skip this check.'));
              process.exit(0);
            }
            console.log();
          }
        }

        const sectionResults: Array<{
          file: string;
          header: string;
          status: string;
          stats?: ImportStats;
          refs?: number;
        }> = [];
        let totalChanges = 0;

        // Route comments to sections using boundaries from the document's real
        // heading paragraphs. docPosition (from extractCommentAnchors) and each
        // heading's docPosition share one coordinate system over xmlDocText, so
        // every configured section gets a boundary — not only the handful that
        // matched a hardcoded keyword list. Sections named "Objectives" or
        // "Annex 2" used to get no boundary, so their comments were silently
        // dropped while the summary still claimed every comment was placed.
        // This is the same routing path as `sync --comments-only`.
        const headings = await extractHeadings(docx);
        const sectionBoundaries = computeSectionBoundaries(config.sections, headings, xmlDocText.length);
        const firstBoundaryStart = sectionBoundaries.length > 0 ? sectionBoundaries[0].start : 0;

        // Truthful comment accounting: track which comments were routed to a
        // synced section and how many were actually written, so the summary
        // reports placements rather than the raw extracted count.
        const routedCommentIds = new Set<string>();
        let totalCommentsPlaced = 0;
        let totalCommentsDeduped = 0;
        let totalCommentsUnmatched = 0;

        for (const section of wordSections) {
          const sectionPath = path.join(options.dir, section.file);

          if (!fs.existsSync(sectionPath)) {
            sectionResults.push({
              file: section.file,
              header: section.header,
              status: 'skipped',
              stats: undefined,
            });
            continue;
          }

          // A section that appears in the reviewed document as a bare heading
          // with no body was not really part of this build (e.g. a "no-annex"
          // export synced against the full project). Importing it would diff
          // real prose against an empty body and rewrite the file to near-empty.
          // Leave it untouched.
          const bodyEmpty = section.content.trim() === section.header.trim();
          if (bodyEmpty) {
            sectionResults.push({
              file: section.file,
              header: section.header,
              status: 'untouched',
              stats: undefined,
            });
            continue;
          }

          const result = await importFromWord(docx, sectionPath, {
            sectionContent: section.content,
            author: 'Reviewer',
            wordTables: wordTables,
          });

          let { annotated, stats } = result;

          let refConversions: Array<{ from: string; to: string }> = [];
          if (registry && options.crossref !== false) {
            const crossrefResult = convertHardcodedRefs(annotated, registry);
            annotated = crossrefResult.converted;
            refConversions = crossrefResult.conversions;
            totalRefConversions += refConversions.length;
          }

          if (comments.length > 0 && anchors.size > 0) {
            // Filter comments to those whose docPosition falls in this section's
            // boundary (docPosition and boundaries share xmlDocText coordinates).
            // The section owning the first boundary also catches comments placed
            // before any heading.
            const boundary = sectionBoundaries.find(b => b.file === section.file);
            const ownsFirstBoundary = !!boundary && boundary.start === firstBoundaryStart;

            const sectionComments = comments.filter((c: { id: string }) => {
              const anchorData = anchors.get(c.id);
              if (!anchorData || anchorData.docPosition === undefined || !boundary) return false;
              if (anchorData.docPosition >= boundary.start && anchorData.docPosition < boundary.end) return true;
              if (ownsFirstBoundary && anchorData.docPosition < firstBoundaryStart) return true;
              return false;
            });

            if (process.env.DEBUG) {
              console.log(`[DEBUG] ${section.file}: ${sectionComments.length} comments to place (boundary: ${boundary?.start}-${boundary?.end})`);
            }

            if (sectionComments.length > 0) {
              for (const c of sectionComments) routedCommentIds.add(c.id);
              const cstats = { placed: 0, deduped: 0, unmatched: 0 };
              annotated = insertCommentsIntoMarkdown(annotated, sectionComments, anchors, {
                quiet: !process.env.DEBUG,
                sectionBoundary: boundary,
                outStats: cstats,
              });
              stats.comments = (stats.comments || 0) + cstats.placed;
              totalCommentsPlaced += cstats.placed;
              totalCommentsDeduped += cstats.deduped;
              totalCommentsUnmatched += cstats.unmatched;

              if (process.env.DEBUG) {
                console.log(`[DEBUG] ${section.file}: placed ${cstats.placed}, deduped ${cstats.deduped}, unmatched ${cstats.unmatched} of ${sectionComments.length}`);
              }
            }
          }

          totalChanges += stats.total;

          sectionResults.push({
            file: section.file,
            header: section.header,
            status: 'ok',
            stats,
            refs: refConversions.length,
          });

          if (!options.dryRun) {
            // Preserve any preamble content (YAML frontmatter, author blocks, metadata)
            // that exists before the first heading in the original file.
            // This content is never included in the Word build output, so it won't
            // appear in the Word doc and would otherwise be lost during sync.
            const originalContent = fs.readFileSync(sectionPath, 'utf-8');
            const firstHeadingMatch = originalContent.match(/^(#\s)/m);
            if (firstHeadingMatch && firstHeadingMatch.index !== undefined && firstHeadingMatch.index > 0) {
              const preamble = originalContent.slice(0, firstHeadingMatch.index);
              // Only prepend if preamble has non-whitespace content
              if (preamble.trim().length > 0) {
                annotated = preamble + annotated;
              }
            }
            fs.writeFileSync(sectionPath, annotated, 'utf-8');
          }
        }

        const tableRows = sectionResults.map((r) => {
          if (r.status === 'skipped' || r.status === 'untouched') {
            return [
              chalk.dim(r.file),
              chalk.dim(r.header.slice(0, 25)),
              chalk.yellow(r.status),
              '',
              '',
              '',
              '',
            ];
          }
          const s = r.stats!;
          return [
            chalk.bold(r.file),
            r.header.length > 25 ? r.header.slice(0, 22) + '...' : r.header,
            s.insertions > 0 ? chalk.green(`+${s.insertions}`) : chalk.dim('-'),
            s.deletions > 0 ? chalk.red(`-${s.deletions}`) : chalk.dim('-'),
            s.substitutions > 0 ? chalk.yellow(`~${s.substitutions}`) : chalk.dim('-'),
            s.comments > 0 ? chalk.blue(`#${s.comments}`) : chalk.dim('-'),
            r.refs! > 0 ? chalk.magenta(`@${r.refs}`) : chalk.dim('-'),
          ];
        });

        console.log(fmt.table(
          ['File', 'Section', 'Ins', 'Del', 'Sub', 'Cmt', 'Ref'],
          tableRows,
          { align: ['left', 'left', 'right', 'right', 'right', 'right', 'right'] }
        ));
        console.log();

        if (options.diff !== false && totalChanges > 0) {
          console.log(fmt.header('Changes Preview'));
          console.log();
          for (const result of sectionResults) {
            if (result.status === 'ok' && result.stats && result.stats.total > 0) {
              const sectionPath = path.join(options.dir, result.file);
              if (fs.existsSync(sectionPath)) {
                const content = fs.readFileSync(sectionPath, 'utf-8');
                const preview = inlineDiffPreview(content, { maxLines: 3 });
                if (preview) {
                  console.log(chalk.bold(result.file) + ':');
                  console.log(preview);
                  console.log();
                }
              }
            }
          }
        }

        // Comments carried by the document but never routed to a synced section
        // (they fell in a skipped/untouched/absent section). Surfacing these
        // keeps the summary honest instead of reporting every extracted comment
        // as placed.
        const unroutedComments = comments.length - routedCommentIds.size;

        if (options.dryRun) {
          console.log(fmt.box(chalk.yellow('Dry run - no files written'), { padding: 0 }));
        } else if (totalChanges > 0 || totalRefConversions > 0 || comments.length > 0) {
          const summaryLines: string[] = [];
          summaryLines.push(`${chalk.bold(wordSections.length)} sections processed`);
          if (totalChanges > 0) summaryLines.push(`${chalk.bold(totalChanges)} annotations imported`);
          if (totalCommentsPlaced > 0) {
            summaryLines.push(`${chalk.bold(totalCommentsPlaced)} of ${comments.length} comments placed`);
          }
          if (totalCommentsDeduped > 0) {
            summaryLines.push(`${chalk.cyan(totalCommentsDeduped)} already present (skipped)`);
          }
          if (totalCommentsUnmatched > 0) {
            summaryLines.push(`${chalk.yellow(totalCommentsUnmatched)} unmatched (anchor not in current prose)`);
          }
          if (unroutedComments > 0) {
            summaryLines.push(`${chalk.yellow(unroutedComments)} not routed to any synced section`);
          }
          if (totalRefConversions > 0) summaryLines.push(`${chalk.bold(totalRefConversions)} refs converted to @-syntax`);

          console.log(fmt.box(summaryLines.join('\n'), { title: 'Summary', padding: 0 }));
          console.log();
          if (totalCommentsUnmatched > 0 || unroutedComments > 0) {
            console.log(chalk.yellow(`  ${totalCommentsUnmatched + unroutedComments} comment(s) were not written. Run "rev verify-anchors" or re-sync with the full document.`));
            console.log();
          }
          console.log(chalk.dim('Next steps:'));
          console.log(chalk.dim('  1. rev review <section.md>  - Accept/reject changes'));
          console.log(chalk.dim('  2. rev comments <section.md> - View/address comments'));
          console.log(chalk.dim('  3. rev build docx  - Rebuild Word doc'));
        } else {
          console.log(fmt.status('success', 'No changes detected.'));
        }
      } catch (err) {
        spin.stop();
        const error = err as Error;
        console.error(fmt.status('error', error.message));
        if (process.env.DEBUG) console.error(error.stack);
        process.exit(1);
      }
    });
}

/**
 * `sync --comments-only`: import only Word comments at fuzzy-matched anchors.
 *
 * Skips the Word→Markdown diff entirely (no track changes, no pandoc, no
 * prose modifications). Useful when the markdown has been edited after the
 * docx was sent for review — applying track changes from a stale draft
 * would overwrite newer edits.
 */
async function syncCommentsOnly(
  docx: string,
  sectionFilter: string[] | undefined,
  options: SyncOptions,
  config: SectionsConfig,
): Promise<void> {
  const { extractWordComments, extractCommentAnchors, extractHeadings, insertCommentsIntoMarkdown } = await import('../import.js');
  const { computeSectionBoundaries } = await import('./section-boundaries.js');

  const spin = fmt.spinner(`Reading comments from ${path.basename(docx)}...`).start();

  let comments;
  let anchors;
  let headings;
  let fullDocText = '';
  try {
    comments = await extractWordComments(docx);
    const result = await extractCommentAnchors(docx);
    anchors = result.anchors;
    fullDocText = result.fullDocText;
    headings = await extractHeadings(docx);
    spin.stop();
  } catch (err) {
    spin.stop();
    const error = err as Error;
    console.error(fmt.status('error', error.message));
    process.exit(1);
  }

  console.log(fmt.header(`Comments from ${path.basename(docx)} (comments-only)`));
  console.log();

  if (comments.length === 0) {
    console.log(fmt.status('info', 'No comments found in document.'));
    return;
  }

  const boundaries = computeSectionBoundaries(config.sections, headings, fullDocText.length);

  if (boundaries.length === 0) {
    console.error(fmt.status('warning', 'No section headings detected in Word document.'));
    console.error(chalk.dim('  Check that headers in sections.yaml match heading paragraphs in the docx.'));
    process.exit(1);
  }

  // Apply optional section filter from CLI
  let activeBoundaries = boundaries;
  if (sectionFilter && sectionFilter.length > 0) {
    const wanted = sectionFilter.map(s => s.trim().toLowerCase());
    activeBoundaries = boundaries.filter(b => {
      const base = b.file.replace(/\.md$/i, '').toLowerCase();
      return wanted.some(name => base === name || base.includes(name));
    });
    if (activeBoundaries.length === 0) {
      console.error(fmt.status('error', `No sections matched: ${sectionFilter.join(', ')}`));
      process.exit(1);
    }
  }

  const firstBoundaryStart = boundaries[0].start;
  const results: Array<{ file: string; placed: number; deduped: number; unmatched: number; skipped: boolean }> = [];

  for (const boundary of activeBoundaries) {
    const sectionPath = path.join(options.dir, boundary.file);
    if (!fs.existsSync(sectionPath)) {
      results.push({ file: boundary.file, placed: 0, deduped: 0, unmatched: 0, skipped: true });
      continue;
    }

    const isFirstSection = boundary === activeBoundaries[0];
    const sectionComments = comments.filter((c: { id: string }) => {
      const anchor = anchors.get(c.id);
      if (!anchor || anchor.docPosition === undefined) return false;
      if (anchor.docPosition >= boundary.start && anchor.docPosition < boundary.end) return true;
      // Comments before the first heading land in the first matched section
      if (isFirstSection && anchor.docPosition < firstBoundaryStart) return true;
      return false;
    });

    if (sectionComments.length === 0) {
      results.push({ file: boundary.file, placed: 0, deduped: 0, unmatched: 0, skipped: false });
      continue;
    }

    const original = fs.readFileSync(sectionPath, 'utf-8');

    const stats = { placed: 0, deduped: 0, unmatched: 0 };
    const annotated = insertCommentsIntoMarkdown(original, sectionComments, anchors, {
      quiet: !process.env.DEBUG,
      sectionBoundary: { start: boundary.start, end: boundary.end },
      wrapAnchor: false,
      outStats: stats,
    });

    if (!options.dryRun && stats.placed > 0) {
      fs.writeFileSync(sectionPath, annotated, 'utf-8');
    }
    results.push({ file: boundary.file, ...stats, skipped: false });
  }

  const tableRows = results.map(r => {
    if (r.skipped) {
      return [chalk.dim(r.file), chalk.yellow('missing'), '', '', ''];
    }
    return [
      chalk.bold(r.file),
      chalk.green(`${r.placed}`),
      r.deduped > 0 ? chalk.cyan(`${r.deduped}`) : chalk.dim('-'),
      r.unmatched > 0 ? chalk.yellow(`${r.unmatched}`) : chalk.dim('-'),
      chalk.dim('comments only'),
    ];
  });

  console.log(fmt.table(
    ['File', 'Placed', 'Already', 'Unmatched', 'Mode'],
    tableRows,
    { align: ['left', 'right', 'right', 'right', 'left'] },
  ));
  console.log();

  const totalPlaced = results.reduce((s, r) => s + r.placed, 0);
  const totalDeduped = results.reduce((s, r) => s + r.deduped, 0);
  const totalUnmatched = results.reduce((s, r) => s + r.unmatched, 0);

  const lines: string[] = [];
  lines.push(`${chalk.bold(comments.length)} comments in document`);
  if (totalPlaced > 0) {
    lines.push(`${chalk.bold(totalPlaced)} placed at anchors`);
  }
  if (totalDeduped > 0) {
    lines.push(`${chalk.cyan(totalDeduped)} already present (skipped to avoid duplication)`);
  }
  if (totalUnmatched > 0) {
    lines.push(`${chalk.yellow(totalUnmatched)} unmatched (no anchor in current prose)`);
  }
  if (options.dryRun) {
    lines.push(chalk.yellow('Dry run — no files written'));
  } else if (totalPlaced > 0) {
    lines.push(chalk.dim('Existing prose unchanged.'));
  }
  console.log(fmt.box(lines.join('\n'), { title: 'Summary', padding: 0 }));

  if (totalUnmatched > 0) {
    console.log();
    console.log(chalk.dim('Tip: run "rev verify-anchors" to see which comments drifted.'));
  }
}
