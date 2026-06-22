/**
 * Regression tests for gcol33/docrev#5
 *
 *  Bug A — sync could not read a rev.yaml-only project's section list.
 *  Bug B — section files headed by a subsection (## 1.2 ...) were bypassed and
 *          their content folded into the preceding H1.
 *  Bug C — comments routed to non-keyword sections were silently dropped and a
 *          section absent (as prose) from the reviewed doc was emptied.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import {
  extractSectionsFromText,
  resolveSectionsConfig,
  deriveSectionsFromRev,
  generateConfig,
} from '../lib/sections.js';
import { computeSectionBoundaries } from '../lib/commands/section-boundaries.js';

const { insertCommentsIntoMarkdown } = await import('../lib/import.js');

let tempDir;
beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-issue5-'));
});
afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('Bug A — sync reads the section list from rev.yaml', () => {
  it('derives a sections config from a rev.yaml `sections:` list', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), 'title: Repro\nsections: [a.md, b.md]\n');
    fs.writeFileSync(path.join(tempDir, 'a.md'), '# Intro\n\nText.\n');
    fs.writeFileSync(path.join(tempDir, 'b.md'), '# Methods\n\nText.\n');

    const derived = deriveSectionsFromRev(tempDir);
    assert.ok(derived);
    assert.strictEqual(derived.sections['a.md'].header, 'Intro');
    assert.strictEqual(derived.sections['b.md'].header, 'Methods');
    // order follows the rev.yaml list
    assert.strictEqual(derived.sections['a.md'].order, 0);
    assert.strictEqual(derived.sections['b.md'].order, 1);
  });

  it('resolveSectionsConfig falls back to rev.yaml when sections.yaml is absent', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), 'title: Repro\nsections: [a.md, b.md]\n');
    fs.writeFileSync(path.join(tempDir, 'a.md'), '# Intro\n\nText.\n');
    fs.writeFileSync(path.join(tempDir, 'b.md'), '# Methods\n\nText.\n');

    const resolved = resolveSectionsConfig(tempDir, 'sections.yaml');
    assert.ok(resolved, 'expected a resolved config from rev.yaml');
    assert.strictEqual(path.basename(resolved.source), 'rev.yaml');
    assert.deepStrictEqual(Object.keys(resolved.config.sections), ['a.md', 'b.md']);
  });

  it('resolveSectionsConfig prefers an explicit sections.yaml', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), 'title: Repro\nsections: [a.md]\n');
    fs.writeFileSync(
      path.join(tempDir, 'sections.yaml'),
      'version: 1\nsections:\n  a.md: Introduction\n',
    );
    const resolved = resolveSectionsConfig(tempDir, 'sections.yaml');
    assert.ok(resolved);
    assert.strictEqual(path.basename(resolved.source), 'sections.yaml');
    assert.strictEqual(resolved.config.sections['a.md'].header, 'Introduction');
  });

  it('returns null when neither config exists', () => {
    assert.strictEqual(resolveSectionsConfig(tempDir, 'sections.yaml'), null);
  });
});

describe('Bug B — subsection-headed section files route correctly', () => {
  const sections = {
    'sec1.md': { header: '1 Description', aliases: [] },
    'sec2.md': { header: '1.2 Objectives', aliases: [] },
  };

  it('routes ## subsection content to its own file, not the parent H1', () => {
    const wordText = [
      '# 1 Description',
      '',
      'Intro paragraph.',
      '',
      '## 1.2 Objectives',
      '',
      'Objective one. two.',
    ].join('\n');

    const result = extractSectionsFromText(wordText, sections);
    const byFile = Object.fromEntries(result.map(r => [r.file, r.content]));

    assert.ok(byFile['sec1.md'], 'sec1 must be present');
    assert.ok(byFile['sec2.md'], 'sec2 (subsection-headed) must be present, not bypassed');

    assert.ok(byFile['sec1.md'].includes('Intro paragraph.'));
    // The subsection content must NOT leak into the parent H1 file.
    assert.ok(!byFile['sec1.md'].includes('Objective one'),
      'objectives must not be folded into the Description section');
    assert.ok(byFile['sec2.md'].includes('Objective one. two.'));
  });

  it('rev init (generateConfig) derives a subsection-headed file\'s header', () => {
    fs.writeFileSync(path.join(tempDir, 'sec1.md'), '# 1 Description\n\nIntro paragraph.\n');
    fs.writeFileSync(path.join(tempDir, 'sec2.md'), '## 1.2 Objectives\n\nObjective one.\n');
    const cfg = generateConfig(tempDir);
    assert.strictEqual(cfg.sections['sec1.md'].header, '1 Description');
    // Previously H1-only extraction left this as the title-cased filename "Sec2".
    assert.strictEqual(cfg.sections['sec2.md'].header, '1.2 Objectives');
  });

  it('computeSectionBoundaries matches a section headed by an H2', () => {
    const headings = [
      { style: 'Heading1', level: 1, text: '1 Description', docPosition: 0 },
      { style: 'Heading2', level: 2, text: '1.2 Objectives', docPosition: 40 },
    ];
    const boundaries = computeSectionBoundaries(sections, headings, 200);
    const byFile = Object.fromEntries(boundaries.map(b => [b.file, b]));

    assert.ok(byFile['sec2.md'], 'subsection-headed section must get a boundary');
    assert.strictEqual(byFile['sec2.md'].start, 40);
    assert.strictEqual(byFile['sec1.md'].end, 40, 'parent boundary ends where the subsection starts');
  });
});

describe('Bug C — comment accounting is truthful', () => {
  it('reports placed vs unmatched honestly via outStats', () => {
    const markdown = '# Methods\n\nThe quick brown fox jumps over the lazy dog.\n';
    const comments = [
      { id: 'c1', author: 'R', text: 'real anchor', parentId: null },
      { id: 'c2', author: 'R', text: 'no anchor here', parentId: null },
    ];
    const anchors = new Map([
      // c1 anchors on text that exists in the prose
      ['c1', { anchor: 'quick brown fox', before: '', after: '', docPosition: 12, docLength: 60 }],
      // c2 has no recoverable anchor at all -> must be reported as unmatched
    ]);

    const stats = { placed: 0, deduped: 0, unmatched: 0 };
    const out = insertCommentsIntoMarkdown(markdown, comments, anchors, {
      quiet: true,
      outStats: stats,
    });

    assert.strictEqual(stats.placed, 1, 'one comment had a real anchor');
    assert.strictEqual(stats.unmatched, 1, 'the other must be reported as unmatched, not silently dropped');
    assert.ok(out.includes('{>>R: real anchor<<}'), 'the matched comment is written');
    assert.ok(!out.includes('no anchor here'), 'the unmatched comment is not written');
  });

  it('a header-only section yields body-empty content (the untouched-write guard signal)', () => {
    // When a reviewed doc carries only a section heading with no prose, the
    // sync write-guard leaves the file untouched rather than emptying it.
    const sections = { 'annex.md': { header: 'Annex 2: Academic CVs', aliases: [] } };
    const wordText = '# Annex 2: Academic CVs\n';
    const [sec] = extractSectionsFromText(wordText, sections);
    assert.ok(sec);
    assert.strictEqual(sec.content.trim(), sec.header.trim(),
      'header-only match must be detectable as body-empty');
  });
});
