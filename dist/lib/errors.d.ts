/**
 * Error handling utilities with actionable suggestions
 */
interface BuildContext {
    bibPath?: string;
    format?: string;
}
/**
 * Format an error message with optional suggestions
 * @param message - Main error message
 * @param suggestions - Actionable suggestions
 * @returns Formatted error string
 */
export declare function formatError(message: string, suggestions?: string[]): string;
/**
 * Get actionable suggestions for file not found errors
 * @param filePath - The file path that wasn't found
 * @returns Array of suggestions
 */
export declare function getFileNotFoundSuggestions(filePath: string): string[];
/**
 * Get actionable suggestions for dependency errors
 * @param dependency - The missing dependency
 * @returns Array of suggestions
 */
export declare function getDependencySuggestions(dependency: string): string[];
/**
 * Get actionable suggestions for configuration errors
 * @param field - The problematic config field
 * @param issue - What's wrong with it
 * @returns Array of suggestions
 */
export declare function getConfigSuggestions(field: string, issue: string): string[];
/**
 * Get suggestions for comment/annotation errors
 * @param issue - The issue type
 * @returns Array of suggestions
 */
export declare function getAnnotationSuggestions(issue: string): string[];
/**
 * Get suggestions for build errors
 * @param issue - The build issue
 * @param context - Additional context
 * @returns Array of suggestions
 */
export declare function getBuildSuggestions(issue: string, context?: BuildContext): string[];
/**
 * Print error and exit
 * @param message - Error message
 * @param suggestions - Suggestions
 */
export declare function exitWithError(message: string, suggestions?: string[]): never;
/**
 * Validate file exists with helpful error
 * @param filePath - File to check
 * @param fileType - Type description for error message
 */
export declare function requireFile(filePath: string, fileType?: string): void;
export {};
//# sourceMappingURL=errors.d.ts.map