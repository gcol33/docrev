/**
 * Template variable substitution for rev
 *
 * Supported variables:
 *   {{date}}       - Current date (YYYY-MM-DD)
 *   {{date:format}} - Custom date format (e.g., {{date:MMMM D, YYYY}})
 *   {{version}}    - Version from rev.yaml
 *   {{word_count}} - Total word count
 *   {{author}}     - First author name
 *   {{authors}}    - All authors (comma-separated)
 *   {{title}}      - Document title
 *   {{year}}       - Current year
 */
import type { Author } from './types.js';
/**
 * Options for variable processing
 */
interface ProcessVariablesOptions {
    sectionContents?: string[];
}
/**
 * Config object (minimal subset needed for variables)
 */
interface Config {
    version?: string;
    title?: string;
    authors?: Author[] | string;
}
/**
 * Process template variables in text
 */
export declare function processVariables(text: string, config?: Config, options?: ProcessVariablesOptions): string;
/**
 * Check if text contains any template variables
 */
export declare function hasVariables(text: string): boolean;
/**
 * List all variables found in text
 */
export declare function findVariables(text: string): string[];
export {};
//# sourceMappingURL=variables.d.ts.map