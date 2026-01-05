/**
 * Tests for annotations.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseAnnotations,
  stripAnnotations,
  getComments,
  countAnnotations,
  applyDecision,
  getTrackChanges,
  setCommentStatus,
  hasAnnotations,
} from '../lib/annotations.js';

describe('parseAnnotations', () => {
  it('should parse insertions', () => {
    const text = 'Hello {++world++}!';
    const annotations = parseAnnotations(text);
    assert.strictEqual(annotations.length, 1);
    assert.strictEqual(annotations[0].type, 'insert');
    assert.strictEqual(annotations[0].content, 'world');
  });

  it('should parse deletions', () => {
    const text = 'Hello {--world--}!';
    const annotations = parseAnnotations(text);
    assert.strictEqual(annotations.length, 1);
    assert.strictEqual(annotations[0].type, 'delete');
    assert.strictEqual(annotations[0].content, 'world');
  });

  it('should parse substitutions', () => {
    const text = 'Hello {~~world~>universe~~}!';
    const annotations = parseAnnotations(text);
    assert.strictEqual(annotations.length, 1);
    assert.strictEqual(annotations[0].type, 'substitute');
    assert.strictEqual(annotations[0].content, 'world');
    assert.strictEqual(annotations[0].replacement, 'universe');
  });

  it('should parse comments', () => {
    const text = 'Hello {>>Author: this is a comment<<}!';
    const annotations = parseAnnotations(text);
    assert.strictEqual(annotations.length, 1);
    assert.strictEqual(annotations[0].type, 'comment');
    assert.strictEqual(annotations[0].author, 'Author');
    assert.strictEqual(annotations[0].content, 'this is a comment');
  });

  it('should parse comments without author', () => {
    const text = 'Hello {>>a comment<<}!';
    const annotations = parseAnnotations(text);
    assert.strictEqual(annotations.length, 1);
    assert.strictEqual(annotations[0].type, 'comment');
    // Author is empty string when not specified
    assert.ok(annotations[0].author === null || annotations[0].author === '');
    assert.strictEqual(annotations[0].content, 'a comment');
  });

  it('should parse multiple annotations', () => {
    const text = '{++New++} {--old--} text {~~changed~>updated~~}';
    const annotations = parseAnnotations(text);
    assert.strictEqual(annotations.length, 3);
  });

  it('should track line numbers', () => {
    const text = 'Line 1\n{++inserted++}\nLine 3';
    const annotations = parseAnnotations(text);
    assert.strictEqual(annotations[0].line, 2);
  });
});

describe('stripAnnotations', () => {
  it('should apply insertions', () => {
    const text = 'Hello {++world++}!';
    const result = stripAnnotations(text);
    assert.strictEqual(result, 'Hello world!');
  });

  it('should apply deletions', () => {
    const text = 'Hello {--world--}!';
    const result = stripAnnotations(text);
    // Whitespace is preserved - only annotation removed
    assert.strictEqual(result, 'Hello !');
  });

  it('should preserve double spaces from deletions', () => {
    const text = 'word {--deleted--} next';
    const result = stripAnnotations(text);
    // Double space preserved - no whitespace manipulation
    assert.strictEqual(result, 'word  next');
  });

  it('should apply substitutions', () => {
    const text = 'Hello {~~world~>universe~~}!';
    const result = stripAnnotations(text);
    assert.strictEqual(result, 'Hello universe!');
  });

  it('should strip comments', () => {
    const text = 'Hello{>>comment<<} world!';
    const result = stripAnnotations(text);
    assert.strictEqual(result, 'Hello world!');
  });

  it('should keep comments when option set', () => {
    const text = 'Hello{>>comment<<} world!';
    const result = stripAnnotations(text, { keepComments: true });
    assert.strictEqual(result, 'Hello{>>comment<<} world!');
  });
});

describe('getComments', () => {
  it('should extract comments with author', () => {
    const text = '{>>Reviewer: Please clarify<<}';
    const comments = getComments(text);
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].author, 'Reviewer');
    assert.strictEqual(comments[0].content, 'Please clarify');
  });

  it('should detect resolved comments', () => {
    const text = '{>>Author: Done [RESOLVED]<<}';
    const comments = getComments(text);
    assert.strictEqual(comments[0].resolved, true);
    assert.strictEqual(comments[0].content, 'Done');
  });

  it('should filter pending only', () => {
    const text = '{>>A: pending<<} {>>B: done [RESOLVED]<<}';
    const comments = getComments(text, { pendingOnly: true });
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].author, 'A');
  });

  it('should filter resolved only', () => {
    const text = '{>>A: pending<<} {>>B: done [RESOLVED]<<}';
    const comments = getComments(text, { resolvedOnly: true });
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].author, 'B');
  });
});

describe('countAnnotations', () => {
  it('should count all annotation types', () => {
    const text = '{++ins++} {--del--} {~~sub~>rep~~} {>>comment<<}';
    const counts = countAnnotations(text);
    assert.strictEqual(counts.inserts, 1);
    assert.strictEqual(counts.deletes, 1);
    assert.strictEqual(counts.substitutes, 1);
    assert.strictEqual(counts.comments, 1);
    assert.strictEqual(counts.total, 4);
  });
});

describe('applyDecision', () => {
  it('should accept insertions', () => {
    const text = 'Hello {++world++}!';
    const annotations = parseAnnotations(text);
    const result = applyDecision(text, annotations[0], true);
    assert.strictEqual(result, 'Hello world!');
  });

  it('should reject insertions', () => {
    const text = 'Hello {++world++}!';
    const annotations = parseAnnotations(text);
    const result = applyDecision(text, annotations[0], false);
    assert.strictEqual(result, 'Hello !');
  });

  it('should accept deletions', () => {
    const text = 'Hello {--world--}!';
    const annotations = parseAnnotations(text);
    const result = applyDecision(text, annotations[0], true);
    assert.strictEqual(result, 'Hello !');
  });

  it('should reject deletions', () => {
    const text = 'Hello {--world--}!';
    const annotations = parseAnnotations(text);
    const result = applyDecision(text, annotations[0], false);
    assert.strictEqual(result, 'Hello world!');
  });

  it('should accept substitutions', () => {
    const text = 'Hello {~~world~>universe~~}!';
    const annotations = parseAnnotations(text);
    const result = applyDecision(text, annotations[0], true);
    assert.strictEqual(result, 'Hello universe!');
  });

  it('should reject substitutions', () => {
    const text = 'Hello {~~world~>universe~~}!';
    const annotations = parseAnnotations(text);
    const result = applyDecision(text, annotations[0], false);
    assert.strictEqual(result, 'Hello world!');
  });
});

describe('getTrackChanges', () => {
  it('should return only track changes (no comments)', () => {
    const text = '{++new++} {--old--} {~~a~>b~~} {>>comment<<}';
    const changes = getTrackChanges(text);
    assert.strictEqual(changes.length, 3);
    assert.ok(changes.every(c => c.type !== 'comment'));
  });

  it('should return empty array for comments-only text', () => {
    const text = '{>>Author: just a comment<<}';
    const changes = getTrackChanges(text);
    assert.strictEqual(changes.length, 0);
  });
});

describe('setCommentStatus', () => {
  it('should mark comment as resolved', () => {
    const text = '{>>Reviewer: Please fix<<}';
    const comments = getComments(text);
    const result = setCommentStatus(text, comments[0], true);
    assert.ok(result.includes('[RESOLVED]'));
  });

  it('should unmark resolved comment', () => {
    const text = '{>>Reviewer: Done [RESOLVED]<<}';
    const comments = getComments(text);
    const result = setCommentStatus(text, comments[0], false);
    assert.ok(!result.includes('[RESOLVED]'));
  });
});

// Edge cases
describe('parseAnnotations edge cases', () => {
  it('should handle multiline insertions', () => {
    const text = '{++line 1\nline 2++}';
    const annotations = parseAnnotations(text);
    assert.strictEqual(annotations.length, 1);
    assert.ok(annotations[0].content.includes('\n'));
  });

  it('should handle nested braces in content', () => {
    const text = '{++function() { return true; }++}';
    const annotations = parseAnnotations(text);
    assert.strictEqual(annotations.length, 1);
  });

  it('should handle empty content', () => {
    const text = '{++  ++}';
    const annotations = parseAnnotations(text);
    // Should parse but content is whitespace
    assert.strictEqual(annotations.length, 1);
  });

  it('should handle special characters in substitution', () => {
    const text = '{~~$100~>$200~~}';
    const annotations = parseAnnotations(text);
    assert.strictEqual(annotations[0].content, '$100');
    assert.strictEqual(annotations[0].replacement, '$200');
  });

  it('should handle unicode text', () => {
    const text = '{++日本語のテキスト++}';
    const annotations = parseAnnotations(text);
    assert.strictEqual(annotations[0].content, '日本語のテキスト');
  });

  it('should not parse figure captions as comments', () => {
    const text = '{>>Figure 1. A sample figure showing the results.<<}';
    const comments = getComments(text);
    assert.strictEqual(comments.length, 0);
  });

  it('should handle adjacent annotations', () => {
    const text = '{++a++}{++b++}';
    const annotations = parseAnnotations(text);
    assert.strictEqual(annotations.length, 2);
  });

  it('should provide context for annotations', () => {
    const text = 'Before {++inserted++} after';
    const annotations = parseAnnotations(text);
    assert.ok(annotations[0].before.includes('Before'));
    assert.ok(annotations[0].after.includes('after'));
  });
});

describe('stripAnnotations edge cases', () => {
  it('should handle text with no annotations', () => {
    const text = 'Plain text without annotations';
    const result = stripAnnotations(text);
    assert.strictEqual(result, text);
  });

  it('should handle multiple nested annotations', () => {
    const text = '{++first {~~old~>new~~} last++}';
    const result = stripAnnotations(text);
    // Order of operations: substitutions first, then insertions
    assert.ok(!result.includes('{'));
  });

  it('should preserve markdown formatting', () => {
    const text = '**bold {++text++}**';
    const result = stripAnnotations(text);
    assert.strictEqual(result, '**bold text**');
  });

  it('should handle highlights', () => {
    const text = '{==highlighted text==}';
    const result = stripAnnotations(text);
    assert.strictEqual(result, 'highlighted text');
  });
});

describe('getComments edge cases', () => {
  it('should handle long author names', () => {
    const text = '{>>Dr. John Smith Jr.: comment<<}';
    const comments = getComments(text);
    assert.strictEqual(comments[0].author, 'Dr. John Smith Jr.');
  });

  it('should handle colons in comment text', () => {
    const text = '{>>Author: Note: this is important<<}';
    const comments = getComments(text);
    assert.strictEqual(comments[0].content, 'Note: this is important');
  });

  it('should handle checkmark resolved marker', () => {
    const text = '{>>Author: Done [✓]<<}';
    const comments = getComments(text);
    assert.strictEqual(comments[0].resolved, true);
  });

  it('should count comments correctly across files', () => {
    const text = '{>>R1: first<<} {>>R2: second<<} {>>R1: third<<}';
    const comments = getComments(text);
    assert.strictEqual(comments.length, 3);
  });
});

describe('nested annotations', () => {
  it('should strip double-nested deletions', () => {
    const text = '{--{--text--}--}';
    const result = stripAnnotations(text);
    assert.strictEqual(result, '');
    assert.ok(!result.includes('{--'));
    assert.ok(!result.includes('--}'));
  });

  it('should strip triple-nested deletions', () => {
    const text = '{--{--{--# Abstract--}--}--}';
    const result = stripAnnotations(text);
    assert.strictEqual(result, '');
  });

  it('should strip double-nested insertions', () => {
    const text = '{++{++text++}++}';
    const result = stripAnnotations(text);
    assert.strictEqual(result, 'text');
  });

  it('should handle mixed nested annotations', () => {
    const text = '{--{++inserted++}--}';
    const result = stripAnnotations(text);
    // Insertion becomes text, then deletion removes it
    assert.strictEqual(result, '');
  });

  it('should handle nested substitutions without leaving markers', () => {
    // Nested substitutions are complex - regex can't perfectly handle them
    // The key requirement is: no malformed markers left behind
    const text = '{~~{~~old~>middle~~}~>new~~}';
    const result = stripAnnotations(text);
    // Should not contain any annotation markers
    assert.ok(!result.includes('{~~'), 'Should not contain {~~');
    assert.ok(!result.includes('~~}'), 'Should not contain ~~}');
    assert.ok(!result.includes('~>'), 'Should not contain ~>');
  });

  it('should clean up orphaned markers', () => {
    const text = 'text --}--} more';
    const result = stripAnnotations(text);
    assert.ok(!result.includes('--}--}'));
  });

  it('should clean up partial opening markers', () => {
    const text = '{--{-- text';
    const result = stripAnnotations(text);
    assert.ok(!result.includes('{--{--'));
  });

  it('should handle deeply nested real-world case', () => {
    // This is the pattern that was causing issues in production
    const text = '{--{--{--# Abstract--}--}--}\n\nBackground: Alien plant species';
    const result = stripAnnotations(text);
    assert.strictEqual(result, '\n\nBackground: Alien plant species');
    assert.ok(!result.includes('{--'));
    assert.ok(!result.includes('--}'));
  });

  it('should preserve comments when stripping nested changes', () => {
    const text = '{--{--deleted--}--} {>>Author: comment<<}';
    const result = stripAnnotations(text, { keepComments: true });
    assert.strictEqual(result, ' {>>Author: comment<<}');
  });
});

describe('hasAnnotations', () => {
  it('should return true for text with insertions', () => {
    assert.strictEqual(hasAnnotations('{++text++}'), true);
  });

  it('should return true for text with deletions', () => {
    assert.strictEqual(hasAnnotations('{--text--}'), true);
  });

  it('should return true for text with substitutions', () => {
    assert.strictEqual(hasAnnotations('{~~old~>new~~}'), true);
  });

  it('should return true for text with comments', () => {
    assert.strictEqual(hasAnnotations('{>>comment<<}'), true);
  });

  it('should return false for plain text', () => {
    assert.strictEqual(hasAnnotations('Plain text'), false);
  });

  it('should return false for empty text', () => {
    assert.strictEqual(hasAnnotations(''), false);
  });
});
