/**
 * Word comment injection with reply threading
 *
 * Flow:
 * 1. prepareMarkdownWithMarkers() - Parse comments, detect reply relationships
 *    - First comment in a cluster = parent (gets markers: ⟦CMS:n⟧anchor⟦CME:n⟧)
 *    - Subsequent adjacent comments = replies (no markers, attach to parent)
 * 2. Pandoc converts to DOCX
 * 3. injectCommentsAtMarkers() - Insert comment ranges for parents only
 *    - Replies go in comments.xml with parent reference in commentsExtended.xml
 */
interface ParsedComment {
    author: string;
    text: string;
    anchor: string | null;
    start: number;
    end: number;
    fullMatch: string;
}
interface PreparedComment extends ParsedComment {
    isReply: boolean;
    parentIdx: number | null;
    commentIdx: number;
    anchorFromReply?: boolean;
    placesParentMarkers?: boolean;
}
interface PrepareResult {
    markedMarkdown: string;
    comments: PreparedComment[];
}
interface InjectionResult {
    success: boolean;
    commentCount: number;
    replyCount?: number;
    skippedComments: number;
    error?: string;
}
/**
 * Parse comments and create markers
 *
 * Returns:
 * - markedMarkdown: markdown with markers for parent comments only
 * - comments: array with author, text, isReply, parentIdx
 */
export declare function prepareMarkdownWithMarkers(markdown: string): PrepareResult;
/**
 * Inject comments at marker positions
 */
export declare function injectCommentsAtMarkers(docxPath: string, comments: PreparedComment[], outputPath: string): Promise<InjectionResult>;
export {};
//# sourceMappingURL=wordcomments.d.ts.map