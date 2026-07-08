/**
 * CSL citation style resolution and caching
 *
 * Resolves short CSL names (e.g. "nature") to local file paths,
 * downloading from the CSL repository if needed.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RateLimiter } from './rate-limiter.js';

// Bounded timeout + retry so a stalled CSL download cannot hang the CLI.
const cslLimiter = new RateLimiter({ minDelay: 100, maxDelay: 10000 });

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
const CSL_ALIASES: Record<string, string> = {
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
export function getCSLCacheDir(): string {
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
export function resolveCSL(nameOrPath: string, projectDir?: string): string | null {
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
export async function fetchCSL(name: string): Promise<string | null> {
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
  } catch {
    return null;
  }
}

/**
 * List all cached CSL files
 */
export function listCachedCSL(): Array<{ name: string; path: string }> {
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
export function getCSLAliases(): Record<string, string> {
  return { ...CSL_ALIASES };
}

// =============================================================================
// Internal helpers
// =============================================================================

/**
 * Resolve a short name to a CSL filename (without extension)
 */
function resolveCSLName(name: string): string {
  const normalized = name.toLowerCase().replace(/\.csl$/, '');
  return CSL_ALIASES[normalized] || normalized;
}

/**
 * HTTPS GET with a bounded timeout. fetch follows redirects natively.
 */
async function httpGet(url: string): Promise<string | null> {
  try {
    const response = await cslLimiter.fetchWithRetry(url);
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}
