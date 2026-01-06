/**
 * Template variable substitution for rev
 *
 * Supported variables:
 *   {{date}}       - Current date (YYYY-MM-DD)
 *   {{date:format}} - Custom date format (e.g., {{date:MMMM D, YYYY}})
 *   {{version}}    - Version from rev.yaml
 *   {{word_count}} - Total word count
 *   {{author}}     - First author name
 *   {{authors}}    - All authors (comma-separated)
 *   {{title}}      - Document title
 *   {{year}}       - Current year
 */

import * as fs from 'fs';
import { countWords } from './utils.js';

/**
 * Format date with simple pattern
 * @param {Date} date
 * @param {string} format - Pattern (YYYY, MM, DD, MMMM, MMM, D)
 * @returns {string}
 */
function formatDate(date, format = 'YYYY-MM-DD') {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const monthsShort = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
  ];

  const year = date.getFullYear();
  const month = date.getMonth();
  const day = date.getDate();

  // Use placeholders to avoid replacement conflicts (e.g., D in December)
  return format
    .replace('YYYY', '\x00YEAR\x00')
    .replace('MMMM', '\x00MONTHFULL\x00')
    .replace('MMM', '\x00MONTHSHORT\x00')
    .replace('MM', '\x00MONTHNUM\x00')
    .replace('DD', '\x00DAYPAD\x00')
    .replace(/\bD\b/, '\x00DAY\x00')
    .replace('\x00YEAR\x00', year.toString())
    .replace('\x00MONTHFULL\x00', months[month])
    .replace('\x00MONTHSHORT\x00', monthsShort[month])
    .replace('\x00MONTHNUM\x00', (month + 1).toString().padStart(2, '0'))
    .replace('\x00DAYPAD\x00', day.toString().padStart(2, '0'))
    .replace('\x00DAY\x00', day.toString());
}


/**
 * Get first author name from authors array
 * @param {Array|string} authors
 * @returns {string}
 */
function getFirstAuthor(authors) {
  if (!authors || authors.length === 0) return '';

  const first = Array.isArray(authors) ? authors[0] : authors;

  if (typeof first === 'string') return first;
  if (first.name) return first.name;

  return '';
}

/**
 * Get all author names
 * @param {Array|string} authors
 * @returns {string}
 */
function getAllAuthors(authors) {
  if (!authors) return '';
  if (typeof authors === 'string') return authors;

  return authors
    .map(a => typeof a === 'string' ? a : a.name)
    .filter(Boolean)
    .join(', ');
}

/**
 * Process template variables in text
 * @param {string} text - Text with {{variable}} placeholders
 * @param {object} config - rev.yaml config
 * @param {object} options - Additional options
 * @param {string[]} options.sections - Section file contents for word count
 * @returns {string} Text with variables replaced
 */
export function processVariables(text, config = {}, options = {}) {
  const now = new Date();
  let result = text;

  // Calculate word count from sections if provided
  let wordCount = 0;
  if (options.sectionContents) {
    for (const content of options.sectionContents) {
      wordCount += countWords(content);
    }
  }

  // {{date}} - Current date
  result = result.replace(/\{\{date\}\}/g, formatDate(now));

  // {{date:format}} - Custom date format
  result = result.replace(/\{\{date:([^}]+)\}\}/g, (match, format) => {
    return formatDate(now, format);
  });

  // {{year}} - Current year
  result = result.replace(/\{\{year\}\}/g, now.getFullYear().toString());

  // {{version}} - From config
  result = result.replace(/\{\{version\}\}/g, config.version || '');

  // {{title}} - Document title
  result = result.replace(/\{\{title\}\}/g, config.title || '');

  // {{author}} - First author
  result = result.replace(/\{\{author\}\}/g, getFirstAuthor(config.authors));

  // {{authors}} - All authors
  result = result.replace(/\{\{authors\}\}/g, getAllAuthors(config.authors));

  // {{word_count}} - Total word count
  result = result.replace(/\{\{word_count\}\}/g, wordCount.toLocaleString());

  return result;
}

/**
 * Check if text contains any template variables
 * @param {string} text
 * @returns {boolean}
 */
export function hasVariables(text) {
  return /\{\{[^}]+\}\}/.test(text);
}

/**
 * List all variables found in text
 * @param {string} text
 * @returns {string[]}
 */
export function findVariables(text) {
  const matches = text.match(/\{\{([^}]+)\}\}/g) || [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
}
