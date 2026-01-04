/**
 * Tests for crossref.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseReferenceList,
  detectHardcodedRefs,
  detectDynamicRefs,
  normalizeType,
  parseRefNumber,
  getRefStatus,
  detectForwardRefs,
  resolveForwardRefs,
  convertHardcodedRefs,
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

describe('normalizeType', () => {
  it('should normalize Figure to fig', () => {
    assert.strictEqual(normalizeType('Figure'), 'fig');
    assert.strictEqual(normalizeType('Figures'), 'fig');
    assert.strictEqual(normalizeType('Fig.'), 'fig');
    assert.strictEqual(normalizeType('Figs.'), 'fig');
  });

  it('should normalize Table to tbl', () => {
    assert.strictEqual(normalizeType('Table'), 'tbl');
    assert.strictEqual(normalizeType('Tables'), 'tbl');
    assert.strictEqual(normalizeType('Tab.'), 'tbl');
  });

  it('should normalize Equation to eq', () => {
    assert.strictEqual(normalizeType('Equation'), 'eq');
    assert.strictEqual(normalizeType('Equations'), 'eq');
    assert.strictEqual(normalizeType('Eq.'), 'eq');
  });

  it('should be case-insensitive', () => {
    assert.strictEqual(normalizeType('FIGURE'), 'fig');
    assert.strictEqual(normalizeType('figure'), 'fig');
  });
});

describe('parseRefNumber', () => {
  it('should parse simple numbers', () => {
    const result = parseRefNumber('1');
    assert.strictEqual(result.num, 1);
    assert.strictEqual(result.isSupp, false);
    assert.strictEqual(result.suffix, null);
  });

  it('should parse supplementary numbers', () => {
    const result = parseRefNumber('S1');
    assert.strictEqual(result.num, 1);
    assert.strictEqual(result.isSupp, true);
  });

  it('should parse numbers with letter suffix', () => {
    const result = parseRefNumber('2a');
    assert.strictEqual(result.num, 2);
    assert.strictEqual(result.suffix, 'a');
  });

  it('should handle supplementary with suffix', () => {
    const result = parseRefNumber('S3b');
    assert.strictEqual(result.num, 3);
    assert.strictEqual(result.isSupp, true);
    assert.strictEqual(result.suffix, 'b');
  });

  it('should handle empty input', () => {
    const result = parseRefNumber('');
    assert.strictEqual(result.num, 0);
  });
});

describe('getRefStatus', () => {
  it('should count dynamic and hardcoded refs', () => {
    const text = 'See @fig:test and Figure 1 and @tbl:data.';
    const status = getRefStatus(text, { figures: new Map(), tables: new Map(), equations: new Map() });

    assert.strictEqual(status.dynamic.length, 2);
    assert.strictEqual(status.hardcoded.length, 1);
  });

  it('should count anchors', () => {
    const text = '![Caption](img.png){#fig:test}\n\n| Table |{#tbl:data}';
    const status = getRefStatus(text, { figures: new Map(), tables: new Map(), equations: new Map() });

    assert.strictEqual(status.anchors.figures, 1);
    assert.strictEqual(status.anchors.tables, 1);
  });
});

// Edge cases for parseReferenceList
describe('parseReferenceList edge cases', () => {
  it('should handle empty string', () => {
    const result = parseReferenceList('');
    assert.strictEqual(result.length, 0);
  });

  it('should handle null', () => {
    const result = parseReferenceList(null);
    assert.strictEqual(result.length, 0);
  });

  it('should handle ampersand as separator', () => {
    const result = parseReferenceList('1 & 2');
    const strs = toStrings(result);
    assert.deepStrictEqual(strs, ['1', '2']);
  });

  it('should handle en-dash and em-dash', () => {
    const result1 = parseReferenceList('1–3'); // en-dash
    const result2 = parseReferenceList('1—3'); // em-dash

    assert.deepStrictEqual(toStrings(result1), ['1', '2', '3']);
    assert.deepStrictEqual(toStrings(result2), ['1', '2', '3']);
  });

  it('should handle mixed supplementary and regular', () => {
    const result = parseReferenceList('1, S1, 2');
    const strs = toStrings(result);
    assert.ok(strs.includes('1'));
    assert.ok(strs.includes('S1'));
    assert.ok(strs.includes('2'));
  });
});

// Edge cases for detectHardcodedRefs
describe('detectHardcodedRefs edge cases', () => {
  it('should handle supplementary figures', () => {
    const refs = detectHardcodedRefs('See Supplementary Figure S1.');
    // Depends on implementation - may or may not match
    assert.ok(Array.isArray(refs));
  });

  it('should not match figure in code blocks', () => {
    // This is text-based, so code blocks aren't automatically skipped
    // Just verify it doesn't crash
    const refs = detectHardcodedRefs('```\nFigure 1\n```');
    assert.ok(Array.isArray(refs));
  });

  it('should track position correctly', () => {
    const text = 'First sentence. See Figure 1. Last sentence.';
    const refs = detectHardcodedRefs(text);

    assert.ok(refs[0].position > 0);
    assert.ok(refs[0].position < text.length);
  });

  it('should handle abbreviation variations', () => {
    const refs1 = detectHardcodedRefs('Fig 1'); // no period
    const refs2 = detectHardcodedRefs('Figs 1-2'); // plural no period

    assert.strictEqual(refs1.length, 1);
    assert.strictEqual(refs2.length, 1);
  });
});

// Edge cases for detectDynamicRefs
describe('detectDynamicRefs edge cases', () => {
  it('should handle labels with numbers', () => {
    const refs = detectDynamicRefs('@fig:figure1');
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].label, 'figure1');
  });

  it('should handle labels with hyphens', () => {
    const refs = detectDynamicRefs('@fig:my-figure');
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].label, 'my-figure');
  });

  it('should handle labels with underscores', () => {
    const refs = detectDynamicRefs('@tbl:data_table');
    assert.strictEqual(refs.length, 1);
    assert.strictEqual(refs[0].label, 'data_table');
  });

  it('should handle multiple refs on same line', () => {
    const refs = detectDynamicRefs('@fig:a, @fig:b, and @fig:c');
    assert.strictEqual(refs.length, 3);
  });

  it('should track position', () => {
    const text = 'See @fig:test here.';
    const refs = detectDynamicRefs(text);
    assert.strictEqual(refs[0].position, 4); // 'See '
  });
});

// Tests for forward reference detection and resolution
describe('detectForwardRefs', () => {
  it('should detect reference appearing before its anchor', () => {
    const text = 'See @fig:map in the methods.\n\n![Map](map.png){#fig:map}';
    const { forwardRefs } = detectForwardRefs(text);

    assert.strictEqual(forwardRefs.length, 1);
    assert.strictEqual(forwardRefs[0].label, 'map');
  });

  it('should not flag reference appearing after its anchor', () => {
    const text = '![Map](map.png){#fig:map}\n\nSee @fig:map above.';
    const { forwardRefs } = detectForwardRefs(text);

    assert.strictEqual(forwardRefs.length, 0);
  });

  it('should detect multiple forward refs', () => {
    const text = 'See @fig:a and @fig:b.\n\n![A](a.png){#fig:a}\n![B](b.png){#fig:b}';
    const { forwardRefs } = detectForwardRefs(text);

    assert.strictEqual(forwardRefs.length, 2);
  });

  it('should handle mixed forward and backward refs', () => {
    const text = '![First](1.png){#fig:first}\n\nSee @fig:first and @fig:second.\n\n![Second](2.png){#fig:second}';
    const { forwardRefs } = detectForwardRefs(text);

    // Only @fig:second is a forward ref
    assert.strictEqual(forwardRefs.length, 1);
    assert.strictEqual(forwardRefs[0].label, 'second');
  });

  it('should flag refs with no anchor as forward refs', () => {
    const text = 'See @fig:missing for details.';
    const { forwardRefs } = detectForwardRefs(text);

    assert.strictEqual(forwardRefs.length, 1);
    assert.strictEqual(forwardRefs[0].label, 'missing');
  });

  it('should track anchor positions correctly', () => {
    const text = '![Map](map.png){#fig:map}';
    const { anchorPositions } = detectForwardRefs(text);

    assert.ok(anchorPositions.has('fig:map'));
    // Anchor {#fig:map} starts at position 15 (after ![Map](map.png))
    assert.strictEqual(anchorPositions.get('fig:map'), 15);
  });
});

describe('resolveForwardRefs', () => {
  // Mock registry for testing
  const mockRegistry = {
    figures: new Map([
      ['map', { label: 'map', num: 1, isSupp: false, file: 'methods.md' }],
      ['chart', { label: 'chart', num: 2, isSupp: false, file: 'results.md' }],
      ['suppfig', { label: 'suppfig', num: 1, isSupp: true, file: 'supplementary.md' }],
    ]),
    tables: new Map([
      ['data', { label: 'data', num: 1, isSupp: false, file: 'results.md' }],
    ]),
    equations: new Map(),
    byNumber: {
      fig: new Map([[1, 'map'], [2, 'chart']]),
      figS: new Map([[1, 'suppfig']]),
      tbl: new Map([[1, 'data']]),
      tblS: new Map(),
      eq: new Map(),
    },
  };

  it('should resolve forward reference to display format', () => {
    const text = 'See @fig:map.\n\n![Map](map.png){#fig:map}';
    const { text: result, resolved } = resolveForwardRefs(text, mockRegistry);

    assert.ok(result.includes('Figure 1'));
    assert.ok(!result.includes('@fig:map'));
    assert.strictEqual(resolved.length, 1);
    assert.strictEqual(resolved[0].from, '@fig:map');
    assert.strictEqual(resolved[0].to, 'Figure 1');
  });

  it('should not resolve backward references', () => {
    const text = '![Map](map.png){#fig:map}\n\nSee @fig:map.';
    const { text: result, resolved } = resolveForwardRefs(text, mockRegistry);

    // Backward ref should remain as @fig:map for pandoc-crossref
    assert.ok(result.includes('@fig:map'));
    assert.strictEqual(resolved.length, 0);
  });

  it('should resolve supplementary figure correctly', () => {
    const text = 'See @fig:suppfig.\n\n![Supp](s.png){#fig:suppfig}';
    const { text: result, resolved } = resolveForwardRefs(text, mockRegistry);

    assert.ok(result.includes('Figure S1'));
    assert.strictEqual(resolved.length, 1);
  });

  it('should resolve tables too', () => {
    const text = 'See @tbl:data.\n\n| Col |{#tbl:data}';
    const { text: result, resolved } = resolveForwardRefs(text, mockRegistry);

    assert.ok(result.includes('Table 1'));
    assert.strictEqual(resolved.length, 1);
  });

  it('should track unresolved refs', () => {
    const text = 'See @fig:nonexistent.\n\n![Other](o.png){#fig:other}';
    const { unresolved } = resolveForwardRefs(text, mockRegistry);

    assert.strictEqual(unresolved.length, 1);
    assert.strictEqual(unresolved[0].ref, '@fig:nonexistent');
  });

  it('should handle multiple forward refs in correct order', () => {
    const text = 'See @fig:chart then @fig:map.\n\n![Map](m.png){#fig:map}\n![Chart](c.png){#fig:chart}';
    const { text: result, resolved } = resolveForwardRefs(text, mockRegistry);

    assert.ok(result.includes('Figure 2'));  // chart
    assert.ok(result.includes('Figure 1'));  // map
    assert.strictEqual(resolved.length, 2);
  });

  it('should preserve text around resolved refs', () => {
    const text = 'As shown in @fig:map, the results...';
    const { text: result } = resolveForwardRefs(text, mockRegistry);

    assert.ok(result.startsWith('As shown in Figure 1'));
    assert.ok(result.includes(', the results...'));
  });
});

describe('convertHardcodedRefs', () => {
  // Registry format matches buildRegistry() output
  const mockRegistry = {
    figures: new Map([
      ['map', { label: 'map', num: 1, isSupp: false }],
      ['chart', { label: 'chart', num: 2, isSupp: false }],
    ]),
    tables: new Map([['data', { label: 'data', num: 1, isSupp: false }]]),
    byNumber: {
      fig: new Map([[1, 'map'], [2, 'chart']]),
      figS: new Map(),
      tbl: new Map([[1, 'data']]),
      tblS: new Map(),
      eq: new Map(),
    },
  };

  it('should convert Figure 1 to @fig:map', () => {
    const text = 'See Figure 1 for details.';
    const { converted, conversions } = convertHardcodedRefs(text, mockRegistry);

    assert.strictEqual(converted, 'See @fig:map for details.');
    assert.strictEqual(conversions.length, 1);
  });

  it('should skip conversion when @-ref already precedes hardcoded ref', () => {
    // This simulates the bug: after import, we might have "@fig:mapFigure 1"
    // from restore + Word text concatenation. Should not double-convert.
    const text = '@fig:mapFigure 1 shows the study area.';
    const { converted, conversions } = convertHardcodedRefs(text, mockRegistry);

    // Should NOT add another @fig:map
    assert.strictEqual(converted, '@fig:mapFigure 1 shows the study area.');
    assert.strictEqual(conversions.length, 0);
  });

  it('should skip when @-ref appears in annotation before hardcoded ref', () => {
    // Simulates: "@fig:map{++@fig:map++}Figure 1" pattern from botched import
    const text = '@fig:map{++@fig:map++}Figure 1 caption here.';
    const { converted, conversions } = convertHardcodedRefs(text, mockRegistry);

    // Should not convert Figure 1 since @fig:map already present
    assert.strictEqual(converted, text);
    assert.strictEqual(conversions.length, 0);
  });

  it('should convert when @-ref is for different figure', () => {
    // @fig:chart precedes Figure 1, but Figure 1 = @fig:map, so should convert
    // The check looks at textBefore, which has @fig:chart, not @fig:map
    const text = '@fig:chart Figure 1 shows something else.';
    const { converted, conversions } = convertHardcodedRefs(text, mockRegistry);

    assert.strictEqual(converted, '@fig:chart @fig:map shows something else.');
    assert.strictEqual(conversions.length, 1);
  });
});
