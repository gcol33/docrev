/**
 * CSL citation style resolution and caching
 *
 * Resolves short CSL names (e.g. "nature") to local file paths,
 * downloading from the CSL repository if needed.
 */
/**
 * Get the CSL cache directory path
 */
export declare function getCSLCacheDir(): string;
/**
 * Resolve a CSL name or path to a local file path.
 *
 * Resolution order:
 * 1. If it's an absolute path or relative path that exists, return it
 * 2. Check project directory for <name>.csl
 * 3. Check ~/.rev/csl/ cache
 * 4. Return null (caller can then use fetchCSL to download)
 */
export declare function resolveCSL(nameOrPath: string, projectDir?: string): string | null;
/**
 * Download a CSL style from the CSL repository to the local cache.
 *
 * @returns Path to the cached file, or null on failure
 */
export declare function fetchCSL(name: string): Promise<string | null>;
/**
 * List all cached CSL files
 */
export declare function listCachedCSL(): Array<{
    name: string;
    path: string;
}>;
/**
 * Get the list of known CSL short name aliases
 */
export declare function getCSLAliases(): Record<string, string>;
//# sourceMappingURL=csl.d.ts.map