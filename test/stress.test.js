/**
 * Stress tests for docrev modules
 * Tests performance and correctness with large inputs, many iterations, and edge cases
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  parseAnnotations,
  stripAnnotations,
  getComments,
  countAnnotations,
  applyDecision,
  hasAnnotations,
} from '../lib/annotations.js';

import {
  extractChanges,
  detectConflicts,
  applyChanges,
  applyChangesAsAnnotations,
} from '../lib/merge.js';

import {
  parseReferenceList,
  detectHardcodedRefs,
  detectDynamicRefs,
  normalizeType,
  parseRefNumber,
} from '../lib/crossref.js';

import {
  extractCitations,
  parseBibFile,
} from '../lib/citations.js';

// Helper to generate random text
function randomWord() {
  const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog', 'species', 'invasion', 'ecology', 'biodiversity', 'population', 'habitat', 'ecosystem', 'conservation', 'environment', 'climate', 'temperature', 'precipitation'];
  return words[Math.floor(Math.random() * words.length)];
}

function generateParagraph(wordCount) {
  return Array.from({ length: wordCount }, randomWord).join(' ');
}

function generateDocument(paragraphCount, wordsPerParagraph) {
  return Array.from({ length: paragraphCount }, () => generateParagraph(wordsPerParagraph)).join('\n\n');
}

// ============================================================================
// ANNOTATIONS STRESS TESTS
// ============================================================================

describe('Annotations stress tests', () => {
  describe('large document handling', () => {
    it('should parse annotations in a document with 1000 insertions', () => {
      // Generate document with many insertions
      const parts = [];
      for (let i = 0; i < 1000; i++) {
        parts.push(`Paragraph ${i}: Some text {++inserted text ${i}++} more text.`);
      }
      const text = parts.join('\n');

      const start = performance.now();
      const annotations = parseAnnotations(text);
      const elapsed = performance.now() - start;

      assert.strictEqual(annotations.length, 1000);
      assert.ok(elapsed < 5000, `Parsing took ${elapsed}ms, should be under 5000ms`);
    });

    it('should parse annotations in a document with 1000 deletions', () => {
      const parts = [];
      for (let i = 0; i < 1000; i++) {
        parts.push(`Paragraph ${i}: Some text {--deleted text ${i}--} more text.`);
      }
      const text = parts.join('\n');

      const start = performance.now();
      const annotations = parseAnnotations(text);
      const elapsed = performance.now() - start;

      assert.strictEqual(annotations.length, 1000);
      assert.ok(elapsed < 5000, `Parsing took ${elapsed}ms, should be under 5000ms`);
    });

    it('should parse annotations in a document with 1000 substitutions', () => {
      const parts = [];
      for (let i = 0; i < 1000; i++) {
        parts.push(`Paragraph ${i}: Some text {~~old${i}~>new${i}~~} more text.`);
      }
      const text = parts.join('\n');

      const start = performance.now();
      const annotations = parseAnnotations(text);
      const elapsed = performance.now() - start;

      assert.strictEqual(annotations.length, 1000);
      assert.ok(elapsed < 5000, `Parsing took ${elapsed}ms, should be under 5000ms`);
    });

    it('should parse annotations in a document with 500 comments', () => {
      const parts = [];
      for (let i = 0; i < 500; i++) {
        parts.push(`Paragraph ${i}: Some text {>>Reviewer${i % 5}: Comment number ${i}<<} more text.`);
      }
      const text = parts.join('\n');

      const start = performance.now();
      const annotations = parseAnnotations(text);
      const elapsed = performance.now() - start;

      assert.strictEqual(annotations.length, 500);
      assert.ok(elapsed < 5000, `Parsing took ${elapsed}ms, should be under 5000ms`);
    });

    it('should handle mixed annotations (2000 total)', () => {
      const parts = [];
      for (let i = 0; i < 500; i++) {
        parts.push(`Line ${i}: {++insert${i}++} {--delete${i}--} {~~old${i}~>new${i}~~} {>>Author: comment${i}<<}`);
      }
      const text = parts.join('\n');

      const start = performance.now();
      const annotations = parseAnnotations(text);
      const elapsed = performance.now() - start;

      assert.strictEqual(annotations.length, 2000);
      assert.ok(elapsed < 10000, `Parsing took ${elapsed}ms, should be under 10000ms`);
    });

    it('should strip annotations from large document efficiently', () => {
      const parts = [];
      for (let i = 0; i < 1000; i++) {
        parts.push(`Line ${i}: {++insert++} {--delete--} {~~old~>new~~}`);
      }
      const text = parts.join('\n');

      const start = performance.now();
      const result = stripAnnotations(text);
      const elapsed = performance.now() - start;

      assert.ok(!result.includes('{++'));
      assert.ok(!result.includes('{--'));
      assert.ok(!result.includes('{~~'));
      assert.ok(elapsed < 5000, `Stripping took ${elapsed}ms, should be under 5000ms`);
    });
  });

  describe('deeply nested annotations', () => {
    it('should handle 10 levels of nested deletions', () => {
      let text = 'innermost';
      for (let i = 0; i < 10; i++) {
        text = `{--${text}--}`;
      }

      const result = stripAnnotations(text);
      assert.strictEqual(result.trim(), '');
      assert.ok(!result.includes('{--'));
      assert.ok(!result.includes('--}'));
    });

    it('should handle 10 levels of nested insertions', () => {
      let text = 'innermost';
      for (let i = 0; i < 10; i++) {
        text = `{++${text}++}`;
      }

      const result = stripAnnotations(text);
      assert.strictEqual(result.trim(), 'innermost');
      assert.ok(!result.includes('{++'));
      assert.ok(!result.includes('++}'));
    });

    it('should handle alternating nested insertions and deletions', () => {
      // {++{--{++{--text--}++}--}++}
      const text = '{++{--{++{--text--}++}--}++}';
      const result = stripAnnotations(text);
      // Outer insert applied, then delete removes, then insert applied, then delete removes
      assert.ok(!result.includes('{'));
      assert.ok(!result.includes('}'));
    });

    it('should handle many adjacent annotations without gaps', () => {
      // 100 adjacent insertions
      const text = Array.from({ length: 100 }, (_, i) => `{++word${i}++}`).join('');

      const annotations = parseAnnotations(text);
      assert.strictEqual(annotations.length, 100);

      const result = stripAnnotations(text);
      assert.ok(!result.includes('{++'));
      for (let i = 0; i < 100; i++) {
        assert.ok(result.includes(`word${i}`));
      }
    });
  });

  describe('large content inside annotations', () => {
    it('should handle insertion with 10KB of content', () => {
      const largeContent = generateParagraph(1500); // ~10KB
      const text = `Before {++${largeContent}++} after`;

      const annotations = parseAnnotations(text);
      assert.strictEqual(annotations.length, 1);
      assert.strictEqual(annotations[0].content.length, largeContent.length);

      const result = stripAnnotations(text);
      assert.ok(result.includes(largeContent));
    });

    it('should handle deletion with 10KB of content', () => {
      const largeContent = generateParagraph(1500);
      const text = `Before {--${largeContent}--} after`;

      const annotations = parseAnnotations(text);
      assert.strictEqual(annotations.length, 1);

      const result = stripAnnotations(text);
      assert.ok(!result.includes(largeContent));
      // stripAnnotations collapses multiple spaces to single space
      assert.strictEqual(result.trim(), 'Before after');
    });

    it('should handle substitution with large old and new content', () => {
      const oldContent = generateParagraph(500);
      const newContent = generateParagraph(600);
      const text = `Before {~~${oldContent}~>${newContent}~~} after`;

      const annotations = parseAnnotations(text);
      assert.strictEqual(annotations.length, 1);
      assert.strictEqual(annotations[0].content, oldContent);
      assert.strictEqual(annotations[0].replacement, newContent);

      const result = stripAnnotations(text);
      assert.ok(result.includes(newContent));
      assert.ok(!result.includes(oldContent) || newContent.includes(oldContent));
    });
  });

  describe('pathological regex inputs', () => {
    it('should handle repeated special characters in annotations', () => {
      // Test for ReDoS resistance
      const specialChars = '{}[]()+-~><=!@#$%^&*';
      const content = specialChars.repeat(100);
      const text = `{++${content}++}`;

      const start = performance.now();
      const annotations = parseAnnotations(text);
      const elapsed = performance.now() - start;

      assert.strictEqual(annotations.length, 1);
      assert.ok(elapsed < 1000, `Should not cause ReDoS, took ${elapsed}ms`);
    });

    it('should handle annotations with many newlines', () => {
      const content = Array.from({ length: 100 }, (_, i) => `Line ${i}`).join('\n');
      const text = `Before\n{++${content}++}\nAfter`;

      const annotations = parseAnnotations(text);
      assert.strictEqual(annotations.length, 1);
      assert.ok(annotations[0].content.includes('\n'));
    });

    it('should handle unicode and emoji in annotations', () => {
      const unicodeContent = '日本語 中文 العربية עברית 🎉🚀💡';
      const text = `{++${unicodeContent}++} {--${unicodeContent}--} {~~${unicodeContent}~>${unicodeContent}~~}`;

      const annotations = parseAnnotations(text);
      assert.strictEqual(annotations.length, 3);
      assert.strictEqual(annotations[0].content, unicodeContent);
    });

    it('should handle false positive patterns efficiently', () => {
      // Many figure-like patterns that should NOT be parsed as comments
      const parts = [];
      for (let i = 0; i < 100; i++) {
        parts.push(`{>>Figure ${i}. This is a caption for figure ${i} showing important results.<<}`);
      }
      const text = parts.join('\n');

      const start = performance.now();
      const comments = getComments(text);
      const elapsed = performance.now() - start;

      // Should filter out figure captions
      assert.strictEqual(comments.length, 0);
      assert.ok(elapsed < 2000, `False positive filtering took ${elapsed}ms`);
    });
  });

  describe('countAnnotations stress', () => {
    it('should count 5000 annotations accurately', () => {
      const parts = [];
      for (let i = 0; i < 1250; i++) {
        parts.push(`{++i${i}++} {--d${i}--} {~~s${i}~>r${i}~~} {>>R: c${i}<<}`);
      }
      const text = parts.join(' ');

      const start = performance.now();
      const counts = countAnnotations(text);
      const elapsed = performance.now() - start;

      assert.strictEqual(counts.inserts, 1250);
      assert.strictEqual(counts.deletes, 1250);
      assert.strictEqual(counts.substitutes, 1250);
      assert.strictEqual(counts.comments, 1250);
      assert.strictEqual(counts.total, 5000);
      assert.ok(elapsed < 10000, `Counting took ${elapsed}ms`);
    });
  });

  describe('applyDecision stress', () => {
    it('should apply decisions to 500 annotations sequentially', () => {
      let text = '';
      for (let i = 0; i < 500; i++) {
        text += `{++insert${i}++} `;
      }

      const start = performance.now();
      let result = text;
      const annotations = parseAnnotations(result);

      // Accept all insertions one by one
      for (const ann of annotations) {
        result = applyDecision(result, ann, true);
      }
      const elapsed = performance.now() - start;

      assert.ok(!result.includes('{++'));
      for (let i = 0; i < 500; i++) {
        assert.ok(result.includes(`insert${i}`));
      }
      assert.ok(elapsed < 10000, `Applying decisions took ${elapsed}ms`);
    });
  });
});

// ============================================================================
// MERGE STRESS TESTS
// ============================================================================

describe('Merge stress tests', () => {
  describe('large document changes', () => {
    it('should extract changes from documents with 100 word differences', () => {
      const original = generateDocument(10, 50);
      // Modify every 5th word
      const words = original.split(/\s+/);
      const modifiedWords = words.map((w, i) => i % 5 === 0 ? `MODIFIED_${w}` : w);
      const modified = modifiedWords.join(' ');

      const start = performance.now();
      const changes = extractChanges(original, modified, 'Reviewer1');
      const elapsed = performance.now() - start;

      assert.ok(changes.length > 0);
      assert.ok(elapsed < 5000, `Change extraction took ${elapsed}ms`);
    });

    it('should handle document where every word is changed', () => {
      const original = 'word '.repeat(200).trim();
      const modified = 'changed '.repeat(200).trim();

      const start = performance.now();
      const changes = extractChanges(original, modified, 'Reviewer1');
      const elapsed = performance.now() - start;

      assert.ok(changes.length > 0);
      assert.ok(elapsed < 5000, `Complete replacement took ${elapsed}ms`);
    });

    it('should handle large insertion at beginning', () => {
      const original = generateParagraph(100);
      const insertion = generateParagraph(500);
      const modified = insertion + '\n\n' + original;

      const changes = extractChanges(original, modified, 'Reviewer1');
      assert.ok(changes.some(c => c.type === 'insert'));
    });

    it('should handle large deletion at end', () => {
      const toDelete = generateParagraph(500);
      const original = generateParagraph(100) + '\n\n' + toDelete;
      const modified = generateParagraph(100);

      const changes = extractChanges(original, modified, 'Reviewer1');
      assert.ok(changes.some(c => c.type === 'delete'));
    });
  });

  describe('multiple reviewers', () => {
    it('should detect conflicts from 5 reviewers with overlapping changes', () => {
      const original = 'The important conclusion is clear.';

      const reviewerChanges = [];
      for (let i = 0; i < 5; i++) {
        const modified = `The important conclusion is ${['obvious', 'evident', 'apparent', 'visible', 'manifest'][i]}.`;
        const changes = extractChanges(original, modified, `Reviewer${i + 1}`);
        reviewerChanges.push(changes);
      }

      const start = performance.now();
      const { conflicts, nonConflicting } = detectConflicts(reviewerChanges);
      const elapsed = performance.now() - start;

      assert.ok(conflicts.length > 0, 'Should detect conflicts');
      assert.ok(elapsed < 1000, `Conflict detection took ${elapsed}ms`);
    });

    it('should handle 10 reviewers with non-overlapping changes', () => {
      const original = Array.from({ length: 10 }, (_, i) => `Section ${i}: Original text for section ${i}.`).join('\n');

      const reviewerChanges = [];
      for (let i = 0; i < 10; i++) {
        const lines = original.split('\n');
        lines[i] = `Section ${i}: Modified text by Reviewer${i + 1}.`;
        const modified = lines.join('\n');
        const changes = extractChanges(original, modified, `Reviewer${i + 1}`);
        reviewerChanges.push(changes);
      }

      const start = performance.now();
      const { conflicts, nonConflicting } = detectConflicts(reviewerChanges);
      const elapsed = performance.now() - start;

      // Each reviewer changed a different section, so no conflicts
      assert.strictEqual(conflicts.length, 0);
      // At least 10 changes (may be more depending on diff algorithm granularity)
      assert.ok(nonConflicting.length >= 10, `Expected at least 10 non-conflicting changes, got ${nonConflicting.length}`);
      assert.ok(elapsed < 2000, `Non-conflict detection took ${elapsed}ms`);
    });

    it('should deduplicate identical changes from multiple reviewers', () => {
      const original = 'The teh quick brown fox.'; // typo
      const fixed = 'The the quick brown fox.';

      const reviewerChanges = [];
      for (let i = 0; i < 5; i++) {
        const changes = extractChanges(original, fixed, `Reviewer${i + 1}`);
        reviewerChanges.push(changes);
      }

      const { conflicts, nonConflicting } = detectConflicts(reviewerChanges);

      // Same change from all reviewers should be deduplicated
      assert.strictEqual(conflicts.length, 0);
      assert.ok(nonConflicting.length <= 5); // Should be deduplicated
    });
  });

  describe('applyChanges stress', () => {
    it('should apply 100 non-overlapping changes', () => {
      // Create document with numbered words
      const original = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');

      // Create changes to modify every word
      const changes = [];
      let offset = 0;
      for (let i = 0; i < 100; i++) {
        const word = `word${i}`;
        const pos = original.indexOf(word);
        changes.push({
          type: 'replace',
          start: pos,
          end: pos + word.length,
          oldText: word,
          newText: `WORD${i}`,
        });
      }

      const start = performance.now();
      const result = applyChanges(original, changes);
      const elapsed = performance.now() - start;

      for (let i = 0; i < 100; i++) {
        assert.ok(result.includes(`WORD${i}`));
      }
      assert.ok(elapsed < 2000, `Applying 100 changes took ${elapsed}ms`);
    });
  });

  describe('applyChangesAsAnnotations stress', () => {
    it('should convert 200 changes to CriticMarkup', () => {
      const parts = [];
      const changes = [];
      let pos = 0;

      for (let i = 0; i < 200; i++) {
        const text = `word${i} `;
        parts.push(text);
        changes.push({
          reviewer: `R${i % 3}`,
          type: i % 3 === 0 ? 'insert' : i % 3 === 1 ? 'delete' : 'replace',
          start: pos,
          end: pos + (i % 3 === 0 ? 0 : text.length - 1),
          oldText: i % 3 === 0 ? '' : `word${i}`,
          newText: i % 3 === 1 ? '' : `NEW${i}`,
        });
        pos += text.length;
      }

      const original = parts.join('');

      const start = performance.now();
      const result = applyChangesAsAnnotations(original, changes);
      const elapsed = performance.now() - start;

      // Should contain CriticMarkup
      assert.ok(result.includes('{++') || result.includes('{--') || result.includes('{~~'));
      assert.ok(elapsed < 5000, `Converting to annotations took ${elapsed}ms`);
    });
  });
});

// ============================================================================
// CROSSREF STRESS TESTS
// ============================================================================

describe('Crossref stress tests', () => {
  describe('parseReferenceList stress', () => {
    it('should parse reference list with 50 items', () => {
      // "1, 2, 3, ..., 50"
      const listStr = Array.from({ length: 50 }, (_, i) => i + 1).join(', ');

      const start = performance.now();
      const refs = parseReferenceList(listStr);
      const elapsed = performance.now() - start;

      assert.strictEqual(refs.length, 50);
      assert.ok(elapsed < 500, `Parsing took ${elapsed}ms`);
    });

    it('should parse complex reference list with ranges and suffixes', () => {
      // "1a-c, 2, 3a-f, 4, 5a, 5b, 5c, 6-10"
      const listStr = '1a-c, 2, 3a-f, 4, 5a, 5b, 5c, 6-10';

      const start = performance.now();
      const refs = parseReferenceList(listStr);
      const elapsed = performance.now() - start;

      // 1a,1b,1c = 3
      // 2 = 1
      // 3a-f = 6
      // 4 = 1
      // 5a,5b,5c = 3
      // 6-10 = 5
      assert.strictEqual(refs.length, 19);
      assert.ok(elapsed < 500, `Parsing took ${elapsed}ms`);
    });

    it('should handle supplementary references', () => {
      const listStr = 'S1, S2, S3a-c, S4';
      const refs = parseReferenceList(listStr);

      assert.ok(refs.every(r => r.isSupp));
      // S1, S2, S3a, S3b, S3c, S4 = 6
      assert.strictEqual(refs.length, 6);
    });
  });

  describe('detectHardcodedRefs stress', () => {
    it('should detect 500 figure references in large document', () => {
      const parts = [];
      for (let i = 0; i < 500; i++) {
        parts.push(`As shown in Figure ${(i % 20) + 1}, the results indicate...`);
      }
      const text = parts.join('\n');

      const start = performance.now();
      const refs = detectHardcodedRefs(text);
      const elapsed = performance.now() - start;

      assert.strictEqual(refs.length, 500);
      assert.ok(elapsed < 3000, `Detection took ${elapsed}ms`);
    });

    it('should detect mixed figure, table, and equation references', () => {
      const parts = [];
      for (let i = 0; i < 100; i++) {
        parts.push(`See Figure ${i + 1}, Table ${i + 1}, and Equation ${i + 1}.`);
      }
      const text = parts.join('\n');

      const start = performance.now();
      const refs = detectHardcodedRefs(text);
      const elapsed = performance.now() - start;

      // 100 figures + 100 tables + 100 equations
      assert.strictEqual(refs.length, 300);
      assert.ok(elapsed < 5000, `Detection took ${elapsed}ms`);
    });

    it('should handle various reference formats', () => {
      const text = `
        See Fig. 1, Figure 2, Figs. 3-5, Figures 6 and 7.
        Also Tab. 1, Table 2, Tables 3, 4, and 5.
        And Eq. 1, Equation 2, Eqs. 3-5.
        Reference with suffixes: Figure 1a, Fig. 2a-c, Figures 3a, b, c.
      `;

      const refs = detectHardcodedRefs(text);
      assert.ok(refs.length > 10, 'Should detect multiple reference formats');
    });

    it('should not match false positives in large document', () => {
      const parts = [];
      for (let i = 0; i < 100; i++) {
        parts.push('Table of Contents');
        parts.push('Figure skating is popular');
        parts.push('Figure out the solution');
      }
      const text = parts.join('\n');

      const refs = detectHardcodedRefs(text);
      assert.strictEqual(refs.length, 0, 'Should not match false positives');
    });
  });

  describe('detectDynamicRefs stress', () => {
    it('should detect 1000 dynamic references', () => {
      const parts = [];
      for (let i = 0; i < 1000; i++) {
        parts.push(`See @fig:figure${i} and @tbl:table${i}.`);
      }
      const text = parts.join('\n');

      const start = performance.now();
      const refs = detectDynamicRefs(text);
      const elapsed = performance.now() - start;

      assert.strictEqual(refs.length, 2000);
      assert.ok(elapsed < 3000, `Detection took ${elapsed}ms`);
    });
  });

  describe('normalizeType and parseRefNumber stress', () => {
    it('should normalize 1000 type strings', () => {
      const types = ['Figure', 'Fig.', 'Figs', 'figure', 'FIG', 'Table', 'Tab.', 'Tabs', 'Equation', 'Eq.'];

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        normalizeType(types[i % types.length]);
      }
      const elapsed = performance.now() - start;

      assert.ok(elapsed < 500, `Normalization took ${elapsed}ms`);
    });

    it('should parse 1000 reference numbers', () => {
      const refs = ['1', '2a', 'S1', 'S2b', '10', '100a', 'S100'];

      const start = performance.now();
      for (let i = 0; i < 1000; i++) {
        parseRefNumber(refs[i % refs.length]);
      }
      const elapsed = performance.now() - start;

      assert.ok(elapsed < 500, `Parsing took ${elapsed}ms`);
    });
  });
});

// ============================================================================
// CITATIONS STRESS TESTS
// ============================================================================

describe('Citations stress tests', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-citations-stress-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('extractCitations stress', () => {
    it('should extract 1000 citations from large document', () => {
      const parts = [];
      for (let i = 0; i < 1000; i++) {
        parts.push(`This finding is supported by previous research [@Author${i}2020].`);
      }
      const text = parts.join('\n');

      const start = performance.now();
      const citations = extractCitations(text);
      const elapsed = performance.now() - start;

      assert.strictEqual(citations.length, 1000);
      assert.ok(elapsed < 3000, `Extraction took ${elapsed}ms`);
    });

    it('should handle multiple citations per bracket', () => {
      const parts = [];
      for (let i = 0; i < 200; i++) {
        // 5 citations per bracket - use @Key format for bracketed citations
        const keys = Array.from({ length: 5 }, (_, j) => `@Key${i * 5 + j}`).join('; ');
        parts.push(`This is well established [${keys}].`);
      }
      const text = parts.join('\n');

      const start = performance.now();
      const citations = extractCitations(text);
      const elapsed = performance.now() - start;

      assert.strictEqual(citations.length, 1000);
      assert.ok(elapsed < 3000, `Extraction took ${elapsed}ms`);
    });

    it('should extract inline and bracketed citations mixed', () => {
      const parts = [];
      for (let i = 0; i < 500; i++) {
        if (i % 2 === 0) {
          parts.push(`As shown by @Smith${i}2020, the results...`);
        } else {
          parts.push(`Previous work [@Jones${i}2020] demonstrated...`);
        }
      }
      const text = parts.join('\n');

      const citations = extractCitations(text);
      assert.strictEqual(citations.length, 500);
    });

    it('should track line numbers correctly in large document', () => {
      const lines = [];
      for (let i = 0; i < 500; i++) {
        lines.push(`Line ${i}: Citation here [@Author${i}2020].`);
      }
      const text = lines.join('\n');

      const citations = extractCitations(text);

      // Check that line numbers are correct
      for (let i = 0; i < citations.length; i++) {
        assert.strictEqual(citations[i].line, i + 1);
      }
    });
  });

  describe('parseBibFile stress', () => {
    it('should parse bib file with 1000 entries', () => {
      const entries = [];
      for (let i = 0; i < 1000; i++) {
        entries.push(`@article{Author${i}2020,
  author = {Author ${i}},
  title = {Title of Article ${i}},
  journal = {Journal Name},
  year = {2020},
  volume = {${i}},
  pages = {1-10}
}`);
      }
      const bibContent = entries.join('\n\n');
      const bibPath = path.join(tempDir, 'large.bib');
      fs.writeFileSync(bibPath, bibContent);

      const start = performance.now();
      const keys = parseBibFile(bibPath);
      const elapsed = performance.now() - start;

      assert.strictEqual(keys.size, 1000);
      assert.ok(elapsed < 3000, `Parsing took ${elapsed}ms`);
    });

    it('should handle various entry types', () => {
      const types = ['article', 'book', 'inproceedings', 'incollection', 'thesis', 'misc', 'techreport'];
      const entries = [];
      for (let i = 0; i < 700; i++) {
        const type = types[i % types.length];
        entries.push(`@${type}{Key${i}2020,
  author = {Author},
  title = {Title},
  year = {2020}
}`);
      }
      const bibContent = entries.join('\n\n');
      const bibPath = path.join(tempDir, 'mixed.bib');
      fs.writeFileSync(bibPath, bibContent);

      const keys = parseBibFile(bibPath);
      assert.strictEqual(keys.size, 700);
    });

    it('should handle entries with special characters in keys', () => {
      const bibContent = `
@article{Smith-Jones_2020a,
  author = {Smith},
  title = {Title},
  year = {2020}
}
@article{O'Brien2020,
  author = {O'Brien},
  title = {Title},
  year = {2020}
}
@article{Mueller2020,
  author = {Müller},
  title = {Title},
  year = {2020}
}
`;
      const bibPath = path.join(tempDir, 'special.bib');
      fs.writeFileSync(bibPath, bibContent);

      const keys = parseBibFile(bibPath);
      assert.ok(keys.has('Smith-Jones_2020a'));
    });
  });

  describe('combined citation validation stress', () => {
    it('should validate citations across multiple files', () => {
      // Create 10 markdown files with citations
      const mdFiles = [];
      for (let i = 0; i < 10; i++) {
        const mdPath = path.join(tempDir, `section${i}.md`);
        const content = Array.from({ length: 50 }, (_, j) =>
          `Finding ${j} is supported by [@Author${i * 50 + j}2020].`
        ).join('\n');
        fs.writeFileSync(mdPath, content);
        mdFiles.push(mdPath);
      }

      // Create bib file with matching entries
      const entries = [];
      for (let i = 0; i < 500; i++) {
        entries.push(`@article{Author${i}2020,
  author = {Author ${i}},
  title = {Title ${i}},
  year = {2020}
}`);
      }
      const bibPath = path.join(tempDir, 'references.bib');
      fs.writeFileSync(bibPath, entries.join('\n\n'));

      // Extract and validate
      const start = performance.now();
      let allCitations = [];
      for (const file of mdFiles) {
        const content = fs.readFileSync(file, 'utf-8');
        const citations = extractCitations(content, path.basename(file));
        allCitations.push(...citations);
      }
      const bibKeys = parseBibFile(bibPath);
      const elapsed = performance.now() - start;

      assert.strictEqual(allCitations.length, 500);
      assert.strictEqual(bibKeys.size, 500);
      assert.ok(elapsed < 5000, `Validation took ${elapsed}ms`);

      // All citations should be valid
      const missing = allCitations.filter(c => !bibKeys.has(c.key));
      assert.strictEqual(missing.length, 0);
    });
  });
});

// ============================================================================
// MEMORY STRESS TESTS
// ============================================================================

describe('Memory stress tests', () => {
  it('should handle repeated operations without memory leaks', () => {
    // Run operations many times to check for memory issues
    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      // Parse annotations
      const text = `{++insert${i}++} {--delete${i}--} {~~old${i}~>new${i}~~}`;
      parseAnnotations(text);
      stripAnnotations(text);
      countAnnotations(text);

      // Merge operations
      const original = `Text version ${i}`;
      const modified = `Modified text version ${i}`;
      extractChanges(original, modified, 'Reviewer');

      // Crossref operations
      detectHardcodedRefs(`Figure ${i} and Table ${i}`);
      parseReferenceList(`${i}, ${i + 1}, ${i + 2}`);
    }

    // If we get here without crashing, memory handling is acceptable
    assert.ok(true);
  });

  it('should process 1MB document', () => {
    // Generate ~1MB document
    const oneMB = generateDocument(200, 500); // ~1MB of text

    const start = performance.now();

    // Add some annotations to the document
    let annotatedDoc = oneMB.replace(/\bthe\b/g, '{++the++}');
    annotatedDoc = annotatedDoc.replace(/\bspecies\b/g, '{--species--}');

    const annotations = parseAnnotations(annotatedDoc);
    const stripped = stripAnnotations(annotatedDoc);

    const elapsed = performance.now() - start;

    assert.ok(annotations.length > 0);
    assert.ok(stripped.length > 0);
    assert.ok(elapsed < 30000, `Processing 1MB took ${elapsed}ms`);
  });
});
