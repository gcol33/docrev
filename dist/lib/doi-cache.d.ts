/**
 * DOI Cache - Reduces API calls for repeated lookups
 */
import type { DoiCache, DoiCacheStats, DoiCheckResult, DoiLookupResult } from './types.js';
/**
 * Load DOI cache from disk
 */
export declare function loadCache(): DoiCache;
/**
 * Save DOI cache to disk
 */
export declare function saveCache(): void;
/**
 * Get cached DOI result
 */
export declare function getCachedDoi(doi: string): DoiCheckResult | DoiLookupResult | null;
/**
 * Cache a DOI result
 */
export declare function cacheDoi(doi: string, result: DoiCheckResult | DoiLookupResult): void;
/**
 * Clear the DOI cache
 */
export declare function clearDoiCache(): void;
/**
 * Get DOI cache statistics
 */
export declare function getDoiCacheStats(): DoiCacheStats;
//# sourceMappingURL=doi-cache.d.ts.map