/**
 * Spelling checker module with global and project dictionaries
 *
 * Uses nspell (Hunspell-compatible) for English spellchecking.
 * Custom words stored in:
 * - ~/.rev-dictionary (global)
 * - .rev-dictionary (project-local)
 */
import type { SpellingResult } from './types.js';
interface WordLocation {
    word: string;
    line: number;
    column: number;
}
interface CheckSpellingOptions {
    projectDir?: string;
    lang?: 'en' | 'en-gb';
}
interface CheckFileOptions {
    projectDir?: string;
    lang?: 'en' | 'en-gb';
}
/**
 * Get the global dictionary path
 */
export declare function getGlobalDictPath(): string;
/**
 * Get the project dictionary path
 */
export declare function getProjectDictPath(directory?: string): string;
/**
 * Load custom words from a dictionary file
 */
export declare function loadDictionaryFile(dictPath: string): Set<string>;
/**
 * Save words to a dictionary file
 */
export declare function saveDictionaryFile(words: Set<string>, dictPath: string): void;
/**
 * Load all custom words (global + project)
 */
export declare function loadAllCustomWords(projectDir?: string): Set<string>;
/**
 * Add word to dictionary
 */
export declare function addWord(word: string, global?: boolean, projectDir?: string): boolean;
/**
 * Remove word from dictionary
 */
export declare function removeWord(word: string, global?: boolean, projectDir?: string): boolean;
/**
 * List words in dictionary
 */
export declare function listWords(global?: boolean, projectDir?: string): string[];
/**
 * Initialize the spellchecker with custom words
 */
export declare function getSpellchecker(projectDir?: string, lang?: 'en' | 'en-gb'): Promise<any>;
/**
 * Clear spellchecker cache (call after modifying dictionaries)
 */
export declare function clearCache(): void;
/**
 * Extract words from text, filtering out non-words
 */
export declare function extractWords(text: string): WordLocation[];
/**
 * Check spelling in text
 */
export declare function checkSpelling(text: string, options?: CheckSpellingOptions): Promise<SpellingResult>;
/**
 * Check spelling in a file
 */
export declare function checkFile(filePath: string, options?: CheckFileOptions): Promise<SpellingResult>;
export {};
//# sourceMappingURL=spelling.d.ts.map