import { describe, it } from 'node:test';
import assert from 'node:assert';
import { countWords } from '../lib/utils.js';

describe('countWords', () => {
  it('counts plain prose', () => {
    assert.strictEqual(countWords('one two three four five'), 5);
  });

  it('keeps the prose standing between two tables', () => {
    // The defect this pins: a table-cell pattern whose negated class matched a
    // newline ran from the last pipe of one table to the first pipe of the
    // next, deleting the paragraph in between.
    const text = [
      '| Target | Value |',
      '|---|---|',
      '| Area | 70.9 |',
      '',
      'alpha beta gamma delta epsilon zeta eta theta iota kappa',
      '',
      '| Target | Value |',
      '|---|---|',
      '| Slope | 5.85 |',
    ].join('\n');
    assert.strictEqual(countWords(text), 10);
  });

  it('counts no words for a table alone', () => {
    const text = ['| Target | Value |', '|---|---|', '| Area | 70.9 |'].join('\n');
    assert.strictEqual(countWords(text), 0);
  });

  it('keeps the prose standing between two attribute blocks', () => {
    const text = [
      '![One](a.png){#fig:one width="100%"}',
      '',
      'alpha beta gamma delta epsilon',
      '',
      '![Two](b.png){#fig:two width="100%"}',
    ].join('\n');
    assert.strictEqual(countWords(text), 5);
  });

  it('drops an image caption however long', () => {
    assert.strictEqual(countWords('![a caption of several words](f.png)\n\nreal prose here'), 3);
  });

  it('drops a citation and the brackets around it', () => {
    assert.strictEqual(countWords('composition carries it [@Ellenberg_1991; @Diekmann_2003] here'), 4);
    assert.strictEqual(countWords('as shown [@Chytry_2016].'), 2);
  });

  it('drops a cross-reference', () => {
    assert.strictEqual(countWords('every target improves (@fig:sample-efficiency) with size'), 5);
  });

  it('keeps link text and drops the target', () => {
    assert.strictEqual(countWords('see [the author guidelines](https://example.org/a/b) for detail'), 6);
  });

  it('removes frontmatter only at the start of the document', () => {
    const text = ['---', 'title: "A title of five words"', '---', '', 'alpha beta gamma'].join('\n');
    assert.strictEqual(countWords(text), 3);
  });

  it('does not treat a horizontal rule mid-document as frontmatter', () => {
    const text = ['alpha beta', '', '---', '', 'gamma delta'].join('\n');
    assert.strictEqual(countWords(text), 4);
  });

  it('drops fenced code', () => {
    const text = ['alpha beta', '', '```', 'const x = 1;', '```', '', 'gamma'].join('\n');
    assert.strictEqual(countWords(text), 3);
  });

  it('keeps heading text and drops the marker', () => {
    assert.strictEqual(countWords('## Sample efficiency\n\nalpha beta'), 4);
  });

  it('does not count leftover punctuation as a word', () => {
    assert.strictEqual(countWords('alpha -- beta ; gamma'), 3);
  });

  it('reads a hash inside a word as part of it', () => {
    assert.strictEqual(countWords('fixed in #10 today'), 4);
  });
});
