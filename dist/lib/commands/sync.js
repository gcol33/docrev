/**
 * SYNC command: Import feedback from Word/PDF back to section files
 *
 * Split from sections.ts for maintainability.
 */
import { chalk, fs, path, fmt, findFiles, loadConfig, extractSectionsFromText, countAnnotations, buildRegistry, convertHardcodedRefs, inlineDiffPreview, } from './context.js';
import * as readline from 'readline';
/**
 * Register the sync command with the program
 */
export function register(program) {
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
        .action(async (docx, sections, options) => {
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
                const configPath = path.resolve(options.dir, options.config);
                if (fs.existsSync(configPath) && !options.dryRun) {
                    const config = loadConfig(configPath);
                    const mainSection = config.sections?.[0];
                    if (mainSection && typeof mainSection === 'string') {
                        const mainPath = path.join(options.dir, mainSection);
                        if (fs.existsSync(mainPath)) {
                            console.log(chalk.dim(`Use 'rev pdf-comments ${docx} --append ${mainSection}' to add comments to markdown.`));
                        }
                    }
                }
            }
            catch (err) {
                spin.stop();
                const error = err;
                console.error(fmt.status('error', `Failed to extract PDF comments: ${error.message}`));
                if (process.env.DEBUG)
                    console.error(error.stack);
                process.exit(1);
            }
            return;
        }
        const configPath = path.resolve(options.dir, options.config);
        if (!fs.existsSync(configPath)) {
            console.error(fmt.status('error', `Config not found: ${configPath}`));
            console.error(chalk.dim('  Run "rev init" first to generate sections.yaml'));
            process.exit(1);
        }
        // --comments-only: import comments only, never modify existing prose.
        // Use this when the markdown has been revised since the docx was sent
        // out — track changes from a stale draft would clobber newer edits.
        if (options.commentsOnly) {
            await syncCommentsOnly(docx, sections, options, configPath);
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
            const config = loadConfig(configPath);
            const { importFromWord, extractWordComments, extractCommentAnchors, insertCommentsIntoMarkdown, extractFromWord } = await import('../import.js');
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
                const conflicts = [];
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
                    const answer = await new Promise((resolve) => rl.question(chalk.cyan('Continue and overwrite? [y/N] '), resolve));
                    rl.close();
                    if (answer.toLowerCase() !== 'y') {
                        console.log(chalk.dim('Aborted. Use --force to skip this check.'));
                        process.exit(0);
                    }
                    console.log();
                }
            }
            const sectionResults = [];
            let totalChanges = 0;
            // Calculate section boundaries in the XML document text for comment filtering
            // Comment positions (docPosition) are relative to xmlDocText, NOT wordText
            // So we must find section headers in xmlDocText to get matching boundaries
            const sectionBoundaries = [];
            const xmlLower = xmlDocText.toLowerCase();
            // Standard section header keywords to search for in XML
            // Map from file name pattern to search terms
            const sectionKeywords = {
                'abstract': ['abstract', 'summary'],
                'introduction': ['introduction', 'background'],
                'methods': ['methods', 'materials and methods', 'methodology'],
                'results': ['results'],
                'discussion': ['discussion'],
                'conclusion': ['conclusion', 'conclusions'],
            };
            // Helper: find section header (skip labels like "Methods:" in structured abstracts)
            // Real section headers are NOT followed by ":" immediately
            function findSectionHeader(text, keyword, startFrom = 0) {
                const lower = text.toLowerCase();
                let idx = startFrom;
                while ((idx = lower.indexOf(keyword, idx)) !== -1) {
                    // Check what follows the keyword
                    const afterKeyword = text.slice(idx + keyword.length, idx + keyword.length + 5);
                    // Skip if followed by ":" (this is a label, not a section header)
                    // Real headers are followed by text content, a newline, or a subheading
                    if (!afterKeyword.startsWith(':') && !afterKeyword.startsWith(' :')) {
                        return idx;
                    }
                    idx++;
                }
                return -1;
            }
            for (const section of wordSections) {
                const fileBase = section.file.replace(/\.md$/i, '').toLowerCase();
                // Get keywords for this section
                const keywords = sectionKeywords[fileBase] || [fileBase];
                // Find the first valid keyword that exists in XML (not a label)
                let headerIdx = -1;
                for (const kw of keywords) {
                    const idx = findSectionHeader(xmlDocText, kw, 0);
                    if (idx >= 0 && (headerIdx < 0 || idx < headerIdx)) {
                        headerIdx = idx;
                    }
                }
                if (headerIdx >= 0) {
                    // Find the next section's start to determine end boundary
                    let nextHeaderIdx = xmlDocText.length;
                    const sectionIdx = wordSections.indexOf(section);
                    if (sectionIdx < wordSections.length - 1) {
                        const nextFileBase = wordSections[sectionIdx + 1].file.replace(/\.md$/i, '').toLowerCase();
                        const nextKeywords = sectionKeywords[nextFileBase] || [nextFileBase];
                        for (const nkw of nextKeywords) {
                            const foundNext = findSectionHeader(xmlDocText, nkw, headerIdx + 10);
                            if (foundNext >= 0 && foundNext < nextHeaderIdx) {
                                nextHeaderIdx = foundNext;
                            }
                        }
                    }
                    sectionBoundaries.push({
                        file: section.file,
                        start: headerIdx,
                        end: nextHeaderIdx
                    });
                }
            }
            // Document length is the XML text length (same coordinate system as docPosition)
            const docLength = xmlDocText.length;
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
                const result = await importFromWord(docx, sectionPath, {
                    sectionContent: section.content,
                    author: 'Reviewer',
                    wordTables: wordTables,
                });
                let { annotated, stats } = result;
                let refConversions = [];
                if (registry && options.crossref !== false) {
                    const crossrefResult = convertHardcodedRefs(annotated, registry);
                    annotated = crossrefResult.converted;
                    refConversions = crossrefResult.conversions;
                    totalRefConversions += refConversions.length;
                }
                let commentsInserted = 0;
                if (comments.length > 0 && anchors.size > 0) {
                    // Filter comments to only those that belong to this section
                    // Use exact position matching: docPosition is in xmlDocText coordinates,
                    // and sectionBoundaries are also in xmlDocText coordinates (same source!)
                    const boundary = sectionBoundaries.find(b => b.file === section.file);
                    const isFirstSection = wordSections.indexOf(section) === 0;
                    const firstBoundaryStart = sectionBoundaries.length > 0 ? Math.min(...sectionBoundaries.map(b => b.start)) : 0;
                    const sectionComments = comments.filter((c) => {
                        const anchorData = anchors.get(c.id);
                        if (!anchorData)
                            return false;
                        // Use exact position - no scaling needed since both are in xmlDocText coordinates
                        if (anchorData.docPosition !== undefined && boundary) {
                            // Include comments within section boundaries
                            if (anchorData.docPosition >= boundary.start && anchorData.docPosition < boundary.end) {
                                return true;
                            }
                            // Also include "outside" comments (before first section) in the first section file
                            if (isFirstSection && anchorData.docPosition < firstBoundaryStart) {
                                return true;
                            }
                        }
                        return false;
                    });
                    if (process.env.DEBUG) {
                        console.log(`[DEBUG] ${section.file}: ${sectionComments.length} comments to place (boundary: ${boundary?.start}-${boundary?.end})`);
                    }
                    if (sectionComments.length > 0) {
                        // Use a more robust pattern that handles < in comment text
                        const commentPattern = /\{>>.*?<<\}/gs;
                        const beforeCount = (annotated.match(commentPattern) || []).length;
                        annotated = insertCommentsIntoMarkdown(annotated, sectionComments, anchors, {
                            quiet: !process.env.DEBUG,
                            sectionBoundary: boundary // Pass section boundary for position-based insertion
                        });
                        const afterCount = (annotated.match(commentPattern) || []).length;
                        commentsInserted = afterCount - beforeCount;
                        if (process.env.DEBUG) {
                            console.log(`[DEBUG] ${section.file}: inserted ${commentsInserted} of ${sectionComments.length} comments`);
                        }
                        if (commentsInserted > 0) {
                            stats.comments = (stats.comments || 0) + commentsInserted;
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
                if (r.status === 'skipped') {
                    return [
                        chalk.dim(r.file),
                        chalk.dim(r.header.slice(0, 25)),
                        chalk.yellow('skipped'),
                        '',
                        '',
                        '',
                        '',
                    ];
                }
                const s = r.stats;
                return [
                    chalk.bold(r.file),
                    r.header.length > 25 ? r.header.slice(0, 22) + '...' : r.header,
                    s.insertions > 0 ? chalk.green(`+${s.insertions}`) : chalk.dim('-'),
                    s.deletions > 0 ? chalk.red(`-${s.deletions}`) : chalk.dim('-'),
                    s.substitutions > 0 ? chalk.yellow(`~${s.substitutions}`) : chalk.dim('-'),
                    s.comments > 0 ? chalk.blue(`#${s.comments}`) : chalk.dim('-'),
                    r.refs > 0 ? chalk.magenta(`@${r.refs}`) : chalk.dim('-'),
                ];
            });
            console.log(fmt.table(['File', 'Section', 'Ins', 'Del', 'Sub', 'Cmt', 'Ref'], tableRows, { align: ['left', 'left', 'right', 'right', 'right', 'right', 'right'] }));
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
            if (options.dryRun) {
                console.log(fmt.box(chalk.yellow('Dry run - no files written'), { padding: 0 }));
            }
            else if (totalChanges > 0 || totalRefConversions > 0 || comments.length > 0) {
                const summaryLines = [];
                summaryLines.push(`${chalk.bold(wordSections.length)} sections processed`);
                if (totalChanges > 0)
                    summaryLines.push(`${chalk.bold(totalChanges)} annotations imported`);
                if (comments.length > 0)
                    summaryLines.push(`${chalk.bold(comments.length)} comments placed`);
                if (totalRefConversions > 0)
                    summaryLines.push(`${chalk.bold(totalRefConversions)} refs converted to @-syntax`);
                console.log(fmt.box(summaryLines.join('\n'), { title: 'Summary', padding: 0 }));
                console.log();
                console.log(chalk.dim('Next steps:'));
                console.log(chalk.dim('  1. rev review <section.md>  - Accept/reject changes'));
                console.log(chalk.dim('  2. rev comments <section.md> - View/address comments'));
                console.log(chalk.dim('  3. rev build docx  - Rebuild Word doc'));
            }
            else {
                console.log(fmt.status('success', 'No changes detected.'));
            }
        }
        catch (err) {
            spin.stop();
            const error = err;
            console.error(fmt.status('error', error.message));
            if (process.env.DEBUG)
                console.error(error.stack);
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
async function syncCommentsOnly(docx, sectionFilter, options, configPath) {
    const config = loadConfig(configPath);
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
    }
    catch (err) {
        spin.stop();
        const error = err;
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
    const results = [];
    for (const boundary of activeBoundaries) {
        const sectionPath = path.join(options.dir, boundary.file);
        if (!fs.existsSync(sectionPath)) {
            results.push({ file: boundary.file, placed: 0, unmatched: 0, skipped: true });
            continue;
        }
        const isFirstSection = boundary === activeBoundaries[0];
        const sectionComments = comments.filter((c) => {
            const anchor = anchors.get(c.id);
            if (!anchor || anchor.docPosition === undefined)
                return false;
            if (anchor.docPosition >= boundary.start && anchor.docPosition < boundary.end)
                return true;
            // Comments before the first heading land in the first matched section
            if (isFirstSection && anchor.docPosition < firstBoundaryStart)
                return true;
            return false;
        });
        if (sectionComments.length === 0) {
            results.push({ file: boundary.file, placed: 0, unmatched: 0, skipped: false });
            continue;
        }
        const original = fs.readFileSync(sectionPath, 'utf-8');
        const commentPattern = /\{>>.*?<<\}/gs;
        const beforeCount = (original.match(commentPattern) || []).length;
        const annotated = insertCommentsIntoMarkdown(original, sectionComments, anchors, {
            quiet: !process.env.DEBUG,
            sectionBoundary: { start: boundary.start, end: boundary.end },
            wrapAnchor: false,
        });
        const afterCount = (annotated.match(commentPattern) || []).length;
        const placed = afterCount - beforeCount;
        const unmatched = sectionComments.length - placed;
        if (!options.dryRun && placed > 0) {
            fs.writeFileSync(sectionPath, annotated, 'utf-8');
        }
        results.push({ file: boundary.file, placed, unmatched, skipped: false });
    }
    const tableRows = results.map(r => {
        if (r.skipped) {
            return [chalk.dim(r.file), chalk.yellow('missing'), '', ''];
        }
        return [
            chalk.bold(r.file),
            chalk.green(`${r.placed}`),
            r.unmatched > 0 ? chalk.yellow(`${r.unmatched}`) : chalk.dim('-'),
            chalk.dim('comments only'),
        ];
    });
    console.log(fmt.table(['File', 'Placed', 'Unmatched', 'Mode'], tableRows, { align: ['left', 'right', 'right', 'left'] }));
    console.log();
    const totalPlaced = results.reduce((s, r) => s + r.placed, 0);
    const totalUnmatched = results.reduce((s, r) => s + r.unmatched, 0);
    const lines = [];
    lines.push(`${chalk.bold(comments.length)} comments in document`);
    lines.push(`${chalk.bold(totalPlaced)} placed at fuzzy-matched anchors`);
    if (totalUnmatched > 0) {
        lines.push(`${chalk.yellow(totalUnmatched)} unmatched (no anchor in current prose)`);
    }
    if (options.dryRun) {
        lines.push(chalk.yellow('Dry run — no files written'));
    }
    else if (totalPlaced > 0) {
        lines.push(chalk.dim('Existing prose unchanged.'));
    }
    console.log(fmt.box(lines.join('\n'), { title: 'Summary', padding: 0 }));
    if (totalUnmatched > 0) {
        console.log();
        console.log(chalk.dim('Tip: run "rev verify-anchors" to see which comments drifted.'));
    }
}
//# sourceMappingURL=sync.js.map