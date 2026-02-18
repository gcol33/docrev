/**
 * Import functionality - convert Word docs to annotated Markdown
 */
interface WordComment {
    id: string;
    author: string;
    date: string;
    text: string;
}
interface CommentAnchorData {
    anchor: string;
    before: string;
    after: string;
    docPosition: number;
    docLength: number;
    isEmpty: boolean;
}
interface CommentAnchorsResult {
    anchors: Map<string, CommentAnchorData>;
    fullDocText: string;
}
interface WordTable {
    markdown: string;
    rowCount: number;
    colCount: number;
}
interface ExtractFromWordOptions {
    mediaDir?: string;
    skipMediaExtraction?: boolean;
}
interface ExtractMessage {
    type: 'info' | 'warning';
    message: string;
}
interface ExtractFromWordResult {
    text: string;
    comments: WordComment[];
    anchors: Map<string, CommentAnchorData>;
    messages: ExtractMessage[];
    extractedMedia: string[];
    tables: WordTable[];
    hasTrackChanges: boolean;
    trackChangeStats: {
        insertions: number;
        deletions: number;
    };
}
interface InsertCommentsOptions {
    quiet?: boolean;
    sectionBoundary?: {
        start: number;
        end: number;
    } | null;
}
interface GenerateSmartDiffOptions {
    wordTables?: WordTable[];
    imageRegistry?: any;
}
interface RestoreCrossrefResult {
    text: string;
    restored: number;
    messages: string[];
    restoredLabels: Set<string>;
}
interface RestoreImagesResult {
    text: string;
    restored: number;
    messages: string[];
}
interface ImportWordWithTrackChangesOptions {
    mediaDir?: string;
    projectDir?: string;
}
interface ImportWordWithTrackChangesResult {
    text: string;
    stats: {
        insertions: number;
        deletions: number;
        substitutions: number;
        comments: number;
        total: number;
        hasTrackChanges: boolean;
        trackChangeStats: {
            insertions: number;
            deletions: number;
        };
    };
    extractedMedia: string[];
    comments: WordComment[];
}
interface ImportFromWordOptions {
    author?: string;
    sectionContent?: string;
    figuresDir?: string;
    wordTables?: WordTable[];
}
interface ImportFromWordResult {
    annotated: string;
    stats: {
        insertions: number;
        deletions: number;
        substitutions: number;
        comments: number;
        total: number;
    };
    extractedMedia: string[];
}
interface MovedFile {
    from: string;
    to: string;
    name: string;
}
interface MoveExtractedMediaResult {
    moved: MovedFile[];
    errors: string[];
}
/**
 * Extract comments directly from Word docx comments.xml
 */
export declare function extractWordComments(docxPath: string): Promise<WordComment[]>;
/**
 * Extract comment anchor texts from document.xml with surrounding context
 * Returns map of comment ID -> {anchor, before, after, docPosition, isEmpty} for better matching
 * Also returns fullDocText for section boundary matching
 */
export declare function extractCommentAnchors(docxPath: string): Promise<CommentAnchorsResult>;
/**
 * Extract tables directly from Word document XML and convert to markdown pipe tables
 */
export declare function extractWordTables(docxPath: string): Promise<WordTable[]>;
/**
 * Extract text from Word document using pandoc with track changes preserved
 */
export declare function extractFromWord(docxPath: string, options?: ExtractFromWordOptions): Promise<ExtractFromWordResult>;
/**
 * Insert comments into markdown text based on anchor texts with context
 */
export declare function insertCommentsIntoMarkdown(markdown: string, comments: WordComment[], anchors: Map<string, CommentAnchorData | string>, options?: InsertCommentsOptions): string;
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
/**
 * Import Word document with track changes directly as CriticMarkup
 */
export declare function importWordWithTrackChanges(docxPath: string, options?: ImportWordWithTrackChangesOptions): Promise<ImportWordWithTrackChangesResult>;
/**
 * Legacy import function: Word doc → annotated MD via diff
 */
export declare function importFromWord(docxPath: string, originalMdPath: string, options?: ImportFromWordOptions): Promise<ImportFromWordResult>;
/**
 * Move extracted media files to a figures directory with better names
 */
export declare function moveExtractedMedia(mediaFiles: string[], figuresDir: string, prefix?: string): MoveExtractedMediaResult;
export {};
//# sourceMappingURL=import.d.ts.map