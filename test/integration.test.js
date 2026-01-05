/**
 * Integration tests for docrev
 * End-to-end workflow tests
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import AdmZip from 'adm-zip';

// Import functions for direct testing
import { parseAnnotations, stripAnnotations, getComments, applyDecision } from '../lib/annotations.js';
import { extractCitations, validateCitations } from '../lib/citations.js';
import { extractEquations } from '../lib/equations.js';
import { detectHardcodedRefs, detectDynamicRefs } from '../lib/crossref.js';
import { extractChanges, detectConflicts, applyChangesAsAnnotations } from '../lib/merge.js';

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-e2e-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Workflow: Review and respond to comments', () => {
  it('should parse, list, and resolve comments', () => {
    const markdown = `# Introduction

This is the intro. {>>Reviewer 1: Please clarify this point<<}

The methodology is explained here. {>>Reviewer 2: Add more detail<<}

## Results

The results show {>>Reviewer 1: Which results?<<} improvement.
`;

    // Step 1: Parse all comments
    const comments = getComments(markdown);
    assert.strictEqual(comments.length, 3);
    assert.ok(comments.some(c => c.author === 'Reviewer 1'));
    assert.ok(comments.some(c => c.author === 'Reviewer 2'));

    // Step 2: Filter by reviewer
    const r1Comments = comments.filter(c => c.author === 'Reviewer 1');
    assert.strictEqual(r1Comments.length, 2);

    // Step 3: Check resolved status
    const pendingComments = getComments(markdown, { pendingOnly: true });
    assert.strictEqual(pendingComments.length, 3); // All pending initially

    // Step 4: Mark one as resolved
    const markdownWithResolved = markdown.replace(
      '{>>Reviewer 1: Please clarify this point<<}',
      '{>>Reviewer 1: Please clarify this point [RESOLVED]<<}'
    );

    const stillPending = getComments(markdownWithResolved, { pendingOnly: true });
    const resolved = getComments(markdownWithResolved, { resolvedOnly: true });

    assert.strictEqual(stillPending.length, 2);
    assert.strictEqual(resolved.length, 1);
  });
});

describe('Workflow: Accept/reject track changes', () => {
  it('should process track changes sequentially', () => {
    let text = `The {++important++} study shows {--old--} that {~~results~>findings~~} are significant.`;

    // Get all track changes
    const annotations = parseAnnotations(text);
    const trackChanges = annotations.filter(a => a.type !== 'comment');

    assert.strictEqual(trackChanges.length, 3);

    // Accept the insertion
    const insert = trackChanges.find(a => a.type === 'insert');
    text = applyDecision(text, insert, true);
    assert.ok(text.includes('important'));
    assert.ok(!text.includes('{++'));

    // Reject the deletion (keep the word)
    const remaining = parseAnnotations(text);
    const deletion = remaining.find(a => a.type === 'delete');
    text = applyDecision(text, deletion, false);
    assert.ok(text.includes('old'));

    // Accept the substitution
    const remaining2 = parseAnnotations(text);
    const sub = remaining2.find(a => a.type === 'substitute');
    text = applyDecision(text, sub, true);
    assert.ok(text.includes('findings'));
    assert.ok(!text.includes('results'));

    // Final text should have no annotations
    const finalAnnotations = parseAnnotations(text);
    assert.strictEqual(finalAnnotations.length, 0);
  });

  it('should strip all annotations at once', () => {
    const original = `Text with {++insert++} and {--delete--} and {~~old~>new~~}.`;
    const stripped = stripAnnotations(original);

    // Whitespace is preserved - only annotations removed (stable for tables)
    assert.strictEqual(stripped, 'Text with insert and  and new.');
    assert.ok(!stripped.includes('{'));
  });
});

describe('Workflow: Citation validation', () => {
  it('should validate citations against bibliography', () => {
    // Create test files
    const mdPath = path.join(tempDir, 'paper.md');
    const bibPath = path.join(tempDir, 'refs.bib');

    fs.writeFileSync(mdPath, `
# Introduction

Previous work [@Smith2020] showed this. Also see [@Jones2021; @Brown2019].
According to @Doe2022, this is important.
Missing reference [@Unknown2023] here.
`);

    fs.writeFileSync(bibPath, `
@article{Smith2020, author={Smith}, title={Paper 1}, year={2020}}
@article{Jones2021, author={Jones}, title={Paper 2}, year={2021}}
@article{Brown2019, author={Brown}, title={Paper 3}, year={2019}}
@article{Unused2020, author={Unused}, title={Unused}, year={2020}}
`);

    const result = validateCitations([mdPath], bibPath);

    // Should find valid citations
    assert.ok(result.valid.length >= 3);

    // Should identify missing citations
    const missingKeys = result.missing.map(m => m.key);
    assert.ok(missingKeys.includes('Unknown2023') || missingKeys.includes('Doe2022'));

    // Should identify unused bib entries
    assert.ok(result.unused.includes('Unused2020'));
  });
});

describe('Workflow: Equation handling', () => {
  it('should extract and count equations', () => {
    const markdown = `
# Methods

The equation $E = mc^2$ describes energy.

For the model:
$$
\\frac{dN}{dt} = rN\\left(1 - \\frac{N}{K}\\right)
$$

Also note that $\\alpha + \\beta = 1$ and $\\gamma > 0$.
`;

    const equations = extractEquations(markdown);

    // Should find inline and display equations
    const inline = equations.filter(e => e.type === 'inline');
    const display = equations.filter(e => e.type === 'display');

    assert.strictEqual(inline.length, 3);
    assert.strictEqual(display.length, 1);

    // Should track line numbers
    assert.ok(equations.every(e => e.line > 0));
  });
});

describe('Workflow: Cross-reference handling', () => {
  it('should detect mixed reference styles', () => {
    const text = `
See Figure 1 for the overview.
Results in @fig:results show improvement.
Tables 1-3 summarize the data.
See @tbl:summary and @tbl:details for more.
As shown in Figs. 2a-c and Figure 3.
`;

    const hardcoded = detectHardcodedRefs(text);
    const dynamic = detectDynamicRefs(text);

    // Should find hardcoded refs
    assert.ok(hardcoded.length >= 3);
    assert.ok(hardcoded.some(r => r.type === 'fig'));
    assert.ok(hardcoded.some(r => r.type === 'tbl'));

    // Should find dynamic refs
    assert.ok(dynamic.length >= 3);
    assert.ok(dynamic.some(r => r.label === 'results'));
    assert.ok(dynamic.some(r => r.label === 'summary'));
  });
});

describe('Workflow: Multi-reviewer merge', () => {
  it('should detect and handle conflicts between reviewers', () => {
    const original = 'The results show significant improvement in all metrics.';

    // Reviewer 1 changes
    const r1Text = 'The results show dramatic improvement in all metrics.';
    const r1Changes = extractChanges(original, r1Text, 'Reviewer 1');

    // Reviewer 2 changes (conflicting)
    const r2Text = 'The results show modest improvement in all metrics.';
    const r2Changes = extractChanges(original, r2Text, 'Reviewer 2');

    // Detect conflicts
    const { conflicts, nonConflicting } = detectConflicts([r1Changes, r2Changes]);

    // Should detect the overlapping change
    assert.ok(conflicts.length >= 1);
    assert.ok(conflicts[0].changes.some(c => c.reviewer === 'Reviewer 1'));
    assert.ok(conflicts[0].changes.some(c => c.reviewer === 'Reviewer 2'));
  });

  it('should merge non-conflicting changes', () => {
    const original = 'The first section. The second section.';

    // R1 changes first section
    const r1Text = 'The updated first section. The second section.';
    const r1Changes = extractChanges(original, r1Text, 'R1');

    // R2 changes second section (no overlap)
    const r2Text = 'The first section. The revised second section.';
    const r2Changes = extractChanges(original, r2Text, 'R2');

    const { conflicts, nonConflicting } = detectConflicts([r1Changes, r2Changes]);

    // No conflicts
    assert.strictEqual(conflicts.length, 0);

    // Both changes should be preserved
    assert.ok(nonConflicting.length >= 2);

    // Apply as annotations
    const annotated = applyChangesAsAnnotations(original, nonConflicting);
    assert.ok(annotated.includes('{~~') || annotated.includes('{++'));
  });
});

describe('Workflow: Full document cycle', () => {
  it('should process a complete revision cycle', () => {
    // Step 1: Original document
    const original = `# Introduction

The study examines habitat loss in forest ecosystems.

# Methods

We collected data from 50 sites.

# Results

Species richness declined by 30%.
`;

    // Step 2: Reviewer annotations added
    let revised = original
      .replace('examines', '{~~examines~>investigates~~}')
      .replace('50 sites', '{--50 sites--}{++100 sites across 5 regions++}')
      .replace('30%', '30% {>>Reviewer: Is this significant?<<}');

    // Step 3: Check annotation counts
    const annotations = parseAnnotations(revised);
    assert.strictEqual(annotations.filter(a => a.type === 'substitute').length, 1);
    assert.strictEqual(annotations.filter(a => a.type === 'delete').length, 1);
    assert.strictEqual(annotations.filter(a => a.type === 'insert').length, 1);
    assert.strictEqual(annotations.filter(a => a.type === 'comment').length, 1);

    // Step 4: Accept all track changes
    let processed = stripAnnotations(revised, { keepComments: true });

    // Should still have the comment
    assert.ok(processed.includes('{>>'));

    // Step 5: Respond to comment
    processed = processed.replace(
      '{>>Reviewer: Is this significant?<<}',
      '{>>Reviewer: Is this significant?<<} {>>Author: Yes, p < 0.001, added to text.<<}'
    );

    // Step 6: Final cleanup
    const final = stripAnnotations(processed);

    // Should have no annotations
    assert.ok(!final.includes('{++'));
    assert.ok(!final.includes('{--'));
    assert.ok(!final.includes('{~~'));
    assert.ok(!final.includes('{>>'));

    // Should have the accepted changes
    assert.ok(final.includes('investigates'));
    assert.ok(final.includes('100 sites'));
    assert.ok(!final.includes('50 sites'));
  });
});

describe('Workflow: Section-based editing', () => {
  it('should handle annotations in section files', () => {
    // Simulate multiple section files
    const intro = `# Introduction

This is the {++updated++} introduction.
{>>Reviewer: Add background<<}
`;

    const methods = `# Methods

The methods {~~were~>are~~} described here.
`;

    const results = `# Results

Results show {--marginal--} improvement.
`;

    // Process each section
    const sections = [
      { name: 'introduction.md', content: intro },
      { name: 'methods.md', content: methods },
      { name: 'results.md', content: results },
    ];

    const processed = sections.map(s => ({
      name: s.name,
      annotations: parseAnnotations(s.content),
      stripped: stripAnnotations(s.content),
    }));

    // Total annotations across all sections
    const totalAnnotations = processed.reduce((sum, s) => sum + s.annotations.length, 0);
    assert.strictEqual(totalAnnotations, 4);

    // Each section should be cleanly stripped
    processed.forEach(s => {
      assert.ok(!s.stripped.includes('{++'));
      assert.ok(!s.stripped.includes('{--'));
    });
  });
});

describe('Error handling', () => {
  it('should handle malformed annotations gracefully', () => {
    const malformed = `
Text with incomplete {++insert
And unmatched {--delete
Normal text here.
`;

    // Should not throw
    const annotations = parseAnnotations(malformed);
    assert.ok(Array.isArray(annotations));

    const stripped = stripAnnotations(malformed);
    assert.ok(typeof stripped === 'string');
  });

  it('should handle empty inputs', () => {
    assert.deepStrictEqual(parseAnnotations(''), []);
    assert.strictEqual(stripAnnotations(''), '');
    assert.deepStrictEqual(getComments(''), []);
    assert.deepStrictEqual(extractEquations(''), []);
    assert.deepStrictEqual(detectHardcodedRefs(''), []);
    assert.deepStrictEqual(detectDynamicRefs(''), []);
  });

  it('should handle very large documents', () => {
    // Generate a large document
    const paragraph = 'This is a paragraph with some {++inserted++} text. ';
    const largeDoc = paragraph.repeat(1000);

    // Should handle without crashing
    const annotations = parseAnnotations(largeDoc);
    assert.ok(annotations.length >= 1000);

    const stripped = stripAnnotations(largeDoc);
    assert.ok(stripped.length > 0);
  });
});
