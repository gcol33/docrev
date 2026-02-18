/**
 * Journal validation profiles
 * Check manuscripts against journal-specific requirements
 */
import type { JournalProfile } from './types.js';
/**
 * Journal requirement profiles
 * Based on publicly available author guidelines
 */
export declare const JOURNAL_PROFILES: Record<string, JournalProfile>;
interface ListJournalsOptions {
    includeCustom?: boolean;
    customOnly?: boolean;
}
interface JournalListItem {
    id: string;
    name: string;
    url: string;
    custom?: boolean;
}
/**
 * List all available journal profiles
 */
export declare function listJournals(options?: ListJournalsOptions): JournalListItem[];
/**
 * Get a specific journal profile
 */
export declare function getJournalProfile(journalId: string): JournalProfile | null;
interface ManuscriptStats {
    wordCount: number;
    abstractWords: number;
    titleChars: number;
    figures: number;
    tables: number;
    references: number;
    sections: number;
}
interface ManuscriptValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    stats: ManuscriptStats | null;
    journal?: string;
    url?: string;
}
/**
 * Validate manuscript against journal requirements
 */
export declare function validateManuscript(text: string, journalId: string): ManuscriptValidationResult;
/**
 * Validate multiple files against journal requirements
 */
export declare function validateProject(files: string[], journalId: string): ManuscriptValidationResult;
export {};
//# sourceMappingURL=journals.d.ts.map