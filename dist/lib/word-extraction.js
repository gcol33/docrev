/**
 * Word document data extraction - raw extraction from .docx files
 */
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);
// ============================================
// Functions
// ============================================
/**
 * Extract comments directly from Word docx comments.xml
 */
export async function extractWordComments(docxPath) {
    const AdmZip = (await import('adm-zip')).default;
    const { parseStringPromise } = await import('xml2js');
    const comments = [];
    // Validate file exists
    if (!fs.existsSync(docxPath)) {
        throw new Error(`File not found: ${docxPath}`);
    }
    try {
        let zip;
        try {
            zip = new AdmZip(docxPath);
        }
        catch (err) {
            throw new Error(`Invalid Word document (not a valid .docx file): ${err.message}`);
        }
        const commentsEntry = zip.getEntry('word/comments.xml');
        if (!commentsEntry) {
            return comments;
        }
        let commentsXml;
        try {
            commentsXml = commentsEntry.getData().toString('utf8');
        }
        catch (err) {
            throw new Error(`Failed to read comments from document: ${err.message}`);
        }
        const parsed = await parseStringPromise(commentsXml, { explicitArray: false });
        const ns = 'w:';
        const commentsRoot = parsed['w:comments'];
        if (!commentsRoot || !commentsRoot['w:comment']) {
            return comments;
        }
        // Ensure it's an array
        const commentNodes = Array.isArray(commentsRoot['w:comment'])
            ? commentsRoot['w:comment']
            : [commentsRoot['w:comment']];
        for (const comment of commentNodes) {
            const id = comment.$?.['w:id'] || '';
            const author = comment.$?.['w:author'] || 'Unknown';
            const date = comment.$?.['w:date'] || '';
            // Extract text from nested w:p/w:r/w:t elements
            let text = '';
            const extractText = (node) => {
                if (!node)
                    return;
                if (typeof node === 'string') {
                    text += node;
                    return;
                }
                if (node['w:t']) {
                    const t = node['w:t'];
                    text += typeof t === 'string' ? t : (t._ || t);
                }
                if (node['w:r']) {
                    const runs = Array.isArray(node['w:r']) ? node['w:r'] : [node['w:r']];
                    runs.forEach(extractText);
                }
                if (node['w:p']) {
                    const paras = Array.isArray(node['w:p']) ? node['w:p'] : [node['w:p']];
                    paras.forEach(extractText);
                }
            };
            extractText(comment);
            comments.push({ id, author, date: date.slice(0, 10), text: text.trim() });
        }
    }
    catch (err) {
        // Re-throw with more context if it's already an Error we created
        if (err.message.includes('Invalid Word document') || err.message.includes('File not found')) {
            throw err;
        }
        throw new Error(`Error extracting comments from ${path.basename(docxPath)}: ${err.message}`);
    }
    return comments;
}
/**
 * Extract comment anchor texts from document.xml with surrounding context
 * Returns map of comment ID -> {anchor, before, after, docPosition, isEmpty} for better matching
 * Also returns fullDocText for section boundary matching
 */
export async function extractCommentAnchors(docxPath) {
    const AdmZip = (await import('adm-zip')).default;
    const anchors = new Map();
    let fullDocText = '';
    try {
        const zip = new AdmZip(docxPath);
        const docEntry = zip.getEntry('word/document.xml');
        if (!docEntry) {
            return { anchors, fullDocText };
        }
        const docXml = docEntry.getData().toString('utf8');
        // ========================================
        // STEP 1: Build text position mapping
        // ========================================
        const textNodePattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        const textNodes = [];
        let textPosition = 0;
        let nodeMatch;
        while ((nodeMatch = textNodePattern.exec(docXml)) !== null) {
            const rawText = nodeMatch[1] ?? '';
            const decodedText = decodeXmlEntities(rawText);
            textNodes.push({
                xmlStart: nodeMatch.index,
                xmlEnd: nodeMatch.index + nodeMatch[0].length,
                textStart: textPosition,
                textEnd: textPosition + decodedText.length,
                text: decodedText
            });
            textPosition += decodedText.length;
        }
        fullDocText = textNodes.map(n => n.text).join('');
        // Helper: convert XML position to text position
        function xmlPosToTextPos(xmlPos) {
            for (let i = 0; i < textNodes.length; i++) {
                const node = textNodes[i];
                if (!node)
                    continue;
                if (xmlPos >= node.xmlStart && xmlPos < node.xmlEnd) {
                    return node.textStart;
                }
                if (xmlPos < node.xmlStart) {
                    return node.textStart;
                }
            }
            const lastNode = textNodes[textNodes.length - 1];
            return lastNode ? lastNode.textEnd : 0;
        }
        // Helper: extract context before a position
        function getContextBefore(position, maxLength = 150) {
            const beforeText = fullDocText.slice(Math.max(0, position - maxLength), position);
            const sentenceStart = beforeText.search(/[.!?]\s+[A-Z][^.!?]*$/);
            return sentenceStart >= 0
                ? beforeText.slice(sentenceStart + 2).trim()
                : beforeText.slice(-80).trim();
        }
        // Helper: extract context after a position
        function getContextAfter(position, maxLength = 150) {
            const afterText = fullDocText.slice(position, position + maxLength);
            const sentenceEnd = afterText.search(/[.!?]\s/);
            return sentenceEnd >= 0
                ? afterText.slice(0, sentenceEnd + 1).trim()
                : afterText.slice(0, 80).trim();
        }
        // ========================================
        // STEP 2: Collect all start/end markers separately
        // ========================================
        const startPattern = /<w:commentRangeStart[^>]*w:id="(\d+)"[^>]*\/?>/g;
        const endPattern = /<w:commentRangeEnd[^>]*w:id="(\d+)"[^>]*\/?>/g;
        const starts = new Map(); // id -> position after start tag
        const ends = new Map(); // id -> position before end tag
        let match;
        while ((match = startPattern.exec(docXml)) !== null) {
            const id = match[1];
            if (!starts.has(id)) {
                starts.set(id, match.index + match[0].length);
            }
        }
        while ((match = endPattern.exec(docXml)) !== null) {
            const id = match[1];
            if (!ends.has(id)) {
                ends.set(id, match.index);
            }
        }
        // ========================================
        // STEP 3: Process each comment range by ID
        // ========================================
        for (const [id, startXmlPos] of starts) {
            const endXmlPos = ends.get(id);
            // Missing end marker - skip with warning
            if (endXmlPos === undefined) {
                console.warn(`Comment ${id}: missing end marker`);
                continue;
            }
            // Calculate text position
            const docPosition = xmlPosToTextPos(startXmlPos);
            // Handle empty or inverted ranges
            if (endXmlPos <= startXmlPos) {
                anchors.set(id, {
                    anchor: '',
                    before: getContextBefore(docPosition),
                    after: getContextAfter(docPosition),
                    docPosition,
                    docLength: fullDocText.length,
                    isEmpty: true
                });
                continue;
            }
            // Extract XML segment between markers
            const segment = docXml.slice(startXmlPos, endXmlPos);
            // Extract text from w:t (regular) AND w:delText (deleted text in track changes)
            const textInRangePattern = /<w:t[^>]*>([^<]*)<\/w:t>|<w:delText[^>]*>([^<]*)<\/w:delText>/g;
            let anchorText = '';
            let tm;
            while ((tm = textInRangePattern.exec(segment)) !== null) {
                anchorText += tm[1] || tm[2] || '';
            }
            anchorText = decodeXmlEntities(anchorText);
            // Get context
            const anchorLength = anchorText.length;
            const before = getContextBefore(docPosition);
            const after = getContextAfter(docPosition + anchorLength);
            // ALWAYS add entry (even if anchor is empty)
            anchors.set(id, {
                anchor: anchorText.trim(),
                before,
                after,
                docPosition,
                docLength: fullDocText.length,
                isEmpty: !anchorText.trim()
            });
        }
    }
    catch (err) {
        console.error('Error extracting comment anchors:', err.message);
        return { anchors, fullDocText: '' };
    }
    return { anchors, fullDocText };
}
/**
 * Extract heading paragraphs from a docx, with their text positions in the
 * same coordinate system as `extractCommentAnchors`'s `fullDocText` and
 * `CommentAnchorData.docPosition`.
 *
 * Headings are paragraphs whose `<w:pStyle>` is a Heading style. Reading
 * styles directly is more reliable than keyword-matching the concatenated
 * body text — there, paragraph boundaries are gone, so the literal string
 * "Methods" can appear inside prose ("results across countries") and the
 * structured-abstract label "Methods:" loses its colon when text runs are
 * concatenated.
 */
export async function extractHeadings(docxPath) {
    const AdmZip = (await import('adm-zip')).default;
    if (!fs.existsSync(docxPath)) {
        throw new Error(`File not found: ${docxPath}`);
    }
    const zip = new AdmZip(docxPath);
    const docEntry = zip.getEntry('word/document.xml');
    if (!docEntry)
        return [];
    const xml = docEntry.getData().toString('utf8');
    // Build the same xml-pos → text-pos mapping that extractCommentAnchors does
    const textNodePattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    const nodes = [];
    let textPos = 0;
    let m;
    while ((m = textNodePattern.exec(xml)) !== null) {
        const decoded = decodeXmlEntities(m[1] ?? '');
        nodes.push({
            xmlStart: m.index,
            xmlEnd: m.index + m[0].length,
            textStart: textPos,
            textEnd: textPos + decoded.length,
        });
        textPos += decoded.length;
    }
    function xmlToTextPos(xmlPos) {
        for (const n of nodes) {
            if (xmlPos >= n.xmlStart && xmlPos < n.xmlEnd)
                return n.textStart;
            if (xmlPos < n.xmlStart)
                return n.textStart;
        }
        return nodes.length ? nodes[nodes.length - 1].textEnd : 0;
    }
    const headings = [];
    const paraPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
    let pm;
    while ((pm = paraPattern.exec(xml)) !== null) {
        const inner = pm[1];
        const styleMatch = inner.match(/<w:pStyle[^>]*w:val="([^"]+)"/);
        if (!styleMatch)
            continue;
        const style = styleMatch[1];
        if (!/heading/i.test(style))
            continue;
        // Concatenate text runs; include w:delText so a heading inside a tracked
        // deletion is still surfaced (verifying anchors against an original draft)
        const textInRange = /<w:t[^>]*>([^<]*)<\/w:t>|<w:delText[^>]*>([^<]*)<\/w:delText>/g;
        let txt = '';
        let tm;
        while ((tm = textInRange.exec(inner)) !== null) {
            txt += decodeXmlEntities(tm[1] || tm[2] || '');
        }
        const trimmed = txt.trim();
        if (!trimmed)
            continue;
        const levelMatch = style.match(/(\d+)/);
        const level = levelMatch ? parseInt(levelMatch[1], 10) : 0;
        headings.push({
            style,
            level,
            text: trimmed,
            docPosition: xmlToTextPos(pm.index),
        });
    }
    return headings;
}
/**
 * Decode XML entities in text
 */
function decodeXmlEntities(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCharCode(parseInt(code, 16)));
}
/**
 * Extract text content from a Word XML cell
 */
function extractCellText(cellXml) {
    const parts = [];
    // Check for OMML math - replace with [math] placeholder
    if (cellXml.includes('<m:oMath')) {
        // Try to extract the text representation of math
        const mathTextMatches = cellXml.match(/<m:t>([^<]*)<\/m:t>/g) || [];
        if (mathTextMatches.length > 0) {
            const mathText = mathTextMatches.map((t) => t.replace(/<[^>]+>/g, '')).join('');
            parts.push(mathText);
        }
        else {
            parts.push('[math]');
        }
    }
    // Extract regular text from w:t elements
    const textMatches = cellXml.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [];
    for (const match of textMatches) {
        const text = match.replace(/<[^>]+>/g, '');
        if (text) {
            parts.push(text);
        }
    }
    let result = parts.join('').trim();
    result = decodeXmlEntities(result);
    // Escape pipe characters in cell content (would break table)
    result = result.replace(/\|/g, '\\|');
    return result;
}
/**
 * Parse a table row, handling merged cells (gridSpan)
 */
function parseTableRow(rowXml, expectedCols) {
    // Match cells - handle both <w:tc> and <w:tc ...>
    const cellMatches = rowXml.match(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g) || [];
    const cells = [];
    const colSpans = [];
    for (const cellXml of cellMatches) {
        // Check for horizontal merge (gridSpan)
        const gridSpanMatch = cellXml.match(/<w:gridSpan\s+w:val="(\d+)"/);
        const span = gridSpanMatch ? parseInt(gridSpanMatch[1], 10) : 1;
        // Check for vertical merge continuation (vMerge without restart)
        // If vMerge is present without w:val="restart", it's a continuation - use empty
        const vMergeMatch = cellXml.match(/<w:vMerge(?:\s+w:val="([^"]+)")?/);
        const isVMergeContinuation = vMergeMatch && vMergeMatch[1] !== 'restart';
        const cellText = isVMergeContinuation ? '' : extractCellText(cellXml);
        // Add the cell content
        cells.push(cellText);
        colSpans.push(span);
        // For gridSpan > 1, add empty cells to maintain column alignment
        for (let i = 1; i < span; i++) {
            cells.push('');
            colSpans.push(0); // 0 indicates this is a spanned cell
        }
    }
    return { cells, colSpans };
}
/**
 * Determine table grid column count from table XML
 */
function getTableGridCols(tableXml) {
    // Try to get from tblGrid
    const gridColMatches = tableXml.match(/<w:gridCol/g) || [];
    if (gridColMatches.length > 0) {
        return gridColMatches.length;
    }
    // Fallback: count max cells in any row
    const rowMatches = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
    let maxCols = 0;
    for (const rowXml of rowMatches) {
        const { cells } = parseTableRow(rowXml, 0);
        maxCols = Math.max(maxCols, cells.length);
    }
    return maxCols;
}
/**
 * Extract tables directly from Word document XML and convert to markdown pipe tables
 */
export async function extractWordTables(docxPath) {
    const AdmZip = (await import('adm-zip')).default;
    const tables = [];
    try {
        const zip = new AdmZip(docxPath);
        const docEntry = zip.getEntry('word/document.xml');
        if (!docEntry) {
            return tables;
        }
        const xml = docEntry.getData().toString('utf8');
        // Find all table elements
        const tableMatches = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
        for (const tableXml of tableMatches) {
            // Determine expected column count from grid
            const expectedCols = getTableGridCols(tableXml);
            // Extract rows
            const rowMatches = tableXml.match(/<w:tr[\s\S]*?<\/w:tr>/g) || [];
            const rows = [];
            for (const rowXml of rowMatches) {
                const { cells } = parseTableRow(rowXml, expectedCols);
                if (cells.length > 0) {
                    rows.push(cells);
                }
            }
            if (rows.length > 0) {
                // Convert to markdown pipe table
                const markdown = convertRowsToMarkdownTable(rows);
                tables.push({ markdown, rowCount: rows.length, colCount: expectedCols || rows[0]?.length || 0 });
            }
        }
    }
    catch (err) {
        console.error('Error extracting tables from Word:', err.message);
    }
    return tables;
}
/**
 * Convert array of rows (each row is array of cell strings) to markdown pipe table
 */
function convertRowsToMarkdownTable(rows) {
    if (rows.length === 0)
        return '';
    // Normalize column count (use max across all rows)
    const colCount = Math.max(...rows.map((r) => r.length));
    // Pad rows to have consistent column count
    const normalizedRows = rows.map((row) => {
        while (row.length < colCount) {
            row.push('');
        }
        return row;
    });
    // Build markdown table
    const lines = [];
    // Header row
    const header = normalizedRows[0];
    lines.push('| ' + header.join(' | ') + ' |');
    // Separator row
    lines.push('|' + header.map(() => '---').join('|') + '|');
    // Data rows
    for (let i = 1; i < normalizedRows.length; i++) {
        lines.push('| ' + normalizedRows[i].join(' | ') + ' |');
    }
    return lines.join('\n');
}
/**
 * Extract text from Word document using pandoc with track changes preserved
 */
export async function extractFromWord(docxPath, options = {}) {
    let text;
    let messages = [];
    let extractedMedia = [];
    let hasTrackChanges = false;
    let trackChangeStats = { insertions: 0, deletions: 0 };
    // Determine media extraction directory
    const docxDir = path.dirname(docxPath);
    const mediaDir = options.mediaDir || path.join(docxDir, 'media');
    // Skip media extraction if figures already exist (e.g., when re-importing with existing source)
    const skipMediaExtraction = options.skipMediaExtraction || false;
    // Extract tables directly from Word XML (reliable, no heuristics)
    const wordTables = await extractWordTables(docxPath);
    // Try pandoc first with --track-changes=all to preserve reviewer edits
    try {
        // Build pandoc command
        let pandocCmd = `pandoc "${docxPath}" -t markdown --wrap=none --track-changes=all`;
        if (!skipMediaExtraction) {
            pandocCmd += ` --extract-media="${mediaDir}"`;
        }
        const { stdout } = await execAsync(pandocCmd, { maxBuffer: 50 * 1024 * 1024 });
        text = stdout;
        // Convert pandoc's track change format to CriticMarkup
        const origLength = text.length;
        // Use a more robust pattern that handles nested content
        text = text.replace(/\[([^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*)\]\{\.insertion[^}]*\}/g, (match, content) => {
            if (content.trim()) {
                trackChangeStats.insertions++;
                return `{++${content}++}`;
            }
            return ''; // Empty insertions are removed
        });
        text = text.replace(/\[([^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*)\]\{\.deletion[^}]*\}/g, (match, content) => {
            if (content.trim()) {
                trackChangeStats.deletions++;
                return `{--${content}--}`;
            }
            return ''; // Empty deletions are removed
        });
        // Handle any remaining pandoc track change patterns
        let prevText;
        do {
            prevText = text;
            text = text.replace(/\[([^\]]*)\]\{\.insertion[^}]*\}/g, (match, content) => {
                if (content.trim()) {
                    trackChangeStats.insertions++;
                    return `{++${content}++}`;
                }
                return '';
            });
            text = text.replace(/\[([^\]]*)\]\{\.deletion[^}]*\}/g, (match, content) => {
                if (content.trim()) {
                    trackChangeStats.deletions++;
                    return `{--${content}--}`;
                }
                return '';
            });
        } while (text !== prevText);
        // Handle pandoc comment patterns - remove comment text from body
        text = text.replace(/\[[^\]]*\]\{\.comment-start[^}]*\}/g, '');
        text = text.replace(/\[\]\{\.comment-end[^}]*\}/g, '');
        // Also handle {.mark} spans
        text = text.replace(/\[([^\]]*)\]\{\.mark\}/g, '$1');
        hasTrackChanges = trackChangeStats.insertions > 0 || trackChangeStats.deletions > 0;
        if (hasTrackChanges) {
            messages.push({
                type: 'info',
                message: `Found ${trackChangeStats.insertions} insertion(s) and ${trackChangeStats.deletions} deletion(s) from track changes`
            });
        }
        // Find extracted media files
        const mediaSubdir = path.join(mediaDir, 'media');
        if (fs.existsSync(mediaSubdir)) {
            extractedMedia = fs.readdirSync(mediaSubdir)
                .filter(f => /\.(png|jpg|jpeg|gif|svg|emf|wmf|tiff?)$/i.test(f))
                .map(f => path.join(mediaSubdir, f));
            if (extractedMedia.length > 0) {
                messages.push({
                    type: 'info',
                    message: `Extracted ${extractedMedia.length} image(s) to ${mediaSubdir}`
                });
            }
        }
    }
    catch (pandocErr) {
        // Pandoc not available — use XML-based extraction with track change support
        const { extractPlainTextWithTrackChanges } = await import('./word.js');
        const { getInstallInstructions } = await import('./dependencies.js');
        const installCmd = getInstallInstructions('pandoc');
        const xmlResult = await extractPlainTextWithTrackChanges(docxPath);
        text = xmlResult.text;
        hasTrackChanges = xmlResult.hasTrackChanges;
        trackChangeStats = xmlResult.stats;
        if (hasTrackChanges) {
            messages.push({
                type: 'warning',
                message: `Pandoc not installed. Using built-in XML extractor (${trackChangeStats.insertions} insertions, ${trackChangeStats.deletions} deletions preserved). Formatting may differ. Install pandoc for best results: ${installCmd}`
            });
        }
        else {
            messages.push({
                type: 'warning',
                message: `Pandoc not installed. Using built-in XML extractor (no track changes found). Install pandoc for better formatting: ${installCmd}`
            });
        }
    }
    // Extract comments directly from docx XML
    const comments = await extractWordComments(docxPath);
    // Extract comment anchor texts
    const { anchors } = await extractCommentAnchors(docxPath);
    return {
        text,
        comments,
        anchors,
        messages,
        extractedMedia,
        tables: wordTables,
        hasTrackChanges,
        trackChangeStats,
    };
}
//# sourceMappingURL=word-extraction.js.map