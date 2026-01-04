/**
 * Multi-reviewer merge utilities
 * Combine feedback from multiple Word documents with conflict detection
 *
 * Supports true three-way merge: base document + multiple reviewer versions
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { diffWords, diffSentences } from 'diff';
import { extractFromWord, extractWordComments } from './import.js';

// Single base document for three-way merge
const REV_DIR = '.rev';
const BASE_FILE = '.rev/base.docx';
const CONFLICTS_FILE = '.rev/conflicts.json';

/**
 * Represents a change from a reviewer
 * @typedef {Object} ReviewerChange
 * @property {string} reviewer - Reviewer name/identifier
 * @property {string} type - 'insert' | 'delete' | 'replace'
 * @property {number} start - Start position in original text
 * @property {number} end - End position in original text
 * @property {string} oldText - Original text (for delete/replace)
 * @property {string} newText - New text (for insert/replace)
 * @property {string} [date] - Date of change (from Word track changes)
 */

/**
 * Represents a conflict between reviewers
 * @typedef {Object} Conflict
 * @property {string} id - Unique conflict ID
 * @property {number} start - Start position in original
 * @property {number} end - End position in original
 * @property {string} original - Original text
 * @property {ReviewerChange[]} changes - Conflicting changes from different reviewers
 * @property {string} [section] - Section file this conflict belongs to
 * @property {number} [line] - Line number in section
 * @property {string|null} resolved - Resolution choice or null if unresolved
 */

/**
 * Initialize .rev directory
 * @param {string} projectDir
 */
export function initRevDir(projectDir) {
  const revDir = path.join(projectDir, REV_DIR);
  if (!fs.existsSync(revDir)) {
    fs.mkdirSync(revDir, { recursive: true });
  }
}

/**
 * Store the base document for three-way merge
 * Overwrites any previous base document
 * @param {string} projectDir
 * @param {string} docxPath - Path to the built docx
 */
export function storeBaseDocument(projectDir, docxPath) {
  initRevDir(projectDir);
  const basePath = path.join(projectDir, BASE_FILE);
  fs.copyFileSync(docxPath, basePath);
}

/**
 * Get the base document path if it exists
 * @param {string} projectDir
 * @returns {string|null}
 */
export function getBaseDocument(projectDir) {
  const basePath = path.join(projectDir, BASE_FILE);
  if (fs.existsSync(basePath)) {
    return basePath;
  }
  return null;
}

/**
 * Check if base document exists
 * @param {string} projectDir
 * @returns {boolean}
 */
export function hasBaseDocument(projectDir) {
  return fs.existsSync(path.join(projectDir, BASE_FILE));
}

/**
 * Compute text similarity between two strings
 * @param {string} text1
 * @param {string} text2
 * @returns {number} Similarity score 0-1
 */
export function computeSimilarity(text1, text2) {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const words2 = text2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (words1.size === 0 || words2.length === 0) return 0;
  const common = words2.filter(w => words1.has(w)).length;
  return common / Math.max(words1.size, words2.length);
}

/**
 * Check if base document matches reviewer document (similarity check)
 * @param {string} basePath
 * @param {string} reviewerPath
 * @returns {Promise<{matches: boolean, similarity: number}>}
 */
export async function checkBaseMatch(basePath, reviewerPath) {
  try {
    const { text: baseText } = await extractFromWord(basePath);
    const { text: reviewerText } = await extractFromWord(reviewerPath);
    const similarity = computeSimilarity(baseText, reviewerText);
    return { matches: similarity > 0.5, similarity };
  } catch {
    return { matches: false, similarity: 0 };
  }
}

/**
 * Extract changes from a Word document compared to original
 * Uses sentence-level diffing for better conflict detection
 * @param {string} originalText - Original text (from base document)
 * @param {string} wordText - Text extracted from reviewer's Word doc
 * @param {string} reviewer - Reviewer identifier
 * @returns {ReviewerChange[]}
 */
export function extractChanges(originalText, wordText, reviewer) {
  const changes = [];

  // Use sentence-level diff for better granularity
  const diffs = diffSentences(originalText, wordText);

  let originalPos = 0;
  let i = 0;

  while (i < diffs.length) {
    const part = diffs[i];

    if (!part.added && !part.removed) {
      // Unchanged
      originalPos += part.value.length;
      i++;
    } else if (part.removed && diffs[i + 1]?.added) {
      // Replacement: removed followed by added
      changes.push({
        reviewer,
        type: 'replace',
        start: originalPos,
        end: originalPos + part.value.length,
        oldText: part.value,
        newText: diffs[i + 1].value,
      });
      originalPos += part.value.length;
      i += 2;
    } else if (part.removed) {
      // Pure deletion
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
    } else if (part.added) {
      // Pure insertion
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
 * Extract changes using word-level diff (more fine-grained)
 * @param {string} originalText
 * @param {string} wordText
 * @param {string} reviewer
 * @returns {ReviewerChange[]}
 */
export function extractChangesWordLevel(originalText, wordText, reviewer) {
  const changes = [];
  const diffs = diffWords(originalText, wordText);

  let originalPos = 0;
  let i = 0;

  while (i < diffs.length) {
    const part = diffs[i];

    if (!part.added && !part.removed) {
      originalPos += part.value.length;
      i++;
    } else if (part.removed && diffs[i + 1]?.added) {
      changes.push({
        reviewer,
        type: 'replace',
        start: originalPos,
        end: originalPos + part.value.length,
        oldText: part.value,
        newText: diffs[i + 1].value,
      });
      originalPos += part.value.length;
      i += 2;
    } else if (part.removed) {
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
    } else if (part.added) {
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
 * Check if two changes overlap
 * @param {ReviewerChange} a
 * @param {ReviewerChange} b
 * @returns {boolean}
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
 * @param {ReviewerChange[][]} allChanges - Array of change arrays, one per reviewer
 * @returns {{conflicts: Conflict[], nonConflicting: ReviewerChange[]}}
 */
export function detectConflicts(allChanges) {
  // Flatten and sort all changes by position
  const flat = allChanges.flat().sort((a, b) => a.start - b.start || a.end - b.end);

  const conflicts = [];
  const nonConflicting = [];
  const usedIndices = new Set();
  let conflictId = 0;

  for (let i = 0; i < flat.length; i++) {
    if (usedIndices.has(i)) continue;

    const change = flat[i];
    const conflictingChanges = [change];

    // Find all changes that conflict with this one
    for (let j = i + 1; j < flat.length; j++) {
      if (usedIndices.has(j)) continue;

      const other = flat[j];

      // Stop if we're past the range
      if (other.start > change.end && change.type !== 'insert') break;

      if (changesOverlap(change, other)) {
        conflictingChanges.push(other);
        usedIndices.add(j);
      }
    }

    if (conflictingChanges.length > 1) {
      // Multiple reviewers changed the same region
      const start = Math.min(...conflictingChanges.map(c => c.start));
      const end = Math.max(...conflictingChanges.map(c => c.end));

      conflicts.push({
        id: `c${++conflictId}`,
        start,
        end,
        original: conflictingChanges[0].oldText || '',
        changes: conflictingChanges,
        resolved: null,
      });
      usedIndices.add(i);
    } else {
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
 * @param {string} originalText
 * @param {ReviewerChange[]} changes - Must be sorted by position
 * @returns {string}
 */
export function applyChanges(originalText, changes) {
  // Sort by position descending to apply from end to start
  const sorted = [...changes].sort((a, b) => b.start - a.start);

  let result = originalText;

  for (const change of sorted) {
    if (change.type === 'insert') {
      result = result.slice(0, change.start) + change.newText + result.slice(change.start);
    } else if (change.type === 'delete') {
      result = result.slice(0, change.start) + result.slice(change.end);
    } else if (change.type === 'replace') {
      result = result.slice(0, change.start) + change.newText + result.slice(change.end);
    }
  }

  return result;
}

/**
 * Apply changes as CriticMarkup annotations
 * @param {string} originalText
 * @param {ReviewerChange[]} changes
 * @returns {string}
 */
export function applyChangesAsAnnotations(originalText, changes) {
  const sorted = [...changes].sort((a, b) => b.start - a.start);

  let result = originalText;

  for (const change of sorted) {
    if (change.type === 'insert') {
      const annotation = `{++${change.newText}++}`;
      result = result.slice(0, change.start) + annotation + result.slice(change.start);
    } else if (change.type === 'delete') {
      const annotation = `{--${change.oldText}--}`;
      result = result.slice(0, change.start) + annotation + result.slice(change.end);
    } else if (change.type === 'replace') {
      const annotation = `{~~${change.oldText}~>${change.newText}~~}`;
      result = result.slice(0, change.start) + annotation + result.slice(change.end);
    }
  }

  return result;
}

/**
 * Apply changes as git-style conflict markers
 * @param {string} originalText
 * @param {Conflict[]} conflicts
 * @returns {string}
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
      } else if (change.type === 'insert') {
        markers.push(change.newText);
      } else {
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
 * @param {Conflict} conflict
 * @param {string} originalText
 * @returns {string}
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
 * @param {string} projectDir
 * @param {Conflict[]} conflicts
 * @param {string} baseDoc - Base document path
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
 * @param {string} projectDir
 * @returns {{base: string, merged: string, conflicts: Conflict[]}|null}
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
 * @param {string} projectDir
 */
export function clearConflicts(projectDir) {
  const conflictsPath = path.join(projectDir, CONFLICTS_FILE);
  if (fs.existsSync(conflictsPath)) {
    fs.unlinkSync(conflictsPath);
  }
}

/**
 * Merge multiple Word documents using three-way merge
 * @param {string} basePath - Path to base document (original sent to reviewers)
 * @param {Array<{path: string, name: string}>} reviewerDocs - Reviewer Word docs
 * @param {Object} options
 * @returns {Promise<{merged: string, conflicts: Conflict[], stats: Object, baseText: string}>}
 */
export async function mergeThreeWay(basePath, reviewerDocs, options = {}) {
  const { diffLevel = 'sentence' } = options;

  if (!fs.existsSync(basePath)) {
    throw new Error(`Base document not found: ${basePath}`);
  }

  // Extract text from base document
  const { text: baseText } = await extractFromWord(basePath);

  // Extract changes from each reviewer relative to base
  const allChanges = [];
  const allComments = [];

  for (const doc of reviewerDocs) {
    if (!fs.existsSync(doc.path)) {
      throw new Error(`Reviewer file not found: ${doc.path}`);
    }

    const { text: wordText } = await extractFromWord(doc.path);

    // Choose diff level
    const changes = diffLevel === 'word'
      ? extractChangesWordLevel(baseText, wordText, doc.name)
      : extractChanges(baseText, wordText, doc.name);

    allChanges.push(changes);

    // Also extract comments
    try {
      const comments = await extractWordComments(doc.path);
      allComments.push(...comments.map(c => ({ ...c, reviewer: doc.name })));
    } catch {
      // Comments extraction failed, continue without
    }
  }

  // Detect conflicts
  const { conflicts, nonConflicting } = detectConflicts(allChanges);

  // Apply non-conflicting changes as annotations
  let merged = applyChangesAsAnnotations(baseText, nonConflicting);

  // Add comments with reviewer attribution
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

  return { merged, conflicts, stats, baseText };
}

/**
 * Merge multiple Word documents against an original markdown file
 * Legacy function - use mergeThreeWay for proper three-way merge
 * @param {string} originalPath - Path to original markdown
 * @param {Array<{path: string, name: string}>} reviewerDocs - Reviewer Word docs
 * @param {Object} options
 * @returns {Promise<{merged: string, conflicts: Conflict[], stats: Object}>}
 */
export async function mergeReviewerDocs(originalPath, reviewerDocs, options = {}) {
  const { autoResolve = false } = options;

  if (!fs.existsSync(originalPath)) {
    throw new Error(`Original file not found: ${originalPath}`);
  }

  const originalText = fs.readFileSync(originalPath, 'utf-8');

  // Extract changes from each reviewer
  const allChanges = [];
  const allComments = [];

  for (const doc of reviewerDocs) {
    if (!fs.existsSync(doc.path)) {
      throw new Error(`Reviewer file not found: ${doc.path}`);
    }

    const { text: wordText } = await extractFromWord(doc.path);
    const changes = extractChanges(originalText, wordText, doc.name);
    allChanges.push(changes);

    // Also extract comments
    try {
      const comments = await extractWordComments(doc.path);
      allComments.push(...comments.map(c => ({ ...c, reviewer: doc.name })));
    } catch {
      // Comments extraction failed, continue without
    }
  }

  // Detect conflicts
  const { conflicts, nonConflicting } = detectConflicts(allChanges);

  // Apply non-conflicting changes as annotations
  let merged = applyChangesAsAnnotations(originalText, nonConflicting);

  // Add comments
  for (const comment of allComments) {
    // Append comments at the end for now (position tracking is complex)
    merged += `\n{>>${comment.reviewer}: ${comment.text}<<}`;
  }

  const stats = {
    reviewers: reviewerDocs.length,
    totalChanges: allChanges.flat().length,
    nonConflicting: nonConflicting.length,
    conflicts: conflicts.length,
    comments: allComments.length,
  };

  return { merged, conflicts, stats, originalText };
}

/**
 * Resolve a conflict by choosing one option
 * @param {Conflict} conflict
 * @param {number} choice - Index of chosen change (0-based)
 * @returns {ReviewerChange}
 */
export function resolveConflict(conflict, choice) {
  if (choice < 0 || choice >= conflict.changes.length) {
    throw new Error(`Invalid choice: ${choice}. Must be 0-${conflict.changes.length - 1}`);
  }
  conflict.resolved = conflict.changes[choice].reviewer;
  return conflict.changes[choice];
}

/**
 * Get list of unresolved conflicts
 * @param {string} projectDir
 * @returns {Conflict[]}
 */
export function getUnresolvedConflicts(projectDir) {
  const data = loadConflicts(projectDir);
  if (!data) return [];
  return data.conflicts.filter(c => c.resolved === null);
}

