/**
 * Realign comments from a reference DOCX to markdown
 * Uses paragraph-level matching with exact positions
 */
interface CommentWithPosition {
    id: string;
    position: number;
    author: string;
    text: string;
}
interface Paragraph {
    text: string;
    comments: CommentWithPosition[];
}
interface RealignOptions {
    dryRun?: boolean;
    author?: string;
    replyAuthor?: string;
}
interface RealignResult {
    success: boolean;
    dryRun?: boolean;
    insertions: number;
    matched?: number;
    unmatched?: number;
}
interface RealignMarkdownOptions {
    author?: string;
    replyAuthor?: string;
}
interface RealignMarkdownResult {
    success: boolean;
    markdown: string;
    insertions: number;
    error?: string;
}
/**
 * Extract paragraphs with their full text and comment positions from DOCX
 */
export declare function extractParagraphsWithComments(docxPath: string): Promise<Paragraph[]>;
/**
 * Realign comments from reference DOCX to markdown
 */
export declare function realignComments(docxPath: string, markdownPath: string, options?: RealignOptions): Promise<RealignResult>;
/**
 * Realign comments in markdown string (in-memory, doesn't write to file)
 */
export declare function realignMarkdown(docxPath: string, markdown: string, options?: RealignMarkdownOptions): Promise<RealignMarkdownResult>;
export {};
//# sourceMappingURL=comment-realign.d.ts.map