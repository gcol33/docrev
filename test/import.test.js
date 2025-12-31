#!/usr/bin/env node

/**
 * Comprehensive test suite for rev import functionality
 * Tests protection of: citations, math, figure anchors, cross-references
 * Tests comment extraction and placement
 */

import { strict as assert } from 'assert';

// Import functions from import.js
const importModule = await import('../lib/import.js');
const {
  generateSmartDiff,
  cleanupAnnotations,
  insertCommentsIntoMarkdown,
} = importModule;

// Test results tracking
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    failures.push({ name, error: err.message });
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function assertContains(text, substring, msg = '') {
  if (!text.includes(substring)) {
    throw new Error(`Expected to contain "${substring}"${msg ? ': ' + msg : ''}\nGot: ${text.slice(0, 200)}`);
  }
}

function assertNotContains(text, substring, msg = '') {
  if (text.includes(substring)) {
    throw new Error(`Expected NOT to contain "${substring}"${msg ? ': ' + msg : ''}\nGot: ${text.slice(0, 200)}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`Expected: "${expected}"\nActual: "${actual}"${msg ? '\n' + msg : ''}`);
  }
}

// ============================================================================
// CITATION PROTECTION TESTS
// ============================================================================

console.log('\n📚 Citation Protection Tests\n');

test('Simple citation preserved when unchanged', () => {
  const original = 'This is cited [@Smith2021].';
  const word = 'This is cited (Smith 2021).';
  const result = generateSmartDiff(original, word);
  assertContains(result, '[@Smith2021]');
  assertNotContains(result, '{--[@Smith2021]--}');
});

test('Multiple citations preserved', () => {
  const original = 'As shown [@Smith2021; @Jones2020] and [@Brown2019].';
  const word = 'As shown (Smith 2021; Jones 2020) and (Brown 2019).';
  const result = generateSmartDiff(original, word);
  assertContains(result, '[@Smith2021; @Jones2020]');
  assertContains(result, '[@Brown2019]');
});

test('Citation with surrounding text changes', () => {
  const original = 'Previous work [@Smith2021] showed results.';
  const word = 'Earlier research (Smith 2021) demonstrated outcomes.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '[@Smith2021]');
});

test('Citation with et al. author', () => {
  const original = 'According to [@Pyšek2020].';
  const word = 'According to (Pyšek et al. 2020).';
  const result = generateSmartDiff(original, word);
  assertContains(result, '[@Pyšek2020]');
});

test('Citation with letter suffix', () => {
  const original = 'In [@Chytry2008a; @Chytry2008b].';
  const word = 'In (Chytry 2008a; Chytry 2008b).';
  const result = generateSmartDiff(original, word);
  assertContains(result, '[@Chytry2008a; @Chytry2008b]');
});

// ============================================================================
// MATH PROTECTION TESTS
// ============================================================================

console.log('\n🔢 Math Protection Tests\n');

test('Inline math preserved: $p$', () => {
  const original = 'The p-value was $p < 0.05$.';
  const word = 'The p-value was p < 0.05.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '$p < 0.05$');
});

test('Inline math with subscript: $p_d$', () => {
  const original = 'Let $p_d$ denote the proportion.';
  const word = 'Let pd denote the proportion.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '$p_d$');
});

test('Display math preserved', () => {
  const original = 'The equation is:\n\n$$\\hat{p} = \\frac{\\sum_d w_d}{N}$$\n\nwhere N is total.';
  const word = 'The equation is:\n\np = Σd wd/N\n\nwhere N is total.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '$$\\hat{p} = \\frac{\\sum_d w_d}{N}$$');
});

test('Multiple inline math expressions', () => {
  const original = 'Both $p$ and $q$ where $p + q = 1$.';
  const word = 'Both p and q where p + q = 1.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '$p$');
  assertContains(result, '$q$');
  assertContains(result, '$p + q = 1$');
});

test('Math with text command', () => {
  const original = 'Calculate $\\text{Var}(X)$.';
  const word = 'Calculate Var(X).';
  const result = generateSmartDiff(original, word);
  assertContains(result, '$\\text{Var}(X)$');
});

test('Math NOT protected in code blocks', () => {
  const original = '```\n$variable = 5$\n```';
  const word = '```\nvariable = 5\n```';
  // Code block math should NOT be treated as LaTeX
  const result = generateSmartDiff(original, word);
  // This is a known limitation - document it
  // For now, just ensure no crash
  assert.ok(result.length > 0);
});

test('Escaped dollar sign', () => {
  const original = 'The price is \\$50.';
  const word = 'The price is $50.';
  const result = generateSmartDiff(original, word);
  // Should not crash, escaped $ should be handled
  assert.ok(result.length > 0);
});

// ============================================================================
// FIGURE ANCHOR PROTECTION TESTS
// ============================================================================

console.log('\n🖼️ Figure Anchor Protection Tests\n');

test('Figure anchor preserved: {#fig:label}', () => {
  const original = '![Caption](image.png){#fig:heatmap}';
  const word = 'Caption';
  const result = generateSmartDiff(original, word);
  assertContains(result, '{#fig:heatmap}');
});

test('Table anchor preserved: {#tbl:label}', () => {
  const original = 'Table caption {#tbl:results}';
  const word = 'Table caption';
  const result = generateSmartDiff(original, word);
  assertContains(result, '{#tbl:results}');
});

test('Multiple anchors preserved', () => {
  const original = '![Fig A](a.png){#fig:first}\n\n![Fig B](b.png){#fig:second}';
  const word = 'Fig A\n\nFig B';
  const result = generateSmartDiff(original, word);
  assertContains(result, '{#fig:first}');
  assertContains(result, '{#fig:second}');
});

test('Anchor with width attribute', () => {
  const original = '![Caption](img.png){#fig:test width=50%}';
  const word = 'Caption';
  const result = generateSmartDiff(original, word);
  assertContains(result, '{#fig:test');
});

// ============================================================================
// CROSS-REFERENCE PROTECTION TESTS
// ============================================================================

console.log('\n🔗 Cross-Reference Protection Tests\n');

test('Figure reference preserved: @fig:label', () => {
  const original = 'See @fig:heatmap for details.';
  const word = 'See Figure 1 for details.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '@fig:heatmap');
});

test('Table reference preserved: @tbl:label', () => {
  const original = 'Results in @tbl:summary show.';
  const word = 'Results in Table 1 show.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '@tbl:summary');
});

test('Multiple cross-references', () => {
  const original = 'As shown in @fig:first and @fig:second, and @tbl:data.';
  const word = 'As shown in Figure 1 and Figure 2, and Table 1.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '@fig:first');
  assertContains(result, '@fig:second');
  assertContains(result, '@tbl:data');
});

test('Section reference preserved: @sec:label', () => {
  const original = 'Discussed in @sec:methods.';
  const word = 'Discussed in Section 2.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '@sec:methods');
});

test('Equation reference preserved: @eq:label', () => {
  const original = 'From @eq:variance we derive.';
  const word = 'From Equation 1 we derive.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '@eq:variance');
});

// ============================================================================
// COMMENT INSERTION TESTS
// ============================================================================

console.log('\n💬 Comment Insertion Tests\n');

test('Single comment inserted at correct position', () => {
  const markdown = 'The results were significant.';
  const comments = [{ id: '1', author: 'Reviewer', text: 'Add p-value' }];
  const anchors = new Map([['1', 'significant']]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  assertContains(result, '{>>Reviewer: Add p-value<<}[significant]{.mark}');
});

test('Multiple comments inserted correctly', () => {
  const markdown = 'First point. Second point. Third point.';
  const comments = [
    { id: '1', author: 'Alice', text: 'Check first' },
    { id: '2', author: 'Bob', text: 'Check second' },
  ];
  const anchors = new Map([
    ['1', 'First'],
    ['2', 'Second'],
  ]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  assertContains(result, '{>>Alice: Check first<<}');
  assertContains(result, '{>>Bob: Check second<<}');
});

test('Comment with no matching anchor is skipped', () => {
  const markdown = 'Some text here.';
  const comments = [{ id: '1', author: 'Reviewer', text: 'Cannot find this' }];
  const anchors = new Map([['1', 'nonexistent anchor text']]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  // Comment should not appear since anchor doesn't match
  assertNotContains(result, '{>>Reviewer:');
});

test('Comment anchor with special characters', () => {
  const markdown = 'The p-value (p < 0.05) was significant.';
  const comments = [{ id: '1', author: 'Reviewer', text: 'Good' }];
  const anchors = new Map([['1', 'p < 0.05']]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  // Should handle regex special chars in anchor
  assertContains(result, '{>>Reviewer: Good<<}');
});

// ============================================================================
// CONTEXT-BASED COMMENT PLACEMENT TESTS
// ============================================================================

console.log('\n🎯 Context-Based Comment Placement Tests\n');

test('Context helps disambiguate duplicate anchors', () => {
  const markdown = 'The species showed high diversity. Later, another species showed low diversity.';
  const comments = [{ id: '1', author: 'Reviewer', text: 'Which species?' }];
  // Anchor "species" appears twice, context "low diversity" indicates second occurrence
  const anchors = new Map([['1', { anchor: 'species', before: 'another', after: 'showed low diversity' }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  // Comment should be on the second "species" (format: {>>comment<<}[anchor]{.mark})
  assertContains(result, 'another {>>Reviewer: Which species?<<}[species]{.mark} showed low diversity');
});

test('Multiple duplicate anchors with different contexts', () => {
  const markdown = 'Results were significant in study A. Methods were significant in study B. Discussion was significant in study C.';
  const comments = [
    { id: '1', author: 'R1', text: 'Comment on B' },
    { id: '2', author: 'R2', text: 'Comment on C' },
  ];
  const anchors = new Map([
    ['1', { anchor: 'significant', before: 'Methods were', after: 'in study B' }],
    ['2', { anchor: 'significant', before: 'Discussion was', after: 'in study C' }],
  ]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  assertContains(result, '{>>R1: Comment on B<<}');
  assertContains(result, '{>>R2: Comment on C<<}');

  // Verify order: R1 should appear before R2
  const r1Pos = result.indexOf('{>>R1');
  const r2Pos = result.indexOf('{>>R2');
  assert.ok(r1Pos < r2Pos, 'R1 comment should be before R2 comment');
});

test('Tie-break uses document order when context is equal', () => {
  const markdown = 'The data shows X. The data shows Y. The data shows Z.';
  const comments = [
    { id: '1', author: 'R1', text: 'First' },
    { id: '2', author: 'R2', text: 'Second' },
  ];
  // Both have same anchor with no distinguishing context
  const anchors = new Map([
    ['1', { anchor: 'data', before: '', after: '' }],
    ['2', { anchor: 'data', before: '', after: '' }],
  ]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  assertContains(result, '{>>R1: First<<}');
  assertContains(result, '{>>R2: Second<<}');

  // Tie-break should assign first comment to first occurrence, second to second
  const r1Pos = result.indexOf('{>>R1');
  const r2Pos = result.indexOf('{>>R2');
  assert.ok(r1Pos < r2Pos, 'With tie-break, R1 should use first occurrence, R2 should use second');
});

test('Legacy string anchors still work (backwards compatibility)', () => {
  const markdown = 'Legacy format still works fine.';
  const comments = [{ id: '1', author: 'Reviewer', text: 'Good' }];
  // Old format: just a string, not {anchor, before, after}
  const anchors = new Map([['1', 'works']]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  assertContains(result, '{>>Reviewer: Good<<}');
});

test('Used positions not reused in tie-breaks', () => {
  // Three identical anchors, three comments - each should get unique position
  const markdown = 'Test word here. Another word there. Final word end.';
  const comments = [
    { id: '1', author: 'A', text: 'C1' },
    { id: '2', author: 'B', text: 'C2' },
    { id: '3', author: 'C', text: 'C3' },
  ];
  const anchors = new Map([
    ['1', { anchor: 'word', before: '', after: '' }],
    ['2', { anchor: 'word', before: '', after: '' }],
    ['3', { anchor: 'word', before: '', after: '' }],
  ]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);

  // All three comments should appear
  assertContains(result, '{>>A: C1<<}');
  assertContains(result, '{>>B: C2<<}');
  assertContains(result, '{>>C: C3<<}');

  // Count occurrences of each comment - each should appear exactly once
  const c1Count = (result.match(/\{>>A: C1<<\}/g) || []).length;
  const c2Count = (result.match(/\{>>B: C2<<\}/g) || []).length;
  const c3Count = (result.match(/\{>>C: C3<<\}/g) || []).length;
  assertEqual(c1Count, 1, 'C1 should appear exactly once');
  assertEqual(c2Count, 1, 'C2 should appear exactly once');
  assertEqual(c3Count, 1, 'C3 should appear exactly once');
});

// ============================================================================
// WORD ELEMENT ROBUSTNESS TESTS
// ============================================================================

console.log('\n📄 Word Element Robustness Tests\n');

// These tests simulate the mismatch between Word rendered text and Markdown source
// Word renders citations, math, and formatting differently than Markdown stores them

test('Citation renders differently: [@Smith2021] vs (Smith 2021)', () => {
  // Markdown has citation syntax, Word rendered it as text
  const markdown = 'The results [@Smith2021] showed significant effects on habitat quality.';
  const comments = [{ id: '1', author: 'Reviewer', text: 'Add more citations' }];
  // Word anchor: "habitat" - but in Word the citation rendered as "(Smith 2021)"
  // Context from Word side has the rendered form
  const anchors = new Map([['1', {
    anchor: 'habitat',
    before: '(Smith 2021) showed significant effects on',  // Word rendered citation
    after: 'quality'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  assertContains(result, '{>>Reviewer: Add more citations<<}[habitat]{.mark}');
});

test('Multiple citations in context: different rendering lengths', () => {
  const markdown = 'Studies [@Smith2021; @Jones2020] and [@Brown2019] examined habitat loss. Later habitat recovery was noted.';
  const comments = [{ id: '1', author: 'R1', text: 'Which habitat?' }];
  // Comment on second "habitat", context has rendered citations
  const anchors = new Map([['1', {
    anchor: 'habitat',
    before: '(Brown 2019) examined',  // After first habitat
    after: 'loss'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  // Should match the first "habitat" (near "loss") - format: {>>comment<<}[habitat]{.mark}
  assertContains(result, '{>>R1: Which habitat?<<}[habitat]{.mark} loss');
});

test('Math renders differently: $p < 0.05$ vs p < 0.05', () => {
  const markdown = 'Values were significant ($p < 0.05$) for all species. The species showed variation.';
  const comments = [{ id: '1', author: 'Reviewer', text: 'Which species?' }];
  // Word rendered math as plain text
  const anchors = new Map([['1', {
    anchor: 'species',
    before: '(p < 0.05) for all',  // Word rendered without $
    after: 'showed variation'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  // Should find first species (after math)
  assertContains(result, '{>>Reviewer: Which species?<<}[species]{.mark}');
});

test('Display math block renders as text', () => {
  const markdown = 'The model is:\n\n$$y = \\beta_0 + \\beta_1 x$$\n\nResults for habitat were clear. Another habitat appeared.';
  const comments = [{ id: '1', author: 'R1', text: 'Define variables' }];
  // Word rendered display math, anchor is after it
  const anchors = new Map([['1', {
    anchor: 'habitat',
    before: 'y = β0 + β1 x  Results for',  // Word rendered math
    after: 'were clear'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  // Should match first habitat - format: {>>comment<<}[habitat]{.mark}
  assertContains(result, 'Results for {>>R1: Define variables<<}[habitat]{.mark} were clear');
});

test('Bold/italic stripped in Word context', () => {
  const markdown = 'The **significant** results showed habitat effects. Minor habitat changes were noted.';
  const comments = [{ id: '1', author: 'R1', text: 'How significant?' }];
  // Word context doesn't have ** markers
  const anchors = new Map([['1', {
    anchor: 'habitat',
    before: 'significant results showed',  // No ** in Word
    after: 'effects'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  assertContains(result, '{>>R1: How significant?<<}[habitat]{.mark} effects');
});

test('HTML entities in Word: &gt; &lt; &amp;', () => {
  const markdown = 'Values > 100 showed habitat preference. Values < 50 showed habitat avoidance.';
  const comments = [{ id: '1', author: 'R1', text: 'Check threshold' }];
  // Word XML might have HTML entities
  const anchors = new Map([['1', {
    anchor: 'habitat',
    before: 'Values > 100 showed',  // Should match despite potential &gt;
    after: 'preference'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  // Should find first habitat - format: {>>comment<<}[habitat]{.mark}
  assertContains(result, 'Values > 100 showed {>>R1: Check threshold<<}[habitat]{.mark} preference');
});

test('Figure reference renders: @fig:map vs Figure 1', () => {
  const markdown = 'See @fig:map for habitat distribution. The habitat patterns vary by region.';
  const comments = [{ id: '1', author: 'R1', text: 'Add scale bar' }];
  // Word rendered @fig:map as "Figure 1"
  const anchors = new Map([['1', {
    anchor: 'habitat',
    before: 'Figure 1 for',  // Word rendered crossref
    after: 'distribution'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  assertContains(result, '{>>R1: Add scale bar<<}[habitat]{.mark} distribution');
});

test('Table reference renders: @tbl:results vs Table 1', () => {
  const markdown = 'Results in @tbl:results show habitat associations. Overall habitat diversity increased.';
  const comments = [{ id: '1', author: 'R1', text: 'Check numbers' }];
  const anchors = new Map([['1', {
    anchor: 'habitat',
    before: 'Table 1 show',  // Word rendered
    after: 'associations'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  assertContains(result, '{>>R1: Check numbers<<}[habitat]{.mark} associations');
});

test('Mixed elements: citation + math + crossref', () => {
  const markdown = 'According to [@Smith2021], when $n > 100$, see @fig:results for habitat effects. Secondary habitat effects were minor.';
  const comments = [{ id: '1', author: 'R1', text: 'Elaborate' }];
  // Word has everything rendered differently
  const anchors = new Map([['1', {
    anchor: 'habitat',
    before: '(Smith 2021), when n > 100, see Figure 1 for',  // All rendered
    after: 'effects. Secondary'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  // Should match first habitat - format: {>>comment<<}[habitat]{.mark}
  assertContains(result, 'see @fig:results for {>>R1: Elaborate<<}[habitat]{.mark} effects');
});

test('Whitespace normalization: multiple spaces collapsed', () => {
  const markdown = 'The  results   showed   habitat    effects.  More habitat data needed.';
  const comments = [{ id: '1', author: 'R1', text: 'Fix spacing' }];
  // Word normalizes whitespace
  const anchors = new Map([['1', {
    anchor: 'habitat',
    before: 'results showed',  // Normalized spaces
    after: 'effects'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  assertContains(result, '{>>R1: Fix spacing<<}');
});

test('Line breaks in Word become spaces', () => {
  const markdown = 'First paragraph about habitat.\n\nSecond paragraph about habitat.';
  const comments = [{ id: '1', author: 'R1', text: 'On second' }];
  // Word context might have different line handling
  const anchors = new Map([['1', {
    anchor: 'habitat',
    before: 'Second paragraph about',
    after: '.'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  // Should match second habitat - format: {>>comment<<}[habitat]{.mark}
  assertContains(result, 'Second paragraph about {>>R1: On second<<}[habitat]{.mark}.');
});

test('Parenthetical citation at sentence end', () => {
  const markdown = 'Habitat loss is increasing [@IPBES2023]. Habitat restoration helps.';
  const comments = [{ id: '1', author: 'R1', text: 'Recent data?' }];
  const anchors = new Map([['1', {
    anchor: 'Habitat',
    before: '(IPBES 2023).',  // After rendered citation
    after: 'restoration helps'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  // Should match second Habitat - format: {>>comment<<}[anchor]{.mark}
  // Comment is placed BEFORE anchor text in new format
  assertContains(result, '{>>R1: Recent data?<<}[Habitat]{.mark} restoration helps');
});

test('Three identical anchors with distinct contexts', () => {
  const markdown = 'Alpine habitat (cold). Coastal habitat (wet). Urban habitat (disturbed).';
  const comments = [
    { id: '1', author: 'A', text: 'Cold ref' },
    { id: '2', author: 'B', text: 'Wet ref' },
    { id: '3', author: 'C', text: 'Urban ref' },
  ];
  const anchors = new Map([
    ['1', { anchor: 'habitat', before: 'Alpine', after: '(cold)' }],
    ['2', { anchor: 'habitat', before: 'Coastal', after: '(wet)' }],
    ['3', { anchor: 'habitat', before: 'Urban', after: '(disturbed)' }],
  ]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);

  // All three should be placed
  assertContains(result, '{>>A: Cold ref<<}');
  assertContains(result, '{>>B: Wet ref<<}');
  assertContains(result, '{>>C: Urban ref<<}');

  // Verify order: A before B before C
  const aPos = result.indexOf('{>>A');
  const bPos = result.indexOf('{>>B');
  const cPos = result.indexOf('{>>C');
  assert.ok(aPos < bPos && bPos < cPos, 'Comments should be in document order');
});

test('Short anchor with long distinguishing context', () => {
  const markdown = 'The a]pha model showed results. The beta model showed results. The gamma model showed results.';
  const comments = [{ id: '1', author: 'R1', text: 'Check beta' }];
  // Very short anchor "model", need context to disambiguate
  const anchors = new Map([['1', {
    anchor: 'model',
    before: 'The beta',
    after: 'showed results. The gamma'
  }]]);

  const result = insertCommentsIntoMarkdown(markdown, comments, anchors);
  // Should find the beta model
  const betaPos = result.indexOf('beta model');
  const commentPos = result.indexOf('{>>');
  assert.ok(commentPos > betaPos && commentPos < result.indexOf('gamma'),
    'Comment should be on beta model');
});

// ============================================================================
// CLEANUP ANNOTATION TESTS
// ============================================================================

console.log('\n🧹 Annotation Cleanup Tests\n');

test('Adjacent delete+insert becomes substitution', () => {
  const input = '{--old--}{++new++}';
  const result = cleanupAnnotations(input);
  assertEqual(result, '{~~old~>new~~}');
});

test('Delete+insert with space becomes substitution', () => {
  const input = '{--old--} {++new++}';
  const result = cleanupAnnotations(input);
  assertEqual(result, '{~~old~>new~~}');
});

test('Empty annotations removed', () => {
  const input = 'Text {--  --} more {++  ++} end.';
  const result = cleanupAnnotations(input);
  assertEqual(result, 'Text more end.');
});

test('Malformed {-- with ~> fixed', () => {
  const input = '{--key~>critical~~}';
  const result = cleanupAnnotations(input);
  assertEqual(result, '{~~key~>critical~~}');
});

// ============================================================================
// EDGE CASES
// ============================================================================

console.log('\n⚠️ Edge Case Tests\n');

test('Empty original document', () => {
  const original = '';
  const word = 'New content added.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '{++New content added.++}');
});

test('Empty word document', () => {
  const original = 'Original content.';
  const word = '';
  const result = generateSmartDiff(original, word);
  assertContains(result, '{--Original content.--}');
});

test('Document with only citations', () => {
  const original = '[@Smith2021]';
  const word = '(Smith 2021)';
  const result = generateSmartDiff(original, word);
  assertContains(result, '[@Smith2021]');
});

test('Document with only math', () => {
  const original = '$x^2 + y^2 = z^2$';
  const word = 'x² + y² = z²';
  const result = generateSmartDiff(original, word);
  assertContains(result, '$x^2 + y^2 = z^2$');
});

test('Very long paragraph', () => {
  const longText = 'Word '.repeat(500);
  const original = longText + '[@Smith2021]';
  const word = longText + '(Smith 2021)';
  const result = generateSmartDiff(original, word);
  assertContains(result, '[@Smith2021]');
});

test('Unicode characters in text', () => {
  const original = 'Données écologiques [@Müller2021].';
  const word = 'Données écologiques (Müller 2021).';
  const result = generateSmartDiff(original, word);
  assertContains(result, '[@Müller2021]');
  assertContains(result, 'écologiques');
});

test('Nested braces in math', () => {
  const original = '$\\frac{a}{b}$ and $\\sqrt{x^{2}}$.';
  const word = 'a/b and √(x²).';
  const result = generateSmartDiff(original, word);
  assertContains(result, '$\\frac{a}{b}$');
  assertContains(result, '$\\sqrt{x^{2}}$');
});

test('Citation inside parentheses', () => {
  const original = 'Known effect (see [@Smith2021]).';
  const word = 'Known effect (see Smith 2021).';
  const result = generateSmartDiff(original, word);
  assertContains(result, '[@Smith2021]');
});

test('Multiple figure refs in same sentence', () => {
  const original = 'See @fig:a, @fig:b, and @fig:c.';
  const word = 'See Figure 1, Figure 2, and Figure 3.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '@fig:a');
  assertContains(result, '@fig:b');
  assertContains(result, '@fig:c');
});

test('Mixed citations and math', () => {
  const original = 'The equation $E = mc^2$ was proven [@Einstein1905].';
  const word = 'The equation E = mc² was proven (Einstein 1905).';
  const result = generateSmartDiff(original, word);
  assertContains(result, '$E = mc^2$');
  assertContains(result, '[@Einstein1905]');
});

test('Table with citations', () => {
  const original = '| Study | Result |\n|-------|--------|\n| [@A2020] | Good |';
  const word = 'Study Result\n(A 2020) Good';
  const result = generateSmartDiff(original, word);
  assertContains(result, '[@A2020]');
});

// ============================================================================
// ANCHOR DELETION PROTECTION TESTS
// ============================================================================

console.log('\n🛡️ Anchor Deletion Protection Tests\n');

test('Figure anchor NOT deleted when Word removes it', () => {
  // This is the critical test - Word doesn't preserve {#fig:label}
  const original = '![Caption text](image.png){#fig:heatmap}\n\nSome paragraph.';
  const word = 'Caption text\n\nSome paragraph.';
  const result = generateSmartDiff(original, word);
  // Anchor must be preserved, not inside {--deletion--}
  assertContains(result, '{#fig:heatmap}');
  assertNotContains(result, '{--{#fig:heatmap}--}');
});

test('Table anchor NOT deleted when Word removes it', () => {
  const original = '| A | B |\n|---|---|\n| 1 | 2 |\n\nTable: Caption {#tbl:data}';
  const word = 'A B\n1 2\n\nTable: Caption';
  const result = generateSmartDiff(original, word);
  assertContains(result, '{#tbl:data}');
  assertNotContains(result, '{--{#tbl:data}--}');
});

test('Cross-ref NOT substituted with rendered form', () => {
  // @fig:heatmap should not become {~~@fig:heatmap~>Figure 1~~}
  const original = 'See @fig:heatmap for details.';
  const word = 'See Figure 1 for details.';
  const result = generateSmartDiff(original, word);
  assertContains(result, '@fig:heatmap');
  assertNotContains(result, '{~~@fig:heatmap');
});

test('Multiple anchors all preserved when Word removes them', () => {
  const original = `![Fig A](a.png){#fig:a}

![Fig B](b.png){#fig:b}

See @fig:a and @fig:b.`;
  const word = `Fig A

Fig B

See Figure 1 and Figure 2.`;
  const result = generateSmartDiff(original, word);
  assertContains(result, '{#fig:a}');
  assertContains(result, '{#fig:b}');
  assertContains(result, '@fig:a');
  assertContains(result, '@fig:b');
});

test('Anchor with attributes preserved', () => {
  const original = '![Caption](img.png){#fig:wide width=100%}';
  const word = 'Caption';
  const result = generateSmartDiff(original, word);
  assertContains(result, '{#fig:wide width=100%}');
});

test('Equation anchor preserved', () => {
  const original = '$$E = mc^2$$ {#eq:einstein}';
  const word = 'E = mc²';
  const result = generateSmartDiff(original, word);
  assertContains(result, '{#eq:einstein}');
});

// ============================================================================
// STRESS TESTS
// ============================================================================

console.log('\n🏋️ Stress Tests\n');

test('Many citations (20+)', () => {
  let original = '';
  let word = '';
  for (let i = 1; i <= 25; i++) {
    original += `Reference [@Author${2000 + i}]. `;
    word += `Reference (Author ${2000 + i}). `;
  }
  const result = generateSmartDiff(original, word);
  // Check first, middle, and last citations
  assertContains(result, '[@Author2001]');
  assertContains(result, '[@Author2013]');
  assertContains(result, '[@Author2025]');
});

test('Many math expressions (20+)', () => {
  let original = '';
  let word = '';
  for (let i = 1; i <= 25; i++) {
    original += `Value $x_${i}$. `;
    word += `Value x${i}. `;
  }
  const result = generateSmartDiff(original, word);
  assertContains(result, '$x_1$');
  assertContains(result, '$x_13$');
  assertContains(result, '$x_25$');
});

test('Many figure references (10+)', () => {
  let original = '';
  let word = '';
  for (let i = 1; i <= 15; i++) {
    original += `See @fig:fig${i}. `;
    word += `See Figure ${i}. `;
  }
  const result = generateSmartDiff(original, word);
  assertContains(result, '@fig:fig1');
  assertContains(result, '@fig:fig8');
  assertContains(result, '@fig:fig15');
});

test('Large document (50 paragraphs)', () => {
  let original = '';
  let word = '';
  for (let i = 1; i <= 50; i++) {
    original += `## Section ${i}\n\nParagraph ${i} with citation [@Auth${i}] and math $x_${i}$.\n\n`;
    word += `Section ${i}\n\nParagraph ${i} with citation (Auth ${i}) and math x${i}.\n\n`;
  }
  const result = generateSmartDiff(original, word);
  // Should handle without crashing
  assert.ok(result.length > original.length * 0.5, 'Result should be substantial');
  assertContains(result, '[@Auth1]');
  assertContains(result, '[@Auth50]');
});

// ============================================================================
// SUMMARY
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed\n`);

if (failures.length > 0) {
  console.log('Failed tests:');
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
  process.exit(1);
}

console.log('✅ All tests passed!\n');
