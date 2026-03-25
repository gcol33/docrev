/**
 * Word document data extraction - raw extraction from .docx files
 */
export interface WordComment {
    id: string;
    author: string;
    date: string;
    text: string;
}
export interface TextNode {
    xmlStart: number;
    xmlEnd: number;
    textStart: number;
    textEnd: number;
    text: string;
}
export interface CommentAnchorData {
    anchor: string;
    before: string;
    after: string;
    docPosition: number;
    docLength: number;
    isEmpty: boolean;
}
export interface CommentAnchorsResult {
    anchors: Map<string, CommentAnchorData>;
    fullDocText: string;
}
export interface WordTable {
    markdown: string;
    rowCount: number;
    colCount: number;
}
export interface ParsedRow {
    cells: string[];
    colSpans: number[];
}
export interface ExtractFromWordOptions {
    mediaDir?: string;
    skipMediaExtraction?: boolean;
}
export interface ExtractMessage {
    type: 'info' | 'warning';
    message: string;
}
export interface ExtractFromWordResult {
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
//# sourceMappingURL=word-extraction.d.ts.map