/**
 * Regression tests for two subtle annotation bugs: a global regex whose
 * lastIndex drifted across hasAnnotations calls, and string-based replacement
 * that edited the first matching annotation instead of the intended one.
 */

import { test } from 'node:test';
import assert from 'node:assert';

import { hasAnnotations, getComments, setCommentStatus } from '../lib/annotations.js';

test('hasAnnotations is stable across repeated calls (no lastIndex drift)', () => {
  const annotated = 'plain {++ins++} text';
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(hasAnnotations(annotated), true, `call ${i} on annotated text`);
  }
  const plain = 'no annotations here at all';
  for (let i = 0; i < 5; i++) {
    assert.strictEqual(hasAnnotations(plain), false, `call ${i} on plain text`);
  }
});

test('setCommentStatus resolves the targeted duplicate, not the first occurrence', () => {
  const text = 'a {>>R: same<<} b {>>R: same<<} c';
  const comments = getComments(text);
  assert.strictEqual(comments.length, 2);

  const out = setCommentStatus(text, comments[1], true);
  const firstUnresolved = out.indexOf('{>>R: same<<}');
  const secondResolved = out.indexOf('{>>R: same [RESOLVED]<<}');

  assert.ok(firstUnresolved >= 0, 'first comment stays unresolved');
  assert.ok(secondResolved > firstUnresolved, 'the second comment is the one resolved');
});
