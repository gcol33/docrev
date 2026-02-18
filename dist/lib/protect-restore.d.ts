/**
 * Protection and restoration utilities for markdown elements during Word import
 *
 * These functions protect special markdown syntax (anchors, cross-refs, math, citations,
 * images, tables) by replacing them with placeholders before diffing, then restore them after.
 */
interface MarkdownPrefix {
    prefix: string;
    content: string;
}
interface ProtectedItem {
    original: string;
    placeholder: string;
}
interface ProtectedMath extends ProtectedItem {
    type: 'inline' | 'display';
    simplified: string;
}
interface ProtectedImage extends ProtectedItem {
    label: string | null;
    caption: string;
    path: string;
    figureNumber: string | null;
}
interface ProtectedTable extends ProtectedItem {
    cellCount: number;
}
interface ProtectAnchorsResult {
    text: string;
    anchors: ProtectedItem[];
}
interface ProtectCrossrefsResult {
    text: string;
    crossrefs: ProtectedItem[];
}
interface ProtectMathResult {
    text: string;
    mathBlocks: ProtectedMath[];
}
interface ProtectCitationsResult {
    text: string;
    citations: string[];
}
interface ProtectImagesResult {
    text: string;
    images: ProtectedImage[];
}
interface ProtectTablesResult {
    text: string;
    tables: ProtectedTable[];
}
interface ImageRegistry {
    byNumber?: Map<string, {
        label: string;
    }>;
}
/**
 * Extract markdown prefix (headers, list markers) from a line
 */
export declare function extractMarkdownPrefix(line: string): MarkdownPrefix;
/**
 * Protect figure/table anchors before diffing
 * Anchors like {#fig:heatmap} and {#tbl:results} should never be deleted
 */
export declare function protectAnchors(md: string): ProtectAnchorsResult;
/**
 * Restore anchors from placeholders
 */
export declare function restoreAnchors(text: string, anchors: ProtectedItem[]): string;
/**
 * Protect cross-references before diffing
 * References like @fig:label, @tbl:label should be preserved
 */
export declare function protectCrossrefs(md: string): ProtectCrossrefsResult;
/**
 * Restore cross-references from placeholders
 */
export declare function restoreCrossrefs(text: string, crossrefs: ProtectedItem[]): string;
/**
 * Simplify LaTeX math for fuzzy matching against Word text
 * Word renders math as text, so we need to match the rendered form
 */
export declare function simplifyMathForMatching(latex: string): string;
/**
 * Protect mathematical notation before diffing by replacing with placeholders
 * Handles both inline $...$ and display $$...$$ math
 */
export declare function protectMath(md: string): ProtectMathResult;
/**
 * Restore math from placeholders
 */
export declare function restoreMath(text: string, mathBlocks: ProtectedMath[]): string;
/**
 * Replace rendered math in Word text with matching placeholders
 * This is heuristic-based since Word can render math in various ways
 */
export declare function replaceRenderedMath(wordText: string, mathBlocks: ProtectedMath[]): string;
/**
 * Protect citations before diffing by replacing with placeholders
 */
export declare function protectCitations(md: string): ProtectCitationsResult;
/**
 * Restore citations from placeholders
 */
export declare function restoreCitations(text: string, citations: string[]): string;
/**
 * Remove rendered citations from Word text (replace with matching placeholders)
 */
export declare function replaceRenderedCitations(wordText: string, count: number): string;
/**
 * Protect markdown images before diffing by replacing with placeholders
 * Images are treated as atomic blocks to prevent corruption during diff
 *
 * Matches: ![caption](path){#fig:label} or ![caption](path)
 * Also matches Word-style: ![Figure N: caption](media/path)
 */
export declare function protectImages(md: string, registry?: ImageRegistry | null): ProtectImagesResult;
/**
 * Restore images from placeholders
 */
export declare function restoreImages(text: string, images: ProtectedImage[]): string;
/**
 * Match Word-extracted images to original images using registry
 * Returns a mapping of Word image placeholders to original image placeholders
 */
export declare function matchWordImagesToOriginal(originalImages: ProtectedImage[], wordImages: ProtectedImage[], registry?: ImageRegistry | null): Map<string, string>;
/**
 * Protect markdown tables before diffing by replacing with placeholders
 * Tables are treated as atomic blocks to prevent corruption during diff
 */
export declare function protectTables(md: string): ProtectTablesResult;
/**
 * Restore tables from placeholders
 */
export declare function restoreTables(text: string, tables: ProtectedTable[]): string;
export {};
//# sourceMappingURL=protect-restore.d.ts.map