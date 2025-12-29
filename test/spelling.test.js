import { test, describe } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  extractWords,
  checkSpelling,
  loadDictionaryFile,
  saveDictionaryFile,
  addWord,
  removeWord,
  listWords,
  getGlobalDictPath,
  getProjectDictPath,
  clearCache,
} from '../lib/spelling.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('spelling.js', () => {
  describe('extractWords', () => {
    test('extracts words from text', () => {
      const words = extractWords('Hello world, this is a test.');
      const wordList = words.map(w => w.word);
      assert.ok(wordList.includes('world'));
      assert.ok(wordList.includes('this'));
      assert.ok(wordList.includes('test'));
    });

    test('skips very short words', () => {
      const words = extractWords('I am a test.');
      const wordList = words.map(w => w.word);
      assert.ok(!wordList.includes('I'));
      assert.ok(!wordList.includes('a'));
    });

    test('skips all-caps acronyms', () => {
      const words = extractWords('The NASA and CERN projects.');
      const wordList = words.map(w => w.word);
      assert.ok(!wordList.includes('NASA'));
      assert.ok(!wordList.includes('CERN'));
      assert.ok(wordList.includes('projects'));
    });

    test('skips code blocks', () => {
      const words = extractWords('```\ncode block\n```\nreal text');
      const wordList = words.map(w => w.word);
      assert.ok(!wordList.includes('code'));
      assert.ok(wordList.includes('real'));
    });

    test('skips URLs', () => {
      const words = extractWords('Visit https://example.com for info.');
      const wordList = words.map(w => w.word);
      assert.ok(!wordList.includes('https'));
      assert.ok(!wordList.includes('example'));
      assert.ok(wordList.includes('info'));
    });

    test('handles markdown links', () => {
      const words = extractWords('Click [here](https://example.com) now.');
      const wordList = words.map(w => w.word);
      assert.ok(wordList.includes('here'));
      assert.ok(!wordList.includes('example'));
    });

    test('includes line numbers', () => {
      const words = extractWords('first line\nsecond line');
      const firstLine = words.filter(w => w.line === 1);
      const secondLine = words.filter(w => w.line === 2);
      assert.ok(firstLine.length > 0);
      assert.ok(secondLine.length > 0);
    });
  });

  describe('checkSpelling', () => {
    test('finds misspelled words', async () => {
      clearCache();
      const { misspelled } = await checkSpelling('This is a tset.');
      assert.ok(misspelled.some(i => i.word === 'tset'));
    });

    test('provides suggestions', async () => {
      clearCache();
      const { misspelled } = await checkSpelling('This is a tset.');
      const tset = misspelled.find(i => i.word === 'tset');
      assert.ok(tset);
      assert.ok(tset.suggestions.includes('test'));
    });

    test('accepts correct words', async () => {
      clearCache();
      const { misspelled, possibleNames } = await checkSpelling('This is correct English text.');
      assert.strictEqual(misspelled.length, 0);
      assert.strictEqual(possibleNames.length, 0);
    });

    test('only reports each word once', async () => {
      clearCache();
      const { misspelled } = await checkSpelling('tset tset tset');
      const tsetIssues = misspelled.filter(i => i.word === 'tset');
      assert.strictEqual(tsetIssues.length, 1);
    });

    test('separates capitalized words as possible names', async () => {
      clearCache();
      const { misspelled, possibleNames } = await checkSpelling('Chytry wrote about tset.');
      assert.ok(misspelled.some(i => i.word === 'tset'));
      assert.ok(possibleNames.some(i => i.word === 'Chytry'));
    });
  });

  describe('dictionary management', () => {
    const tempDir = path.join(__dirname, 'temp-spelling');
    const dictPath = path.join(tempDir, '.rev-dictionary');

    test('loadDictionaryFile returns empty set for missing file', () => {
      const words = loadDictionaryFile('/nonexistent/.rev-dictionary');
      assert.strictEqual(words.size, 0);
    });

    test('saveDictionaryFile and loadDictionaryFile round-trip', () => {
      fs.mkdirSync(tempDir, { recursive: true });
      const words = new Set(['apple', 'banana', 'cherry']);
      saveDictionaryFile(words, dictPath);

      const loaded = loadDictionaryFile(dictPath);
      assert.strictEqual(loaded.size, 3);
      assert.ok(loaded.has('apple'));
      assert.ok(loaded.has('banana'));
      assert.ok(loaded.has('cherry'));

      fs.rmSync(tempDir, { recursive: true });
    });

    test('addWord adds new word', () => {
      fs.mkdirSync(tempDir, { recursive: true });
      clearCache();

      const added = addWord('testword', false, tempDir);
      assert.strictEqual(added, true);

      const words = loadDictionaryFile(getProjectDictPath(tempDir));
      assert.ok(words.has('testword'));

      fs.rmSync(tempDir, { recursive: true });
    });

    test('addWord returns false for existing word', () => {
      fs.mkdirSync(tempDir, { recursive: true });
      clearCache();

      addWord('duplicate', false, tempDir);
      const added = addWord('duplicate', false, tempDir);
      assert.strictEqual(added, false);

      fs.rmSync(tempDir, { recursive: true });
    });

    test('removeWord removes word', () => {
      fs.mkdirSync(tempDir, { recursive: true });
      clearCache();

      addWord('toremove', false, tempDir);
      const removed = removeWord('toremove', false, tempDir);
      assert.strictEqual(removed, true);

      const words = loadDictionaryFile(getProjectDictPath(tempDir));
      assert.ok(!words.has('toremove'));

      fs.rmSync(tempDir, { recursive: true });
    });

    test('listWords returns sorted list', () => {
      fs.mkdirSync(tempDir, { recursive: true });
      clearCache();

      addWord('zebra', false, tempDir);
      addWord('apple', false, tempDir);
      addWord('mango', false, tempDir);

      const list = listWords(false, tempDir);
      assert.deepStrictEqual(list, ['apple', 'mango', 'zebra']);

      fs.rmSync(tempDir, { recursive: true });
    });
  });
});
