/**
 * Tests for the reader-load profile: terms introduced and held at each paragraph.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { parseInformation } from '../lib/information.js';
import { parseManuscript } from '../lib/paragraph-markers.js';
import { readerLoad } from '../lib/reader-load.js';

const MANUSCRIPT = [
  '# Introduction',
  '',
  '<!-- @p:intro.gap -->',
  'We count 19.7 million candidate transitions. The regional pool is large.',
  '',
  '<!-- @p:intro.pool -->',
  'The regional pool holds the aliens of a country. A transition is a candidate arriving between surveys.',
  '',
  '<!-- @p:intro.debt -->',
  'Forecast debt is what the pool still owes. Plants and vegetation plots are everywhere.',
  '',
  '# Methods',
  '',
  '<!-- @p:meth.fit -->',
  'The regional pool and each transition enter the model. Vegetation plots are resurveyed.',
  '',
].join('\n');

const INFORMATION = [
  '## Terms',
  '',
  '### regional-pool',
  '- forms: regional pool',
  '- defined: @p:intro.pool',
  '',
  '### transition',
  '- forms: transition; transitions; candidate transitions',
  '- defined: @p:intro.pool',
  '',
  '### forecast-debt',
  '- forms: forecast debt',
  '- defined: none',
  '',
  '### plot',
  '- forms: vegetation plots',
  '- defined: known',
].join('\n');

const profile = () => readerLoad(parseManuscript([{ file: 'm.md', content: MANUSCRIPT }]),
  parseInformation(INFORMATION).entries);

describe('readerLoad', () => {
  it('marks uses before the introduction as early', () => {
    const gap = profile().rows.find((r) => r.id === 'intro.gap');
    assert.deepStrictEqual(gap.early.sort(), ['regional pool', 'transition']);
    assert.deepStrictEqual(gap.introduced, []);
  });

  it('introduces terms at their definition', () => {
    const pool = profile().rows.find((r) => r.id === 'intro.pool');
    assert.deepStrictEqual(pool.introduced.sort(), ['regional pool', 'transition']);
    assert.deepStrictEqual(pool.early, []);
  });

  it('flags a never-introduced term at its first use only', () => {
    const rows = profile().rows;
    assert.deepStrictEqual(rows.find((r) => r.id === 'intro.debt').early, ['forecast debt']);
  });

  it('holds a term from its first appearance to its last use, and skips known terms', () => {
    const p = profile();
    assert.deepStrictEqual(p.rows.map((r) => r.held), [2, 2, 3, 2]);
    assert.strictEqual(p.terms, 3);
    assert.deepStrictEqual(p.peak && p.peak.id, 'intro.debt');
  });

  it('records where each term is first met', () => {
    const met = profile().met;
    assert.strictEqual(met[0].at, 0);
    assert.strictEqual(met.find((m) => m.term === 'forecast debt').introduced, false);
  });
});
