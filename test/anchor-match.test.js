#!/usr/bin/env node

/**
 * Tests for the shared anchor-matching primitives used by both
 * insertCommentsIntoMarkdown (sync) and verify-anchors.
 */

import { strict as assert } from 'assert';

const { findAnchorInText, findAllOccurrences, stripCriticMarkup, classifyStrategy } =
  await import('../lib/anchor-match.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

console.log('\n🔧 anchor-match unit tests\n');

test('direct match returns clean strategy', () => {
  const r = findAnchorInText('quick brown fox', 'the quick brown fox jumps');
  assert.equal(r.strategy, 'direct');
  assert.deepEqual(r.occurrences, [4]);
  assert.equal(classifyStrategy(r.strategy, r.occurrences.length), 'clean');
});

test('case-insensitive direct match', () => {
  const r = findAnchorInText('Quick Brown', 'the quick brown fox');
  assert.equal(r.strategy, 'direct');
});

test('whitespace normalization', () => {
  const r = findAnchorInText('quick   brown\nfox', 'the quick brown fox jumps');
  assert.equal(r.strategy, 'normalized');
});

test('drift via stripped CriticMarkup', () => {
  // Anchor straddles inserted text; only the stripped form contains it verbatim
  const text = 'the {++newly inserted ++}quick brown fox jumps';
  const r = findAnchorInText('newly inserted quick', text);
  assert.equal(r.strategy, 'stripped');
  assert.equal(classifyStrategy(r.strategy, r.occurrences.length), 'drift');
});

test('partial-start match for long anchor with revised tail', () => {
  const r = findAnchorInText(
    'methods we used random forest classification on the standardized data',
    'methods we used random forest classification with cross-validation'
  );
  assert.equal(r.strategy, 'partial-start');
  assert.equal(classifyStrategy(r.strategy, r.occurrences.length), 'drift');
});

test('context-only when anchor text is gone', () => {
  const r = findAnchorInText(
    'arable land cover dropped sharply',
    'across all sites we observed a clear pattern',
    'across all sites',
    'we observed a clear pattern'
  );
  assert.equal(r.strategy, 'context-both');
  assert.equal(classifyStrategy(r.strategy, r.occurrences.length), 'context-only');
});

test('empty anchor falls back to context-only', () => {
  const r = findAnchorInText('', 'before context middle after context', 'before context', 'after context');
  assert.ok(['context-both', 'context-before', 'context-after'].includes(r.strategy));
});

test('unmatched anchor returns failed', () => {
  const r = findAnchorInText('nonexistent phrase entirely', 'completely unrelated content');
  assert.equal(r.strategy, 'failed');
  assert.equal(r.occurrences.length, 0);
  assert.equal(classifyStrategy(r.strategy, r.occurrences.length), 'unmatched');
});

test('ambiguous: multiple direct matches', () => {
  const r = findAnchorInText('variance', 'variance was high. The variance differed.');
  assert.equal(r.strategy, 'direct');
  assert.equal(r.occurrences.length, 2);
});

test('findAllOccurrences finds overlapping candidates', () => {
  const occ = findAllOccurrences('aaaa', 'aa');
  assert.deepEqual(occ, [0, 1, 2]);
});

test('stripCriticMarkup removes all annotation forms', () => {
  const t = 'a {++ins++}b{--del--}c{~~old~>new~~}d{>>U: hi<<}e[mark]{.mark}f';
  assert.equal(stripCriticMarkup(t), 'a insbcnewdemarkf');
});

test('stripCriticMarkup handles comments containing literal < and > chars', () => {
  // Reviewers paste math/code into comments. The earlier [^<]* regex bailed
  // on the first '<' and left the comment in place — anchors that lived
  // underneath such a comment then fell through every fuzzy strategy.
  const t = 'before {>>R: contains < and > and <html> chars<<} after';
  assert.equal(stripCriticMarkup(t), 'before  after');
});

test('stripCriticMarkup non-greedy across two adjacent comments', () => {
  // Greedy matching would eat both comments as one big span.
  const t = 'pre {>>A: one<<} mid {>>B: two<<} post';
  assert.equal(stripCriticMarkup(t), 'pre  mid  post');
});

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
