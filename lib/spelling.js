/**
 * Spelling checker module with global and project dictionaries
 *
 * Uses nspell (Hunspell-compatible) for English spellchecking.
 * Custom words stored in:
 * - ~/.rev-dictionary (global)
 * - .rev-dictionary (project-local)
 */

import * as fs from 'fs';
import * as path from 'path';
import nspell from 'nspell';
import dictionaryEn from 'dictionary-en';
import dictionaryEnGb from 'dictionary-en-gb';

const DICT_NAME = '.rev-dictionary';

// Cache for the spellchecker instances (one per language)
const spellcheckerCache = {
  en: null,
  'en-gb': null,
};

/**
 * Get the global dictionary path
 * @returns {string}
 */
export function getGlobalDictPath() {
  const home = process.env.HOME || process.env.USERPROFILE;
  return path.join(home, DICT_NAME);
}

/**
 * Get the project dictionary path
 * @param {string} directory
 * @returns {string}
 */
export function getProjectDictPath(directory = '.') {
  return path.join(directory, DICT_NAME);
}

/**
 * Load custom words from a dictionary file
 * @param {string} dictPath
 * @returns {Set<string>}
 */
export function loadDictionaryFile(dictPath) {
  const words = new Set();

  if (fs.existsSync(dictPath)) {
    const content = fs.readFileSync(dictPath, 'utf-8');
    for (const line of content.split('\n')) {
      const word = line.trim();
      if (word && !word.startsWith('#')) {
        words.add(word.toLowerCase());
      }
    }
  }

  return words;
}

/**
 * Save words to a dictionary file
 * @param {Set<string>} words
 * @param {string} dictPath
 */
export function saveDictionaryFile(words, dictPath) {
  const header = `# Custom dictionary for docrev
# One word per line, lines starting with # are comments
`;
  const content = header + [...words].sort().join('\n') + '\n';

  // Ensure directory exists
  const dir = path.dirname(dictPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(dictPath, content, 'utf-8');
}

/**
 * Load all custom words (global + project)
 * @param {string} projectDir
 * @returns {Set<string>}
 */
export function loadAllCustomWords(projectDir = '.') {
  const globalWords = loadDictionaryFile(getGlobalDictPath());
  const projectWords = loadDictionaryFile(getProjectDictPath(projectDir));

  return new Set([...globalWords, ...projectWords]);
}

/**
 * Add word to dictionary
 * @param {string} word
 * @param {boolean} global - Add to global dictionary
 * @param {string} projectDir
 * @returns {boolean} True if word was added
 */
export function addWord(word, global = true, projectDir = '.') {
  const dictPath = global ? getGlobalDictPath() : getProjectDictPath(projectDir);
  const words = loadDictionaryFile(dictPath);
  const normalizedWord = word.trim().toLowerCase();

  if (words.has(normalizedWord)) {
    return false;
  }

  words.add(normalizedWord);
  saveDictionaryFile(words, dictPath);

  // Clear cache so new word is picked up
  clearCache();

  return true;
}

/**
 * Remove word from dictionary
 * @param {string} word
 * @param {boolean} global
 * @param {string} projectDir
 * @returns {boolean} True if word was removed
 */
export function removeWord(word, global = true, projectDir = '.') {
  const dictPath = global ? getGlobalDictPath() : getProjectDictPath(projectDir);
  const words = loadDictionaryFile(dictPath);
  const normalizedWord = word.trim().toLowerCase();

  if (!words.has(normalizedWord)) {
    return false;
  }

  words.delete(normalizedWord);
  saveDictionaryFile(words, dictPath);

  // Clear cache
  clearCache();

  return true;
}

/**
 * List words in dictionary
 * @param {boolean} global
 * @param {string} projectDir
 * @returns {string[]}
 */
export function listWords(global = true, projectDir = '.') {
  const dictPath = global ? getGlobalDictPath() : getProjectDictPath(projectDir);
  const words = loadDictionaryFile(dictPath);
  return [...words].sort();
}

/**
 * Initialize the spellchecker with custom words
 * @param {string} projectDir
 * @param {string} lang - Language: 'en' (US) or 'en-gb' (British)
 * @returns {Promise<object>}
 */
export async function getSpellchecker(projectDir = '.', lang = 'en') {
  if (spellcheckerCache[lang]) {
    return spellcheckerCache[lang];
  }

  // Select dictionary based on language
  const dictionary = lang === 'en-gb' ? dictionaryEnGb : dictionaryEn;
  const spell = nspell(dictionary);

  // Add custom words
  const customWords = loadAllCustomWords(projectDir);
  for (const word of customWords) {
    spell.add(word);
  }

  spellcheckerCache[lang] = spell;
  return spell;
}

/**
 * Clear spellchecker cache (call after modifying dictionaries)
 */
export function clearCache() {
  spellcheckerCache.en = null;
  spellcheckerCache['en-gb'] = null;
}

/**
 * Extract words from text, filtering out non-words
 * @param {string} text
 * @returns {Array<{word: string, line: number, column: number}>}
 */
export function extractWords(text) {
  const words = [];
  const lines = text.split('\n');
  let inCodeBlock = false;
  let inFrontmatter = false;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    const trimmed = line.trim();

    // Track YAML frontmatter (only at start of file)
    if (lineNum === 0 && trimmed === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter) {
      if (trimmed === '---') {
        inFrontmatter = false;
      }
      continue;
    }

    // Track code blocks
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock) {
      continue;
    }

    // Skip URLs and paths
    if (trimmed.startsWith('http') || trimmed.startsWith('/')) {
      continue;
    }

    // Remove markdown syntax, URLs, code spans, LaTeX, etc.
    let cleanLine = line
      .replace(/`[^`]+`/g, '')           // inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // links (keep text)
      .replace(/!\[[^\]]*\]\([^)]+\)/g, '')     // images
      .replace(/@(fig|tbl|eq):\w+/g, '')        // cross-refs
      .replace(/\{[^}]+\}/g, '')                // CriticMarkup/templates
      .replace(/https?:\/\/\S+/g, '')           // URLs
      .replace(/\$[^$]+\$/g, '')                // inline LaTeX math
      .replace(/\\\w+/g, '')                    // LaTeX commands like \frac
      .replace(/[#*_~`>|]/g, ' ');              // markdown chars

    // Extract words (letters and apostrophes only)
    const wordPattern = /[a-zA-Z][a-zA-Z']*[a-zA-Z]|[a-zA-Z]/g;
    let match;

    while ((match = wordPattern.exec(cleanLine)) !== null) {
      const word = match[0];

      // Skip:
      // - Very short words (1-2 chars)
      // - All caps (acronyms like NASA)
      // - File extensions (.md, .tex, .png)
      // - CamelCase (likely code or citations like vanKleunen)
      // - Words starting with capital in middle of sentence (proper nouns/names)
      if (word.length < 3 ||
          /^[A-Z]+$/.test(word) ||
          /^\w{2,4}$/.test(word) && /^(md|tex|png|jpg|pdf|csv|js|py|html|css|yaml|json|docx|bib)$/i.test(word) ||
          /[a-z][A-Z]/.test(word)) {
        continue;
      }

      words.push({
        word,
        line: lineNum + 1,
        column: match.index + 1,
      });
    }
  }

  return words;
}

/**
 * Check if a word looks like a proper noun (name)
 * @param {string} word
 * @returns {boolean}
 */
function looksLikeName(word) {
  // Capitalized, not all caps, reasonable length for a name
  return /^[A-Z][a-z]{2,}$/.test(word);
}

/**
 * Check spelling in text
 * @param {string} text
 * @param {object} options
 * @param {string} options.projectDir
 * @param {string} options.lang - 'en' (US) or 'en-gb' (British)
 * @returns {Promise<{misspelled: Array, possibleNames: Array}>}
 */
export async function checkSpelling(text, options = {}) {
  const { projectDir = '.', lang = 'en' } = options;
  const spell = await getSpellchecker(projectDir, lang);
  const words = extractWords(text);
  const misspelled = [];
  const possibleNames = [];
  const seen = new Set();
  const seenNames = new Set();

  for (const { word, line, column } of words) {
    // Skip if already reported this word
    const key = word.toLowerCase();
    if (seen.has(key) || seenNames.has(key)) {
      continue;
    }

    if (!spell.correct(word)) {
      // Check if it looks like a proper noun/name
      if (looksLikeName(word)) {
        seenNames.add(key);
        possibleNames.push({ word, line, column });
      } else {
        seen.add(key);
        misspelled.push({
          word,
          line,
          column,
          suggestions: spell.suggest(word).slice(0, 5),
        });
      }
    }
  }

  return { misspelled, possibleNames };
}

/**
 * Check spelling in a file
 * @param {string} filePath
 * @param {object} options
 * @param {string} options.projectDir
 * @param {string} options.lang
 * @returns {Promise<{misspelled: Array, possibleNames: Array}>}
 */
export async function checkFile(filePath, options = {}) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const result = await checkSpelling(text, options);

  return {
    misspelled: result.misspelled.map(issue => ({ ...issue, file: filePath })),
    possibleNames: result.possibleNames.map(issue => ({ ...issue, file: filePath })),
  };
}
