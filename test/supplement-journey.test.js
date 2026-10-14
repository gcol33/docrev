/**
 * Tests for supplement/journey.md: parsing, S/A labels, the supplement checks,
 * and the project runner that `rev journey check` and `rev check` share.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { parseSupplementJourney, supplementLabels, supplementCheck } from '../lib/supplement-journey.js';
import { checkJourneyProject } from '../lib/journey-project.js';

const JOURNEY = `# Journey: Supporting Information

One entry per item. Fields:
- file: the section file that prints the item

## Data and inputs

### tbl.databases  [S1]
- title: Contributing databases
- file: databases.md
- tier: reference

### fig.coverage  [S1 S2]
- file: coverage.md
- tier: evidence
- supports: @p:meth.data; @p:res.coverage

## Archive

### tbl.grid  [S1]
- file: grid.md
- tier: archive

### sec.capacity  [S1]
- file: capacity.md
- tier: development

### tbl.databases-2  [S1]
- file: databases.md
- tier: reference
`;

describe('parseSupplementJourney', () => {
  it('reads items in order with part, arcs and fields, ignoring the preamble', () => {
    const { doc, errors } = parseSupplementJourney(JOURNEY, 'supplement/journey.md');
    assert.deepStrictEqual(errors, []);
    assert.strictEqual(doc.title, 'Supporting Information');
    assert.deepStrictEqual(doc.items.map((i) => i.key), ['tbl:databases', 'fig:coverage', 'tbl:grid', 'sec:capacity', 'tbl:databases-2']);
    const fig = doc.items[1];
    assert.strictEqual(fig.part, 'Data and inputs');
    assert.deepStrictEqual(fig.arcs, ['S1', 'S2']);
    assert.deepStrictEqual(fig.supports, ['meth.data', 'res.coverage']);
    assert.strictEqual(doc.items[2].part, 'Archive');
  });

  it('reports a bad kind, a bad tier, a missing file and a duplicate', () => {
    const md = '## P\n\n### box.x\n- file: a.md\n- tier: evidence\n\n### tbl.y\n- tier: maybe\n\n### tbl.z\n- file: z.md\n- tier: archive\n\n### tbl.z\n- file: z.md\n- tier: archive\n- colour: red\n';
    const { errors } = parseSupplementJourney(md, 'j.md');
    const messages = errors.map((e) => e.message).join('\n');
    assert.match(messages, /"box\.x" does not start with tbl\./);
    assert.match(messages, /Tier "maybe"/);
    assert.match(messages, /tbl\.y names no file/);
    assert.match(messages, /Duplicate entry id "tbl\.z"/);
    assert.match(messages, /Unknown entry field "colour"/);
  });
});

describe('supplementLabels', () => {
  it('numbers per kind, archive items with A, sections not at all', () => {
    const { doc } = parseSupplementJourney(JOURNEY, 'j.md');
    assert.deepStrictEqual(Object.fromEntries(supplementLabels(doc.items)), {
      'tbl:databases': 'S1',
      'fig:coverage': 'S1',
      'tbl:grid': 'A1',
      'tbl:databases-2': 'S2',
    });
  });
});

describe('supplementCheck', () => {
  const { doc } = parseSupplementJourney(JOURNEY, 'j.md');
  const sectionFiles = () =>
    new Map([
      ['databases.md', '# Tables [[tbl:databases]] and [[tbl:databases-2]]. Databases\n'],
      ['coverage.md', '![Coverage.](c.png){#fig:coverage}\n\nSee Table [[tbl:grid]].\n'],
      ['grid.md', '# Table [[tbl:grid]]. Grid\n'],
      ['capacity.md', '# Model capacity\n'],
    ]);
  const input = (over = {}) => ({
    sectionFiles: sectionFiles(),
    manuscript: [{ file: 'results.md', content: 'As Table S1 and Figure S1 show (Tables 2 and S2).\n' }],
    sidecars: [{ file: 'story.md', content: '- evidence: Table A1\n' }],
    markerIds: new Set(['meth.data', 'res.coverage']),
    story: { arcs: [{ id: 'S1' }, { id: 'S2' }] },
    lock: { 'tbl:databases': 'S1', 'fig:coverage': 'S1', 'tbl:grid': 'A1', 'tbl:databases-2': 'S2' },
    ...over,
  });
  const kinds = (findings) => findings.filter((f) => !f.accepted).map((f) => f.kind);

  it('is quiet on a consistent supplement (keys and pandoc labels both define an item)', () => {
    assert.deepStrictEqual(kinds(supplementCheck(doc, input())), []);
  });

  it('flags a missing file, an unplaced file and a file that does not print its key', () => {
    const files = sectionFiles();
    files.delete('capacity.md');
    files.set('grid.md', '# A grid\n');
    files.set('stray.md', 'x\n');
    const found = kinds(supplementCheck(doc, input({ sectionFiles: files })));
    assert.ok(found.includes('supplement-missing-file'));
    assert.ok(found.includes('supplement-missing-key'));
    assert.ok(found.includes('supplement-unplaced-file'));
  });

  it('flags an unknown key and a literal label no item carries', () => {
    const found = supplementCheck(doc, input({
      manuscript: [{ file: 'results.md', content: 'Table S9 and [[fig:nothing]].\n' }],
    }));
    assert.deepStrictEqual(kinds(found).sort(), ['supplement-unknown-key', 'supplement-unresolved-label']);
    assert.match(found.find((f) => f.kind === 'supplement-unresolved-label').message, /results\.md:1 cites Table S9/);
  });

  it('flags the manuscript citing the archive, but not the supplement or a sidecar', () => {
    const found = supplementCheck(doc, input({
      manuscript: [{ file: 'methods.md', content: 'Settings in\nTable A1.\n' }],
    }));
    const archive = found.filter((f) => f.kind === 'supplement-archive-cited');
    assert.strictEqual(archive.length, 1);
    assert.strictEqual(archive[0].file, 'methods.md');
    assert.strictEqual(archive[0].line, 2);
  });

  it('flags evidence without support, a support with no paragraph, an unknown arc', () => {
    const md = '## P\n\n### tbl.a  [S9]\n- file: a.md\n- tier: evidence\n\n### tbl.b  [S1]\n- file: b.md\n- tier: evidence\n- supports: @p:gone\n';
    const { doc: d } = parseSupplementJourney(md, 'j.md');
    const found = kinds(supplementCheck(d, {
      sectionFiles: new Map([['a.md', '[[tbl:a]]'], ['b.md', '[[tbl:b]]']]),
      manuscript: [], sidecars: [], markerIds: new Set(), story: { arcs: [{ id: 'S1' }] },
    }));
    assert.deepStrictEqual(found.sort(), ['supplement-dangling-support', 'supplement-no-support', 'supplement-unknown-arc']);
  });

  it('flags a lock that no longer matches the journey order', () => {
    const found = supplementCheck(doc, input({ lock: { 'tbl:databases': 'S2', 'tbl:databases-2': 'S1', 'fig:coverage': 'S1', 'tbl:grid': 'A1' } }));
    const stale = found.find((f) => f.kind === 'supplement-stale-lock');
    assert.match(stale.message, /tbl:databases S2 -> S1/);
  });

  it('honours an accept: line on the item a finding names', () => {
    const md = '## P\n\n### tbl.a  [S1]\n- file: a.md\n- tier: evidence\n- accept: evidence backs nothing: the Discussion cites it in prose\n';
    const { doc: d } = parseSupplementJourney(md, 'j.md');
    const [finding] = supplementCheck(d, { sectionFiles: new Map([['a.md', '[[tbl:a]]']]), manuscript: [], sidecars: [], markerIds: new Set() });
    assert.strictEqual(finding.kind, 'supplement-no-support');
    assert.strictEqual(finding.accepted, 'the Discussion cites it in prose');
  });
});

describe('checkJourneyProject', () => {
  it('checks the supplement journey beside the manuscript, with or without a main journey', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-supp-'));
    try {
      fs.mkdirSync(path.join(dir, 'supplement', 'sections'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'results.md'), '# Results\n\n<!-- @p:res.a -->\nAs Table S1 shows.\n');
      fs.writeFileSync(path.join(dir, 'supplement', 'journey.md'), '## Data\n\n### tbl.a  [S1]\n- file: a.md\n- tier: evidence\n- supports: @p:res.a; @p:res.b\n');
      fs.writeFileSync(path.join(dir, 'supplement', 'sections', 'a.md'), '# Table [[tbl:a]]. A\n');
      fs.writeFileSync(path.join(dir, 'supplement', 'numbers.json'), '{ not json');

      const result = checkJourneyProject(dir, {}, ['results.md']);
      assert.strictEqual(result.journey, null);
      assert.deepStrictEqual(result.supplement.summary, { items: 1, labelled: 1, sectionFiles: 1 });
      assert.deepStrictEqual(result.supplement.findings.map((f) => f.message), ['tbl.a supports @p:res.b, which no manuscript paragraph carries']);
      assert.match(result.parseErrors[0].message, /Not valid JSON/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
