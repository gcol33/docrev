/**
 * Tests for crossref.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseReferenceList,
  detectHardcodedRefs,
  detectDynamicRefs,
} from '../lib/crossref.js';

// Helper to extract number strings from parsed refs
function toStrings(refs) {
  return refs.map(r => {
    const prefix = r.isSupp ? 'S' : '';
    const suffix = r.suffix || '';
    return `${prefix}${r.num}${suffix}`;
  });
}

describe('parseReferenceList', () => {
  it('should parse single number', () => {
    const result = parseReferenceList('1');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].num, 1);
  });

  it('should parse simple range', () => {
    const result = parseReferenceList('1-3');
    const strs = toStrings(result);
    assert.deepStrictEqual(strs, ['1', '2', '3']);
  });

  it('should parse comma list', () => {
    const result = parseReferenceList('1, 2, 3');
    const strs = toStrings(result);
    assert.deepStrictEqual(strs, ['1', '2', '3']);
  });

  it('should parse list with and', () => {
    const result = parseReferenceList('1, 2, and 3');
    const strs = toStrings(result);
    assert.deepStrictEqual(strs, ['1', '2', '3']);
  });

  it('should parse letter suffixes', () => {
    const result = parseReferenceList('1a');
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].num, 1);
    assert.strictEqual(result[0].suffix, 'a');
  });

  it('should expand letter suffix range', () => {
    const result = parseReferenceList('1a-c');
    const strs = toStrings(result);
    assert.deepStrictEqual(strs, ['1a', '1b', '1c']);
  });

  it('should parse implied prefix (1a, b, c)', () => {
    const result = parseReferenceList('1a, b, c');
    const strs = toStrings(result);
    assert.deepStrictEqual(strs, ['1a', '1b', '1c']);
  });

  it('should handle supplementary figures', () => {
    const result = parseReferenceList('S1-S3');
    const strs = toStrings(result);
    assert.deepStrictEqual(strs, ['S1', 'S2', 'S3']);
  });

  it('should parse cross-number suffix range', () => {
    const result = parseReferenceList('1a-2b');
    const strs = toStrings(result);
    assert.ok(strs.includes('1a'));
    assert.ok(strs.includes('1b'));
    assert.ok(strs.includes('2a'));
    assert.ok(strs.includes('2b'));
  });

  it('should handle complex pattern with and', () => {
    const result = parseReferenceList('1, 2 and 3');
    const strs = toStrings(result);
    assert.deepStrictEqual(strs, ['1', '2', '3']);
  });
});

describe('detectHardcodedRefs', () => {
  it('should detect "Figure 1"', () => {
    const refs = detectHardcodedRefs('See Figure 1 for details.');
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].type, 'fig'); // normalized type
    assert.deepStrictEqual(toStrings(refs[0].numbers), ['1']);
  });

  it('should detect "Fig. 2"', () => {
    const refs = detectHardcodedRefs('See Fig. 2 for details.');
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].type, 'fig');
  });

  it('should detect "Figs. 1-3"', () => {
    const refs = detectHardcodedRefs('See Figs. 1-3 for details.');
    assert.strictEqual(refs.length, 1);
    assert.deepStrictEqual(toStrings(refs[0].numbers), ['1', '2', '3']);
  });

  it('should detect "Figures 1, 2, and 3"', () => {
    const refs = detectHardcodedRefs('See Figures 1, 2, and 3.');
    assert.strictEqual(refs.length, 1);
    assert.deepStrictEqual(toStrings(refs[0].numbers), ['1', '2', '3']);
  });

  it('should detect "Fig. 1a-c"', () => {
    const refs = detectHardcodedRefs('See Fig. 1a-c.');
    assert.strictEqual(refs.length, 1);
    const strs = toStrings(refs[0].numbers);
    assert.ok(strs.includes('1a'));
    assert.ok(strs.includes('1b'));
    assert.ok(strs.includes('1c'));
  });

  it('should detect tables', () => {
    const refs = detectHardcodedRefs('See Table 1.');
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].type, 'tbl'); // normalized type
  });

  it('should detect equations', () => {
    const refs = detectHardcodedRefs('Using Equation 1.');
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].type, 'eq'); // normalized type
  });

  it('should detect multiple refs in same text', () => {
    const refs = detectHardcodedRefs('See Figure 1 and Table 2.');
    assert.strictEqual(refs.length, 2);
  });

  it('should not match "a" from "and" as suffix', () => {
    const refs = detectHardcodedRefs('Figures 1 and 2');
    assert.strictEqual(refs.length, 1);
    const strs = toStrings(refs[0].numbers);
    assert.deepStrictEqual(strs, ['1', '2']);
    // Should NOT include 'a' as a separate number
    assert.ok(!strs.includes('a'));
  });
});

describe('detectDynamicRefs', () => {
  it('should detect @fig:label', () => {
    const refs = detectDynamicRefs('See @fig:heatmap for details.');
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].type, 'fig');
    assert.strictEqual(refs[0].label, 'heatmap');
  });

  it('should detect @tbl:label', () => {
    const refs = detectDynamicRefs('See @tbl:results.');
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].type, 'tbl');
  });

  it('should detect @eq:label', () => {
    const refs = detectDynamicRefs('Using @eq:main.');
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].type, 'eq');
  });

  it('should detect multiple refs', () => {
    const refs = detectDynamicRefs('See @fig:a and @fig:b.');
    assert.strictEqual(refs.length, 2);
  });

  it('should not match citations (no colon)', () => {
    const refs = detectDynamicRefs('As shown in @smith2020.');
    // Citations don't have colons, only cross-refs do
    // The function may return 0 or filter them out
    const crossRefs = refs.filter(r => r.type);
    assert.strictEqual(crossRefs.length, 0);
  });
});
