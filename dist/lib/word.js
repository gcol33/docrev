/**
 * Word document extraction utilities
 * Handle reading text, comments, and anchors from .docx files
 */
import * as fs from 'fs';
import AdmZip from 'adm-zip';
import { parseString } from 'xml2js';
import { promisify } from 'util';
const parseXml = promisify(parseString);
// =============================================================================
// Constants
// =============================================================================
/** Characters of context to extract around comment anchors */
const ANCHOR_CONTEXT_SIZE = 100;
/** Characters of context before comment range start */
const CONTEXT_BEFORE_SIZE = 500;
// =============================================================================
// Public API
// =============================================================================
/**
 * Extract comments from Word document's comments.xml
 * @param docxPath - Path to .docx file
 * @returns Array of extracted comments
 * @throws {TypeError} If docxPath is not a string
 * @throws {Error} If file not found or invalid docx
 */
export async function extractWordComments(docxPath) {
    if (typeof docxPath !== 'string') {
        throw new TypeError(`docxPath must be a string, got ${typeof docxPath}`);
    }
    if (!fs.existsSync(docxPath)) {
        throw new Error(`File not found: ${docxPath}`);
    }
    const zip = new AdmZip(docxPath);
    const commentsEntry = zip.getEntry('word/comments.xml');
    if (!commentsEntry) {
        return []; // No comments in document
    }
    const commentsXml = zip.readAsText(commentsEntry);
    const parsed = await parseXml(commentsXml);
    if (!parsed?.['w:comments'] || !parsed['w:comments']['w:comment']) {
        return [];
    }
    const comments = [];
    const rawComments = parsed['w:comments']['w:comment'];
    for (const comment of rawComments) {
        const id = comment.$?.['w:id'];
        const author = comment.$?.['w:author'] || 'Unknown';
        const date = comment.$?.['w:date'];
        // Extract text from all paragraphs in comment
        let text = '';
        const paragraphs = comment['w:p'] || [];
        for (const para of paragraphs) {
            const runs = para['w:r'] || [];
            for (const run of runs) {
                const texts = run['w:t'] || [];
                for (const t of texts) {
                    text += typeof t === 'string' ? t : (t._ || '');
                }
            }
        }
        if (id && text.trim()) {
            comments.push({
                id,
                author,
                date,
                text: text.trim(),
            });
        }
    }
    return comments;
}
/**
 * Extract comment anchors (where comments are attached) from document.xml
 * Returns mapping of comment ID to the text they're anchored to
 * @param docxPath - Path to .docx file
 * @returns Map of comment ID to anchor info
 * @throws {TypeError} If docxPath is not a string
 * @throws {Error} If invalid docx structure
 */
export async function extractCommentAnchors(docxPath) {
    if (typeof docxPath !== 'string') {
        throw new TypeError(`docxPath must be a string, got ${typeof docxPath}`);
    }
    const zip = new AdmZip(docxPath);
    const documentEntry = zip.getEntry('word/document.xml');
    if (!documentEntry) {
        throw new Error('Invalid docx: no document.xml');
    }
    const documentXml = zip.readAsText(documentEntry);
    const anchors = new Map();
    // Find commentRangeStart and commentRangeEnd pairs
    // The text between them is what the comment is anchored to
    const startPattern = /<w:commentRangeStart w:id="(\d+)"\/>/g;
    const endPattern = /<w:commentRangeEnd w:id="(\d+)"\/>/g;
    let match;
    const starts = new Map();
    const ends = new Map();
    while ((match = startPattern.exec(documentXml)) !== null) {
        if (match[1]) {
            starts.set(match[1], match.index);
        }
    }
    while ((match = endPattern.exec(documentXml)) !== null) {
        if (match[1]) {
            ends.set(match[1], match.index);
        }
    }
    // For each comment, extract the text between start and end
    for (const [id, startPos] of starts) {
        const endPos = ends.get(id);
        if (!endPos)
            continue;
        const segment = documentXml.slice(startPos, endPos);
        // Extract all text content from the segment
        const textPattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        let text = '';
        let textMatch;
        while ((textMatch = textPattern.exec(segment)) !== null) {
            text += textMatch[1] ?? '';
        }
        // Get surrounding context (text before the anchor)
        const contextStart = Math.max(0, startPos - CONTEXT_BEFORE_SIZE);
        const contextSegment = documentXml.slice(contextStart, startPos);
        let context = '';
        while ((textMatch = textPattern.exec(contextSegment)) !== null) {
            context += textMatch[1] ?? '';
        }
        anchors.set(id, {
            text: text.trim(),
            context: context.slice(-ANCHOR_CONTEXT_SIZE),
        });
    }
    return anchors;
}
/**
 * Extract plain text from Word document (strips track change markup)
 * @param docxPath - Path to .docx file
 * @returns Extracted plain text (accepted changes applied)
 * @throws {TypeError} If docxPath is not a string
 * @throws {Error} If file not found
 */
export async function extractTextFromWord(docxPath) {
    if (typeof docxPath !== 'string') {
        throw new TypeError(`docxPath must be a string, got ${typeof docxPath}`);
    }
    const result = await extractPlainTextWithTrackChanges(docxPath);
    // Strip CriticMarkup: accept insertions, remove deletions, apply substitutions
    let text = result.text;
    text = text.replace(/\{~~[^~]*~>([^~]*)~~\}/g, '$1'); // substitutions → new
    text = text.replace(/\{\+\+([^+]*)\+\+\}/g, '$1'); // insertions → keep
    text = text.replace(/\{--[^}]*--\}/g, ''); // deletions → remove
    return text;
}
/**
 * Get document metadata from Word file
 * @param docxPath - Path to .docx file
 * @returns Document metadata
 * @throws {TypeError} If docxPath is not a string
 */
export async function getWordMetadata(docxPath) {
    if (typeof docxPath !== 'string') {
        throw new TypeError(`docxPath must be a string, got ${typeof docxPath}`);
    }
    const zip = new AdmZip(docxPath);
    const coreEntry = zip.getEntry('docProps/core.xml');
    if (!coreEntry) {
        return {};
    }
    const coreXml = zip.readAsText(coreEntry);
    const metadata = {};
    // Extract common metadata fields
    const patterns = {
        title: /<dc:title>([^<]*)<\/dc:title>/,
        author: /<dc:creator>([^<]*)<\/dc:creator>/,
        created: /<dcterms:created[^>]*>([^<]*)<\/dcterms:created>/,
        modified: /<dcterms:modified[^>]*>([^<]*)<\/dcterms:modified>/,
    };
    for (const [key, pattern] of Object.entries(patterns)) {
        const match = coreXml.match(pattern);
        if (match) {
            metadata[key] = match[1];
        }
    }
    return metadata;
}
/**
 * Check if file is a valid Word document
 * @param filePath - Path to file to check
 * @returns True if valid .docx file
 */
export function isWordDocument(filePath) {
    if (typeof filePath !== 'string')
        return false;
    if (!fs.existsSync(filePath))
        return false;
    if (!filePath.toLowerCase().endsWith('.docx'))
        return false;
    try {
        const zip = new AdmZip(filePath);
        return zip.getEntry('word/document.xml') !== null;
    }
    catch {
        return false;
    }
}
/**
 * Extract text content from XML element, handling nested elements
 * @param xml - XML string
 * @returns Plain text content
 */
function extractTextFromXml(xml) {
    let text = '';
    // Match w:t elements (regular text)
    const textPattern = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let match;
    while ((match = textPattern.exec(xml)) !== null) {
        text += match[1];
    }
    // Also match w:delText (deleted text)
    const delTextPattern = /<w:delText[^>]*>([^<]*)<\/w:delText>/g;
    while ((match = delTextPattern.exec(xml)) !== null) {
        text += match[1];
    }
    return text;
}
/**
 * Extract track changes (insertions and deletions) from Word document
 * Converts Word's w:ins and w:del elements to CriticMarkup format
 *
 * @param docxPath - Path to Word document
 * @returns Track changes result with content and stats
 */
export async function extractTrackChanges(docxPath) {
    if (!fs.existsSync(docxPath)) {
        throw new Error(`File not found: ${docxPath}`);
    }
    const zip = new AdmZip(docxPath);
    const documentEntry = zip.getEntry('word/document.xml');
    if (!documentEntry) {
        throw new Error('Invalid docx: no document.xml');
    }
    let xml = zip.readAsText(documentEntry);
    let insertions = 0;
    let deletions = 0;
    // Check if there are any track changes
    const hasInsertions = xml.includes('<w:ins ');
    const hasDeletions = xml.includes('<w:del ');
    if (!hasInsertions && !hasDeletions) {
        return { hasTrackChanges: false, content: null, stats: { insertions: 0, deletions: 0 } };
    }
    // Process insertions: <w:ins ...>...</w:ins> -> {++...++}
    // Match the full w:ins element including nested content
    xml = xml.replace(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g, (match, content) => {
        const text = extractTextFromXml(content);
        if (text.trim()) {
            insertions++;
            return `{++${text}++}`;
        }
        return text;
    });
    // Process deletions: <w:del ...>...</w:del> -> {--...--}
    xml = xml.replace(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/g, (match, content) => {
        const text = extractTextFromXml(content);
        if (text.trim()) {
            deletions++;
            return `{--${text}--}`;
        }
        return '';
    });
    return {
        hasTrackChanges: true,
        content: xml,
        stats: { insertions, deletions },
    };
}
/**
 * Extract a single marker's content starting at position i.
 * Returns { content, end } where end is the position after the closing marker,
 * or null if no valid closing marker found.
 */
function extractMarker(text, i, open, close) {
    if (!text.startsWith(open, i))
        return null;
    const start = i + open.length;
    const closeIdx = text.indexOf(close, start);
    if (closeIdx === -1)
        return null;
    return { content: text.slice(start, closeIdx), end: closeIdx + close.length };
}
/**
 * Greedily collect consecutive markers of the same type.
 * E.g. {++a++}{++b++}{++c++} → "abc", advancing past all three.
 */
function collectConsecutive(text, i, open, close) {
    const first = extractMarker(text, i, open, close);
    if (!first)
        return null;
    let content = first.content;
    let end = first.end;
    while (end < text.length) {
        const next = extractMarker(text, end, open, close);
        if (!next)
            break;
        content += next.content;
        end = next.end;
    }
    return { content, end };
}
/**
 * Scan text for adjacent CriticMarkup markers and:
 * 1. Merge consecutive same-type markers: {++a++}{++b++} → {++ab++}
 * 2. Merge adjacent del+ins or ins+del into substitutions: {--old--}{++new++} → {~~old~>new~~}
 *
 * Uses a linear scanner — no regex backtracking, no ambiguity.
 */
function mergeAdjacentMarkers(text) {
    let result = '';
    let i = 0;
    while (i < text.length) {
        // --- Deletion block ---
        if (text.startsWith('{--', i)) {
            const del = collectConsecutive(text, i, '{--', '--}');
            if (!del) {
                result += text[i];
                i++;
                continue;
            }
            // Skip spaces, then check for adjacent insertion
            let j = del.end;
            while (j < text.length && text[j] === ' ')
                j++;
            const ins = collectConsecutive(text, j, '{++', '++}');
            if (ins) {
                // Merge into substitution
                const trailing = del.content.endsWith(' ') || ins.content.endsWith(' ');
                result += `{~~${del.content.trimEnd()}~>${ins.content.trimEnd()}~~}${trailing ? ' ' : ''}`;
                i = ins.end;
            }
            else {
                // Emit merged deletion
                result += `{--${del.content}--}`;
                i = del.end;
            }
            continue;
        }
        // --- Insertion block ---
        if (text.startsWith('{++', i)) {
            const ins = collectConsecutive(text, i, '{++', '++}');
            if (!ins) {
                result += text[i];
                i++;
                continue;
            }
            // Skip spaces, then check for adjacent deletion
            let j = ins.end;
            while (j < text.length && text[j] === ' ')
                j++;
            const del = collectConsecutive(text, j, '{--', '--}');
            if (del) {
                // Merge into substitution (del → ins order in output)
                const trailing = del.content.endsWith(' ') || ins.content.endsWith(' ');
                result += `{~~${del.content.trimEnd()}~>${ins.content.trimEnd()}~~}${trailing ? ' ' : ''}`;
                i = del.end;
            }
            else {
                // Emit merged insertion
                result += `{++${ins.content}++}`;
                i = ins.end;
            }
            continue;
        }
        result += text[i];
        i++;
    }
    return result;
}
/**
 * Extract plain text from Word XML with track changes preserved as CriticMarkup.
 * This is a pandoc-free fallback that reads document.xml directly.
 *
 * Converts:
 *   <w:ins> content </w:ins>  →  {++text++}
 *   <w:del> content </w:del>  →  {--text--}
 *
 * Also detects headings (w:pStyle Heading1-6) and outputs markdown # syntax.
 *
 * @param docxPath - Path to Word document
 * @returns Plain text with CriticMarkup and stats
 */
export async function extractPlainTextWithTrackChanges(docxPath) {
    if (!fs.existsSync(docxPath)) {
        throw new Error(`File not found: ${docxPath}`);
    }
    const zip = new AdmZip(docxPath);
    const docEntry = zip.getEntry('word/document.xml');
    if (!docEntry) {
        throw new Error('Invalid docx: no document.xml');
    }
    let xml = docEntry.getData().toString('utf8');
    let insertions = 0;
    let deletions = 0;
    // Use unique markers (null bytes) that won't appear in normal text
    const INS_S = '\x00IS\x00';
    const INS_E = '\x00IE\x00';
    const DEL_S = '\x00DS\x00';
    const DEL_E = '\x00DE\x00';
    // Step 1: Replace <w:ins> with marker-wrapped text injected as <w:t>
    // Whitespace-only insertions are kept as plain text (not markers) to preserve spacing.
    xml = xml.replace(/<w:ins\b[^>]*>([\s\S]*?)<\/w:ins>/g, (_match, content) => {
        const texts = [];
        const tPat = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        let m;
        while ((m = tPat.exec(content)) !== null) {
            texts.push(m[1] || '');
        }
        const text = texts.join('');
        if (text.trim()) {
            insertions++;
            return `<w:r><w:t>${INS_S}${text}${INS_E}</w:t></w:r>`;
        }
        // Whitespace-only: preserve as plain text for spacing
        if (text.length > 0) {
            return `<w:r><w:t>${text}</w:t></w:r>`;
        }
        return '';
    });
    // Step 2: Replace <w:del> similarly (uses w:delText inside)
    // Whitespace-only deletions are kept as plain text to preserve spacing.
    xml = xml.replace(/<w:del\b[^>]*>([\s\S]*?)<\/w:del>/g, (_match, content) => {
        const texts = [];
        const tPat = /<w:delText[^>]*>([^<]*)<\/w:delText>|<w:t[^>]*>([^<]*)<\/w:t>/g;
        let m;
        while ((m = tPat.exec(content)) !== null) {
            texts.push(m[1] || m[2] || '');
        }
        const text = texts.join('');
        if (text.trim()) {
            deletions++;
            return `<w:r><w:t>${DEL_S}${text}${DEL_E}</w:t></w:r>`;
        }
        // Whitespace-only: preserve as plain text for spacing
        if (text.length > 0) {
            return `<w:r><w:t>${text}</w:t></w:r>`;
        }
        return '';
    });
    // Step 3: Extract text paragraph by paragraph
    const paragraphs = [];
    const paraPattern = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
    let pm;
    while ((pm = paraPattern.exec(xml)) !== null) {
        const paraXml = pm[1];
        // Detect heading level from paragraph style
        let headingLevel = 0;
        const styleMatch = paraXml.match(/<w:pStyle\s+w:val="Heading(\d)"/i);
        if (styleMatch && styleMatch[1]) {
            headingLevel = parseInt(styleMatch[1], 10);
        }
        // Extract all <w:t> text in order
        const texts = [];
        const tPat = /<w:t[^>]*>([^<]*)<\/w:t>/g;
        let tm;
        while ((tm = tPat.exec(paraXml)) !== null) {
            texts.push(tm[1] || '');
        }
        let paraText = texts.join('');
        // Decode XML entities
        paraText = paraText
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
        // Convert markers to CriticMarkup
        paraText = paraText
            .split(INS_S).join('{++')
            .split(INS_E).join('++}')
            .split(DEL_S).join('{--')
            .split(DEL_E).join('--}');
        // Merge adjacent del+ins (or ins+del) into substitutions.
        // Uses a scanner instead of regex to avoid backtracking across marker boundaries.
        paraText = mergeAdjacentMarkers(paraText);
        // Collapse runs of multiple spaces into single space
        paraText = paraText.replace(/ {2,}/g, ' ');
        if (paraText.trim()) {
            if (headingLevel > 0 && headingLevel <= 6) {
                paragraphs.push('#'.repeat(headingLevel) + ' ' + paraText.trim());
            }
            else {
                paragraphs.push(paraText);
            }
        }
    }
    return {
        text: paragraphs.join('\n\n'),
        hasTrackChanges: insertions > 0 || deletions > 0,
        stats: { insertions, deletions },
    };
}
/**
 * Extract Word document content with track changes preserved as CriticMarkup
 * Uses pandoc with track-changes=all option to preserve insertions/deletions
 *
 * @param docxPath - Path to Word document
 * @param options - Options
 * @returns Track changes result with text and stats
 */
export async function extractWithTrackChanges(docxPath, options = {}) {
    const { mediaDir } = options;
    if (!fs.existsSync(docxPath)) {
        throw new Error(`File not found: ${docxPath}`);
    }
    const { execSync } = await import('child_process');
    // Use pandoc with --track-changes=all to preserve track changes
    // This outputs insertions as [insertion]{.insertion} and deletions as [deletion]{.deletion}
    let pandocArgs = `"${docxPath}" -t markdown --wrap=none --track-changes=all`;
    if (mediaDir) {
        pandocArgs += ` --extract-media="${mediaDir}"`;
    }
    let text;
    try {
        text = execSync(`pandoc ${pandocArgs}`, {
            encoding: 'utf-8',
            maxBuffer: 50 * 1024 * 1024,
        });
    }
    catch (err) {
        throw new Error(`Pandoc extraction failed: ${err.message}`);
    }
    // Count track changes from pandoc output
    let insertions = 0;
    let deletions = 0;
    // Pandoc outputs track changes as:
    // [inserted text]{.insertion author="..."}
    // [deleted text]{.deletion author="..."}
    // Convert pandoc's track change format to CriticMarkup
    // Insertions: [text]{.insertion ...} -> {++text++}
    text = text.replace(/\[([^\]]*)\]\{\.insertion[^}]*\}/g, (match, content) => {
        if (content.trim()) {
            insertions++;
            return `{++${content}++}`;
        }
        return '';
    });
    // Deletions: [text]{.deletion ...} -> {--text--}
    text = text.replace(/\[([^\]]*)\]\{\.deletion[^}]*\}/g, (match, content) => {
        if (content.trim()) {
            deletions++;
            return `{--${content}--}`;
        }
        return '';
    });
    const hasTrackChanges = insertions > 0 || deletions > 0;
    return {
        text,
        hasTrackChanges,
        stats: { insertions, deletions },
    };
}
//# sourceMappingURL=word.js.map