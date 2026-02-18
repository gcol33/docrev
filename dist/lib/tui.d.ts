/**
 * Clear the terminal screen
 */
export function clearScreen(): void;
/**
 * Move cursor to position
 * @param {number} row
 * @param {number} col
 */
export function moveCursor(row: number, col: number): void;
/**
 * Get terminal dimensions
 * @returns {{rows: number, cols: number}}
 */
export function getTerminalSize(): {
    rows: number;
    cols: number;
};
/**
 * Draw a box with content
 * @param {object} options
 * @param {string} options.title
 * @param {string[]} options.content
 * @param {number} options.width
 * @param {string} options.borderColor
 * @returns {string[]}
 */
export function drawBox({ title, content, width, borderColor }: {
    title: string;
    content: string[];
    width: number;
    borderColor: string;
}): string[];
/**
 * Draw a status bar at the bottom of the screen
 * @param {string} left - Left-aligned text
 * @param {string} right - Right-aligned text
 * @returns {string}
 */
export function statusBar(left: string, right?: string): string;
/**
 * Draw a progress indicator
 * @param {number} current
 * @param {number} total
 * @param {number} width
 * @returns {string}
 */
export function progressIndicator(current: number, total: number, width?: number): string;
/**
 * Format a comment for TUI display
 * @param {object} comment
 * @param {number} index
 * @param {number} total
 * @param {number} width
 * @returns {string[]}
 */
export function formatCommentCard(comment: object, index: number, total: number, width?: number): string[];
/**
 * Draw the action menu
 * @param {string[]} options - Array of [key, description] tuples
 * @returns {string}
 */
export function actionMenu(options: string[]): string;
/**
 * Run TUI comment review session
 * @param {string} text
 * @param {object} options
 * @returns {Promise<{text: string, resolved: number, replied: number, skipped: number}>}
 */
export function tuiCommentReview(text: string, options?: object): Promise<{
    text: string;
    resolved: number;
    replied: number;
    skipped: number;
}>;
//# sourceMappingURL=tui.d.ts.map