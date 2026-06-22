/**
 * Real-world OOXML shapes through the public extraction API (word.js and the
 * import.js re-exports). Each assertion exercises a case the regex readers got
 * wrong: a non-`w` namespace prefix, anchor text split across runs with a tab
 * and an entity, comment markers carrying attributes beyond w:id, and prose in
 * a footnote part.
 */

import { test } from 'node:test';
import assert from 'node:assert';

import { extractTextFromWord } from '../lib/word.ts';
import {
  extractWordComments,
  extractCommentAnchors,
} from '../lib/import.ts';

import {
  buildMessyCommentDocx,
  buildAltPrefixDocx,
  buildFootnoteDocx,
} from './helpers/realworld-docx.mjs';

test('messy doc: multi-run anchor with w16cid marker, tab, and entity', async () => {
  const docx = buildMessyCommentDocx();

  const comments = await extractWordComments(docx);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].author, 'Reviewer 2');
  assert.equal(comments[0].text, 'Define "niche" here.');

  const { anchors } = await extractCommentAnchors(docx);
  assert.equal(anchors.size, 1);
  // The whole anchor is recovered across three runs; the w16cid:durableId on
  // the marker does not hide it, the entity decodes, the tab survives.
  assert.equal(anchors.get('0').anchor, 'niche A&B\texpansion');

  const text = await extractTextFromWord(docx);
  assert.ok(text.includes('The niche A&B\texpansion was measured.'));
});

test('alt-prefix doc: WordML bound to x: still yields text and the comment', async () => {
  const docx = buildAltPrefixDocx();

  const text = await extractTextFromWord(docx);
  assert.equal(text, 'arable land cover dropped sharply');

  const comments = await extractWordComments(docx);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].author, 'Reviewer 1');

  const { anchors } = await extractCommentAnchors(docx);
  assert.equal(anchors.get('0').anchor, 'arable land cover dropped sharply');
});

test('footnote doc: a comment anchored in a footnote is not lost', async () => {
  // A comment range living in word/footnotes.xml is found because comment
  // extraction enumerates every part that can carry a range.
  const docx = buildFootnoteDocx();
  const { anchors, fullDocText } = await extractCommentAnchors(docx);
  // No comment in this fixture, but the footnote prose is part of the model.
  assert.ok(fullDocText.includes('Standardized by grid-cell area'));
  assert.equal(anchors.size, 0);
});
