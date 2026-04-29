/**
 * VERIFY-ANCHORS command: report drift between Word comment anchors
 * and the current markdown.
 *
 * Useful when prose has been revised between sending the docx out for
 * review and receiving it back. Each comment is classified by how well
 * its anchor still matches the current section prose:
 *
 *   clean        – exact or whitespace-normalized hit
 *   drift        – anchor only matches via stripped/partial fallbacks
 *   context-only – anchor text is gone, only surrounding context survives
 *   ambiguous    – multiple matches, can't pick one without context
 *   unmatched    – nothing maps; user must place the comment manually
 */
import { chalk, fs, path, fmt, loadConfig, jsonMode, jsonOutput, } from './context.js';
import { findAnchorInText, classifyStrategy, scoreContextAt } from '../anchor-match.js';
import { computeSectionBoundaries } from './section-boundaries.js';
export function register(program) {
    program
        .command('verify-anchors')
        .description('Report drift between Word comment anchors and current markdown')
        .argument('<file>', 'Word document with reviewer comments (.docx)')
        .option('-c, --config <file>', 'Sections config file', 'sections.yaml')
        .option('-d, --dir <directory>', 'Directory with section files', '.')
        .option('--json', 'Output JSON report (for scripting)')
        .action(async (docxPath, options) => {
        if (!fs.existsSync(docxPath)) {
            console.error(fmt.status('error', `File not found: ${docxPath}`));
            process.exit(1);
        }
        const configPath = path.resolve(options.dir, options.config);
        if (!fs.existsSync(configPath)) {
            console.error(fmt.status('error', `Config not found: ${configPath}`));
            console.error(chalk.dim('  Run "rev init" first to generate sections.yaml'));
            process.exit(1);
        }
        const config = loadConfig(configPath);
        const { extractWordComments, extractCommentAnchors, extractHeadings } = await import('../import.js');
        let comments;
        let anchors;
        let headings;
        try {
            comments = await extractWordComments(docxPath);
            const result = await extractCommentAnchors(docxPath);
            anchors = result.anchors;
            headings = await extractHeadings(docxPath);
        }
        catch (err) {
            const error = err;
            console.error(fmt.status('error', `Failed to read ${path.basename(docxPath)}: ${error.message}`));
            if (process.env.DEBUG)
                console.error(error.stack);
            process.exit(1);
        }
        if (comments.length === 0) {
            console.log(fmt.status('info', 'No comments found in document.'));
            return;
        }
        const boundaries = computeSectionBoundaries(config.sections, headings);
        // Cache section markdown contents on first read
        const sectionCache = new Map();
        function loadSection(file) {
            if (sectionCache.has(file))
                return sectionCache.get(file);
            const sectionPath = path.join(options.dir, file);
            if (!fs.existsSync(sectionPath))
                return null;
            const content = fs.readFileSync(sectionPath, 'utf-8');
            sectionCache.set(file, content);
            return content;
        }
        const firstBoundaryStart = boundaries.length > 0 ? boundaries[0].start : 0;
        const reports = [];
        for (const c of comments) {
            const anchor = anchors.get(c.id);
            const anchorText = anchor?.anchor || '';
            if (!anchor) {
                reports.push({
                    id: c.id,
                    author: c.author,
                    text: c.text,
                    section: null,
                    quality: 'unmatched',
                    strategy: 'no-anchor',
                    anchor: '',
                    occurrences: 0,
                });
                continue;
            }
            // Determine which section file this comment lives in
            let sectionFile = null;
            for (const b of boundaries) {
                if (anchor.docPosition >= b.start && anchor.docPosition < b.end) {
                    sectionFile = b.file;
                    break;
                }
            }
            if (!sectionFile && boundaries.length > 0 && anchor.docPosition < firstBoundaryStart) {
                sectionFile = boundaries[0].file;
            }
            if (!sectionFile) {
                reports.push({
                    id: c.id,
                    author: c.author,
                    text: c.text,
                    section: null,
                    quality: 'unmatched',
                    strategy: 'no-section',
                    anchor: anchorText,
                    occurrences: 0,
                });
                continue;
            }
            const md = loadSection(sectionFile);
            if (md === null) {
                reports.push({
                    id: c.id,
                    author: c.author,
                    text: c.text,
                    section: sectionFile,
                    quality: 'unmatched',
                    strategy: 'missing-file',
                    anchor: anchorText,
                    occurrences: 0,
                });
                continue;
            }
            const search = findAnchorInText(anchor.anchor, md, anchor.before, anchor.after);
            let quality = classifyStrategy(search.strategy, search.occurrences.length);
            if (quality === 'clean' && search.occurrences.length > 1) {
                // Multiple direct hits — only flag as ambiguous when before/after
                // context can't pick a clear winner. If one candidate scores
                // strictly higher than the others, sync will place it correctly.
                const anchorLen = anchor.anchor.length;
                const scores = search.occurrences.map(p => scoreContextAt(p, md, anchor.before, anchor.after, anchorLen));
                const max = Math.max(...scores);
                const winners = scores.filter(s => s === max).length;
                if (max === 0 || winners > 1) {
                    quality = 'ambiguous';
                }
            }
            reports.push({
                id: c.id,
                author: c.author,
                text: c.text,
                section: sectionFile,
                quality,
                strategy: search.strategy,
                anchor: anchorText,
                occurrences: search.occurrences.length,
            });
        }
        if (options.json || jsonMode) {
            jsonOutput({
                file: docxPath,
                totalComments: comments.length,
                summary: tally(reports),
                comments: reports,
            });
            return;
        }
        printReport(docxPath, reports);
    });
}
function tally(reports) {
    const out = { clean: 0, drift: 0, 'context-only': 0, ambiguous: 0, unmatched: 0 };
    for (const r of reports)
        out[r.quality] = (out[r.quality] || 0) + 1;
    return out;
}
function printReport(docxPath, reports) {
    console.log(fmt.header(`Anchor Verification: ${path.basename(docxPath)}`));
    console.log();
    const totals = tally(reports);
    const summaryLines = [];
    summaryLines.push(`${chalk.green(totals.clean)} clean (anchor still matches)`);
    if (totals.drift)
        summaryLines.push(`${chalk.cyan(totals.drift)} drifted (matched via fallback strategies)`);
    if (totals['context-only'])
        summaryLines.push(`${chalk.yellow(totals['context-only'])} context-only (anchor text gone, neighbors survive)`);
    if (totals.ambiguous)
        summaryLines.push(`${chalk.magenta(totals.ambiguous)} ambiguous (multiple candidate positions)`);
    if (totals.unmatched)
        summaryLines.push(`${chalk.red(totals.unmatched)} unmatched (manual placement needed)`);
    console.log(fmt.box(summaryLines.join('\n'), { title: 'Summary', padding: 0 }));
    console.log();
    // Per-comment table for everything that isn't a clean direct hit
    const problems = reports.filter(r => r.quality !== 'clean');
    if (problems.length === 0) {
        console.log(fmt.status('success', 'All comment anchors match the current markdown.'));
        return;
    }
    const rows = problems.map(r => [
        chalk.dim(`#${r.id}`),
        qualityColor(r.quality),
        r.section ? chalk.bold(r.section) : chalk.dim('—'),
        chalk.dim(r.strategy),
        truncate(r.anchor, 35),
        truncate(r.text, 35),
    ]);
    console.log(fmt.table(['ID', 'Quality', 'Section', 'Strategy', 'Anchor (Word)', 'Comment'], rows, { align: ['right', 'left', 'left', 'left', 'left', 'left'] }));
    if (totals.unmatched > 0 || totals.ambiguous > 0) {
        console.log();
        console.log(chalk.dim('Comments flagged "unmatched" or "ambiguous" need manual placement.'));
        console.log(chalk.dim('Run "rev sync --comments-only" to import the matched ones without touching prose.'));
    }
}
function qualityColor(q) {
    switch (q) {
        case 'clean': return chalk.green('clean');
        case 'drift': return chalk.cyan('drift');
        case 'context-only': return chalk.yellow('context');
        case 'ambiguous': return chalk.magenta('ambiguous');
        case 'unmatched': return chalk.red('unmatched');
        default: return q;
    }
}
function truncate(s, max) {
    if (!s)
        return chalk.dim('—');
    const flat = s.replace(/\s+/g, ' ').trim();
    return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}
//# sourceMappingURL=verify-anchors.js.map