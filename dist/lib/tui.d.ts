/**
 * TUI (Text User Interface) components for enhanced visual display
 * Uses box-drawing characters and colors for a richer terminal experience
 */
import type { Annotation } from './types.js';
interface BoxOptions {
    title?: string;
    content?: string[];
    width?: number;
    borderColor?: string;
}
interface TuiReviewOptions {
    author?: string;
    addReply?: (text: string, comment: Annotation, author: string, reply: string) => string;
    setStatus?: (text: string, comment: Annotation, resolved: boolean) => string;
}
interface TuiReviewResult {
    text: string;
    resolved: number;
    replied: number;
    skipped: number;
}
/**
 * Strip ANSI codes for length calculation
 */
export declare function stripAnsi(str: string): string;
/**
 * Clear the terminal screen
 */
export declare function clearScreen(): void;
/**
 * Move cursor to position
 */
export declare function moveCursor(row: number, col: number): void;
/**
 * Get terminal dimensions
 */
export declare function getTerminalSize(): {
    rows: number;
    cols: number;
};
/**
 * Draw a box with content
 */
export declare function drawBox({ title, content, width, borderColor }?: BoxOptions): string[];
/**
 * Draw a status bar at the bottom of the screen
 */
export declare function statusBar(left: string, right?: string): string;
/**
 * Draw a progress indicator
 */
export declare function progressIndicator(current: number, total: number, width?: number): string;
/**
 * Format a comment for TUI display
 */
export declare function formatCommentCard(comment: Annotation, index: number, total: number, width?: number): string[];
/**
 * Draw the action menu
 */
export declare function actionMenu(options: [string, string][]): string;
/**
 * Run TUI comment review session
 */
export declare function tuiCommentReview(text: string, options?: TuiReviewOptions): Promise<TuiReviewResult>;
export {};
//# sourceMappingURL=tui.d.ts.map