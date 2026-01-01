/**
 * Tests for pdf-comments.js (PDF margin notes for dual export)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  convertCommentsToMarginNotes,
  convertTrackChangesToLatex,
  prepareMarkdownForAnnotatedPdf,
  MARGIN_NOTES_PREAMBLE,
  SIMPLE_MARGIN_PREAMBLE,
} from '../lib/pdf-comments.js';

describe('convertCommentsToMarginNotes', () => {
  it('should convert simple comments to margin notes', () => {
    const markdown = 'This is some text. {>>Please clarify this.<<}';
    const result = convertCommentsToMarginNotes(markdown);

    assert.ok(result.markdown.includes('\\margincomment{Please clarify this.}'));
    assert.strictEqual(result.commentCount, 1);
  });

  it('should convert comments with author to reviewercomment', () => {
    const markdown = 'Some text {>>Reviewer 1: This needs more detail.<<}';
    const result = convertCommentsToMarginNotes(markdown);

    assert.ok(result.markdown.includes('\\reviewercomment{Reviewer 1}{This needs more detail.}'));
    assert.strictEqual(result.commentCount, 1);
  });

  it('should handle multiple comments', () => {
    const markdown = 'Text {>>Comment 1<<} more text {>>Author: Comment 2<<}';
    const result = convertCommentsToMarginNotes(markdown);

    assert.strictEqual(result.commentCount, 2);
    assert.ok(result.markdown.includes('\\margincomment{Comment 1}'));
    assert.ok(result.markdown.includes('\\reviewercomment{Author}{Comment 2}'));
  });

  it('should strip resolved comments by default', () => {
    const markdown = 'Text {>>✓ Resolved comment<<} more {>>Active comment<<}';
    const result = convertCommentsToMarginNotes(markdown, { stripResolved: true });

    assert.strictEqual(result.commentCount, 1);
    assert.ok(!result.markdown.includes('Resolved'));
    assert.ok(result.markdown.includes('Active comment'));
  });

  it('should keep resolved comments when stripResolved is false', () => {
    const markdown = 'Text {>>✓ Resolved comment<<}';
    const result = convertCommentsToMarginNotes(markdown, { stripResolved: false });

    assert.strictEqual(result.commentCount, 1);
  });

  it('should escape LaTeX special characters', () => {
    const markdown = 'Text {>>Use $100 & 50% discount<<}';
    const result = convertCommentsToMarginNotes(markdown);

    assert.ok(result.markdown.includes('\\$100'));
    assert.ok(result.markdown.includes('\\&'));
    assert.ok(result.markdown.includes('\\%'));
  });

  it('should return correct preamble for todonotes', () => {
    const result = convertCommentsToMarginNotes('text', { useTodonotes: true });
    assert.ok(result.preamble.includes('todonotes'));
  });

  it('should return simple preamble when todonotes disabled', () => {
    const result = convertCommentsToMarginNotes('text', { useTodonotes: false });
    assert.ok(result.preamble.includes('marginpar'));
    assert.ok(!result.preamble.includes('todonotes'));
  });
});

describe('convertTrackChangesToLatex', () => {
  it('should convert insertions to green text', () => {
    const markdown = 'Hello {++world++}!';
    const result = convertTrackChangesToLatex(markdown);

    assert.ok(result.markdown.includes('\\textcolor{green}{world}'));
  });

  it('should convert deletions to red strikethrough', () => {
    const markdown = 'Hello {--world--}!';
    const result = convertTrackChangesToLatex(markdown);

    assert.ok(result.markdown.includes('\\textcolor{red}{\\sout{world}}'));
  });

  it('should convert substitutions', () => {
    const markdown = 'Hello {~~world~>universe~~}!';
    const result = convertTrackChangesToLatex(markdown);

    assert.ok(result.markdown.includes('\\sout{world}'));
    assert.ok(result.markdown.includes('\\textcolor{green}{universe}'));
  });

  it('should include ulem package in preamble', () => {
    const result = convertTrackChangesToLatex('text');
    assert.ok(result.preamble.includes('ulem'));
  });
});

describe('prepareMarkdownForAnnotatedPdf', () => {
  it('should convert comments and return combined result', () => {
    const markdown = 'Text {>>Comment here<<}';
    const result = prepareMarkdownForAnnotatedPdf(markdown);

    assert.ok(result.markdown.includes('\\margincomment'));
    assert.ok(result.preamble.includes('todonotes'));
    assert.strictEqual(result.commentCount, 1);
  });

  it('should handle empty markdown', () => {
    const result = prepareMarkdownForAnnotatedPdf('');
    assert.strictEqual(result.commentCount, 0);
    assert.strictEqual(result.markdown, '');
  });

  it('should handle markdown with no comments', () => {
    const markdown = 'Just regular text with no annotations.';
    const result = prepareMarkdownForAnnotatedPdf(markdown);

    assert.strictEqual(result.commentCount, 0);
    assert.strictEqual(result.markdown, markdown);
  });
});

describe('preambles', () => {
  it('should have valid MARGIN_NOTES_PREAMBLE', () => {
    assert.ok(MARGIN_NOTES_PREAMBLE.includes('\\usepackage'));
    assert.ok(MARGIN_NOTES_PREAMBLE.includes('\\newcommand'));
  });

  it('should have valid SIMPLE_MARGIN_PREAMBLE', () => {
    assert.ok(SIMPLE_MARGIN_PREAMBLE.includes('\\marginpar'));
  });
});
