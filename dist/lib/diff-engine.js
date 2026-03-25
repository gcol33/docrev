/**
 * Diff engine - diffing and annotation processing for Word→Markdown import
 */
import { diffWords } from 'diff';
import { extractMarkdownPrefix, protectAnchors, restoreAnchors, protectCrossrefs, restoreCrossrefs, protectMath, restoreMath, replaceRenderedMath, protectCitations, restoreCitations, replaceRenderedCitations, protectImages, restoreImages, matchWordImagesToOriginal, protectTables, restoreTables, } from './protect-restore.js';
import { normalizeWhitespace } from './utils.js';
// ============================================
// Functions
// ============================================
/**
 * Fix citation and math annotations by preserving original markdown syntax
 */
export function fixCitationAnnotations(text, originalMd) {
    // Fix math annotations - preserve inline and display math
    text = text.replace(/\{--(\$[^$]+\$)--\}/g, '$1');
    text = text.replace(/\{--(\$\$[^$]+\$\$)--\}/g, '$1');
    text = text.replace(/\{~~(\$[^$]+\$)~>[^~]+~~\}/g, '$1');
    text = text.replace(/\{~~(\$\$[^$]+\$\$)~>[^~]+~~\}/g, '$1');
    // Extract all citations from original markdown
    const citationPattern = /\[@[^\]]+\]/g;
    const originalCitations = [...originalMd.matchAll(citationPattern)].map(m => m[0]);
    // Fix substitutions where left side has markdown citation
    text = text.replace(/\{~~(\[@[^\]]+\])~>[^~]+~~\}/g, '$1');
    // Fix substitutions where left side STARTS with markdown citation
    text = text.replace(/\{~~(\[@[^\]]+\])\s*([^~]*)~>([^~]*)~~\}/g, (match, cite, oldText, newText) => {
        if (oldText.trim() === '' && newText.trim() === '') {
            return cite;
        }
        if (oldText.trim() || newText.trim()) {
            return cite + (oldText.trim() !== newText.trim() ? ` {~~${oldText.trim()}~>${newText.trim()}~~}` : ` ${newText}`);
        }
        return cite;
    });
    // Fix deletions of markdown citations
    text = text.replace(/\{--(\[@[^\]]+\])--\}/g, '$1');
    // Fix insertions of rendered citations
    text = text.replace(/\{\+\+\([A-Z][^)]*\d{4}[^)]*\)\+\+\}/g, '');
    // Clean up broken multi-part substitutions
    text = text.replace(/\{~~(@[A-Za-z]+\d{4})~>[^~]+~~\}/g, '[$1]');
    // Fix citations split across substitution boundaries
    text = text.replace(/\{~~\[@~>[^~]*~~\}([A-Za-z]+\d{4})\]/g, '[@$1]');
    // Clean up any remaining partial citations
    text = text.replace(/\{~~;\s*@([A-Za-z]+\d{4})\]~>[^~]*~~\}/g, '; [@$1]');
    // Remove rendered citation insertions (with Unicode support)
    text = text.replace(/\{\+\+\(\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)\+\+\}/gu, '');
    text = text.replace(/\{\+\+\(\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)\.\s*\+\+\}/gu, '');
    // Trailing citation fragments
    text = text.replace(/\{\+\+\d{4}[a-z]?(?:[;,]\s*(?:\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+)?\d{4}[a-z]?)*\)\.\s*\+\+\}/gu, '');
    text = text.replace(/\{\+\+\d{4}[a-z]?(?:[;,]\s*(?:\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+)?\d{4}[a-z]?)*\)\s*\+\+\}/gu, '');
    // Just year with closing paren
    text = text.replace(/\{\+\+\d{4}[a-z]?\)\.\s*\+\+\}/g, '');
    text = text.replace(/\{\+\+\d{4}[a-z]?\)\s*\+\+\}/g, '');
    // Leading citation fragments
    text = text.replace(/\{\+\+\(?\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s*\+\+\}/gu, '');
    // Semicolon-separated fragments
    text = text.replace(/\{\+\+[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?\+\+\}/gu, '');
    // Year ranges with authors
    text = text.replace(/\{\+\+\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)\s*\+\+\}/gu, '');
    text = text.replace(/\{\+\+\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?(?:[;,]\s*\p{Lu}\p{L}*(?:\s+et\s+al\.?)?\s+\d{4}[a-z]?)*\)\.\s*\+\+\}/gu, '');
    // Clean up double spaces and orphaned punctuation
    text = text.replace(/  +/g, ' ');
    text = text.replace(/\s+\./g, '.');
    text = text.replace(/\s+,/g, ',');
    // Final cleanup - remove empty annotations
    text = text.replace(/\{~~\s*~>\s*~~\}/g, '');
    text = text.replace(/\{\+\+\s*\+\+\}/g, '');
    text = text.replace(/\{--\s*--\}/g, '');
    return text;
}
/**
 * Strip markdown syntax to get plain text
 */
function stripMarkdownSyntax(md) {
    return md
        .replace(/^---[\s\S]*?---\n*/m, '')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/(\*\*|__)(.*?)\1/g, '$2')
        .replace(/(\*|_)(.*?)\1/g, '$2')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/```[\s\S]*?```/g, '')
        .replace(/^>\s*/gm, '')
        .replace(/^[-*_]{3,}\s*$/gm, '')
        .replace(/^[\s]*[-*+]\s+/gm, '')
        .replace(/^[\s]*\d+\.\s+/gm, '')
        .replace(/\|/g, ' ')
        .replace(/^[-:]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
/**
 * Inject Word tables (extracted from XML) into pandoc text output
 */
function injectWordTables(pandocText, wordTables) {
    if (!wordTables || wordTables.length === 0) {
        return pandocText;
    }
    let result = pandocText;
    for (const table of wordTables) {
        const firstLine = table.markdown.split('\n')[0];
        const headerCells = firstLine
            .split('|')
            .map((c) => c.trim())
            .filter((c) => c.length > 0);
        if (headerCells.length === 0)
            continue;
        const firstCell = headerCells[0];
        const startIdx = result.indexOf(firstCell);
        if (startIdx === -1)
            continue;
        const lastLine = table.markdown.split('\n').pop();
        const lastCells = lastLine
            .split('|')
            .map((c) => c.trim())
            .filter((c) => c.length > 0);
        const lastCell = lastCells[lastCells.length - 1] || lastCells[0];
        const endIdx = result.indexOf(lastCell, startIdx);
        if (endIdx === -1)
            continue;
        let regionStart = result.lastIndexOf('\n\n', startIdx);
        if (regionStart === -1)
            regionStart = 0;
        else
            regionStart += 2;
        let regionEnd = result.indexOf('\n\n', endIdx + lastCell.length);
        if (regionEnd === -1)
            regionEnd = result.length;
        result = result.slice(0, regionStart) + table.markdown + '\n\n' + result.slice(regionEnd);
    }
    return result;
}
/**
 * Generate annotated markdown by diffing original MD against Word text
 */
export function generateAnnotatedDiff(originalMd, wordText, author = 'Reviewer') {
    const normalizedOriginal = normalizeWhitespace(originalMd);
    const normalizedWord = normalizeWhitespace(wordText);
    const changes = diffWords(normalizedOriginal, normalizedWord);
    let result = '';
    for (const part of changes) {
        if (part.added) {
            result += `{++${part.value}++}`;
        }
        else if (part.removed) {
            result += `{--${part.value}--}`;
        }
        else {
            result += part.value;
        }
    }
    return result;
}
/**
 * Smart paragraph-level diff that preserves markdown structure
 */
export function generateSmartDiff(originalMd, wordText, author = 'Reviewer', options = {}) {
    const { wordTables = [], imageRegistry = null } = options;
    // Inject Word tables into pandoc output
    let wordTextWithTables = injectWordTables(wordText, wordTables);
    // Protect markdown tables
    const { text: mdWithTablesProtected, tables } = protectTables(originalMd);
    // Also protect tables in Word text
    const { text: wordWithTablesProtected, tables: wordTableBlocks } = protectTables(wordTextWithTables);
    // Protect images
    const { text: mdWithImagesProtected, images: origImages } = protectImages(mdWithTablesProtected, imageRegistry);
    const { text: wordWithImagesProtected, images: wordImages } = protectImages(wordWithTablesProtected, imageRegistry);
    // Match Word images to original images
    const imageMapping = matchWordImagesToOriginal(origImages, wordImages, imageRegistry);
    // Replace Word image placeholders with matching original placeholders
    let wordWithMappedImages = wordWithImagesProtected;
    for (const [wordPlaceholder, origPlaceholder] of imageMapping) {
        wordWithMappedImages = wordWithMappedImages.split(wordPlaceholder).join(origPlaceholder);
    }
    // Protect figure/table anchors
    const { text: mdWithAnchorsProtected, anchors: figAnchors } = protectAnchors(mdWithImagesProtected);
    // Protect cross-references
    const { text: mdWithXrefsProtected, crossrefs } = protectCrossrefs(mdWithAnchorsProtected);
    // Protect math
    const { text: mdWithMathProtected, mathBlocks } = protectMath(mdWithXrefsProtected);
    // Protect citations
    const { text: mdProtected, citations } = protectCitations(mdWithMathProtected);
    // Replace rendered elements in Word text
    let wordProtected = wordWithMappedImages;
    wordProtected = replaceRenderedMath(wordProtected, mathBlocks);
    wordProtected = replaceRenderedCitations(wordProtected, citations.length);
    // Split into paragraphs
    const originalParas = mdProtected.split(/\n\n+/);
    const wordParas = wordProtected.split(/\n\n+/);
    const result = [];
    // Try to match paragraphs intelligently
    let wordIdx = 0;
    for (let i = 0; i < originalParas.length; i++) {
        const orig = originalParas[i] || '';
        const { prefix: mdPrefix, content: origContent } = extractMarkdownPrefix(orig.split('\n')[0]);
        // Find best matching word paragraph
        let bestMatch = -1;
        let bestScore = 0;
        for (let j = wordIdx; j < Math.min(wordIdx + 3, wordParas.length); j++) {
            const wordPara = wordParas[j] || '';
            const origWords = new Set(origContent.toLowerCase().split(/\s+/));
            const wordWords = wordPara.toLowerCase().split(/\s+/);
            const common = wordWords.filter((w) => origWords.has(w)).length;
            const score = common / Math.max(origWords.size, wordWords.length);
            if (score > bestScore && score > 0.3) {
                bestScore = score;
                bestMatch = j;
            }
        }
        if (bestMatch === -1) {
            if (mdPrefix && wordIdx < wordParas.length) {
                const wordPara = wordParas[wordIdx];
                if (wordPara.toLowerCase().includes(origContent.toLowerCase().slice(0, 20))) {
                    bestMatch = wordIdx;
                }
            }
        }
        if (bestMatch >= 0) {
            const word = wordParas[bestMatch];
            const origStripped = stripMarkdownSyntax(orig);
            const wordNormalized = normalizeWhitespace(word);
            if (origStripped === wordNormalized) {
                result.push(orig);
            }
            else {
                const changes = diffWords(origStripped, wordNormalized);
                let annotated = mdPrefix;
                for (const part of changes) {
                    if (part.added) {
                        annotated += `{++${part.value}++}`;
                    }
                    else if (part.removed) {
                        annotated += `{--${part.value}--}`;
                    }
                    else {
                        annotated += part.value;
                    }
                }
                result.push(annotated);
            }
            wordIdx = bestMatch + 1;
        }
        else {
            // Paragraph deleted entirely
            if (mdPrefix && mdPrefix.match(/^#{1,6}\s+/)) {
                result.push(orig);
            }
            else {
                result.push(`{--${orig}--}`);
            }
        }
    }
    // Any remaining word paragraphs are additions
    for (let j = wordIdx; j < wordParas.length; j++) {
        const word = wordParas[j];
        if (word.trim()) {
            result.push(`{++${word}++}`);
        }
    }
    // Restore protected content
    let finalResult = result.join('\n\n');
    finalResult = restoreCitations(finalResult, citations);
    finalResult = restoreMath(finalResult, mathBlocks);
    finalResult = restoreCrossrefs(finalResult, crossrefs);
    finalResult = restoreAnchors(finalResult, figAnchors);
    finalResult = restoreImages(finalResult, origImages);
    finalResult = restoreImages(finalResult, wordImages);
    finalResult = restoreTables(finalResult, tables);
    finalResult = restoreTables(finalResult, wordTableBlocks);
    return finalResult;
}
/**
 * Clean up redundant adjacent annotations
 */
export function cleanupAnnotations(text) {
    // Convert adjacent delete+insert to substitution
    text = text.replace(/\{--(.+?)--\}\s*\{\+\+(.+?)\+\+\}/g, '{~~$1~>$2~~}');
    // Also handle insert+delete
    text = text.replace(/\{\+\+(.+?)\+\+\}\s*\{--(.+?)--\}/g, '{~~$2~>$1~~}');
    // Fix malformed patterns
    text = text.replace(/\{--([^}]+?)~>([^}]+?)~~\}/g, '{~~$1~>$2~~}');
    // Fix malformed substitutions that got split
    text = text.replace(/\{~~([^~]+)\s*--\}/g, '{--$1--}');
    text = text.replace(/\{\+\+([^+]+)~~\}/g, '{++$1++}');
    // Clean up empty annotations
    text = text.replace(/\{--\s*--\}/g, '');
    text = text.replace(/\{\+\+\s*\+\+\}/g, '');
    // Clean up double spaces in prose, but preserve table formatting
    const lines = text.split('\n');
    let inTable = false;
    const processedLines = lines.map((line, idx) => {
        const isSeparator = /^[-]+(\s+[-]+)+\s*$/.test(line.trim());
        const looksLikeTableRow = /\S+\s{2,}\S+/.test(line);
        if (isSeparator) {
            if (!inTable) {
                inTable = true;
            }
            return line;
        }
        if (inTable) {
            if (line.trim() === '') {
                let lookAhead = idx + 1;
                let foundTableContent = false;
                let foundEndSeparator = false;
                while (lookAhead < lines.length && lookAhead < idx + 20) {
                    const nextLine = lines[lookAhead].trim();
                    if (nextLine === '') {
                        lookAhead++;
                        continue;
                    }
                    if (/^[-]+(\s+[-]+)+\s*$/.test(nextLine)) {
                        foundEndSeparator = true;
                        break;
                    }
                    if (/\S+\s{2,}\S+/.test(nextLine)) {
                        foundTableContent = true;
                        break;
                    }
                    if (/^\*[^*]+\*\s*$/.test(nextLine)) {
                        foundTableContent = true;
                        break;
                    }
                    if (lines[lookAhead].startsWith('  ')) {
                        lookAhead++;
                        continue;
                    }
                    break;
                }
                if (foundTableContent || foundEndSeparator) {
                    return line;
                }
                inTable = false;
                return line;
            }
            return line;
        }
        if (looksLikeTableRow) {
            let nextIdx = idx + 1;
            while (nextIdx < lines.length && lines[nextIdx].trim() === '') {
                nextIdx++;
            }
            if (nextIdx < lines.length && /^[-]+(\s+[-]+)+\s*$/.test(lines[nextIdx].trim())) {
                return line;
            }
        }
        if (line.trim().startsWith('|')) {
            return line;
        }
        return line.replace(/  +/g, ' ');
    });
    text = processedLines.join('\n');
    return text;
}
//# sourceMappingURL=diff-engine.js.map