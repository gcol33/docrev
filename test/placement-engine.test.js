/**
 * Section-scoped placement: the engine matches anchor text by real offset and
 * reports an honest confidence tier, rather than mapping a docx-to-markdown
 * length ratio and reporting every approximate guess as "placed".
 */

import { test } from 'node:test';
import assert from 'node:assert';

import { insertCommentsIntoMarkdown } from '../lib/import.ts';

function anchorMap(entries) {
  return new Map(entries);
}

test('places at the matched anchor even when it sits far from the proportional estimate', () => {
  // The anchor lives near the END of the section, but its docPosition is near
  // the START. A length-ratio mapping would search the beginning and miss it;
  // offset matching finds it wherever it moved to.
  const filler = 'Lorem ipsum dolor sit amet consectetur. '.repeat(60);
  const markdown = filler + 'The unique target phrase concludes the section.';
  const comments = [{ id: '1', author: 'Rev', text: 'clarify', date: '2026-01-01' }];
  const anchors = anchorMap([
    ['1', { anchor: 'unique target phrase', before: '', after: '', docPosition: 3, docLength: 100, isEmpty: false }],
  ]);

  const stats = { placed: 0, lowConfidence: 0, deduped: 0, unmatched: 0 };
  const out = insertCommentsIntoMarkdown(markdown, comments, anchors, {
    quiet: true,
    wrapAnchor: false,
    sectionBoundary: { start: 0, end: 100 },
    outStats: stats,
  });

  // The comment lands immediately before the anchor near the end of the
  // section, not at the proportional estimate near the start.
  assert.ok(
    out.includes('{>>Rev: clarify<<}unique target phrase'),
    'comment should sit directly before the matched anchor',
  );
  assert.ok(out.indexOf('{>>Rev: clarify<<}') > filler.length - 5, 'comment is not at the proportional start');
  assert.strictEqual(stats.placed, 1);
  assert.strictEqual(stats.lowConfidence, 0);
});

test('an anchor missing from the section is placed approximately and counted low-confidence', () => {
  const markdown = 'A short section with ordinary prose and nothing notable here at all.';
  const comments = [{ id: '9', author: 'Rev', text: 'where did this go', date: '2026-01-01' }];
  const anchors = anchorMap([
    ['9', { anchor: 'a phrase deleted by the author', before: '', after: '', docPosition: 40, docLength: 100, isEmpty: false }],
  ]);

  const stats = { placed: 0, lowConfidence: 0, deduped: 0, unmatched: 0 };
  const out = insertCommentsIntoMarkdown(markdown, comments, anchors, {
    quiet: true,
    wrapAnchor: false,
    sectionBoundary: { start: 0, end: 100 },
    outStats: stats,
  });

  // The comment is still inserted (not dropped), but flagged as approximate.
  assert.ok(out.includes('{>>Rev: where did this go<<}'), 'comment still inserted');
  assert.strictEqual(stats.placed, 0, 'not counted as a confident placement');
  assert.strictEqual(stats.lowConfidence, 1, 'counted in the low-confidence bucket');
  assert.strictEqual(stats.unmatched, 0);
});

test('a present anchor without a section boundary is a confident placement', () => {
  const markdown = 'The methods describe a random forest trained on standardized data.';
  const comments = [{ id: '2', author: 'Rev', text: 'which package', date: '2026-01-01' }];
  const anchors = anchorMap([
    ['2', { anchor: 'random forest', before: '', after: '', docPosition: 0, docLength: 60, isEmpty: false }],
  ]);

  const stats = { placed: 0, lowConfidence: 0, deduped: 0, unmatched: 0 };
  insertCommentsIntoMarkdown(markdown, comments, anchors, {
    quiet: true,
    wrapAnchor: false,
    outStats: stats,
  });
  assert.strictEqual(stats.placed, 1);
  assert.strictEqual(stats.lowConfidence, 0);
});
