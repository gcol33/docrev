/**
 * Citation validation utilities
 * Check that all [@cite] references exist in .bib file
 */
import type { Citation, CitationValidation, CitationStats } from './types.js';
/**
 * Extract all citation keys from markdown text
 * Handles: [@Key], [@Key1; @Key2], @Key (inline)
 * @param text - Markdown text to parse
 * @param file - Optional filename for context
 * @returns Array of citation objects
 */
export declare function extractCitations(text: string, file?: string): Citation[];
/**
 * Parse .bib file and extract all entry keys
 * @param bibPath - Path to bibliography file
 * @returns Set of citation keys found in the bib file
 */
export declare function parseBibFile(bibPath: string): Set<string>;
/**
 * Validate citations against bib file
 * @param mdFiles - Markdown files to check
 * @param bibPath - Path to .bib file
 * @returns Validation result with valid, missing, unused, and duplicate citations
 */
export declare function validateCitations(mdFiles: string[], bibPath: string): CitationValidation;
/**
 * Get citation statistics
 * @param mdFiles - Markdown files to analyze
 * @param bibPath - Path to bibliography file
 * @returns Statistics object
 */
export declare function getCitationStats(mdFiles: string[], bibPath: string): CitationStats;
//# sourceMappingURL=citations.d.ts.map