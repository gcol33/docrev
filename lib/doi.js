/**
 * DOI validation and fetching utilities
 * Check DOIs in .bib files, fetch BibTeX from DOIs
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ============================================================================
// DOI Cache - Reduces API calls for repeated lookups
// ============================================================================

const CACHE_FILE = path.join(os.homedir(), '.rev-doi-cache.json');
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days in ms

let doiCache = null;

/**
 * Load DOI cache from disk
 * @returns {object}
 */
function loadCache() {
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
function saveCache() {
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
function getCachedDoi(doi) {
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
function cacheDoi(doi, result) {
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

// Entry types that typically don't have DOIs
const NO_DOI_TYPES = new Set([
  'book',           // Books often don't have DOIs (chapters might)
  'inbook',         // Book chapters - variable
  'thesis',         // Theses rarely have DOIs
  'mastersthesis',
  'phdthesis',
  'misc',           // Catch-all, often no DOI
  'unpublished',    // By definition
  'manual',         // Software manuals
  'techreport',     // Some do, many don't
  'booklet',
]);

// Entry types that should have DOIs
const EXPECT_DOI_TYPES = new Set([
  'article',        // Journal articles should have DOIs
  'inproceedings',  // Conference papers usually do
  'proceedings',
  'incollection',   // Book chapters in collections
]);

/**
 * Parse .bib file and extract entries with DOI info
 * @param {string} bibPath
 * @returns {Array<{key: string, type: string, doi: string|null, title: string, skip: boolean, line: number}>}
 */
export function parseBibEntries(bibPath) {
  if (!fs.existsSync(bibPath)) {
    return [];
  }

  const content = fs.readFileSync(bibPath, 'utf-8');
  const entries = [];
  const lines = content.split('\n');

  // Pattern for bib entries: @type{key,
  const entryPattern = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;

  let match;
  while ((match = entryPattern.exec(content)) !== null) {
    const type = match[1].toLowerCase();
    const key = match[2];
    const startPos = match.index;

    // Find the line number
    let line = 1;
    for (let i = 0; i < startPos; i++) {
      if (content[i] === '\n') line++;
    }

    // Find the end of this entry (matching closing brace)
    let braceCount = 0;
    let entryEnd = startPos;
    let inEntry = false;

    for (let i = startPos; i < content.length; i++) {
      if (content[i] === '{') {
        braceCount++;
        inEntry = true;
      } else if (content[i] === '}') {
        braceCount--;
        if (inEntry && braceCount === 0) {
          entryEnd = i + 1;
          break;
        }
      }
    }

    const entryContent = content.slice(startPos, entryEnd);

    // Extract DOI field
    const doiMatch = entryContent.match(/\bdoi\s*=\s*[{"]([^}"]+)[}"]/i);
    let doi = doiMatch ? doiMatch[1].trim() : null;

    // Clean DOI - remove URL prefix if present
    if (doi) {
      doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    }

    // Extract title for display
    const titleMatch = entryContent.match(/\btitle\s*=\s*[{"]([^}"]+)[}"]/i);
    const title = titleMatch ? titleMatch[1].trim().slice(0, 60) : '';

    // Extract author for lookup
    const authorMatch = entryContent.match(/\bauthor\s*=\s*[{"]([^}"]+)[}"]/i);
    const authorRaw = authorMatch ? authorMatch[1].trim() : '';

    // Extract year
    const yearMatch = entryContent.match(/\byear\s*=\s*[{"]?(\d{4})[}""]?/i);
    const year = yearMatch ? parseInt(yearMatch[1]) : null;

    // Extract journal
    const journalMatch = entryContent.match(/\bjournal\s*=\s*[{"]([^}"]+)[}"]/i);
    const journal = journalMatch ? journalMatch[1].trim() : '';

    // Check for skip marker: nodoi = {true} or nodoi = true
    const skipMatch = entryContent.match(/\bnodoi\s*=\s*[{"]?(true|yes|1)[}""]?/i);
    const skip = !!skipMatch;

    // Check for comment marker immediately before entry: % no-doi
    // Only look at the text between the last entry end (or start) and this entry
    const linesBefore = content.slice(Math.max(0, startPos - 200), startPos);
    // Find the last closing brace or start of file to avoid matching comments for previous entries
    const lastEntryEnd = linesBefore.lastIndexOf('}');
    const relevantBefore = lastEntryEnd >= 0 ? linesBefore.slice(lastEntryEnd + 1) : linesBefore;
    const commentSkip = /% *no-?doi/i.test(relevantBefore);

    entries.push({
      key,
      type,
      doi,
      title,
      authorRaw,
      year,
      journal,
      skip: skip || commentSkip,
      expectDoi: EXPECT_DOI_TYPES.has(type),
      noDoi: NO_DOI_TYPES.has(type),
      line,
    });
  }

  return entries;
}

/**
 * Validate DOI format
 * @param {string} doi
 * @returns {boolean}
 */
export function isValidDoiFormat(doi) {
  if (!doi) return false;
  // DOI format: 10.prefix/suffix
  // Prefix is 4+ digits, suffix can contain most characters
  return /^10\.\d{4,}\/[^\s]+$/.test(doi);
}

/**
 * Check if DOI resolves via DataCite (for Zenodo, Figshare, etc.)
 * @param {string} doi
 * @returns {Promise<{valid: boolean, metadata?: object, error?: string}>}
 */
async function checkDoiDataCite(doi) {
  try {
    const response = await fetch(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`, {
      headers: {
        'Accept': 'application/vnd.api+json',
        'User-Agent': 'rev-cli/0.2.0',
      },
    });

    if (response.status === 404) {
      return { valid: false, error: 'DOI not found in DataCite' };
    }

    if (!response.ok) {
      return { valid: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const attrs = data.data?.attributes;

    if (!attrs) {
      return { valid: false, error: 'Invalid DataCite response' };
    }

    return {
      valid: true,
      source: 'datacite',
      metadata: {
        title: attrs.titles?.[0]?.title || '',
        authors: attrs.creators?.map(c => `${c.givenName || ''} ${c.familyName || ''}`.trim()) || [],
        year: attrs.publicationYear,
        journal: attrs.publisher || '',
        type: attrs.types?.resourceTypeGeneral || '',
      },
    };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

/**
 * Check if DOI resolves (exists) - tries Crossref first, then DataCite
 * Results are cached for 7 days to reduce API calls.
 * @param {string} doi
 * @param {object} options
 * @param {boolean} options.skipCache - Skip cache lookup
 * @returns {Promise<{valid: boolean, source?: string, metadata?: object, error?: string, cached?: boolean}>}
 */
export async function checkDoi(doi, options = {}) {
  if (!isValidDoiFormat(doi)) {
    return { valid: false, error: 'Invalid DOI format' };
  }

  // Check cache first (unless skipped)
  if (!options.skipCache) {
    const cached = getCachedDoi(doi);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  // Zenodo DOIs start with 10.5281 - check DataCite first
  const isZenodo = doi.startsWith('10.5281/');
  const isFigshare = doi.startsWith('10.6084/');
  const isDataCiteLikely = isZenodo || isFigshare;

  if (isDataCiteLikely) {
    const dataciteResult = await checkDoiDataCite(doi);
    if (dataciteResult.valid) {
      cacheDoi(doi, dataciteResult);
      return dataciteResult;
    }
  }

  try {
    // Use Crossref API to check DOI
    const response = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
      headers: {
        'User-Agent': 'rev-cli/0.2.0 (mailto:dev@example.com)',
      },
    });

    if (response.status === 404) {
      // Try DataCite as fallback (if not already tried)
      if (!isDataCiteLikely) {
        const dataciteResult = await checkDoiDataCite(doi);
        if (dataciteResult.valid) {
          cacheDoi(doi, dataciteResult);
          return dataciteResult;
        }
      }
      const result = { valid: false, error: 'DOI not found' };
      cacheDoi(doi, result);
      return result;
    }

    if (!response.ok) {
      // Don't cache transient errors
      return { valid: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    const work = data.message;

    const result = {
      valid: true,
      source: 'crossref',
      metadata: {
        title: work.title?.[0] || '',
        authors: work.author?.map(a => `${a.given || ''} ${a.family || ''}`.trim()) || [],
        year: work.published?.['date-parts']?.[0]?.[0] || work.created?.['date-parts']?.[0]?.[0],
        journal: work['container-title']?.[0] || '',
        type: work.type,
      },
    };

    cacheDoi(doi, result);
    return result;
  } catch (err) {
    // Don't cache network errors
    return { valid: false, error: err.message };
  }
}

/**
 * Fetch BibTeX from DOI using content negotiation
 * @param {string} doi
 * @returns {Promise<{success: boolean, bibtex?: string, error?: string}>}
 */
export async function fetchBibtex(doi) {
  // Clean DOI
  doi = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');

  if (!isValidDoiFormat(doi)) {
    return { success: false, error: 'Invalid DOI format' };
  }

  try {
    const response = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
      headers: {
        'Accept': 'application/x-bibtex',
        'User-Agent': 'rev-cli/0.2.0',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status}` };
    }

    const bibtex = await response.text();

    if (!bibtex.includes('@')) {
      return { success: false, error: 'Invalid BibTeX response' };
    }

    return { success: true, bibtex: bibtex.trim() };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Check all DOIs in a .bib file
 * @param {string} bibPath
 * @param {object} options
 * @returns {Promise<{entries: Array, valid: number, invalid: number, missing: number, skipped: number}>}
 */
export async function checkBibDois(bibPath, options = {}) {
  const { checkMissing = false, parallel = 5 } = options;

  const entries = parseBibEntries(bibPath);
  const results = [];

  let valid = 0;
  let invalid = 0;
  let missing = 0;
  let skipped = 0;

  // Process in batches to avoid rate limiting
  for (let i = 0; i < entries.length; i += parallel) {
    const batch = entries.slice(i, i + parallel);

    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        // Skip if marked
        if (entry.skip) {
          skipped++;
          return { ...entry, status: 'skipped', message: 'Marked as no-doi' };
        }

        // No DOI field
        if (!entry.doi) {
          if (entry.noDoi) {
            // Expected - books, theses, etc.
            skipped++;
            return { ...entry, status: 'skipped', message: `${entry.type} typically has no DOI` };
          } else if (entry.expectDoi) {
            // Should have DOI but doesn't
            missing++;
            return { ...entry, status: 'missing', message: 'Expected DOI for article/proceedings' };
          } else {
            skipped++;
            return { ...entry, status: 'skipped', message: 'No DOI field' };
          }
        }

        // Validate DOI format first
        if (!isValidDoiFormat(entry.doi)) {
          invalid++;
          return { ...entry, status: 'invalid', message: 'Invalid DOI format' };
        }

        // Check if DOI resolves
        const check = await checkDoi(entry.doi);
        if (check.valid) {
          valid++;
          return { ...entry, status: 'valid', metadata: check.metadata };
        } else {
          invalid++;
          return { ...entry, status: 'invalid', message: check.error };
        }
      })
    );

    results.push(...batchResults);

    // Small delay between batches to be nice to the API
    if (i + parallel < entries.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return { entries: results, valid, invalid, missing, skipped };
}

/**
 * Search DataCite API (for Zenodo, Figshare, etc.)
 * @param {string} title
 * @param {string} author
 * @param {number} year
 * @returns {Promise<Array>}
 */
async function searchDataCite(title, author = '', year = null) {
  try {
    // DataCite query syntax
    let query = `titles.title:${title.replace(/[{}]/g, '')}`;
    if (author) {
      query += ` AND creators.name:${author}`;
    }
    if (year) {
      query += ` AND publicationYear:${year}`;
    }

    const params = new URLSearchParams({
      query: query,
      'page[size]': '5',
    });

    const response = await fetch(`https://api.datacite.org/dois?${params}`, {
      headers: {
        'Accept': 'application/vnd.api+json',
        'User-Agent': 'rev-cli/0.2.0',
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    const items = data.data || [];

    return items.map(item => {
      const attrs = item.attributes;
      return {
        DOI: item.id,
        title: [attrs.titles?.[0]?.title || ''],
        author: attrs.creators?.map(c => ({ family: c.familyName, given: c.givenName })) || [],
        'published-print': { 'date-parts': [[attrs.publicationYear]] },
        'container-title': [attrs.publisher || ''],
        score: 50, // Base score for DataCite results
        source: 'datacite',
      };
    });
  } catch {
    return [];
  }
}

/**
 * Normalize text for comparison (lowercase, remove special chars)
 * @param {string} text
 * @returns {string}
 */
function normalizeText(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[{}\\]/g, '')  // Remove LaTeX braces
    .replace(/[^a-z0-9\s]/g, ' ')  // Replace special chars with space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if DOI looks like a supplement, figure, or review (not the main paper)
 * @param {string} doi
 * @param {string} title
 * @param {string} journal
 * @returns {boolean}
 */
function isSupplementOrReview(doi, title = '', journal = '') {
  const doiLower = (doi || '').toLowerCase();
  const titleLower = (title || '').toLowerCase();
  const journalLower = (journal || '').toLowerCase();

  // Supplement/figure DOI patterns
  if (/\.suppl|\/suppl|\.figure|\/figure|\.s\d+$|_s\d+$/i.test(doiLower)) {
    return true;
  }

  // F1000/Faculty Opinions (post-publication reviews)
  if (/10\.3410\/f\./i.test(doiLower) || /faculty opinions/i.test(journalLower)) {
    return true;
  }

  // Title suggests it's supplementary material
  if (/^supplementary|^supporting information|^appendix/i.test(titleLower)) {
    return true;
  }

  return false;
}

/**
 * Search for DOI by title and author using Crossref API (+ DataCite fallback)
 * @param {string} title
 * @param {string} author - First author's last name
 * @param {number} year - Publication year (optional, improves accuracy)
 * @param {string} journal - Expected journal name (optional, improves accuracy)
 * @returns {Promise<{found: boolean, doi?: string, confidence?: number, metadata?: object, error?: string}>}
 */
export async function lookupDoi(title, author = '', year = null, journal = '') {
  if (!title || title.length < 10) {
    return { found: false, error: 'Title too short for reliable search' };
  }

  // Check for keywords that suggest Zenodo/DataCite sources
  const likelyZenodo = /\b(IPBES|zenodo|assessment report|secretariat)\b/i.test(title);

  try {
    // Build query - title is most important, add author and journal if available
    let query = title;
    if (author) {
      query = `${title} ${author}`;
    }
    // Add journal to query for better matching
    if (journal) {
      query = `${query} ${journal}`;
    }

    let items = [];

    // Try structured bibliographic query first (more accurate)
    const structuredParams = new URLSearchParams({
      rows: '10',
      select: 'DOI,title,author,published-print,published-online,container-title,score,type',
    });
    structuredParams.set('query.bibliographic', title);
    if (author) {
      structuredParams.set('query.author', author);
    }
    if (journal) {
      structuredParams.set('query.container-title', journal);
    }

    let response = await fetch(`https://api.crossref.org/works?${structuredParams}`, {
      headers: {
        'User-Agent': 'rev-cli/0.2.0 (mailto:dev@example.com)',
      },
    });

    if (response.ok) {
      const data = await response.json();
      items = data.message?.items || [];
    }

    // If structured query found few results, also try query.title (often better for exact matches)
    if (items.length < 5) {
      const titleParams = new URLSearchParams({
        rows: '10',
        select: 'DOI,title,author,published-print,published-online,container-title,score,type',
      });
      titleParams.set('query.title', title);

      const response2 = await fetch(`https://api.crossref.org/works?${titleParams}`, {
        headers: {
          'User-Agent': 'rev-cli/0.2.0 (mailto:dev@example.com)',
        },
      });

      if (response2.ok) {
        const data = await response2.json();
        const newItems = data.message?.items || [];
        // Merge results, avoiding duplicates
        const existingDois = new Set(items.map(i => i.DOI));
        for (const item of newItems) {
          if (!existingDois.has(item.DOI)) {
            items.push(item);
          }
        }
      }
    }

    // If still nothing, try basic query (most lenient)
    if (items.length === 0) {
      const basicParams = new URLSearchParams({
        query: query,
        rows: '10',
        select: 'DOI,title,author,published-print,published-online,container-title,score,type',
      });

      response = await fetch(`https://api.crossref.org/works?${basicParams}`, {
        headers: {
          'User-Agent': 'rev-cli/0.2.0 (mailto:dev@example.com)',
        },
      });

      if (response.ok) {
        const data = await response.json();
        items = data.message?.items || [];
      }
    }

    // Also search DataCite for Zenodo/institutional repos
    if (likelyZenodo || items.length === 0) {
      const dataciteItems = await searchDataCite(title, author, year);
      items = [...items, ...dataciteItems];
    }

    if (items.length === 0) {
      return { found: false, error: 'No results found' };
    }

    const normalizedSearchTitle = normalizeText(title);
    const normalizedJournal = normalizeText(journal);

    // Score the results
    const scored = items.map(item => {
      let score = 0;
      const itemTitle = item.title?.[0] || '';
      const itemJournal = item['container-title']?.[0] || '';
      const normalizedItemTitle = normalizeText(itemTitle);
      const normalizedItemJournal = normalizeText(itemJournal);

      // === PENALTY: Supplement/figure/review DOIs ===
      if (isSupplementOrReview(item.DOI, itemTitle, itemJournal)) {
        score -= 100;  // Heavy penalty - almost never want these
      }

      // === Title similarity (most important) ===
      if (normalizedItemTitle === normalizedSearchTitle) {
        score += 100;  // Exact match
      } else if (normalizedItemTitle.includes(normalizedSearchTitle) ||
                 normalizedSearchTitle.includes(normalizedItemTitle)) {
        score += 50;
      } else {
        // Check word overlap
        const searchWords = normalizedSearchTitle.split(/\s+/).filter(w => w.length > 3);
        const itemWords = normalizedItemTitle.split(/\s+/).filter(w => w.length > 3);
        const overlap = searchWords.filter(w =>
          itemWords.some(iw => iw.includes(w) || w.includes(iw))
        );
        score += (overlap.length / Math.max(searchWords.length, 1)) * 40;
      }

      // === Author match ===
      if (author && item.author) {
        const authorLower = author.toLowerCase();
        const hasAuthor = item.author.some(a =>
          (a.family || '').toLowerCase().includes(authorLower) ||
          authorLower.includes((a.family || '').toLowerCase())
        );
        if (hasAuthor) score += 30;
      }

      // === Journal match (NEW) ===
      if (normalizedJournal && normalizedItemJournal) {
        // Check for journal name match (handles abbreviations)
        const journalWords = normalizedJournal.split(/\s+/).filter(w => w.length > 2);
        const itemJournalWords = normalizedItemJournal.split(/\s+/).filter(w => w.length > 2);

        // Count matching words
        const journalOverlap = journalWords.filter(w =>
          itemJournalWords.some(iw => iw.includes(w) || w.includes(iw))
        );

        if (journalOverlap.length >= Math.min(2, journalWords.length)) {
          score += 40;  // Good journal match
        } else if (journalOverlap.length >= 1) {
          score += 15;  // Partial match
        }

        // Bonus for exact journal match
        if (normalizedItemJournal === normalizedJournal) {
          score += 20;
        }
      }

      // === Year match - CRITICAL for accuracy ===
      const itemYear = item['published-print']?.['date-parts']?.[0]?.[0] ||
                       item['published-online']?.['date-parts']?.[0]?.[0];
      if (year && itemYear) {
        if (itemYear === year) {
          score += 50;  // Exact match - required for high confidence
        } else if (Math.abs(itemYear - year) === 1) {
          score += 20;  // Off by one (common for online-first)
        } else {
          score -= 50;  // Wrong year = likely wrong paper
        }
      } else if (year && !itemYear) {
        score -= 10;  // Can't verify year
      }

      // Crossref's own relevance score (capped)
      score += Math.min(item.score || 0, 10);

      return {
        doi: item.DOI,
        title: itemTitle,
        authors: item.author?.map(a => `${a.given || ''} ${a.family || ''}`.trim()) || [],
        year: itemYear,
        journal: itemJournal,
        score,
        crossrefScore: item.score,
        isSupplement: isSupplementOrReview(item.DOI, itemTitle, itemJournal),
      };
    });

    // Sort by our score
    scored.sort((a, b) => b.score - a.score);

    // Filter out supplements for the "best" pick (but keep in alternatives)
    const mainPapers = scored.filter(s => !s.isSupplement);
    const best = mainPapers.length > 0 ? mainPapers[0] : scored[0];

    // Confidence thresholds
    let confidence = 'low';
    if (best.score >= 120) confidence = 'high';
    else if (best.score >= 70) confidence = 'medium';

    // === NEW: Try DataCite if Crossref confidence is low ===
    if (confidence === 'low' && !likelyZenodo) {
      const dataciteItems = await searchDataCite(title, author, year);
      if (dataciteItems.length > 0) {
        // Score DataCite results with same logic
        for (const dcItem of dataciteItems) {
          const dcTitle = dcItem.title?.[0] || '';
          const normalizedDcTitle = normalizeText(dcTitle);
          let dcScore = 0;

          // Title match
          if (normalizedDcTitle === normalizedSearchTitle) {
            dcScore += 100;
          } else if (normalizedDcTitle.includes(normalizedSearchTitle) ||
                     normalizedSearchTitle.includes(normalizedDcTitle)) {
            dcScore += 50;
          }

          // Year match
          const dcYear = dcItem['published-print']?.['date-parts']?.[0]?.[0];
          if (year && dcYear && dcYear === year) {
            dcScore += 50;
          }

          if (dcScore > best.score) {
            return {
              found: true,
              doi: dcItem.DOI,
              confidence: dcScore >= 120 ? 'high' : dcScore >= 70 ? 'medium' : 'low',
              score: dcScore,
              metadata: {
                title: dcTitle,
                authors: dcItem.author?.map(a => `${a.given || ''} ${a.family || ''}`.trim()) || [],
                year: dcYear,
                journal: dcItem['container-title']?.[0] || '',
              },
              alternatives: scored.slice(0, 2),
              source: 'datacite',
            };
          }
        }
      }
    }

    return {
      found: true,
      doi: best.doi,
      confidence,
      score: best.score,
      metadata: {
        title: best.title,
        authors: best.authors,
        year: best.year,
        journal: best.journal,
      },
      alternatives: scored.filter(s => s.doi !== best.doi).slice(0, 3),
    };
  } catch (err) {
    return { found: false, error: err.message };
  }
}

/**
 * Look up DOIs for all entries missing them in a .bib file
 * @param {string} bibPath
 * @param {object} options
 * @returns {Promise<Array<{key: string, result: object}>>}
 */
export async function lookupMissingDois(bibPath, options = {}) {
  const { parallel = 3, onProgress } = options;

  const entries = parseBibEntries(bibPath);
  const missing = entries.filter(e =>
    !e.doi &&
    !e.skip &&
    !NO_DOI_TYPES.has(e.type)
  );

  const results = [];

  for (let i = 0; i < missing.length; i += parallel) {
    const batch = missing.slice(i, i + parallel);

    const batchResults = await Promise.all(
      batch.map(async (entry) => {
        // Extract first author's last name from the entry
        // This is tricky because BibTeX author format varies
        let author = '';
        if (entry.authorRaw) {
          // Try to get first author's last name
          const firstAuthor = entry.authorRaw.split(' and ')[0];
          const parts = firstAuthor.split(',');
          author = parts[0]?.trim() || '';
        }

        const result = await lookupDoi(entry.title, author, entry.year, entry.journal);

        return {
          key: entry.key,
          title: entry.title,
          type: entry.type,
          journal: entry.journal,
          result,
        };
      })
    );

    results.push(...batchResults);

    if (onProgress) {
      onProgress(Math.min(i + parallel, missing.length), missing.length);
    }

    // Rate limiting
    if (i + parallel < missing.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  return results;
}

/**
 * Add a BibTeX entry to a .bib file
 * @param {string} bibPath
 * @param {string} bibtex
 * @returns {{success: boolean, key?: string, error?: string}}
 */
export function addToBib(bibPath, bibtex) {
  // Extract key from BibTeX
  const keyMatch = bibtex.match(/@\w+\s*\{\s*([^,\s]+)/);
  if (!keyMatch) {
    return { success: false, error: 'Could not extract citation key from BibTeX' };
  }
  const key = keyMatch[1];

  // Check if key already exists
  const existing = fs.existsSync(bibPath) ? fs.readFileSync(bibPath, 'utf-8') : '';
  if (existing.includes(`{${key},`) || existing.includes(`{${key}\n`)) {
    return { success: false, error: `Key "${key}" already exists in ${bibPath}` };
  }

  // Append to file
  const newContent = existing.trim() + '\n\n' + bibtex + '\n';
  fs.writeFileSync(bibPath, newContent, 'utf-8');

  return { success: true, key };
}
