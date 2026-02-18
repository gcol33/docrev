/**
 * Grammar checker module with custom dictionary support
 *
 * Features:
 * - Common grammar/style issues detection
 * - Custom dictionary for project-specific terms
 * - Learn mode to add words to dictionary
 */
interface GrammarIssue {
    rule: string;
    message: string;
    severity: 'error' | 'warning' | 'info';
    line: number;
    column: number;
    match: string;
    context: string;
}
interface GrammarSummary {
    total: number;
    errors: number;
    warnings: number;
    info: number;
    byRule: Record<string, number>;
}
interface CheckGrammarOptions {
    scientific?: boolean;
    directory?: string;
}
/**
 * Load custom dictionary from file
 */
export declare function loadDictionary(directory?: string): Set<string>;
/**
 * Save custom dictionary to file
 */
export declare function saveDictionary(words: Set<string>, directory?: string): void;
/**
 * Add word to custom dictionary
 */
export declare function addToDictionary(word: string, directory?: string): boolean;
/**
 * Remove word from custom dictionary
 */
export declare function removeFromDictionary(word: string, directory?: string): boolean;
/**
 * Check text for grammar/style issues
 */
export declare function checkGrammar(text: string, options?: CheckGrammarOptions): GrammarIssue[];
/**
 * Get grammar check summary
 */
export declare function getGrammarSummary(issues: GrammarIssue[]): GrammarSummary;
/**
 * List available grammar rules
 */
export declare function listRules(scientific?: boolean): Array<{
    id: string;
    message: string;
    severity: string;
}>;
export {};
//# sourceMappingURL=grammar.d.ts.map