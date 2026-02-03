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
// @ts-ignore - nspell has no types
import nspell from 'nspell';
// @ts-ignore - dictionary-en has no types
import dictionaryEn from 'dictionary-en';
// @ts-ignore - dictionary-en-gb has no types
import dictionaryEnGb from 'dictionary-en-gb';
import { scientificWords } from './scientific-words.js';
import type { SpellingIssue, SpellingResult } from './types.js';

const DICT_NAME = '.rev-dictionary';

// Cache for the spellchecker instances (one per language)
const spellcheckerCache: Record<string, any> = {
  en: null,
  'en-gb': null,
};

interface WordLocation {
  word: string;
  line: number;
  column: number;
}

interface CheckSpellingOptions {
  projectDir?: string;
  lang?: 'en' | 'en-gb';
}

interface CheckFileOptions {
  projectDir?: string;
  lang?: 'en' | 'en-gb';
}

/**
 * Get the global dictionary path
 */
export function getGlobalDictPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE;
  return path.join(home!, DICT_NAME);
}

/**
 * Get the project dictionary path
 */
export function getProjectDictPath(directory: string = '.'): string {
  return path.join(directory, DICT_NAME);
}

/**
 * Load custom words from a dictionary file
 */
export function loadDictionaryFile(dictPath: string): Set<string> {
  const words = new Set<string>();

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
 */
export function saveDictionaryFile(words: Set<string>, dictPath: string): void {
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
 */
export function loadAllCustomWords(projectDir: string = '.'): Set<string> {
  const globalWords = loadDictionaryFile(getGlobalDictPath());
  const projectWords = loadDictionaryFile(getProjectDictPath(projectDir));

  return new Set([...globalWords, ...projectWords]);
}

/**
 * Add word to dictionary
 */
export function addWord(word: string, global: boolean = true, projectDir: string = '.'): boolean {
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
 */
export function removeWord(word: string, global: boolean = true, projectDir: string = '.'): boolean {
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
 */
export function listWords(global: boolean = true, projectDir: string = '.'): string[] {
  const dictPath = global ? getGlobalDictPath() : getProjectDictPath(projectDir);
  const words = loadDictionaryFile(dictPath);
  return [...words].sort();
}

/**
 * Initialize the spellchecker with custom words
 */
export async function getSpellchecker(projectDir: string = '.', lang: 'en' | 'en-gb' = 'en'): Promise<any> {
  if (spellcheckerCache[lang]) {
    return spellcheckerCache[lang];
  }

  // Select dictionary based on language
  const dictionary = lang === 'en-gb' ? dictionaryEnGb : dictionaryEn;
  const spell = nspell(dictionary);

  // Add scientific/academic words
  for (const word of scientificWords) {
    spell.add(word);
  }

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
export function clearCache(): void {
  spellcheckerCache.en = null;
  spellcheckerCache['en-gb'] = null;
}

/**
 * Extract words from text, filtering out non-words
 */
export function extractWords(text: string): WordLocation[] {
  const words: WordLocation[] = [];
  const lines = text.split('\n');
  let inCodeBlock = false;
  let inFrontmatter = false;

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    if (!line) continue;
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
 */
function looksLikeName(word: string): boolean {
  // Capitalized, not all caps, reasonable length for a name
  return /^[A-Z][a-z]{2,}$/.test(word);
}

/**
 * Check spelling in text
 */
export async function checkSpelling(text: string, options: CheckSpellingOptions = {}): Promise<SpellingResult> {
  const { projectDir = '.', lang = 'en' } = options;
  const spell = await getSpellchecker(projectDir, lang);
  const words = extractWords(text);
  const misspelled: SpellingIssue[] = [];
  const possibleNames: SpellingIssue[] = [];
  const seen = new Set<string>();
  const seenNames = new Set<string>();

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
 */
export async function checkFile(filePath: string, options: CheckFileOptions = {}): Promise<SpellingResult> {
  const text = fs.readFileSync(filePath, 'utf-8');
  const result = await checkSpelling(text, options);

  return {
    misspelled: result.misspelled.map(issue => ({ ...issue, file: filePath })),
    possibleNames: result.possibleNames.map(issue => ({ ...issue, file: filePath })),
  };
}
