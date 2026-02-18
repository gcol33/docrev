/**
 * Word document extraction utilities
 * Handle reading text, comments, and anchors from .docx files
 */
import type { WordComment, CommentAnchor, WordMetadata, TrackChangesResult } from './types.js';
/**
 * Extract comments from Word document's comments.xml
 * @param docxPath - Path to .docx file
 * @returns Array of extracted comments
 * @throws {TypeError} If docxPath is not a string
 * @throws {Error} If file not found or invalid docx
 */
export declare function extractWordComments(docxPath: string): Promise<WordComment[]>;
/**
 * Extract comment anchors (where comments are attached) from document.xml
 * Returns mapping of comment ID to the text they're anchored to
 * @param docxPath - Path to .docx file
 * @returns Map of comment ID to anchor info
 * @throws {TypeError} If docxPath is not a string
 * @throws {Error} If invalid docx structure
 */
export declare function extractCommentAnchors(docxPath: string): Promise<Map<string, CommentAnchor>>;
/**
 * Extract plain text from Word document (strips track change markup)
 * @param docxPath - Path to .docx file
 * @returns Extracted plain text (accepted changes applied)
 * @throws {TypeError} If docxPath is not a string
 * @throws {Error} If file not found
 */
export declare function extractTextFromWord(docxPath: string): Promise<string>;
/**
 * Get document metadata from Word file
 * @param docxPath - Path to .docx file
 * @returns Document metadata
 * @throws {TypeError} If docxPath is not a string
 */
export declare function getWordMetadata(docxPath: string): Promise<WordMetadata>;
/**
 * Check if file is a valid Word document
 * @param filePath - Path to file to check
 * @returns True if valid .docx file
 */
export declare function isWordDocument(filePath: string): boolean;
/**
 * Extract track changes (insertions and deletions) from Word document
 * Converts Word's w:ins and w:del elements to CriticMarkup format
 *
 * @param docxPath - Path to Word document
 * @returns Track changes result with content and stats
 */
export declare function extractTrackChanges(docxPath: string): Promise<TrackChangesResult>;
/**
 * Extract plain text from Word XML with track changes preserved as CriticMarkup.
 * This is a pandoc-free fallback that reads document.xml directly.
 *
 * Converts:
 *   <w:ins> content </w:ins>  →  {++text++}
 *   <w:del> content </w:del>  →  {--text--}
 *
 * Also detects headings (w:pStyle Heading1-6) and outputs markdown # syntax.
 *
 * @param docxPath - Path to Word document
 * @returns Plain text with CriticMarkup and stats
 */
export declare function extractPlainTextWithTrackChanges(docxPath: string): Promise<{
    text: string;
    hasTrackChanges: boolean;
    stats: {
        insertions: number;
        deletions: number;
    };
}>;
interface ExtractWithTrackChangesOptions {
    mediaDir?: string;
}
/**
 * Extract Word document content with track changes preserved as CriticMarkup
 * Uses pandoc with track-changes=all option to preserve insertions/deletions
 *
 * @param docxPath - Path to Word document
 * @param options - Options
 * @returns Track changes result with text and stats
 */
export declare function extractWithTrackChanges(docxPath: string, options?: ExtractWithTrackChangesOptions): Promise<{
    text: string;
    hasTrackChanges: boolean;
    stats: {
        insertions: number;
        deletions: number;
    };
}>;
export {};
//# sourceMappingURL=word.d.ts.map