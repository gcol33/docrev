/**
 * CriticMarkup annotation parsing and manipulation
 *
 * Syntax:
 *   {++inserted text++}     - Insertions
 *   {--deleted text--}      - Deletions
 *   {~~old~>new~~}          - Substitutions
 *   {>>Author: comment<<}   - Comments
 *   {==text==}              - Highlights
 */
import type { Annotation, AnnotationCounts, StripOptions, CommentFilterOptions } from './types.js';
/**
 * Parse all annotations from text
 * @param text - Markdown text containing CriticMarkup annotations
 * @returns Array of parsed annotations sorted by position
 * @throws TypeError If text is not a string
 */
export declare function parseAnnotations(text: string): Annotation[];
/**
 * Strip annotations from text, applying changes
 * Handles nested annotations by iterating until stable
 * @param text - Markdown text with CriticMarkup annotations
 * @param options - Strip options
 * @returns Clean text with annotations applied/removed
 * @throws TypeError If text is not a string
 */
export declare function stripAnnotations(text: string, options?: StripOptions): string;
/**
 * Collapse multiple spaces to single space, preserving table formatting
 * Useful for cleaning up messy Word imports
 * @param text - Text to normalize
 * @returns Text with multiple spaces collapsed to single spaces
 * @throws TypeError If text is not a string
 */
export declare function stripToSingleSpace(text: string): string;
/**
 * Check if text contains any CriticMarkup annotations
 * @param text - Text to check
 * @returns True if text contains any annotations
 * @throws TypeError If text is not a string
 */
export declare function hasAnnotations(text: string): boolean;
/**
 * Apply a decision to a single annotation (accept or reject)
 * @param text - Document text containing the annotation
 * @param annotation - Annotation object from parseAnnotations()
 * @param accept - True to accept the change, false to reject
 * @returns Updated text with the decision applied
 * @throws TypeError If text is not a string or annotation is invalid
 */
export declare function applyDecision(text: string, annotation: Annotation, accept: boolean): string;
/**
 * Get track changes only (no comments)
 * @param text - Markdown text with CriticMarkup annotations
 * @returns Array of insert/delete/substitute annotations
 * @throws TypeError If text is not a string
 */
export declare function getTrackChanges(text: string): Annotation[];
/**
 * Get comments only
 * @param text - Markdown text with CriticMarkup annotations
 * @param options - Filter options
 * @returns Array of comment annotations
 * @throws TypeError If text is not a string
 */
export declare function getComments(text: string, options?: CommentFilterOptions): Annotation[];
/**
 * Mark a comment as resolved or pending
 * @param text - Document text containing the comment
 * @param comment - Comment annotation object from getComments()
 * @param resolved - True to mark resolved, false to mark pending
 * @returns Updated text with status marker applied
 * @throws TypeError If text is not a string or comment is invalid
 */
export declare function setCommentStatus(text: string, comment: Annotation, resolved: boolean): string;
/**
 * Count annotations by type
 * @param text - Markdown text with CriticMarkup annotations
 * @returns Counts by annotation type
 * @throws TypeError If text is not a string
 */
export declare function countAnnotations(text: string): AnnotationCounts;
/**
 * Clean up orphaned/malformed CriticMarkup markers
 * This can happen when track changes span across comment boundaries
 * @param text - Document text with potentially malformed markers
 * @returns Cleaned text with orphaned markers removed
 * @throws TypeError If text is not a string
 */
export declare function cleanupOrphanedMarkers(text: string): string;
//# sourceMappingURL=annotations.d.ts.map