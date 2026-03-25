/**
 * Import functionality - convert Word docs to annotated Markdown
 *
 * Orchestration workflows + re-exports from extraction/diff/restore modules
 */
import * as fs from 'fs';
import * as path from 'path';
import { stripAnnotations } from './annotations.js';
import { readImageRegistry } from './image-registry.js';
import { exec } from 'child_process';
import { promisify } from 'util';
// Import from split modules
import { extractFromWord, } from './word-extraction.js';
import { generateSmartDiff, cleanupAnnotations, fixCitationAnnotations, } from './diff-engine.js';
import { restoreCrossrefFromWord, restoreImagesFromRegistry, convertVisibleComments, } from './restore-references.js';
// Re-export everything so existing imports from './import.js' still work
export { extractFromWord, extractWordComments, extractCommentAnchors, extractWordTables, } from './word-extraction.js';
export { generateSmartDiff, generateAnnotatedDiff, cleanupAnnotations, fixCitationAnnotations, } from './diff-engine.js';
export { restoreCrossrefFromWord, restoreImagesFromRegistry, parseVisibleComments, convertVisibleComments, } from './restore-references.js';
const execAsync = promisify(exec);
// ============================================
// Functions
// ============================================
/**
 * Insert comments into markdown text based on anchor texts with context
 */
export function insertCommentsIntoMarkdown(markdown, comments, anchors, options = {}) {
    const { quiet = false, sectionBoundary = null } = options;
    let result = markdown;
    let unmatchedCount = 0;
    const duplicateWarnings = [];
    const usedPositions = new Set(); // For tie-breaking: track used positions
    // Helper: Strip CriticMarkup from text to get "clean" version for matching
    function stripCriticMarkup(text) {
        return text
            .replace(/\{\+\+([^+]*)\+\+\}/g, '$1') // insertions: keep inserted text
            .replace(/\{--([^-]*)--\}/g, '') // deletions: remove deleted text
            .replace(/\{~~([^~]*)~>([^~]*)~~\}/g, '$2') // substitutions: keep new text
            .replace(/\{>>[^<]*<<\}/g, '') // comments: remove
            .replace(/\[([^\]]*)\]\{\.mark\}/g, '$1'); // marked text: keep text
    }
    // Helper: Find anchor in text with multiple fallback strategies
    function findAnchorInText(anchor, text, before = '', after = '') {
        // If anchor is empty, skip directly to context-based matching
        if (!anchor || anchor.trim().length === 0) {
            // Jump to context-based strategies (Strategy 5)
            if (before || after) {
                const beforeLower = (before || '').toLowerCase();
                const afterLower = (after || '').toLowerCase();
                const textLower = text.toLowerCase();
                if (before && after) {
                    const beforeIdx = textLower.indexOf(beforeLower.slice(-50));
                    if (beforeIdx !== -1) {
                        const searchStart = beforeIdx + beforeLower.slice(-50).length;
                        const afterIdx = textLower.indexOf(afterLower.slice(0, 50), searchStart);
                        if (afterIdx !== -1 && afterIdx - searchStart < 500) {
                            return { occurrences: [searchStart], matchedAnchor: null, strategy: 'context-both' };
                        }
                    }
                }
                if (before) {
                    const beforeIdx = textLower.lastIndexOf(beforeLower.slice(-30));
                    if (beforeIdx !== -1) {
                        return { occurrences: [beforeIdx + beforeLower.slice(-30).length], matchedAnchor: null, strategy: 'context-before' };
                    }
                }
                if (after) {
                    const afterIdx = textLower.indexOf(afterLower.slice(0, 30));
                    if (afterIdx !== -1) {
                        return { occurrences: [afterIdx], matchedAnchor: null, strategy: 'context-after' };
                    }
                }
            }
            return { occurrences: [], matchedAnchor: null, strategy: 'empty-anchor' };
        }
        const anchorLower = anchor.toLowerCase();
        const textLower = text.toLowerCase();
        // Strategy 1: Direct match
        let occurrences = findAllOccurrences(textLower, anchorLower);
        if (occurrences.length > 0) {
            return { occurrences, matchedAnchor: anchor, strategy: 'direct' };
        }
        // Strategy 2: Normalized whitespace
        const normalizedAnchor = anchor.replace(/\s+/g, ' ').toLowerCase();
        const normalizedText = text.replace(/\s+/g, ' ').toLowerCase();
        let idx = normalizedText.indexOf(normalizedAnchor);
        if (idx !== -1) {
            return { occurrences: [idx], matchedAnchor: anchor, strategy: 'normalized' };
        }
        // Strategy 3: Try matching in stripped CriticMarkup version
        const strippedText = stripCriticMarkup(text);
        const strippedLower = strippedText.toLowerCase();
        occurrences = findAllOccurrences(strippedLower, anchorLower);
        if (occurrences.length > 0) {
            return { occurrences, matchedAnchor: anchor, strategy: 'stripped', stripped: true };
        }
        // Strategy 4: First N words of anchor (for long anchors)
        const words = anchor.split(/\s+/);
        if (words.length > 3) {
            for (let n = Math.min(6, words.length); n >= 3; n--) {
                const partialAnchor = words.slice(0, n).join(' ').toLowerCase();
                if (partialAnchor.length >= 15) {
                    occurrences = findAllOccurrences(textLower, partialAnchor);
                    if (occurrences.length > 0) {
                        return { occurrences, matchedAnchor: words.slice(0, n).join(' '), strategy: 'partial-start' };
                    }
                    occurrences = findAllOccurrences(strippedLower, partialAnchor);
                    if (occurrences.length > 0) {
                        return { occurrences, matchedAnchor: words.slice(0, n).join(' '), strategy: 'partial-start-stripped', stripped: true };
                    }
                }
            }
        }
        // Strategy 5: Use context (before/after) to find approximate position
        if (before || after) {
            const beforeLower = before.toLowerCase();
            const afterLower = after.toLowerCase();
            if (before && after) {
                const beforeIdx = textLower.indexOf(beforeLower.slice(-50));
                if (beforeIdx !== -1) {
                    const searchStart = beforeIdx + beforeLower.slice(-50).length;
                    const afterIdx = textLower.indexOf(afterLower.slice(0, 50), searchStart);
                    if (afterIdx !== -1 && afterIdx - searchStart < 500) {
                        return { occurrences: [searchStart], matchedAnchor: null, strategy: 'context-both' };
                    }
                }
            }
            if (before) {
                const beforeIdx = textLower.lastIndexOf(beforeLower.slice(-30));
                if (beforeIdx !== -1) {
                    return { occurrences: [beforeIdx + beforeLower.slice(-30).length], matchedAnchor: null, strategy: 'context-before' };
                }
            }
            if (after) {
                const afterIdx = textLower.indexOf(afterLower.slice(0, 30));
                if (afterIdx !== -1) {
                    return { occurrences: [afterIdx], matchedAnchor: null, strategy: 'context-after' };
                }
            }
        }
        // Strategy 6: Try splitting anchor on common transition words
        const splitPatterns = [' ', ', ', '. ', ' - ', ' – '];
        for (const sep of splitPatterns) {
            if (anchor.includes(sep)) {
                const parts = anchor.split(sep).filter(p => p.length >= 4);
                for (const part of parts) {
                    const partLower = part.toLowerCase();
                    occurrences = findAllOccurrences(textLower, partLower);
                    if (occurrences.length > 0 && occurrences.length < 5) {
                        return { occurrences, matchedAnchor: part, strategy: 'split-match' };
                    }
                }
            }
        }
        return { occurrences: [], matchedAnchor: null, strategy: 'failed' };
    }
    // Helper: Find all occurrences of needle in haystack
    function findAllOccurrences(haystack, needle) {
        if (!needle || needle.length === 0) {
            return [];
        }
        const occurrences = [];
        let idx = 0;
        while ((idx = haystack.indexOf(needle, idx)) !== -1) {
            occurrences.push(idx);
            idx += 1;
        }
        return occurrences;
    }
    // Get all positions in order (for sequential tie-breaking)
    const commentsWithPositions = comments.map((c) => {
        const anchorData = anchors.get(c.id);
        if (!anchorData) {
            unmatchedCount++;
            return { ...c, pos: -1, anchorText: null };
        }
        // Support both old format (string) and new format ({anchor, before, after})
        const anchor = typeof anchorData === 'string' ? anchorData : anchorData.anchor;
        const before = typeof anchorData === 'object' ? anchorData.before : '';
        const after = typeof anchorData === 'object' ? anchorData.after : '';
        const isEmpty = typeof anchorData === 'object' && anchorData.isEmpty;
        const docPosition = typeof anchorData === 'object' ? anchorData.docPosition : undefined;
        // Position-based insertion (most reliable)
        if (sectionBoundary && docPosition !== undefined) {
            const sectionLength = sectionBoundary.end - sectionBoundary.start;
            if (sectionLength > 0) {
                let relativePos;
                if (docPosition < sectionBoundary.start) {
                    relativePos = 0;
                }
                else {
                    relativePos = docPosition - sectionBoundary.start;
                }
                const proportion = Math.min(relativePos / sectionLength, 1.0);
                const markdownPos = Math.floor(proportion * result.length);
                let insertPos = markdownPos;
                // Look for nearby word boundary
                const searchWindow = result.slice(Math.max(0, markdownPos - 25), Math.min(result.length, markdownPos + 25));
                const spaceIdx = searchWindow.indexOf(' ', 25);
                if (spaceIdx !== -1 && spaceIdx < 50) {
                    insertPos = Math.max(0, markdownPos - 25) + spaceIdx;
                }
                // If we have anchor text, try to find it near this position
                if (anchor && !isEmpty) {
                    const searchStart = Math.max(0, insertPos - 200);
                    const searchEnd = Math.min(result.length, insertPos + 200);
                    const localSearch = result.slice(searchStart, searchEnd).toLowerCase();
                    const anchorLower = anchor.toLowerCase();
                    const localIdx = localSearch.indexOf(anchorLower);
                    if (localIdx !== -1) {
                        return { ...c, pos: searchStart + localIdx, anchorText: anchor, anchorEnd: searchStart + localIdx + anchor.length, strategy: 'position+text' };
                    }
                    // Try first few words
                    const words = anchor.split(/\s+/).slice(0, 4).join(' ').toLowerCase();
                    if (words.length >= 10) {
                        const partialIdx = localSearch.indexOf(words);
                        if (partialIdx !== -1) {
                            return { ...c, pos: searchStart + partialIdx, anchorText: words, anchorEnd: searchStart + partialIdx + words.length, strategy: 'position+partial' };
                        }
                    }
                }
                return { ...c, pos: insertPos, anchorText: null, strategy: 'position-only' };
            }
        }
        // Handle empty anchors
        if (!anchor || isEmpty) {
            if (before || after) {
                const { occurrences } = findAnchorInText('', result, before, after);
                if (occurrences.length > 0) {
                    return { ...c, pos: occurrences[0], anchorText: null, isEmpty: true };
                }
            }
            unmatchedCount++;
            return { ...c, pos: -1, anchorText: null, isEmpty: true };
        }
        // Text-based matching strategies
        const { occurrences, matchedAnchor, strategy, stripped } = findAnchorInText(anchor, result, before, after);
        if (occurrences.length === 0) {
            unmatchedCount++;
            return { ...c, pos: -1, anchorText: null };
        }
        const anchorLen = matchedAnchor ? matchedAnchor.length : 0;
        if (occurrences.length === 1) {
            if (matchedAnchor) {
                return { ...c, pos: occurrences[0], anchorText: matchedAnchor, anchorEnd: occurrences[0] + anchorLen };
            }
            else {
                return { ...c, pos: occurrences[0], anchorText: null };
            }
        }
        // Multiple occurrences - use context for disambiguation
        if (matchedAnchor) {
            duplicateWarnings.push(`"${matchedAnchor.slice(0, 40)}${matchedAnchor.length > 40 ? '...' : ''}" appears ${occurrences.length} times`);
        }
        let bestIdx = occurrences.find(p => !usedPositions.has(p)) ?? occurrences[0];
        let bestScore = -1;
        for (const pos of occurrences) {
            if (usedPositions.has(pos))
                continue;
            let score = 0;
            if (before) {
                const contextBefore = result.slice(Math.max(0, pos - before.length - 20), pos).toLowerCase();
                const beforeLower = before.toLowerCase();
                const beforeWords = beforeLower.split(/\s+/).filter(w => w.length > 3);
                for (const word of beforeWords) {
                    if (contextBefore.includes(word))
                        score += 2;
                }
                if (contextBefore.includes(beforeLower.slice(-30)))
                    score += 5;
            }
            if (after) {
                const contextAfter = result.slice(pos + anchorLen, pos + anchorLen + after.length + 20).toLowerCase();
                const afterLower = after.toLowerCase();
                const afterWords = afterLower.split(/\s+/).filter(w => w.length > 3);
                for (const word of afterWords) {
                    if (contextAfter.includes(word))
                        score += 2;
                }
                if (contextAfter.includes(afterLower.slice(0, 30)))
                    score += 5;
            }
            if (score > bestScore || (score === bestScore && pos < bestIdx)) {
                bestScore = score;
                bestIdx = pos;
            }
        }
        usedPositions.add(bestIdx);
        if (matchedAnchor) {
            return { ...c, pos: bestIdx, anchorText: matchedAnchor, anchorEnd: bestIdx + anchorLen };
        }
        else {
            return { ...c, pos: bestIdx, anchorText: null };
        }
    });
    // Log any unmatched comments for debugging
    const unmatched = commentsWithPositions.filter((c) => c.pos < 0);
    if (process.env.DEBUG) {
        console.log(`[DEBUG] insertComments: ${comments.length} input, ${commentsWithPositions.length} processed, ${unmatched.length} unmatched`);
        if (unmatched.length > 0) {
            unmatched.forEach(c => console.log(`[DEBUG]   Unmatched ID=${c.id}: anchor="${(c.anchorText || 'none').slice(0, 30)}"`));
        }
    }
    const matched = commentsWithPositions.filter((c) => c.pos >= 0);
    // Sort by position descending (insert from end to avoid offset issues)
    matched.sort((a, b) => b.pos - a.pos);
    // Insert each comment with anchor marking
    for (const c of matched) {
        const comment = `{>>${c.author}: ${c.text}<<}`;
        if (c.anchorText && c.anchorEnd) {
            // Replace anchor text with: {>>comment<<}[anchor]{.mark}
            const before = result.slice(0, c.pos);
            const anchor = result.slice(c.pos, c.anchorEnd);
            const after = result.slice(c.anchorEnd);
            result = before + comment + `[${anchor}]{.mark}` + after;
        }
        else {
            // No anchor - just insert comment at position
            result = result.slice(0, c.pos) + ` ${comment}` + result.slice(c.pos);
        }
    }
    // Log warnings unless quiet mode
    if (!quiet) {
        if (unmatchedCount > 0) {
            console.warn(`Warning: ${unmatchedCount} comment(s) could not be matched to anchor text`);
        }
        if (duplicateWarnings.length > 0) {
            console.warn(`Warning: Duplicate anchor text found (using context & tie-breaks for placement):`);
            for (const w of duplicateWarnings) {
                console.warn(`  - ${w}`);
            }
        }
    }
    return result;
}
/**
 * Import Word document with track changes directly as CriticMarkup
 */
export async function importWordWithTrackChanges(docxPath, options = {}) {
    const { mediaDir, projectDir } = options;
    const docxDir = path.dirname(docxPath);
    const targetMediaDir = mediaDir || path.join(docxDir, 'media');
    const targetProjectDir = projectDir || docxDir;
    const registry = readImageRegistry(targetProjectDir);
    const hasRegistry = registry && registry.figures && registry.figures.length > 0;
    // First pass: count images
    const { stdout: rawText } = await execAsync(`pandoc "${docxPath}" -t markdown --wrap=none --track-changes=all`, { maxBuffer: 50 * 1024 * 1024 });
    const wordImageCount = (rawText.match(/!\[[^\]]*\]\(media\/[^)]+\)/g) || []).length;
    const registryCount = hasRegistry ? registry.figures.length : 0;
    const needsMediaExtraction = wordImageCount > registryCount;
    if (hasRegistry) {
        console.log(`Registry has ${registryCount} figures, Word doc has ${wordImageCount} images`);
        if (needsMediaExtraction) {
            console.log(`Extracting media (${wordImageCount - registryCount} new image(s) detected)`);
        }
        else {
            console.log(`Using existing figures from registry`);
        }
    }
    // Extract from Word
    const extracted = await extractFromWord(docxPath, {
        mediaDir: targetMediaDir,
        skipMediaExtraction: !needsMediaExtraction,
    });
    let text = extracted.text;
    const extractedMedia = extracted.extractedMedia || [];
    const comments = extracted.comments || [];
    const anchors = extracted.anchors || new Map();
    // Log messages
    for (const msg of extracted.messages || []) {
        if (msg.type === 'info') {
            console.log(msg.message);
        }
        else if (msg.type === 'warning') {
            console.warn(`Warning: ${msg.message}`);
        }
    }
    // Restore crossref
    const crossrefResult = restoreCrossrefFromWord(text, targetProjectDir);
    text = crossrefResult.text;
    if (crossrefResult.restored > 0) {
        console.log(`Restored ${crossrefResult.restored} crossref reference(s)`);
    }
    // Restore images
    const imageRestoreResult = restoreImagesFromRegistry(text, targetProjectDir, crossrefResult.restoredLabels);
    text = imageRestoreResult.text;
    if (imageRestoreResult.restored > 0) {
        console.log(`Restored ${imageRestoreResult.restored} image(s) from registry`);
    }
    // Insert comments
    if (comments.length > 0) {
        text = insertCommentsIntoMarkdown(text, comments, anchors);
        console.log(`Inserted ${comments.length} comment(s)`);
    }
    // Clean up
    text = cleanupAnnotations(text);
    // Count final changes
    const insertions = (text.match(/\{\+\+/g) || []).length;
    const deletions = (text.match(/\{--/g) || []).length;
    const substitutions = (text.match(/\{~~/g) || []).length;
    const commentCount = (text.match(/\{>>/g) || []).length;
    return {
        text,
        stats: {
            insertions,
            deletions,
            substitutions,
            comments: commentCount,
            total: insertions + deletions + substitutions + commentCount,
            hasTrackChanges: extracted.hasTrackChanges,
            trackChangeStats: extracted.trackChangeStats,
        },
        extractedMedia,
        comments,
    };
}
/**
 * Legacy import function: Word doc → annotated MD via diff
 */
export async function importFromWord(docxPath, originalMdPath, options = {}) {
    const { author = 'Reviewer', sectionContent, figuresDir } = options;
    const projectDir = path.dirname(originalMdPath);
    let wordText;
    let extractedMedia = [];
    let wordTables = options.wordTables || [];
    let hasTrackChanges = false;
    if (sectionContent !== undefined) {
        let annotated = cleanupAnnotations(sectionContent);
        const insertions = (annotated.match(/\{\+\+/g) || []).length;
        const deletions = (annotated.match(/\{--/g) || []).length;
        const substitutions = (annotated.match(/\{~~/g) || []).length;
        const commentCount = (annotated.match(/\{>>/g) || []).length;
        return {
            annotated,
            stats: {
                insertions,
                deletions,
                substitutions,
                comments: commentCount,
                total: insertions + deletions + substitutions + commentCount,
            },
            extractedMedia: [],
        };
    }
    else {
        const docxDir = path.dirname(docxPath);
        const mediaDir = figuresDir || docxDir;
        const extracted = await extractFromWord(docxPath, { mediaDir });
        wordText = extracted.text;
        extractedMedia = extracted.extractedMedia || [];
        wordTables = extracted.tables || [];
        hasTrackChanges = extracted.hasTrackChanges || false;
        for (const msg of extracted.messages || []) {
            if (msg.type === 'info') {
                console.log(msg.message);
            }
            else if (msg.type === 'warning') {
                console.warn(`Warning: ${msg.message}`);
            }
        }
        if (hasTrackChanges) {
            const crossrefResult = restoreCrossrefFromWord(wordText, projectDir);
            wordText = crossrefResult.text;
            if (crossrefResult.restored > 0) {
                console.log(`Restored ${crossrefResult.restored} crossref reference(s)`);
            }
            const imageRestoreResult = restoreImagesFromRegistry(wordText, projectDir, crossrefResult.restoredLabels);
            wordText = imageRestoreResult.text;
            if (imageRestoreResult.restored > 0) {
                console.log(`Restored ${imageRestoreResult.restored} image(s) from registry`);
            }
            const comments = extracted.comments || [];
            const anchors = extracted.anchors || new Map();
            if (comments.length > 0) {
                wordText = insertCommentsIntoMarkdown(wordText, comments, anchors);
                console.log(`Inserted ${comments.length} comment(s)`);
            }
            wordText = cleanupAnnotations(wordText);
            const insertions = (wordText.match(/\{\+\+/g) || []).length;
            const deletions = (wordText.match(/\{--/g) || []).length;
            const substitutions = (wordText.match(/\{~~/g) || []).length;
            const commentCount = (wordText.match(/\{>>/g) || []).length;
            return {
                annotated: wordText,
                stats: {
                    insertions,
                    deletions,
                    substitutions,
                    comments: commentCount,
                    total: insertions + deletions + substitutions + commentCount,
                },
                extractedMedia,
            };
        }
        console.warn('Warning: No track changes detected in Word document.');
        console.warn('  For best results, reviewers should use Track Changes in Word.');
        console.warn('  Falling back to diff-based import (comparing against original MD).');
        console.warn('  This approach may produce less accurate change annotations.');
        const crossrefResult = restoreCrossrefFromWord(wordText, projectDir);
        wordText = crossrefResult.text;
        if (crossrefResult.restored > 0) {
            console.log(`Restored ${crossrefResult.restored} crossref reference(s)`);
        }
        const imageRestoreResult = restoreImagesFromRegistry(wordText, projectDir, crossrefResult.restoredLabels);
        wordText = imageRestoreResult.text;
        if (imageRestoreResult.restored > 0) {
            console.log(`Restored ${imageRestoreResult.restored} image(s) from registry`);
        }
    }
    // Read original markdown
    let originalMd = fs.readFileSync(originalMdPath, 'utf-8');
    // Strip existing annotations
    originalMd = stripAnnotations(originalMd, { keepComments: false });
    // Load image registry
    const imageRegistry = readImageRegistry(projectDir);
    // Generate diff
    let annotated = generateSmartDiff(originalMd, wordText, author, { wordTables, imageRegistry });
    // Clean up
    annotated = cleanupAnnotations(annotated);
    // Fix citation annotations
    annotated = fixCitationAnnotations(annotated, originalMd);
    // Convert visible comments
    annotated = convertVisibleComments(annotated);
    // Count changes
    const insertions = (annotated.match(/\{\+\+/g) || []).length;
    const deletions = (annotated.match(/\{--/g) || []).length;
    const substitutions = (annotated.match(/\{~~/g) || []).length;
    const comments = (annotated.match(/\{>>/g) || []).length;
    return {
        annotated,
        stats: {
            insertions,
            deletions,
            substitutions,
            comments,
            total: insertions + deletions + substitutions + comments,
        },
        extractedMedia,
    };
}
/**
 * Move extracted media files to a figures directory with better names
 */
export function moveExtractedMedia(mediaFiles, figuresDir, prefix = 'figure') {
    const moved = [];
    const errors = [];
    if (!fs.existsSync(figuresDir)) {
        fs.mkdirSync(figuresDir, { recursive: true });
    }
    for (let i = 0; i < mediaFiles.length; i++) {
        const src = mediaFiles[i];
        const ext = path.extname(src).toLowerCase();
        const newName = `${prefix}${i + 1}${ext}`;
        const dest = path.join(figuresDir, newName);
        try {
            fs.copyFileSync(src, dest);
            moved.push({ from: src, to: dest, name: newName });
        }
        catch (err) {
            errors.push(`Failed to copy ${src}: ${err.message}`);
        }
    }
    return { moved, errors };
}
//# sourceMappingURL=import.js.map