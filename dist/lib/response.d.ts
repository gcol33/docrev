/**
 * Response letter generator
 * Extract comments and replies from markdown files for journal resubmission
 */
interface Reply {
    author: string;
    text: string;
}
interface CommentWithReplies {
    author: string;
    text: string;
    replies: Reply[];
    context: string;
    file: string;
    line: number;
}
interface ResponseOptions {
    title?: string;
    authorName?: string;
    includeContext?: boolean;
    includeLocation?: boolean;
}
/**
 * Parse a comment with potential replies
 * Format: {>>Author: comment<<} {>>Reply Author: reply<<}
 */
export declare function parseCommentsWithReplies(text: string, file?: string): CommentWithReplies[];
/**
 * Group comments by reviewer
 */
export declare function groupByReviewer(comments: CommentWithReplies[]): Map<string, CommentWithReplies[]>;
/**
 * Generate response letter in Markdown format
 */
export declare function generateResponseLetter(comments: CommentWithReplies[], options?: ResponseOptions): string;
/**
 * Collect comments from multiple files
 */
export declare function collectComments(files: string[]): CommentWithReplies[];
export {};
//# sourceMappingURL=response.d.ts.map