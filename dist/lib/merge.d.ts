/**
 * Multi-reviewer merge utilities
 * Combine feedback from multiple Word documents with conflict detection
 *
 * Supports true three-way merge: base document + multiple reviewer versions
 */
import type { ReviewerChange, Conflict, MergeResult } from './types.js';
interface ReviewerDoc {
    path: string;
    name: string;
}
interface MergeOptions {
    diffLevel?: 'sentence' | 'word';
    autoResolve?: boolean;
}
interface CheckMatchResult {
    matches: boolean;
    similarity: number;
}
interface ConflictDetectionResult {
    conflicts: Conflict[];
    nonConflicting: ReviewerChange[];
}
interface ConflictsData {
    base: string;
    merged: string;
    conflicts: Conflict[];
}
/**
 * Initialize .rev directory for revision tracking
 * @param projectDir - Project directory path
 * @throws {TypeError} If projectDir is not a string
 */
export declare function initRevDir(projectDir: string): void;
/**
 * Store the base document for three-way merge
 * Overwrites any previous base document
 * @param projectDir - Project directory path
 * @param docxPath - Path to the built docx to store as base
 * @throws {TypeError} If arguments are not strings
 * @throws {Error} If docxPath does not exist
 */
export declare function storeBaseDocument(projectDir: string, docxPath: string): void;
/**
 * Get the base document path if it exists
 * @param projectDir - Project directory path
 * @returns Path to base document or null if not found
 * @throws {TypeError} If projectDir is not a string
 */
export declare function getBaseDocument(projectDir: string): string | null;
/**
 * Check if base document exists
 * @param projectDir - Project directory path
 * @returns True if base document exists
 * @throws {TypeError} If projectDir is not a string
 */
export declare function hasBaseDocument(projectDir: string): boolean;
/**
 * Compute text similarity between two strings using Jaccard-like coefficient
 * @param text1 - First text to compare
 * @param text2 - Second text to compare
 * @returns Similarity score 0-1 (0 = no similarity, 1 = identical)
 */
export declare function computeSimilarity(text1: string, text2: string): number;
/**
 * Check if base document matches reviewer document (similarity check)
 */
export declare function checkBaseMatch(basePath: string, reviewerPath: string): Promise<CheckMatchResult>;
/**
 * Extract changes from a Word document compared to original
 * Uses sentence-level diffing for better conflict detection
 * @param originalText - Original text (from base document)
 * @param wordText - Text extracted from reviewer's Word doc
 * @param reviewer - Reviewer identifier
 */
export declare function extractChanges(originalText: string, wordText: string, reviewer: string): ReviewerChange[];
/**
 * Extract changes using word-level diff (more fine-grained)
 */
export declare function extractChangesWordLevel(originalText: string, wordText: string, reviewer: string): ReviewerChange[];
/**
 * Detect conflicts between changes from multiple reviewers
 * @param allChanges - Array of change arrays, one per reviewer
 */
export declare function detectConflicts(allChanges: ReviewerChange[][]): ConflictDetectionResult;
/**
 * Apply non-conflicting changes to text
 * @param originalText
 * @param changes - Must be sorted by position
 */
export declare function applyChanges(originalText: string, changes: ReviewerChange[]): string;
/**
 * Apply changes as CriticMarkup annotations
 */
export declare function applyChangesAsAnnotations(originalText: string, changes: ReviewerChange[]): string;
/**
 * Apply changes as git-style conflict markers
 */
export declare function applyConflictMarkers(originalText: string, conflicts: Conflict[]): string;
/**
 * Format a conflict for display
 */
export declare function formatConflict(conflict: Conflict, originalText: string): string;
/**
 * Save conflicts to file for later resolution
 */
export declare function saveConflicts(projectDir: string, conflicts: Conflict[], baseDoc: string): void;
/**
 * Load conflicts from file
 */
export declare function loadConflicts(projectDir: string): ConflictsData | null;
/**
 * Clear conflicts file after resolution
 */
export declare function clearConflicts(projectDir: string): void;
/**
 * Merge multiple Word documents using three-way merge
 */
export declare function mergeThreeWay(basePath: string, reviewerDocs: ReviewerDoc[], options?: MergeOptions): Promise<MergeResult & {
    baseText: string;
}>;
/**
 * Merge multiple Word documents against an original markdown file
 * Legacy function - use mergeThreeWay for proper three-way merge
 */
export declare function mergeReviewerDocs(originalPath: string, reviewerDocs: ReviewerDoc[], options?: MergeOptions): Promise<MergeResult>;
/**
 * Resolve a conflict by choosing one option
 * @param conflict
 * @param choice - Index of chosen change (0-based)
 */
export declare function resolveConflict(conflict: Conflict, choice: number): ReviewerChange;
/**
 * Get list of unresolved conflicts
 */
export declare function getUnresolvedConflicts(projectDir: string): Conflict[];
export {};
//# sourceMappingURL=merge.d.ts.map