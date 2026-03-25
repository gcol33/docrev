/**
 * Diff engine - diffing and annotation processing for Word→Markdown import
 */
import type { WordTable } from './word-extraction.js';
export interface GenerateSmartDiffOptions {
    wordTables?: WordTable[];
    imageRegistry?: any;
}
/**
 * Fix citation and math annotations by preserving original markdown syntax
 */
export declare function fixCitationAnnotations(text: string, originalMd: string): string;
/**
 * Generate annotated markdown by diffing original MD against Word text
 */
export declare function generateAnnotatedDiff(originalMd: string, wordText: string, author?: string): string;
/**
 * Smart paragraph-level diff that preserves markdown structure
 */
export declare function generateSmartDiff(originalMd: string, wordText: string, author?: string, options?: GenerateSmartDiffOptions): string;
/**
 * Clean up redundant adjacent annotations
 */
export declare function cleanupAnnotations(text: string): string;
//# sourceMappingURL=diff-engine.d.ts.map