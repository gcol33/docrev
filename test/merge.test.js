/**
 * Tests for merge.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  extractChangesWordLevel as extractChanges,
  detectConflicts,
  applyChanges,
  applyChangesAsAnnotations,
  formatConflict,
} from '../lib/merge.js';

describe('extractChanges', () => {
  it('should detect insertions', () => {
    const original = 'Hello world';
    const modified = 'Hello beautiful world';
    const changes = extractChanges(original, modified, 'Reviewer1');

    assert.ok(changes.some(c => c.type === 'insert'));
    assert.ok(changes.some(c => c.newText.includes('beautiful')));
  });

  it('should detect deletions', () => {
    const original = 'Hello beautiful world';
    const modified = 'Hello world';
    const changes = extractChanges(original, modified, 'Reviewer1');

    assert.ok(changes.some(c => c.type === 'delete'));
  });

  it('should detect replacements', () => {
    const original = 'Hello world';
    const modified = 'Hello universe';
    const changes = extractChanges(original, modified, 'Reviewer1');

    assert.ok(changes.some(c => c.type === 'replace'));
    assert.ok(changes.some(c => c.oldText === 'world' && c.newText === 'universe'));
  });

  it('should track reviewer name', () => {
    const original = 'text';
    const modified = 'modified text';
    const changes = extractChanges(original, modified, 'Dr. Smith');

    assert.ok(changes.every(c => c.reviewer === 'Dr. Smith'));
  });

  it('should handle identical texts', () => {
    const text = 'Same text';
    const changes = extractChanges(text, text, 'Reviewer');
    assert.strictEqual(changes.length, 0);
  });

  it('should track positions correctly', () => {
    const original = 'The quick brown fox';
    const modified = 'The slow brown fox';
    const changes = extractChanges(original, modified, 'R1');

    const replace = changes.find(c => c.type === 'replace');
    assert.ok(replace);
    assert.strictEqual(replace.start, 4); // Position of 'quick'
  });
});

describe('detectConflicts', () => {
  it('should detect overlapping changes from different reviewers', () => {
    const changes1 = [{
      reviewer: 'R1',
      type: 'replace',
      start: 0,
      end: 5,
      oldText: 'hello',
      newText: 'hi',
    }];

    const changes2 = [{
      reviewer: 'R2',
      type: 'replace',
      start: 0,
      end: 5,
      oldText: 'hello',
      newText: 'hey',
    }];

    const { conflicts, nonConflicting } = detectConflicts([changes1, changes2]);

    assert.strictEqual(conflicts.length, 1);
    assert.strictEqual(conflicts[0].changes.length, 2);
  });

  it('should not flag identical changes as conflicts', () => {
    const changes1 = [{
      reviewer: 'R1',
      type: 'replace',
      start: 0,
      end: 5,
      oldText: 'hello',
      newText: 'hi',
    }];

    const changes2 = [{
      reviewer: 'R2',
      type: 'replace',
      start: 0,
      end: 5,
      oldText: 'hello',
      newText: 'hi', // Same replacement
    }];

    const { conflicts, nonConflicting } = detectConflicts([changes1, changes2]);

    assert.strictEqual(conflicts.length, 0);
    // Should be deduplicated
    assert.strictEqual(nonConflicting.length, 1);
  });

  it('should allow non-overlapping changes', () => {
    const changes1 = [{
      reviewer: 'R1',
      type: 'replace',
      start: 0,
      end: 5,
      oldText: 'hello',
      newText: 'hi',
    }];

    const changes2 = [{
      reviewer: 'R2',
      type: 'replace',
      start: 10,
      end: 15,
      oldText: 'world',
      newText: 'earth',
    }];

    const { conflicts, nonConflicting } = detectConflicts([changes1, changes2]);

    assert.strictEqual(conflicts.length, 0);
    assert.strictEqual(nonConflicting.length, 2);
  });

  it('should detect conflicting insertions at same position', () => {
    const changes1 = [{
      reviewer: 'R1',
      type: 'insert',
      start: 5,
      end: 5,
      oldText: '',
      newText: ' new',
    }];

    const changes2 = [{
      reviewer: 'R2',
      type: 'insert',
      start: 5,
      end: 5,
      oldText: '',
      newText: ' different',
    }];

    const { conflicts } = detectConflicts([changes1, changes2]);

    assert.strictEqual(conflicts.length, 1);
  });
});

describe('applyChanges', () => {
  it('should apply insertions', () => {
    const original = 'Hello world';
    const changes = [{
      type: 'insert',
      start: 6,
      end: 6,
      newText: 'beautiful ',
    }];

    const result = applyChanges(original, changes);
    assert.strictEqual(result, 'Hello beautiful world');
  });

  it('should apply deletions', () => {
    const original = 'Hello beautiful world';
    const changes = [{
      type: 'delete',
      start: 6,
      end: 16,
      oldText: 'beautiful ',
    }];

    const result = applyChanges(original, changes);
    assert.strictEqual(result, 'Hello world');
  });

  it('should apply replacements', () => {
    const original = 'Hello world';
    const changes = [{
      type: 'replace',
      start: 6,
      end: 11,
      oldText: 'world',
      newText: 'universe',
    }];

    const result = applyChanges(original, changes);
    assert.strictEqual(result, 'Hello universe');
  });

  it('should apply multiple changes from end to start', () => {
    const original = 'one two three';
    const changes = [
      { type: 'replace', start: 0, end: 3, oldText: 'one', newText: 'ONE' },
      { type: 'replace', start: 8, end: 13, oldText: 'three', newText: 'THREE' },
    ];

    const result = applyChanges(original, changes);
    assert.strictEqual(result, 'ONE two THREE');
  });
});

describe('applyChangesAsAnnotations', () => {
  it('should convert insertions to CriticMarkup', () => {
    const original = 'Hello world';
    const changes = [{
      reviewer: 'R1',
      type: 'insert',
      start: 6,
      end: 6,
      newText: 'beautiful ',
    }];

    const result = applyChangesAsAnnotations(original, changes);
    assert.ok(result.includes('{++beautiful ++}'));
  });

  it('should convert deletions to CriticMarkup', () => {
    const original = 'Hello beautiful world';
    const changes = [{
      reviewer: 'R1',
      type: 'delete',
      start: 6,
      end: 16,
      oldText: 'beautiful ',
    }];

    const result = applyChangesAsAnnotations(original, changes);
    assert.ok(result.includes('{--beautiful --}'));
  });

  it('should convert replacements to CriticMarkup', () => {
    const original = 'Hello world';
    const changes = [{
      reviewer: 'R1',
      type: 'replace',
      start: 6,
      end: 11,
      oldText: 'world',
      newText: 'universe',
    }];

    const result = applyChangesAsAnnotations(original, changes);
    assert.ok(result.includes('{~~world~>universe~~}'));
  });
});

describe('formatConflict', () => {
  it('should format conflict with context', () => {
    const conflict = {
      start: 10,
      end: 15,
      original: 'hello',
      changes: [
        { reviewer: 'R1', type: 'replace', oldText: 'hello', newText: 'hi' },
        { reviewer: 'R2', type: 'replace', oldText: 'hello', newText: 'hey' },
      ],
    };

    const original = 'Before - hello - After';
    const formatted = formatConflict(conflict, original);

    assert.ok(formatted.includes('R1'));
    assert.ok(formatted.includes('R2'));
    assert.ok(formatted.includes('Options:'));
  });

  it('should handle insertion conflicts', () => {
    const conflict = {
      start: 5,
      end: 5,
      original: '',
      changes: [
        { reviewer: 'R1', type: 'insert', oldText: '', newText: 'A' },
        { reviewer: 'R2', type: 'insert', oldText: '', newText: 'B' },
      ],
    };

    const original = 'HelloWorld';
    const formatted = formatConflict(conflict, original);

    assert.ok(formatted.includes('Insert'));
    assert.ok(formatted.includes('(insertion point)'));
  });
});

// Edge cases
describe('merge edge cases', () => {
  it('should handle empty original text', () => {
    const changes = extractChanges('', 'new text', 'R1');
    assert.ok(changes.length > 0);
    assert.ok(changes.some(c => c.type === 'insert'));
  });

  it('should handle complete deletion', () => {
    const changes = extractChanges('original', '', 'R1');
    assert.ok(changes.length > 0);
    assert.ok(changes.some(c => c.type === 'delete'));
  });

  it('should handle whitespace-only changes', () => {
    const changes = extractChanges('hello world', 'hello  world', 'R1');
    // diffWords may or may not detect whitespace changes depending on version
    // Just verify it doesn't crash
    assert.ok(Array.isArray(changes));
  });

  it('should handle changes at document boundaries', () => {
    const original = 'content';
    const changes = [
      { type: 'insert', start: 0, end: 0, newText: 'prefix ' },
      { type: 'insert', start: 7, end: 7, newText: ' suffix' },
    ];

    const result = applyChanges(original, changes);
    assert.strictEqual(result, 'prefix content suffix');
  });

  it('should handle unicode text', () => {
    const original = 'Hello 世界';
    const modified = 'Hello 世界！';
    const changes = extractChanges(original, modified, 'R1');
    assert.ok(changes.some(c => c.newText.includes('！')));
  });
});
