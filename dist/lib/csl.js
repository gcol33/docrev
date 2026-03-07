/**
 * CSL citation style resolution and caching
 *
 * Resolves short CSL names (e.g. "nature") to local file paths,
 * downloading from the CSL repository if needed.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
// =============================================================================
// Constants
// =============================================================================
/** Cache directory for downloaded CSL files */
const CSL_CACHE_DIR = path.join(os.homedir(), '.rev', 'csl');
/** GitHub raw URL for the CSL styles repository */
const CSL_REPO_BASE = 'https://raw.githubusercontent.com/citation-style-language/styles/master';
/**
 * Short name → CSL filename mapping for common styles.
 * Names that match their filename exactly don't need an entry here.
 */
const CSL_ALIASES = {
    'apa': 'apa',
    'chicago': 'chicago-author-date',
    'vancouver': 'vancouver',
    'ieee': 'ieee',
    'nature': 'nature',
    'science': 'science',
    'cell': 'cell',
    'pnas': 'pnas',
    'plos': 'plos',
    'elife': 'elife',
    'ecology-letters': 'ecology-letters',
    'ecology': 'ecology',
    'ama': 'american-medical-association',
    'acs': 'american-chemical-society',
    'rsc': 'royal-society-of-chemistry',
    'harvard': 'harvard-cite-them-right',
    'mla': 'modern-language-association',
    'elsevier': 'elsevier-harvard',
    'springer': 'springer-basic-author-date',
    'biomed-central': 'biomed-central',
};
// =============================================================================
// Public API
// =============================================================================
/**
 * Get the CSL cache directory path
 */
export function getCSLCacheDir() {
    return CSL_CACHE_DIR;
}
/**
 * Resolve a CSL name or path to a local file path.
 *
 * Resolution order:
 * 1. If it's an absolute path or relative path that exists, return it
 * 2. Check project directory for <name>.csl
 * 3. Check ~/.rev/csl/ cache
 * 4. Return null (caller can then use fetchCSL to download)
 */
export function resolveCSL(nameOrPath, projectDir) {
    // Already a file path that exists
    if (path.isAbsolute(nameOrPath) && fs.existsSync(nameOrPath)) {
        return nameOrPath;
    }
    // Relative path in project directory
    if (projectDir) {
        const projectPath = path.join(projectDir, nameOrPath);
        if (fs.existsSync(projectPath)) {
            return projectPath;
        }
        // Try with .csl extension
        const projectPathCsl = projectPath.endsWith('.csl') ? projectPath : `${projectPath}.csl`;
        if (fs.existsSync(projectPathCsl)) {
            return projectPathCsl;
        }
    }
    // Resolve short name to filename
    const baseName = resolveCSLName(nameOrPath);
    const fileName = baseName.endsWith('.csl') ? baseName : `${baseName}.csl`;
    // Check cache
    const cachePath = path.join(CSL_CACHE_DIR, fileName);
    if (fs.existsSync(cachePath)) {
        return cachePath;
    }
    return null;
}
/**
 * Download a CSL style from the CSL repository to the local cache.
 *
 * @returns Path to the cached file, or null on failure
 */
export async function fetchCSL(name) {
    const baseName = resolveCSLName(name);
    const fileName = baseName.endsWith('.csl') ? baseName : `${baseName}.csl`;
    const url = `${CSL_REPO_BASE}/${fileName}`;
    const cachePath = path.join(CSL_CACHE_DIR, fileName);
    // Ensure cache directory exists
    if (!fs.existsSync(CSL_CACHE_DIR)) {
        fs.mkdirSync(CSL_CACHE_DIR, { recursive: true });
    }
    try {
        const content = await httpGet(url);
        if (content) {
            fs.writeFileSync(cachePath, content, 'utf-8');
            return cachePath;
        }
        return null;
    }
    catch {
        return null;
    }
}
/**
 * List all cached CSL files
 */
export function listCachedCSL() {
    if (!fs.existsSync(CSL_CACHE_DIR)) {
        return [];
    }
    return fs.readdirSync(CSL_CACHE_DIR)
        .filter(f => f.endsWith('.csl'))
        .sort()
        .map(f => ({
        name: path.basename(f, '.csl'),
        path: path.join(CSL_CACHE_DIR, f),
    }));
}
/**
 * Get the list of known CSL short name aliases
 */
export function getCSLAliases() {
    return { ...CSL_ALIASES };
}
// =============================================================================
// Internal helpers
// =============================================================================
/**
 * Resolve a short name to a CSL filename (without extension)
 */
function resolveCSLName(name) {
    const normalized = name.toLowerCase().replace(/\.csl$/, '');
    return CSL_ALIASES[normalized] || normalized;
}
/**
 * Simple HTTPS GET that follows redirects
 */
function httpGet(url, redirectCount = 0) {
    if (redirectCount > 5)
        return Promise.resolve(null);
    return new Promise((resolve) => {
        https.get(url, (res) => {
            // Follow redirects
            if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
                resolve(httpGet(res.headers.location, redirectCount + 1));
                return;
            }
            if (res.statusCode !== 200) {
                resolve(null);
                return;
            }
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve(data));
            res.on('error', () => resolve(null));
        }).on('error', () => resolve(null));
    });
}
//# sourceMappingURL=csl.js.map