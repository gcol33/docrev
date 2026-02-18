/**
 * Formatting utilities for CLI output
 * Tables, boxes, spinners, progress bars
 */
interface TableOptions {
    align?: Array<'left' | 'right' | 'center'>;
    headerStyle?: (text: string) => string;
    borderStyle?: (text: string) => string;
    cellStyle?: ((value: string, colIndex: number, rowIndex: number) => string) | null;
}
interface SimpleTableOptions {
    headerStyle?: (text: string) => string;
    indent?: string;
}
interface BoxOptions {
    title?: string | null;
    padding?: number;
    borderStyle?: (text: string) => string;
    titleStyle?: (text: string) => string;
}
interface StatsOptions {
    title?: string | null;
}
interface ProgressOptions {
    width?: number;
    label?: string;
}
interface InlineDiffPreviewOptions {
    maxLines?: number;
    contextChars?: number;
}
interface HeaderOptions {
    style?: (text: string) => string;
    width?: number;
}
interface Spinner {
    text: string;
    start: () => Spinner;
    stop: (finalMessage?: string | null) => Spinner;
    success: (msg?: string) => Spinner;
    error: (msg?: string) => Spinner;
}
interface ProgressBar {
    update: (n: number) => ProgressBar;
    increment: () => ProgressBar;
    done: (message?: string) => ProgressBar;
}
/**
 * Format a table with borders and alignment
 * @param headers - Column headers
 * @param rows - Row data
 * @param options - Formatting options
 * @returns Formatted table string
 */
export declare function table(headers: string[], rows: string[][], options?: TableOptions): string;
/**
 * Simple table without borders (compact)
 */
export declare function simpleTable(headers: string[], rows: string[][], options?: SimpleTableOptions): string;
/**
 * Format a box around content
 */
export declare function box(content: string, options?: BoxOptions): string;
/**
 * Summary stats in a nice format
 */
export declare function stats(data: Record<string, string | number>, options?: StatsOptions): string;
/**
 * Progress indicator
 */
export declare function progress(current: number, total: number, options?: ProgressOptions): string;
export declare function setEmoji(enabled: boolean): void;
/**
 * Status line with icon
 */
export declare function status(type: string, message: string): string;
/**
 * Create a pulsing star spinner for async operations
 */
export declare function spinner(message: string): Spinner;
/**
 * Create a progress bar for batch operations
 * @param total - Total number of items
 * @param label - Label for the progress bar
 * @returns Progress bar controller with update(), increment(), and done()
 */
export declare function progressBar(total: number, label?: string): ProgressBar;
/**
 * Diff display with inline highlighting
 */
export declare function diff(insertions: number, deletions: number, substitutions: number): string;
/**
 * Show inline diff preview for CriticMarkup changes
 * @param text - Text with CriticMarkup annotations
 * @param options - Display options
 * @returns Formatted preview string
 */
export declare function inlineDiffPreview(text: string, options?: InlineDiffPreviewOptions): string;
/**
 * Section header
 */
export declare function header(text: string, options?: HeaderOptions): string;
export {};
//# sourceMappingURL=format.d.ts.map