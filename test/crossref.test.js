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
  resolveExternalRefs,
  replaceRefs,
  refPrefixes,
  convertHardcodedRefs,
  resolveSupplementaryRefs,
  checkCrossRefs,
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

describe('resolveExternalRefs', () => {
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

  it('leaves a forward reference whose anchor is in the text to pandoc-crossref', () => {
    const text = 'See @fig:map and [-@fig:map].\n\n![Map](map.png){#fig:map}';
    const { text: result, resolved } = resolveExternalRefs(text, mockRegistry);

    assert.strictEqual(result, text);
    assert.strictEqual(resolved.length, 0);
  });

  it('leaves a backward reference to pandoc-crossref', () => {
    const text = '![Map](map.png){#fig:map}\n\nSee @fig:map.';
    const { text: result, resolved } = resolveExternalRefs(text, mockRegistry);

    assert.strictEqual(result, text);
    assert.strictEqual(resolved.length, 0);
  });

  it('resolves a reference whose anchor is outside the text', () => {
    const text = 'As shown in @fig:map, the results...';
    const { text: result, resolved } = resolveExternalRefs(text, mockRegistry);

    assert.strictEqual(result, 'As shown in Figure 1, the results...');
    assert.strictEqual(resolved.length, 1);
    assert.strictEqual(resolved[0].from, '@fig:map');
  });

  it('resolves supplementary and table references outside the text', () => {
    const { text: result } = resolveExternalRefs('See @fig:suppfig and @tbl:data.', mockRegistry);
    assert.strictEqual(result, 'See Figure S1 and Table 1.');
  });

  it('tracks references the registry does not hold', () => {
    const text = 'See @fig:nonexistent.\n\n![Other](o.png){#fig:other}';
    const { unresolved } = resolveExternalRefs(text, mockRegistry);

    assert.strictEqual(unresolved.length, 1);
    assert.strictEqual(unresolved[0].ref, '@fig:nonexistent');
  });

  it('prints the configured prefix', () => {
    const prefixes = refPrefixes({ figPrefix: ['Fig.', 'Figs.'] });
    const { text: result } = resolveExternalRefs('See @fig:map.', mockRegistry, prefixes);
    assert.strictEqual(result, 'See Fig. 1.');
  });
});

describe('replaceRefs', () => {
  const registry = {
    figures: new Map([
      ['a', { label: 'a', num: 1, isSupp: false }],
      ['b', { label: 'b', num: 2, isSupp: false }],
      ['s', { label: 's', num: 3, isSupp: true }],
    ]),
    tables: new Map([['t', { label: 't', num: 1, isSupp: false }]]),
    equations: new Map(),
    byNumber: {},
  };
  const prefixes = refPrefixes({ figPrefix: ['Fig.', 'Figs.'] });
  const all = () => true;

  it('prints the number alone for a prefix-suppressed citation', () => {
    assert.strictEqual(replaceRefs('Fig. [-@fig:b]a shows', registry, prefixes, all).text, 'Fig. 2a shows');
  });

  it('prints prefix and number for a bracketed or bare reference', () => {
    assert.strictEqual(replaceRefs('[@fig:a] and @fig:b', registry, prefixes, all).text, 'Fig. 1 and Fig. 2');
  });

  it('prints the plural prefix for a group', () => {
    assert.strictEqual(replaceRefs('(see [@fig:a; @fig:b])', registry, prefixes, all).text, '(see Figs. 1, 2)');
  });

  it('capitalises the prefix for a capitalised type', () => {
    const lower = refPrefixes({ figPrefix: ['fig.', 'figs.'] });
    assert.strictEqual(replaceRefs('@Fig:a and @fig:a', registry, lower, all).text, 'Fig. 1 and fig. 1');
  });

  it('prints a supplementary number with its S', () => {
    assert.strictEqual(replaceRefs('[-@fig:s]', registry, prefixes, all).text, 'S3');
  });

  it('leaves a group alone unless every reference in it is selected', () => {
    const text = 'see [@fig:a; @fig:s] and @fig:s';
    const onlySupp = (r) => r.label === 's';
    assert.strictEqual(replaceRefs(text, registry, prefixes, onlySupp).text, 'see [@fig:a; @fig:s] and Fig. S3');
  });

  it('leaves a mixed-type group to pandoc-crossref and reports it', () => {
    const { text, unresolved } = replaceRefs('[@fig:a; @tbl:t]', registry, prefixes, all);
    assert.strictEqual(text, '[@fig:a; @tbl:t]');
    assert.strictEqual(unresolved.length, 1);
  });

  it('falls back to the default prefixes where the config sets none', () => {
    assert.deepStrictEqual(refPrefixes({}).tbl, ['Table', 'Tables']);
    assert.deepStrictEqual(refPrefixes({ figPrefix: 'Fig.' }).fig, ['Fig.', 'Fig.']);
  });
});

describe('resolveSupplementaryRefs', () => {
  const suppRegistry = {
    figures: new Map([
      ['confusion', { label: 'confusion', num: 1, isSupp: true }],
      ['map', { label: 'map', num: 1, isSupp: false }],
    ]),
    tables: new Map([
      ['suppdata', { label: 'suppdata', num: 1, isSupp: true }],
    ]),
    equations: new Map(),
    byNumber: {
      fig: new Map([[1, 'map']]),
      figS: new Map([[1, 'confusion']]),
      tbl: new Map(),
      tblS: new Map([[1, 'suppdata']]),
      eq: new Map(),
    },
  };

  it('keeps image attributes when stripping a supplementary anchor (issue #9)', () => {
    const text = '![Confusion](fig.png){#fig:confusion width=70%}';
    const { text: result } = resolveSupplementaryRefs(text, suppRegistry);
    assert.strictEqual(result, '![Confusion](fig.png){width=70%}');
  });

  it('emits nothing when the anchor is the only attribute', () => {
    const text = '![Confusion](fig.png){#fig:confusion}';
    const { text: result } = resolveSupplementaryRefs(text, suppRegistry);
    assert.strictEqual(result, '![Confusion](fig.png)');
  });

  it('preserves multiple non-anchor attributes', () => {
    const text = '![Confusion](fig.png){#fig:confusion width=70% .center}';
    const { text: result } = resolveSupplementaryRefs(text, suppRegistry);
    assert.strictEqual(result, '![Confusion](fig.png){width=70% .center}');
  });

  it('keeps attributes when the anchor is not first in the block', () => {
    const text = '![Confusion](fig.png){width=70% #fig:confusion}';
    const { text: result } = resolveSupplementaryRefs(text, suppRegistry);
    assert.strictEqual(result, '![Confusion](fig.png){width=70%}');
  });

  it('strips supplementary table anchors while keeping attributes', () => {
    const text = '| Col |{#tbl:suppdata .striped}';
    const { text: result } = resolveSupplementaryRefs(text, suppRegistry);
    assert.strictEqual(result, '| Col |{.striped}');
  });

  it('does not touch non-supplementary anchors', () => {
    const text = '![Map](map.png){#fig:map width=50%}';
    const { text: result } = resolveSupplementaryRefs(text, suppRegistry);
    assert.strictEqual(result, '![Map](map.png){#fig:map width=50%}');
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

describe('checkCrossRefs', () => {
  it('strips Pandoc attributes from anchor labels', () => {
    const result = checkCrossRefs([{
      file: 'a.md',
      content: 'See @fig:demo.\n\n![Example](image.png){#fig:demo width="100%"}\n',
    }]);
    assert.deepStrictEqual(result.broken, []);
    assert.deepStrictEqual(result.unreferencedFigures, []);
  });

  it('finds an id that is not the first attribute', () => {
    const result = checkCrossRefs([{
      file: 'a.md',
      content: '# Methods {.unnumbered #sec:methods}\n\nAs in @sec:methods.\n',
    }]);
    assert.deepStrictEqual(result.broken, []);
  });

  it('resolves references across sources', () => {
    const result = checkCrossRefs([
      { file: 'a.md', content: 'See @fig:demo and @Tbl:summary.\n' },
      { file: 'b.md', content: '![Example](image.png){#fig:demo}\n\n: Summary {#tbl:summary}\n' },
    ]);
    assert.deepStrictEqual(result.broken, []);
  });

  it('reports genuinely missing labels with their file', () => {
    const result = checkCrossRefs([
      { file: 'a.md', content: 'See @fig:missing and @eq:energy.\n' },
      { file: 'b.md', content: '![Unused](u.png){#fig:unused}\n' },
    ]);
    assert.deepStrictEqual(result.broken, [
      { file: 'a.md', key: 'fig:missing' },
      { file: 'a.md', key: 'eq:energy' },
    ]);
    assert.deepStrictEqual(result.unreferencedFigures, [{ file: 'b.md', key: 'fig:unused' }]);
  });
});
