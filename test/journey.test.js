/**
 * Tests for story/journey sidecars (gcol33/docrev#12): parsing, the manuscript
 * block scanner, the `journey check` findings, and paragraph-marker survival
 * through a Word round-trip.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { parseStory } from '../lib/story.js';
import {
  parseJourney,
  journeyCheck,
  assignParagraphIds,
  scaffoldJourneyEntries,
  serializeJourney,
  formatJourneyEntry,
  sectionSlug,
  firstSentence,
} from '../lib/journey.js';
import {
  classifyBlock,
  parseManuscriptBlocks,
  stripParagraphMarkers,
  reattachParagraphMarkers,
} from '../lib/paragraph-markers.js';
import { generateSmartDiff } from '../lib/diff-engine.js';
import { buildRegistry } from '../lib/crossref.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

// ============================================================================
// story.md parsing
// ============================================================================

describe('parseStory', () => {
  const SAMPLE = `# Story: Checkable optimality

## Claim
The paper shows the certificate is checkable without re-solving.

## Audience
Readers who already accept branch-and-price but not the certificate.

## Arcs

### S1 Setup
- question: Why does this need a certificate at all?
- answer: Because re-solving to verify is too slow.
- evidence: @fig:runtime
- limits: Only shown for instances under 500 nodes.

### S2 Checkable optimality
- question: How is optimality checked?
- answer: By a certificate computed alongside the solve.
- evidence: @eq:certificate; TODO cite the follow-up paper
- limits: Requires integral duals.
- needs: S1

## Terms
- certificate: a set of duals proving optimality.

## Constraints
- Never call the baseline "naive".

## Open
- Whether the certificate generalizes to non-integral duals.
`;

  it('parses title, claim, and audience', () => {
    const { doc, errors } = parseStory(SAMPLE);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(doc.title, 'Checkable optimality');
    assert.match(doc.claim, /checkable without re-solving/);
    assert.match(doc.audience, /branch-and-price/);
  });

  it('parses arcs with fields and needs', () => {
    const { doc } = parseStory(SAMPLE);
    assert.strictEqual(doc.arcs.length, 2);
    const [s1, s2] = doc.arcs;
    assert.strictEqual(s1.id, 'S1');
    assert.strictEqual(s1.title, 'Setup');
    assert.strictEqual(s1.evidence, '@fig:runtime');
    assert.deepStrictEqual(s1.needs, []);
    assert.strictEqual(s2.id, 'S2');
    assert.deepStrictEqual(s2.needs, ['S1']);
    assert.match(s2.evidence, /TODO/);
  });

  it('parses terms, constraints, and open items', () => {
    const { doc } = parseStory(SAMPLE);
    assert.deepStrictEqual(doc.terms, [{ term: 'certificate', definition: 'a set of duals proving optimality.' }]);
    assert.deepStrictEqual(doc.constraints, ['Never call the baseline "naive".']);
    assert.deepStrictEqual(doc.open, ['Whether the certificate generalizes to non-integral duals.']);
  });

  it('reports a field line before any arc heading', () => {
    const { errors } = parseStory('# Story: X\n\n## Arcs\n\n- question: orphaned\n');
    assert.ok(errors.some((e) => /before any arc heading/.test(e.message)));
    assert.strictEqual(errors[0].line, 5);
  });

  it('reports an unknown arc field with its line number', () => {
    const { errors } = parseStory('# Story: X\n\n## Arcs\n\n### S1 Title\n- bogus: value\n');
    assert.ok(errors.some((e) => /Unknown arc field "bogus"/.test(e.message) && e.line === 6));
  });

  it('parses an arc payoff', () => {
    const { doc, errors } = parseStory('## Arcs\n\n### S1 A\n- answer: a\n- payoff: Readers can fill the gaps.\n');
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(doc.arcs[0].payoff, 'Readers can fill the gaps.');
  });

  it('reports a duplicate arc id', () => {
    const { errors } = parseStory('## Arcs\n\n### S1 A\n- question: a\n\n### S1 B\n- question: b\n');
    assert.ok(errors.some((e) => /Duplicate arc id "S1"/.test(e.message)));
  });
});

// ============================================================================
// journey.md parsing
// ============================================================================

describe('parseJourney', () => {
  const SAMPLE = `# Journey: Checkable optimality

## Introduction

### intro.memory  [S1]
- job: The number of possible pairs is what creates the memory demand.
- support: scaling argument
- leaves: Why large problems need another way to obtain costs.

### eq.reduced-cost  [S2]  (equation)
- job: Defines the reduced cost used by the certificate.
- leaves: What the certificate actually certifies.

### fig.headline  [S2 S1]  (figure)
- job: Shows runtime against instance size.
`;

  it('parses title and entries with arcs, types, and fields', () => {
    const { doc, errors } = parseJourney(SAMPLE);
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(doc.title, 'Checkable optimality');
    assert.strictEqual(doc.entries.length, 3);

    const [intro, eq, fig] = doc.entries;
    assert.strictEqual(intro.id, 'intro.memory');
    assert.strictEqual(intro.section, 'Introduction');
    assert.deepStrictEqual(intro.arcs, ['S1']);
    assert.strictEqual(intro.entryType, 'paragraph');
    assert.match(intro.job, /memory demand/);

    assert.strictEqual(eq.entryType, 'equation');
    assert.deepStrictEqual(eq.arcs, ['S2']);
    assert.strictEqual(eq.support, '');

    assert.strictEqual(fig.entryType, 'figure');
    assert.deepStrictEqual(fig.arcs, ['S2', 'S1']);
  });

  it('flags an unknown entry type', () => {
    const { errors } = parseJourney('## Sec\n\n### x.p1 (chart)\n- job: y\n');
    assert.ok(errors.some((e) => /Unknown entry type "\(chart\)"/.test(e.message)));
  });

  it('round-trips through formatJourneyEntry/serializeJourney', () => {
    const { doc } = parseJourney(SAMPLE);
    const text = serializeJourney(doc.title, doc.entries);
    const reparsed = parseJourney(text).doc;
    assert.strictEqual(reparsed.entries.length, doc.entries.length);
    assert.strictEqual(reparsed.entries[2].id, 'fig.headline');
    assert.deepStrictEqual(reparsed.entries[2].arcs, ['S2', 'S1']);
    assert.strictEqual(reparsed.entries[2].entryType, 'figure');
  });

  it('keeps idea, warning and accept lines through a rewrite', () => {
    const text = `# Journey: X

## Abstract

### abs.release  [S6]
- idea: models released
- job: Says what the released models do.
- warning: off-job: the last sentence is about training data
- warning: undelivered: the payoff is missing
- accept: synonym-drift "fields": the header's own word
`;
    const { doc, errors } = parseJourney(text);
    assert.deepStrictEqual(errors, []);
    const [entry] = doc.entries;
    assert.strictEqual(entry.idea, 'models released');
    assert.strictEqual(entry.warnings.length, 2);
    assert.deepStrictEqual(entry.accepts, ['synonym-drift "fields": the header\'s own word']);
    assert.strictEqual(serializeJourney(doc.title, doc.entries), text);
  });
});

// ============================================================================
// Manuscript block scanning
// ============================================================================

describe('classifyBlock', () => {
  it('classifies paragraphs, figures, tables, equations, and code', () => {
    assert.strictEqual(classifyBlock('Plain prose here.'), 'paragraph');
    assert.strictEqual(classifyBlock('![Caption.](fig.png){#fig:x}'), 'figure');
    assert.strictEqual(classifyBlock('$$x = y$$'), 'equation');
    assert.strictEqual(classifyBlock('```js\nconst x = 1;\n```'), 'code');
    assert.strictEqual(classifyBlock('| a | b |\n|---|---|\n| 1 | 2 |'), 'table');
  });
});

describe('parseManuscriptBlocks', () => {
  const CONTENT = `# Introduction

<!-- @p:intro.memory -->
The number of possible pairs is what creates the memory demand.

An unmarked second paragraph.

## Results

![Runtime plot.](runtime.png){#fig:runtime}

| n | time |
|---|------|
| 1 | 2 |
`;

  it('assigns section from the nearest heading and extracts markers', () => {
    const blocks = parseManuscriptBlocks(CONTENT, 'intro.md', 'intro');

    assert.strictEqual(blocks.length, 4);
    assert.strictEqual(blocks[0].markerId, 'intro.memory');
    assert.strictEqual(blocks[0].section, 'Introduction');
    assert.strictEqual(blocks[0].blockType, 'paragraph');
    assert.match(blocks[0].text, /^The number of possible pairs/);

    assert.strictEqual(blocks[1].markerId, null);
    assert.strictEqual(blocks[1].section, 'Introduction');

    assert.strictEqual(blocks[2].section, 'Results');
    assert.strictEqual(blocks[2].blockType, 'figure');

    assert.strictEqual(blocks[3].blockType, 'table');
  });

  it('falls back to the given section name before any heading', () => {
    const blocks = parseManuscriptBlocks('Just a paragraph, no heading.', 'x.md', 'Fallback');
    assert.strictEqual(blocks.length, 1);
    assert.strictEqual(blocks[0].section, 'Fallback');
  });

  it('reads headings in a file with Windows line endings', () => {
    const blocks = parseManuscriptBlocks(CONTENT.replace(/\n/g, '\r\n'), 'intro.md', 'intro');
    assert.strictEqual(blocks.length, 4);
    assert.strictEqual(blocks[0].section, 'Introduction');
    assert.strictEqual(blocks[2].section, 'Results');
    assert.ok(blocks.every((b) => !b.text.includes('\r')));
  });
});

// ============================================================================
// journeyCheck
// ============================================================================

function makeBlock(overrides) {
  return { file: 'x.md', section: 'Introduction', blockType: 'paragraph', markerId: null, text: 'x', line: 1, ...overrides };
}

function makeEntry(overrides) {
  return { id: 'x', section: 'Introduction', arcs: [], entryType: 'paragraph', idea: '', job: 'A job.', support: '', leaves: '',
           warnings: [], accepts: [], line: 1, ...overrides };
}

describe('journeyCheck', () => {
  it('flags a paragraph with no marker', () => {
    const findings = journeyCheck([makeBlock({ markerId: null })], { title: '', entries: [] });
    assert.ok(findings.some((f) => f.kind === 'missing-marker'));
  });

  it('flags a marked paragraph with no journey entry', () => {
    const findings = journeyCheck([makeBlock({ markerId: 'intro.p1' })], { title: '', entries: [] });
    assert.ok(findings.some((f) => f.kind === 'missing-entry' && f.entryIds.includes('intro.p1')));
  });

  it('flags a journey entry with no matching paragraph', () => {
    const findings = journeyCheck([], { title: '', entries: [makeEntry({ id: 'ghost' })] });
    assert.ok(findings.some((f) => f.kind === 'orphan-marker' && f.entryIds.includes('ghost')));
  });

  it('flags entries listed in the wrong order relative to the manuscript', () => {
    const blocks = [makeBlock({ markerId: 'a', line: 1 }), makeBlock({ markerId: 'b', line: 5 })];
    const journey = { title: '', entries: [makeEntry({ id: 'b', line: 1 }), makeEntry({ id: 'a', line: 5 })] };
    const findings = journeyCheck(blocks, journey);
    assert.ok(findings.some((f) => f.kind === 'order-mismatch'));
  });

  it('flags a job that is more than one sentence', () => {
    const journey = { title: '', entries: [makeEntry({ job: 'First sentence. Second sentence.' })] };
    const findings = journeyCheck([makeBlock({ markerId: 'x' })], journey);
    assert.ok(findings.some((f) => f.kind === 'multi-sentence-job'));
  });

  it('does not flag a one-sentence job with an abbreviation', () => {
    const journey = { title: '', entries: [makeEntry({ job: 'It follows e.g. from the setup lemma.' })] };
    const findings = journeyCheck([makeBlock({ markerId: 'x' })], journey);
    assert.ok(!findings.some((f) => f.kind === 'multi-sentence-job'));
  });

  it('flags an entry with no arc and an arc with no entry', () => {
    const story = { title: '', claim: '', audience: '', arcs: [{ id: 'S1', title: 'T', question: '', answer: '', evidence: '', limits: '', needs: [], line: 1 }], terms: [], constraints: [], open: [] };
    const journey = { title: '', entries: [makeEntry({ id: 'x', arcs: [] })] };
    const findings = journeyCheck([makeBlock({ markerId: 'x' })], journey, { story });
    assert.ok(findings.some((f) => f.kind === 'orphan-entry' && f.entryIds.includes('x')));
    assert.ok(findings.some((f) => f.kind === 'unclaimed-arc' && f.arcId === 'S1'));
  });

  it('flags an arc introduced before an arc it needs', () => {
    const story = {
      title: '', claim: '', audience: '',
      arcs: [
        { id: 'S1', title: 'A', question: '', answer: '', evidence: '', limits: '', needs: [], line: 1 },
        { id: 'S2', title: 'B', question: '', answer: '', evidence: '', limits: '', needs: ['S1'], line: 2 },
      ],
      terms: [], constraints: [], open: [],
    };
    // S2's entry comes before S1's entry — needs violated.
    const journey = { title: '', entries: [makeEntry({ id: 'a', arcs: ['S2'] }), makeEntry({ id: 'b', arcs: ['S1'] })] };
    const blocks = [makeBlock({ markerId: 'a' }), makeBlock({ markerId: 'b' })];
    const findings = journeyCheck(blocks, journey, { story });
    assert.ok(findings.some((f) => f.kind === 'needs-violation' && f.arcId === 'S2'));
  });

  it('takes the needs order from the body, not from the abstract that states every arc', () => {
    const story = {
      title: '', claim: '', audience: '',
      arcs: [
        { id: 'S1', title: 'A', question: '', answer: '', payoff: '', evidence: '', limits: '', needs: [], line: 1 },
        { id: 'S2', title: 'B', question: '', answer: '', payoff: '', evidence: '', limits: '', needs: ['S1'], line: 2 },
      ],
      terms: [], constraints: [], open: [],
    };
    const entries = [
      makeEntry({ id: 'abs', section: 'Abstract', arcs: ['S2', 'S1'] }),
      makeEntry({ id: 'a', arcs: ['S1'] }),
      makeEntry({ id: 'b', arcs: ['S2'] }),
    ];
    const blocks = entries.map((e) => makeBlock({ markerId: e.id }));
    assert.ok(!journeyCheck(blocks, { title: '', entries }, { story }).some((f) => f.kind === 'needs-violation'));
    const reversed = [entries[0], entries[2], entries[1]];
    const reversedBlocks = reversed.map((e) => makeBlock({ markerId: e.id }));
    assert.ok(journeyCheck(reversedBlocks, { title: '', entries: reversed }, { story }).some((f) => f.kind === 'needs-violation'));
  });

  it('does not flag needs order when satisfied', () => {
    const story = {
      title: '', claim: '', audience: '',
      arcs: [
        { id: 'S1', title: 'A', question: '', answer: '', evidence: '', limits: '', needs: [], line: 1 },
        { id: 'S2', title: 'B', question: '', answer: '', evidence: '', limits: '', needs: ['S1'], line: 2 },
      ],
      terms: [], constraints: [], open: [],
    };
    const journey = { title: '', entries: [makeEntry({ id: 'a', arcs: ['S1'] }), makeEntry({ id: 'b', arcs: ['S2'] })] };
    const blocks = [makeBlock({ markerId: 'a' }), makeBlock({ markerId: 'b' })];
    const findings = journeyCheck(blocks, journey, { story });
    assert.ok(!findings.some((f) => f.kind === 'needs-violation'));
  });

  it('flags TODO evidence and unresolved evidence labels', () => {
    const story = {
      title: '', claim: '', audience: '',
      arcs: [
        { id: 'S1', title: 'A', question: '', answer: '', evidence: 'TODO find a figure', limits: '', needs: [], line: 1 },
        { id: 'S2', title: 'B', question: '', answer: '', evidence: '@fig:missing', limits: '', needs: [], line: 2 },
      ],
      terms: [], constraints: [], open: [],
    };
    const registry = { figures: new Map(), tables: new Map(), equations: new Map(), byNumber: {} };
    const findings = journeyCheck([], { title: '', entries: [] }, { story, registry });
    assert.ok(findings.some((f) => f.kind === 'todo-evidence' && f.arcId === 'S1'));
    assert.ok(findings.some((f) => f.kind === 'unresolved-evidence' && f.arcId === 'S2'));
  });

  it('does not flag evidence that resolves against the registry', () => {
    const story = {
      title: '', claim: '', audience: '',
      arcs: [{ id: 'S1', title: 'A', question: '', answer: '', evidence: '@fig:runtime', limits: '', needs: [], line: 1 }],
      terms: [], constraints: [], open: [],
    };
    const registry = { figures: new Map([['runtime', { label: 'runtime', num: 1, isSupp: false, file: 'x.md' }]]), tables: new Map(), equations: new Map(), byNumber: {} };
    const findings = journeyCheck([], { title: '', entries: [] }, { story, registry });
    assert.ok(!findings.some((f) => f.kind === 'unresolved-evidence'));
  });

  it('flags near-identical job/leaves across different sections', () => {
    const journey = {
      title: '',
      entries: [
        makeEntry({ id: 'res.a', section: 'Results', job: 'States the runtime result.', leaves: 'The certificate is checkable without re-solving the program.' }),
        makeEntry({ id: 'disc.a', section: 'Discussion', job: 'Restates the runtime result.', leaves: 'The certificate is checkable without re-solving the program again.' }),
      ],
    };
    const blocks = [makeBlock({ markerId: 'res.a' }), makeBlock({ markerId: 'disc.a' })];
    const findings = journeyCheck(blocks, journey);
    assert.ok(findings.some((f) => f.kind === 'near-duplicate' && f.entryIds.includes('res.a') && f.entryIds.includes('disc.a')));
  });

  it('does not flag unrelated job/leaves in different sections', () => {
    const journey = {
      title: '',
      entries: [
        makeEntry({ id: 'res.a', section: 'Results', job: 'Reports the measured runtime.', leaves: 'The runtime scales linearly with instance size.' }),
        makeEntry({ id: 'disc.a', section: 'Discussion', job: 'Proposes future work.', leaves: 'Future work could relax the integrality assumption.' }),
      ],
    };
    const blocks = [makeBlock({ markerId: 'res.a' }), makeBlock({ markerId: 'disc.a' })];
    const findings = journeyCheck(blocks, journey);
    assert.ok(!findings.some((f) => f.kind === 'near-duplicate'));
  });

  it('flags a figure in the manuscript with no journey entry', () => {
    const blocks = [makeBlock({ blockType: 'figure', markerId: null, text: '![Runtime.](r.png){#fig:runtime}' })];
    const reg = { figures: new Map([['runtime', { label: 'runtime', num: 1, isSupp: false, file: 'x.md' }]]), tables: new Map(), equations: new Map(), byNumber: {} };
    const findings = journeyCheck(blocks, { title: '', entries: [] }, { registry: reg });
    assert.ok(findings.some((f) => f.kind === 'unlisted-float' && /fig:runtime/.test(f.message)));
  });

  it('does not flag a figure whose owning block has a journey entry', () => {
    const blocks = [makeBlock({ blockType: 'figure', markerId: 'fig.runtime', text: '![Runtime.](r.png){#fig:runtime}' })];
    const journey = { title: '', entries: [makeEntry({ id: 'fig.runtime', entryType: 'figure' })] };
    const reg = { figures: new Map([['runtime', { label: 'runtime', num: 1, isSupp: false, file: 'x.md' }]]), tables: new Map(), equations: new Map(), byNumber: {} };
    const findings = journeyCheck(blocks, journey, { registry: reg });
    assert.ok(!findings.some((f) => f.kind === 'unlisted-float'));
  });
});

// ============================================================================
// journey init helpers
// ============================================================================

describe('journeyCheck against a real crossref registry', () => {
  it('resolves evidence and finds the unlisted figure end to end', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-journey-'));
    try {
      const introContent = [
        '# Introduction',
        '',
        '<!-- @p:intro.setup -->',
        'This paper introduces a certificate.',
        '',
        '![Runtime against instance size.](runtime.png){#fig:runtime}',
      ].join('\n');
      fs.writeFileSync(path.join(tempDir, 'intro.md'), introContent);

      const registry = buildRegistry(tempDir, ['intro.md']);
      const blocks = parseManuscriptBlocks(introContent, 'intro.md', 'Introduction');

      const story = {
        title: '', claim: '', audience: '',
        arcs: [{ id: 'S1', title: 'Setup', question: '', answer: '', evidence: '@fig:runtime', limits: '', needs: [], line: 1 }],
        terms: [], constraints: [], open: [],
      };
      const journey = { title: '', entries: [makeEntry({ id: 'intro.setup', arcs: ['S1'] })] };

      const findings = journeyCheck(blocks, journey, { story, registry });
      assert.ok(!findings.some((f) => f.kind === 'unresolved-evidence'));
      assert.ok(findings.some((f) => f.kind === 'unlisted-float' && /fig:runtime/.test(f.message)));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe('sectionSlug / firstSentence', () => {
  it('aliases common section names', () => {
    assert.strictEqual(sectionSlug('Introduction'), 'intro');
    assert.strictEqual(sectionSlug('Materials and Methods'), 'methods');
    assert.strictEqual(sectionSlug('Some Custom Heading'), 'some');
  });

  it('extracts the first sentence and strips markdown', () => {
    assert.strictEqual(
      firstSentence('The **number** of possible pairs is large. It creates a memory demand.'),
      'The number of possible pairs is large.'
    );
  });
});

describe('assignParagraphIds / scaffoldJourneyEntries', () => {
  it('assigns unique ids only to unmarked blocks', () => {
    const blocks = [
      makeBlock({ section: 'Introduction', markerId: null, text: 'First paragraph.' }),
      makeBlock({ section: 'Introduction', markerId: 'intro.keep', text: 'Already marked.' }),
      makeBlock({ section: 'Introduction', blockType: 'figure', markerId: null, text: '![x](y.png)' }),
    ];
    const { updated, newIds } = assignParagraphIds(blocks, []);
    assert.strictEqual(newIds.length, 2);
    assert.strictEqual(updated[1].markerId, 'intro.keep');
    assert.notStrictEqual(updated[0].markerId, updated[2].markerId);
    assert.match(updated[0].markerId, /^intro\.p\d+$/);
    assert.match(updated[2].markerId, /^intro\.fig\d+$/);
  });

  it('avoids collisions with existing ids', () => {
    const blocks = [makeBlock({ section: 'Introduction', markerId: null })];
    const { updated } = assignParagraphIds(blocks, ['intro.p1']);
    assert.strictEqual(updated[0].markerId, 'intro.p2');
  });

  it('preserves hand-authored fields for existing entries, drafts new ones', () => {
    const blocks = [
      makeBlock({ markerId: 'intro.keep', text: 'Kept paragraph.' }),
      makeBlock({ markerId: 'intro.new', text: 'A brand new paragraph. More text.' }),
    ];
    const existing = new Map([['intro.keep', makeEntry({ id: 'intro.keep', arcs: ['S1'], job: 'Hand-written job.' })]]);
    const entries = scaffoldJourneyEntries(blocks, existing);
    assert.strictEqual(entries[0].job, 'Hand-written job.');
    assert.deepStrictEqual(entries[0].arcs, ['S1']);
    assert.strictEqual(entries[1].job, 'A brand new paragraph.');
    assert.deepStrictEqual(entries[1].arcs, []);
  });
});

// ============================================================================
// Paragraph markers: build stripping, sync round-trip, reattachment
// ============================================================================

describe('stripParagraphMarkers', () => {
  it('removes marker lines but leaves the paragraph', () => {
    const content = '<!-- @p:intro.memory -->\nSome prose.\n\nAnother paragraph.';
    const stripped = stripParagraphMarkers(content);
    assert.ok(!stripped.includes('@p:'));
    assert.match(stripped, /Some prose\./);
  });
});

describe('paragraph markers survive generateSmartDiff (legacy diff-based sync)', () => {
  it('keeps the marker on an unchanged paragraph', () => {
    const original = '<!-- @p:intro.memory -->\nThe number of possible pairs is what creates the memory demand.';
    const word = 'The number of possible pairs is what creates the memory demand.';
    const result = generateSmartDiff(original, word);
    assert.match(result, /^<!-- @p:intro\.memory -->/);
  });

  it('keeps the marker when the paragraph is lightly edited', () => {
    const original = '<!-- @p:intro.memory -->\nThe number of possible pairs creates the memory demand.';
    const word = 'The count of possible pairs creates the memory demand.';
    const result = generateSmartDiff(original, word);
    assert.match(result, /@p:intro\.memory/);
  });
});

describe('reattachParagraphMarkers (OOXML sync path)', () => {
  it('reattaches a marker onto an unchanged reconstructed paragraph', () => {
    const original = '<!-- @p:intro.memory -->\nThe number of possible pairs is what creates the memory demand.';
    const reconstructed = 'The number of possible pairs is what creates the memory demand.';
    const result = reattachParagraphMarkers(original, reconstructed);
    assert.match(result, /^<!-- @p:intro\.memory -->\nThe number/);
  });

  it('reattaches a marker onto a lightly edited paragraph', () => {
    const original = '<!-- @p:intro.memory -->\nThe number of possible pairs creates the memory demand.';
    const reconstructed = 'The {++total++} number of possible pairs creates the memory demand.';
    const result = reattachParagraphMarkers(original, reconstructed);
    assert.match(result, /@p:intro\.memory/);
  });

  it('does not reattach onto an unrelated paragraph', () => {
    const original = '<!-- @p:intro.memory -->\nThe number of possible pairs creates the memory demand.';
    const reconstructed = 'A completely different sentence about something else entirely unrelated to pairs.';
    const result = reattachParagraphMarkers(original, reconstructed);
    assert.strictEqual(result, reconstructed);
  });

  it('reattaches multiple markers to the right paragraphs in order', () => {
    const original = [
      '<!-- @p:a -->',
      'First paragraph about apples and oranges.',
      '',
      '<!-- @p:b -->',
      'Second paragraph about bananas and pears.',
    ].join('\n');
    const reconstructed = [
      'First paragraph about apples and oranges.',
      '',
      'Second paragraph about bananas and pears.',
    ].join('\n');
    const result = reattachParagraphMarkers(original, reconstructed);
    const lines = result.split('\n');
    assert.strictEqual(lines[0], '<!-- @p:a -->');
    assert.ok(result.includes('<!-- @p:b -->\nSecond paragraph'));
  });

  it('is a no-op when the original has no markers', () => {
    const original = 'No markers here.';
    const reconstructed = 'No markers here, reconstructed.';
    assert.strictEqual(reattachParagraphMarkers(original, reconstructed), reconstructed);
  });
});

// ============================================================================
// rev journey init (CLI)
// ============================================================================

describe('rev journey init', () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const rev = (dir) => {
    try {
      return { code: 0, out: execSync(`"${path.join(root, 'node_modules', '.bin', 'tsx')}" "${path.join(root, 'bin', 'rev.ts')}" journey init`,
        { cwd: dir, encoding: 'utf-8', stdio: 'pipe', timeout: 30000 }) };
    } catch (err) {
      return { code: err.status, out: `${err.stdout}${err.stderr}` };
    }
  };
  const project = (files) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-journey-'));
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
    return dir;
  };

  it('marks paragraphs, not headings, in a file with Windows line endings, and keeps its line endings', () => {
    const dir = project({
      'rev.yaml': 'title: T\r\nsections:\r\n  - a.md\r\n',
      'a.md': '# Abstract\r\n\r\nFirst paragraph.\r\n\r\n## Sub\r\n\r\nSecond paragraph.\r\n',
    });
    try {
      assert.strictEqual(rev(dir).code, 0);
      const a = fs.readFileSync(path.join(dir, 'a.md'), 'utf-8');
      assert.deepStrictEqual(a.match(/-->\r\n.*/g), ['-->\r\nFirst paragraph.', '-->\r\nSecond paragraph.']);
      assert.ok(!/[^\r]\n/.test(a), 'every line ends in CRLF');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('puts a new marker inside an unmarked item of a list whose items carry markers', () => {
    const dir = project({
      'rev.yaml': 'title: T\nsections:\n  - a.md\n',
      'a.md': '# Abstract\n\n1. <!-- @p:abs.one -->\n   First point.\n2. Second point.\n',
    });
    try {
      assert.strictEqual(rev(dir).code, 0);
      assert.match(fs.readFileSync(path.join(dir, 'a.md'), 'utf-8'), /^2\. <!-- @p:abs\.p1 --> Second point\.$/m);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to rewrite a journey.md with lines it cannot parse', () => {
    const journey = '# Journey: T\n\n## Abstract\n\n### abs.p1\n- job: First.\n- mystery: a field docrev does not know\n';
    const dir = project({
      'rev.yaml': 'title: T\nsections:\n  - a.md\n',
      'a.md': '# Abstract\n\n<!-- @p:abs.p1 -->\nFirst paragraph.\n\nA new paragraph.\n',
      'journey.md': journey,
    });
    try {
      const { code, out } = rev(dir);
      assert.strictEqual(code, 1);
      assert.match(out, /Unknown entry field "mystery"/);
      assert.strictEqual(fs.readFileSync(path.join(dir, 'journey.md'), 'utf-8'), journey);
      assert.ok(!fs.readFileSync(path.join(dir, 'a.md'), 'utf-8').includes('abs.p2'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('list items with their own markers', () => {
  const ABSTRACT = `# Abstract

1. <!-- @p:abs.problem -->
   Archives leave many variables unrecorded.
   We ask which can be predicted.
2. <!-- @p:abs.design -->
   We trained networks on 1.9 million plots.
3. Composition alone recovered habitat best.
`;

  it('makes each marked item its own unit, starting at its item line', () => {
    const blocks = parseManuscriptBlocks(ABSTRACT, 'abstract.md', 'abstract');
    assert.deepStrictEqual(blocks.map((b) => [b.markerId, b.line, b.listItem]),
      [['abs.problem', 3, true], ['abs.design', 6, true], [null, 8, true]]);
    assert.strictEqual(blocks[0].text, 'Archives leave many variables unrecorded.\nWe ask which can be predicted.');
    assert.strictEqual(blocks[2].text, 'Composition alone recovered habitat best.');
  });

  it('keeps a list without item markers as one unit', () => {
    const blocks = parseManuscriptBlocks('<!-- @p:intro.list -->\n1. One.\n2. Two.\n', 'x.md', 'x');
    assert.deepStrictEqual(blocks.map((b) => b.markerId), ['intro.list']);
  });
});
