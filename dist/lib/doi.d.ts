/**
 * DOI validation and fetching utilities
 * Check DOIs in .bib files, fetch BibTeX from DOIs
 */
import type { BibEntry, DoiCheckResult, BibtexFetchResult, DoiLookupResult, BibCheckResult } from './types.js';
/**
 * Parse .bib file and extract entries with DOI info
 */
export declare function parseBibEntries(bibPath: string): BibEntry[];
/**
 * Validate DOI format
 */
export declare function isValidDoiFormat(doi: string): boolean;
interface CheckDoiOptions {
    skipCache?: boolean;
}
/**
 * Check if DOI resolves (exists) - tries Crossref first, then DataCite
 * Results are cached for 7 days to reduce API calls.
 */
export declare function checkDoi(doi: string, options?: CheckDoiOptions): Promise<DoiCheckResult & {
    cached?: boolean;
}>;
/**
 * Fetch BibTeX from DOI using content negotiation
 */
export declare function fetchBibtex(doi: string): Promise<BibtexFetchResult>;
interface CheckBibDoisOptions {
    checkMissing?: boolean;
    parallel?: number;
}
/**
 * Check all DOIs in a .bib file
 */
export declare function checkBibDois(bibPath: string, options?: CheckBibDoisOptions): Promise<BibCheckResult>;
/**
 * Search for DOI by title and author using Crossref API (+ DataCite fallback)
 */
export declare function lookupDoi(title: string, author?: string, year?: number | null, journal?: string): Promise<DoiLookupResult>;
interface LookupMissingDoisOptions {
    parallel?: number;
    onProgress?: (current: number, total: number) => void;
}
interface LookupMissingDoiResult {
    key: string;
    title: string;
    type: string;
    journal: string;
    result: DoiLookupResult;
}
/**
 * Look up DOIs for all entries missing them in a .bib file
 */
export declare function lookupMissingDois(bibPath: string, options?: LookupMissingDoisOptions): Promise<LookupMissingDoiResult[]>;
interface AddToBibResult {
    success: boolean;
    key?: string;
    error?: string;
}
/**
 * Add a BibTeX entry to a .bib file
 */
export declare function addToBib(bibPath: string, bibtex: string): AddToBibResult;
export {};
//# sourceMappingURL=doi.d.ts.map