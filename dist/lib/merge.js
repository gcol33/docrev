/**
 * Multi-reviewer merge utilities
 * Combine feedback from multiple Word documents with conflict detection
 *
 * Supports true three-way merge: base document + multiple reviewer versions
 */
import * as fs from 'fs';
import * as path from 'path';
import { diffWords, diffSentences } from 'diff';
import { extractFromWord, extractWordComments } from './import.js';
// =============================================================================
// Constants
// =============================================================================
/** Directory for revision tracking data */
const REV_DIR = '.rev';
/** Path to base document for three-way merge */
const BASE_FILE = '.rev/base.docx';
/** Path to conflict resolution state */
const CONFLICTS_FILE = '.rev/conflicts.json';
/** Minimum word length for similarity calculations */
const MIN_WORD_LENGTH = 2;
/** Similarity threshold below which changes are considered conflicts */
const CONFLICT_SIMILARITY_THRESHOLD = 0.8;
/** Characters of context for change attribution */
const CHANGE_CONTEXT_SIZE = 50;
// =============================================================================
// Public API
// =============================================================================
/**
 * Initialize .rev directory for revision tracking
 * @param projectDir - Project directory path
 * @throws {TypeError} If projectDir is not a string
 */
export function initRevDir(projectDir) {
    if (typeof projectDir !== 'string') {
        throw new TypeError(`projectDir must be a string, got ${typeof projectDir}`);
    }
    const revDir = path.join(projectDir, REV_DIR);
    if (!fs.existsSync(revDir)) {
        fs.mkdirSync(revDir, { recursive: true });
    }
}
/**
 * Store the base document for three-way merge
 * Overwrites any previous base document
 * @param projectDir - Project directory path
 * @param docxPath - Path to the built docx to store as base
 * @throws {TypeError} If arguments are not strings
 * @throws {Error} If docxPath does not exist
 */
export function storeBaseDocument(projectDir, docxPath) {
    if (typeof projectDir !== 'string') {
        throw new TypeError(`projectDir must be a string, got ${typeof projectDir}`);
    }
    if (typeof docxPath !== 'string') {
        throw new TypeError(`docxPath must be a string, got ${typeof docxPath}`);
    }
    if (!fs.existsSync(docxPath)) {
        throw new Error(`Source document not found: ${docxPath}`);
    }
    initRevDir(projectDir);
    const basePath = path.join(projectDir, BASE_FILE);
    fs.copyFileSync(docxPath, basePath);
}
/**
 * Get the base document path if it exists
 * @param projectDir - Project directory path
 * @returns Path to base document or null if not found
 * @throws {TypeError} If projectDir is not a string
 */
export function getBaseDocument(projectDir) {
    if (typeof projectDir !== 'string') {
        throw new TypeError(`projectDir must be a string, got ${typeof projectDir}`);
    }
    const basePath = path.join(projectDir, BASE_FILE);
    if (fs.existsSync(basePath)) {
        return basePath;
    }
    return null;
}
/**
 * Check if base document exists
 * @param projectDir - Project directory path
 * @returns True if base document exists
 * @throws {TypeError} If projectDir is not a string
 */
export function hasBaseDocument(projectDir) {
    if (typeof projectDir !== 'string') {
        throw new TypeError(`projectDir must be a string, got ${typeof projectDir}`);
    }
    return fs.existsSync(path.join(projectDir, BASE_FILE));
}
/**
 * Compute text similarity between two strings using Jaccard-like coefficient
 * @param text1 - First text to compare
 * @param text2 - Second text to compare
 * @returns Similarity score 0-1 (0 = no similarity, 1 = identical)
 */
export function computeSimilarity(text1, text2) {
    if (typeof text1 !== 'string' || typeof text2 !== 'string') {
        return 0;
    }
    const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > MIN_WORD_LENGTH));
    const words2 = text2.toLowerCase().split(/\s+/).filter(w => w.length > MIN_WORD_LENGTH);
    if (words1.size === 0 || words2.length === 0)
        return 0;
    const common = words2.filter(w => words1.has(w)).length;
    return common / Math.max(words1.size, words2.length);
}
/**
 * Check if base document matches reviewer document (similarity check)
 */
export async function checkBaseMatch(basePath, reviewerPath) {
    try {
        const { text: baseText } = await extractFromWord(basePath);
        const { text: reviewerText } = await extractFromWord(reviewerPath);
        const similarity = computeSimilarity(baseText, reviewerText);
        return { matches: similarity > 0.5, similarity };
    }
    catch {
        return { matches: false, similarity: 0 };
    }
}
/**
 * Extract changes from diffs between original and modified text
 * @param diffs - Array of diff changes
 * @param reviewer - Reviewer identifier
 */
function extractChangesFromDiffs(diffs, reviewer) {
    const changes = [];
    let originalPos = 0;
    let i = 0;
    while (i < diffs.length) {
        const part = diffs[i];
        if (!part)
            break;
        if (!part.added && !part.removed) {
            originalPos += part.value.length;
            i++;
        }
        else if (part.removed && diffs[i + 1]?.added) {
            const nextPart = diffs[i + 1];
            if (!nextPart)
                break;
            changes.push({
                reviewer,
                type: 'replace',
                start: originalPos,
                end: originalPos + part.value.length,
                oldText: part.value,
                newText: nextPart.value,
            });
            originalPos += part.value.length;
            i += 2;
        }
        else if (part.removed) {
            changes.push({
                reviewer,
                type: 'delete',
                start: originalPos,
                end: originalPos + part.value.length,
                oldText: part.value,
                newText: '',
            });
            originalPos += part.value.length;
            i++;
        }
        else if (part.added) {
            changes.push({
                reviewer,
                type: 'insert',
                start: originalPos,
                end: originalPos,
                oldText: '',
                newText: part.value,
            });
            i++;
        }
    }
    return changes;
}
/**
 * Extract changes from a Word document compared to original
 * Uses sentence-level diffing for better conflict detection
 * @param originalText - Original text (from base document)
 * @param wordText - Text extracted from reviewer's Word doc
 * @param reviewer - Reviewer identifier
 */
export function extractChanges(originalText, wordText, reviewer) {
    return extractChangesFromDiffs(diffSentences(originalText, wordText), reviewer);
}
/**
 * Extract changes using word-level diff (more fine-grained)
 */
export function extractChangesWordLevel(originalText, wordText, reviewer) {
    return extractChangesFromDiffs(diffWords(originalText, wordText), reviewer);
}
/**
 * Check if two changes overlap
 */
function changesOverlap(a, b) {
    // Insertions at same point conflict
    if (a.type === 'insert' && b.type === 'insert' && a.start === b.start) {
        return a.newText !== b.newText; // Same insertion is not a conflict
    }
    // Check range overlap
    const aStart = a.start;
    const aEnd = a.type === 'insert' ? a.start : a.end;
    const bStart = b.start;
    const bEnd = b.type === 'insert' ? b.start : b.end;
    // Ranges overlap if neither ends before the other starts
    if (aEnd <= bStart || bEnd <= aStart) {
        return false;
    }
    // They overlap - but is it a conflict?
    // Same change from different reviewers is not a conflict
    if (a.type === b.type && a.oldText === b.oldText && a.newText === b.newText) {
        return false;
    }
    return true;
}
/**
 * Detect conflicts between changes from multiple reviewers
 * @param allChanges - Array of change arrays, one per reviewer
 */
export function detectConflicts(allChanges) {
    // Flatten and sort all changes by position
    const flat = allChanges.flat().sort((a, b) => a.start - b.start || a.end - b.end);
    const conflicts = [];
    const nonConflicting = [];
    const usedIndices = new Set();
    let conflictId = 0;
    for (let i = 0; i < flat.length; i++) {
        if (usedIndices.has(i))
            continue;
        const change = flat[i];
        if (!change)
            continue;
        const conflictingChanges = [change];
        // Find all changes that conflict with this one
        for (let j = i + 1; j < flat.length; j++) {
            if (usedIndices.has(j))
                continue;
            const other = flat[j];
            if (!other)
                continue;
            // Stop if we're past the range
            if (other.start > change.end && change.type !== 'insert')
                break;
            if (changesOverlap(change, other)) {
                conflictingChanges.push(other);
                usedIndices.add(j);
            }
        }
        if (conflictingChanges.length > 1) {
            // Multiple reviewers changed the same region
            const start = Math.min(...conflictingChanges.map(c => c?.start ?? 0).filter(s => s !== undefined));
            const end = Math.max(...conflictingChanges.map(c => c?.end ?? 0).filter(e => e !== undefined));
            const firstChange = conflictingChanges[0];
            conflicts.push({
                id: `c${++conflictId}`,
                start,
                end,
                original: firstChange?.oldText || '',
                changes: conflictingChanges.filter((c) => c !== undefined),
                resolved: null,
            });
            usedIndices.add(i);
        }
        else {
            // No conflict
            nonConflicting.push(change);
            usedIndices.add(i);
        }
    }
    // Deduplicate identical non-conflicting changes
    const seen = new Map();
    const dedupedNonConflicting = [];
    for (const change of nonConflicting) {
        const key = `${change.start}:${change.end}:${change.type}:${change.newText}`;
        if (!seen.has(key)) {
            seen.set(key, true);
            dedupedNonConflicting.push(change);
        }
    }
    return { conflicts, nonConflicting: dedupedNonConflicting };
}
/**
 * Apply non-conflicting changes to text
 * @param originalText
 * @param changes - Must be sorted by position
 */
export function applyChanges(originalText, changes) {
    // Sort by position descending to apply from end to start
    const sorted = [...changes].sort((a, b) => b.start - a.start);
    let result = originalText;
    for (const change of sorted) {
        if (change.type === 'insert') {
            result = result.slice(0, change.start) + change.newText + result.slice(change.start);
        }
        else if (change.type === 'delete') {
            result = result.slice(0, change.start) + result.slice(change.end);
        }
        else if (change.type === 'replace') {
            result = result.slice(0, change.start) + change.newText + result.slice(change.end);
        }
    }
    return result;
}
/**
 * Apply changes as CriticMarkup annotations
 */
export function applyChangesAsAnnotations(originalText, changes) {
    const sorted = [...changes].sort((a, b) => b.start - a.start);
    let result = originalText;
    for (const change of sorted) {
        if (change.type === 'insert') {
            const annotation = `{++${change.newText}++}`;
            result = result.slice(0, change.start) + annotation + result.slice(change.start);
        }
        else if (change.type === 'delete') {
            const annotation = `{--${change.oldText}--}`;
            result = result.slice(0, change.start) + annotation + result.slice(change.end);
        }
        else if (change.type === 'replace') {
            const annotation = `{~~${change.oldText}~>${change.newText}~~}`;
            result = result.slice(0, change.start) + annotation + result.slice(change.end);
        }
    }
    return result;
}
/**
 * Apply changes as git-style conflict markers
 */
export function applyConflictMarkers(originalText, conflicts) {
    // Sort by position descending
    const sorted = [...conflicts].sort((a, b) => b.start - a.start);
    let result = originalText;
    for (const conflict of sorted) {
        const markers = [];
        markers.push(`<<<<<<< CONFLICT ${conflict.id}`);
        for (const change of conflict.changes) {
            markers.push(`======= ${change.reviewer}`);
            if (change.type === 'delete') {
                markers.push(`[DELETED: "${change.oldText}"]`);
            }
            else if (change.type === 'insert') {
                markers.push(change.newText);
            }
            else {
                markers.push(change.newText);
            }
        }
        markers.push(`>>>>>>> END ${conflict.id}`);
        const markerText = markers.join('\n');
        result = result.slice(0, conflict.start) + markerText + result.slice(conflict.end);
    }
    return result;
}
/**
 * Format a conflict for display
 */
export function formatConflict(conflict, originalText) {
    const lines = [];
    const context = 50;
    // Show context
    const beforeStart = Math.max(0, conflict.start - context);
    const afterEnd = Math.min(originalText.length, conflict.end + context);
    const before = originalText.slice(beforeStart, conflict.start).trim();
    const original = originalText.slice(conflict.start, conflict.end);
    const after = originalText.slice(conflict.end, afterEnd).trim();
    if (before) {
        lines.push(`  ...${before}`);
    }
    lines.push(`  [ORIGINAL]: "${original || '(insertion point)'}"`);
    if (after) {
        lines.push(`  ${after}...`);
    }
    lines.push('');
    lines.push('  Options:');
    conflict.changes.forEach((change, i) => {
        const label = change.type === 'insert'
            ? `Insert: "${change.newText.slice(0, 60)}${change.newText.length > 60 ? '...' : ''}"`
            : change.type === 'delete'
                ? `Delete: "${change.oldText.slice(0, 60)}${change.oldText.length > 60 ? '...' : ''}"`
                : `Replace → "${change.newText.slice(0, 60)}${change.newText.length > 60 ? '...' : ''}"`;
        lines.push(`    ${i + 1}. [${change.reviewer}] ${label}`);
    });
    return lines.join('\n');
}
/**
 * Save conflicts to file for later resolution
 */
export function saveConflicts(projectDir, conflicts, baseDoc) {
    const conflictsPath = path.join(projectDir, CONFLICTS_FILE);
    const data = {
        base: baseDoc,
        merged: new Date().toISOString(),
        conflicts,
    };
    // Ensure directory exists
    const dir = path.dirname(conflictsPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(conflictsPath, JSON.stringify(data, null, 2));
}
/**
 * Load conflicts from file
 */
export function loadConflicts(projectDir) {
    const conflictsPath = path.join(projectDir, CONFLICTS_FILE);
    if (!fs.existsSync(conflictsPath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(conflictsPath, 'utf-8'));
}
/**
 * Clear conflicts file after resolution
 */
export function clearConflicts(projectDir) {
    const conflictsPath = path.join(projectDir, CONFLICTS_FILE);
    if (fs.existsSync(conflictsPath)) {
        fs.unlinkSync(conflictsPath);
    }
}
/**
 * Core merge logic: extract changes from reviewer docs, detect conflicts, apply annotations
 */
async function mergeReviewerDocsCore(baseText, reviewerDocs, options = {}) {
    const { diffLevel = 'sentence' } = options;
    const allChanges = [];
    const allComments = [];
    for (const doc of reviewerDocs) {
        if (!fs.existsSync(doc.path)) {
            throw new Error(`Reviewer file not found: ${doc.path}`);
        }
        const { text: wordText } = await extractFromWord(doc.path);
        const changes = diffLevel === 'word'
            ? extractChangesWordLevel(baseText, wordText, doc.name)
            : extractChanges(baseText, wordText, doc.name);
        allChanges.push(changes);
        try {
            const comments = await extractWordComments(doc.path);
            allComments.push(...comments.map(c => ({ ...c, reviewer: doc.name })));
        }
        catch (e) {
            if (process.env.DEBUG) {
                const error = e;
                console.warn(`merge: Failed to extract comments:`, error.message);
            }
        }
    }
    const { conflicts, nonConflicting } = detectConflicts(allChanges);
    let merged = applyChangesAsAnnotations(baseText, nonConflicting);
    for (const comment of allComments) {
        merged += `\n{>>${comment.reviewer}: ${comment.text}<<}`;
    }
    const stats = {
        reviewers: reviewerDocs.length,
        totalChanges: allChanges.flat().length,
        nonConflicting: nonConflicting.length,
        conflicts: conflicts.length,
        comments: allComments.length,
    };
    return { merged, conflicts, stats, originalText: baseText };
}
/**
 * Merge multiple Word documents using three-way merge
 */
export async function mergeThreeWay(basePath, reviewerDocs, options = {}) {
    if (!fs.existsSync(basePath)) {
        throw new Error(`Base document not found: ${basePath}`);
    }
    const { text: baseText } = await extractFromWord(basePath);
    const result = await mergeReviewerDocsCore(baseText, reviewerDocs, options);
    return { ...result, baseText };
}
/**
 * Merge multiple Word documents against an original markdown file
 * Legacy function - use mergeThreeWay for proper three-way merge
 */
export async function mergeReviewerDocs(originalPath, reviewerDocs, options = {}) {
    if (!fs.existsSync(originalPath)) {
        throw new Error(`Original file not found: ${originalPath}`);
    }
    const originalText = fs.readFileSync(originalPath, 'utf-8');
    return mergeReviewerDocsCore(originalText, reviewerDocs, options);
}
/**
 * Resolve a conflict by choosing one option
 * @param conflict
 * @param choice - Index of chosen change (0-based)
 */
export function resolveConflict(conflict, choice) {
    if (choice < 0 || choice >= conflict.changes.length) {
        throw new Error(`Invalid choice: ${choice}. Must be 0-${conflict.changes.length - 1}`);
    }
    const selectedChange = conflict.changes[choice];
    if (!selectedChange) {
        throw new Error(`Invalid choice: ${choice}. Change not found`);
    }
    conflict.resolved = selectedChange.reviewer;
    return selectedChange;
}
/**
 * Get list of unresolved conflicts
 */
export function getUnresolvedConflicts(projectDir) {
    const data = loadConflicts(projectDir);
    if (!data)
        return [];
    return data.conflicts.filter(c => c.resolved === null);
}
//# sourceMappingURL=merge.js.map