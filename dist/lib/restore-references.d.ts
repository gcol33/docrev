/**
 * Post-extraction reference restoration and comment parsing
 */
export interface RestoreCrossrefResult {
    text: string;
    restored: number;
    messages: string[];
    restoredLabels: Set<string>;
}
export interface RestoreImagesResult {
    text: string;
    restored: number;
    messages: string[];
}
/**
 * Parse visible comment markers from Word text
 */
export declare function parseVisibleComments(text: string): Array<{
    author: string;
    text: string;
    position: number;
}>;
/**
 * Convert visible comments to CriticMarkup format
 */
export declare function convertVisibleComments(text: string): string;
/**
 * Restore pandoc-crossref figure/table references from Word-rendered format
 */
export declare function restoreCrossrefFromWord(text: string, projectDir: string, restoredLabels?: Set<string> | null): RestoreCrossrefResult;
/**
 * Restore proper markdown image syntax from Word-extracted text using image registry
 */
export declare function restoreImagesFromRegistry(text: string, projectDir: string, restoredLabels?: Set<string> | null): RestoreImagesResult;
//# sourceMappingURL=restore-references.d.ts.map