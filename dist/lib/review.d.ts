/**
 * Interactive review TUI for track changes
 */
import type { Comment } from './types.js';
interface ReviewResult {
    text: string;
    accepted: number;
    rejected: number;
    skipped: number;
}
interface CommentReviewOptions {
    author?: string;
    addReply?: (text: string, comment: Comment, author: string, replyText: string) => string;
    setCommentStatus?: (text: string, comment: Comment, resolved: boolean) => string;
}
interface CommentReviewResult {
    text: string;
    resolved: number;
    replied: number;
    skipped: number;
}
/**
 * Run interactive review session
 */
export declare function interactiveReview(text: string): Promise<ReviewResult>;
/**
 * List all comments
 */
export declare function listComments(text: string): void;
/**
 * Run interactive comment review session
 */
export declare function interactiveCommentReview(text: string, options?: CommentReviewOptions): Promise<CommentReviewResult>;
export {};
//# sourceMappingURL=review.d.ts.map