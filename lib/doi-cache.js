/**
 * DOI Cache - Reduces API calls for repeated lookups
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CACHE_FILE = path.join(os.homedir(), '.rev-doi-cache.json');
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

let doiCache = null;

/**
 * Load DOI cache from disk
 * @returns {object}
 */
export function loadCache() {
  if (doiCache !== null) return doiCache;

  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
      doiCache = data;
      return doiCache;
    }
  } catch {
    // Ignore cache errors
  }

  doiCache = { entries: {}, version: 1 };
  return doiCache;
}

/**
 * Save DOI cache to disk
 */
export function saveCache() {
  if (!doiCache) return;

  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(doiCache, null, 2), 'utf-8');
  } catch {
    // Ignore cache write errors
  }
}

/**
 * Get cached DOI result
 * @param {string} doi
 * @returns {object|null}
 */
export function getCachedDoi(doi) {
  const cache = loadCache();
  const entry = cache.entries[doi];

  if (!entry) return null;

  // Check if cache entry is expired
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    delete cache.entries[doi];
    return null;
  }

  return entry.result;
}

/**
 * Cache a DOI result
 * @param {string} doi
 * @param {object} result
 */
export function cacheDoi(doi, result) {
  const cache = loadCache();
  cache.entries[doi] = {
    result,
    timestamp: Date.now(),
  };

  // Limit cache size - remove oldest entries if over 1000
  const entries = Object.entries(cache.entries);
  if (entries.length > 1000) {
    entries
      .sort((a, b) => a[1].timestamp - b[1].timestamp)
      .slice(0, entries.length - 800)
      .forEach(([key]) => delete cache.entries[key]);
  }

  saveCache();
}

/**
 * Clear the DOI cache
 */
export function clearDoiCache() {
  doiCache = { entries: {}, version: 1 };
  try {
    if (fs.existsSync(CACHE_FILE)) {
      fs.unlinkSync(CACHE_FILE);
    }
  } catch {
    // Ignore
  }
}

/**
 * Get DOI cache statistics
 * @returns {{ size: number, path: string }}
 */
export function getDoiCacheStats() {
  const cache = loadCache();
  return {
    size: Object.keys(cache.entries).length,
    path: CACHE_FILE,
  };
}
