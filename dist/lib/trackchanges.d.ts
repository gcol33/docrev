/**
 * Track changes module - Apply markdown annotations as Word track changes
 *
 * Converts CriticMarkup annotations to Word OOXML track changes format.
 */
import type { TrackChangeMarker } from './types.js';
interface PrepareOptions {
    author?: string;
}
interface PrepareResult {
    text: string;
    markers: TrackChangeMarker[];
}
interface ApplyResult {
    success: boolean;
    message: string;
}
/**
 * Prepare text with CriticMarkup annotations for track changes
 * Replaces annotations with markers that can be processed in DOCX
 *
 * @param text - Text with CriticMarkup annotations
 * @param options - Options
 * @returns Processed text and marker info
 */
export declare function prepareForTrackChanges(text: string, options?: PrepareOptions): PrepareResult;
/**
 * Apply track changes markers to a Word document
 *
 * @param docxPath - Path to input DOCX file
 * @param markers - Markers from prepareForTrackChanges
 * @param outputPath - Path for output DOCX file
 * @returns Result with success status and message
 */
export declare function applyTrackChangesToDocx(docxPath: string, markers: TrackChangeMarker[], outputPath: string): Promise<ApplyResult>;
/**
 * Build a Word document with track changes from annotated markdown
 *
 * @param mdPath - Path to markdown file with CriticMarkup
 * @param docxPath - Output path for Word document
 * @param options - Options
 * @returns Result with success status and message
 */
export declare function buildWithTrackChanges(mdPath: string, docxPath: string, options?: PrepareOptions): Promise<ApplyResult>;
export {};
//# sourceMappingURL=trackchanges.d.ts.map