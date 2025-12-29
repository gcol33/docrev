/**
 * Citation validation utilities
 * Check that all [@cite] references exist in .bib file
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Extract all citation keys from markdown text
 * Handles: [@Key], [@Key1; @Key2], @Key (inline)
 * @param {string} text
 * @returns {Array<{key: string, line: number, file: string}>}
 */
export function extractCitations(text, file = '') {
  const citations = [];
  const lines = text.split('\n');

  // Pattern for bracketed citations: [@Key] or [@Key1; @Key2]
  const bracketPattern = /\[@([^\]]+)\]/g;
  // Pattern for inline citations: @Key (word boundary)
  const inlinePattern = /(?<!\[)@([A-Za-z][A-Za-z0-9_-]*\d{4}[a-z]?)(?![;\]])/g;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Skip code blocks and comments
    if (line.trim().startsWith('```') || line.trim().startsWith('<!--')) continue;

    // Bracketed citations
    let match;
    while ((match = bracketPattern.exec(line)) !== null) {
      // Split by ; for multiple citations
      const keys = match[1].split(';').map(k => k.trim().replace(/^@/, ''));
      for (const key of keys) {
        if (key) {
          citations.push({ key, line: lineNum + 1, file });
        }
      }
    }

    // Inline citations (reset lastIndex)
    inlinePattern.lastIndex = 0;
    while ((match = inlinePattern.exec(line)) !== null) {
      citations.push({ key: match[1], line: lineNum + 1, file });
    }
  }

  return citations;
}

/**
 * Parse .bib file and extract all entry keys
 * @param {string} bibPath
 * @returns {Set<string>}
 */
export function parseBibFile(bibPath) {
  const keys = new Set();

  if (!fs.existsSync(bibPath)) {
    return keys;
  }

  const content = fs.readFileSync(bibPath, 'utf-8');

  // Pattern for bib entries: @type{key,
  const entryPattern = /@\w+\s*\{\s*([^,\s]+)\s*,/g;

  let match;
  while ((match = entryPattern.exec(content)) !== null) {
    keys.add(match[1]);
  }

  return keys;
}

/**
 * Validate citations against bib file
 * @param {string[]} mdFiles - Markdown files to check
 * @param {string} bibPath - Path to .bib file
 * @returns {{valid: Array, missing: Array, unused: Array, duplicates: Array}}
 */
export function validateCitations(mdFiles, bibPath) {
  // Collect all citations from markdown
  const allCitations = [];
  for (const file of mdFiles) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf-8');
    const citations = extractCitations(text, path.basename(file));
    allCitations.push(...citations);
  }

  // Get bib keys
  const bibKeys = parseBibFile(bibPath);

  // Categorize
  const valid = [];
  const missing = [];
  const citedKeys = new Set();
  const keyOccurrences = new Map();

  for (const citation of allCitations) {
    citedKeys.add(citation.key);

    // Track occurrences for duplicates
    if (!keyOccurrences.has(citation.key)) {
      keyOccurrences.set(citation.key, []);
    }
    keyOccurrences.get(citation.key).push(citation);

    if (bibKeys.has(citation.key)) {
      valid.push(citation);
    } else {
      missing.push(citation);
    }
  }

  // Find unused bib entries
  const unused = [...bibKeys].filter(key => !citedKeys.has(key));

  // Find duplicate citations (same key cited multiple times - not an error, just info)
  const duplicates = [...keyOccurrences.entries()]
    .filter(([key, occurrences]) => occurrences.length > 1)
    .map(([key, occurrences]) => ({ key, count: occurrences.length, locations: occurrences }));

  return { valid, missing, unused, duplicates };
}

/**
 * Get citation statistics
 * @param {string[]} mdFiles
 * @param {string} bibPath
 * @returns {object}
 */
export function getCitationStats(mdFiles, bibPath) {
  const result = validateCitations(mdFiles, bibPath);
  const bibKeys = parseBibFile(bibPath);

  return {
    totalCitations: result.valid.length + result.missing.length,
    uniqueCited: new Set([...result.valid, ...result.missing].map(c => c.key)).size,
    valid: result.valid.length,
    missing: result.missing.length,
    missingKeys: [...new Set(result.missing.map(c => c.key))],
    bibEntries: bibKeys.size,
    unused: result.unused.length,
    unusedKeys: result.unused,
  };
}
