/**
 * Word import keeps the reviewers' structure: tracked changes through pandoc's
 * document tree, comment anchors at their real positions, and a bootstrap
 * import split at the document's headings with comments, changes and images.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { trackChangesToCriticMarkup } from '../lib/pandoc-track-changes.js';
import { findAnchorInText, foldCase } from '../lib/anchor-match.js';
import { stripAnnotations, stripAnnotationsWithMap } from '../lib/annotations.js';
import { findMarkdownHeadings } from '../lib/sections.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'paper-niche-expansion.docx');

const hasPandoc = () => spawnSync('pandoc', ['--version']).status === 0;

const str = (s) => ({ t: 'Str', c: s });
const space = { t: 'Space' };
const span = (classes, content) => ({ t: 'Span', c: [['', classes, []], content] });
const para = (...inlines) => ({ t: 'Para', c: inlines });
const doc = (blocks, meta = {}) => ({ 'pandoc-api-version': [1, 23, 1], meta, blocks });

/** The Markdown pandoc would print for inlines rewritten by the walk. */
function flat(inlines) {
  return inlines.map((n) => {
    if (n.t === 'Str') return n.c;
    if (n.t === 'Space') return ' ';
    if (n.t === 'RawInline') return n.c[1];
    return `<${n.t}>`;
  }).join('');
}

describe('trackChangesToCriticMarkup', () => {
  it('writes insertions and deletions as CriticMarkup', () => {
    const d = doc([para(str('We'), space, span(['deletion'], [str('surveyed')]), span(['insertion'], [str('sampled')]), space, str('plots.'))]);
    const stats = trackChangesToCriticMarkup(d);
    assert.strictEqual(flat(d.blocks[0].c), 'We {--surveyed--}{++sampled++} plots.');
    assert.deepStrictEqual(stats, { insertions: 1, deletions: 1 });
  });

  it('removes a comment end nested inside a deletion', () => {
    const d = doc([para(span(['deletion'], [span(['comment-end'], []), str('additional')]), space, str('habitats'))]);
    trackChangesToCriticMarkup(d);
    assert.strictEqual(flat(d.blocks[0].c), '{--additional--} habitats');
  });

  it('drops a change nested in the opposite change', () => {
    const d = doc([para(
      span(['insertion'], [str('new'), span(['deletion'], [str('gone')]), str('text')]),
      space,
      span(['deletion'], [str('old'), span(['insertion'], [str('added')])]),
    )]);
    const stats = trackChangesToCriticMarkup(d);
    assert.strictEqual(flat(d.blocks[0].c), '{++newtext++} {--old--}');
    assert.deepStrictEqual(stats, { insertions: 1, deletions: 1 });
  });

  it('removes comment text, paragraph marks and empty changes, and unwraps highlights', () => {
    const d = doc([para(
      span(['comment-start'], [str('Reviewer'), space, str('text')]),
      span(['mark'], [str('marked')]),
      span(['paragraph-insertion'], []),
      span(['insertion'], [space]),
    )]);
    trackChangesToCriticMarkup(d);
    assert.strictEqual(flat(d.blocks[0].c), 'marked');
  });

  it('clears a heading identifier derived from removed comment text, but keeps a cross-reference label', () => {
    const header = (id) => ({ t: 'Header', c: [1, [id, [], []], [span(['comment-start'], [str('note')]), str('Discussion')]] });
    const d = doc([header('notediscussion'), header('sec:discussion')]);
    trackChangesToCriticMarkup(d);
    assert.strictEqual(d.blocks[0].c[1][0], '');
    assert.strictEqual(d.blocks[1].c[1][0], 'sec:discussion');
  });

  it('writes image paths relative to imageBase', () => {
    const base = path.join(os.tmpdir(), 'project');
    const image = { t: 'Image', c: [['', [], []], [], [path.join(base, 'figures', 'media', 'image1.png'), '']] };
    const d = doc([para(image)]);
    trackChangesToCriticMarkup(d, { imageBase: base });
    assert.strictEqual(d.blocks[0].c[0].c[2][0], 'figures/media/image1.png');
  });

  it('removes comments from the metadata title', () => {
    const d = doc([], { title: { t: 'MetaInlines', c: [span(['comment-start'], [str('vague')]), str('Patterns')] } });
    trackChangesToCriticMarkup(d);
    assert.strictEqual(flat(d.meta.title.c), 'Patterns');
  });
});

describe('anchor positions', () => {
  it('folds case without changing the length', () => {
    const text = 'İstanbul and Vegetation';
    assert.strictEqual(foldCase(text).length, text.length);
    assert.strictEqual(foldCase('Vegetation'), 'vegetation');
  });

  it('finds an anchor at its index after a character whose lower case is longer', () => {
    const text = 'Data from İstanbul. The vegetation plots were resurveyed.';
    const { occurrences } = findAnchorInText('vegetation', text);
    assert.strictEqual(text.slice(occurrences[0], occurrences[0] + 'vegetation'.length), 'vegetation');
  });

  it('maps a whitespace-normalised hit back to the text', () => {
    const text = 'First  line.\nThe   vegetation\nplots were resurveyed.';
    const { occurrences, matchedAnchor, strategy } = findAnchorInText('vegetation plots', text);
    assert.strictEqual(strategy, 'normalized');
    assert.strictEqual(text.slice(occurrences[0], occurrences[0] + matchedAnchor.length), matchedAnchor);
    assert.strictEqual(matchedAnchor, 'vegetation\nplots');
  });

  it('maps a hit through CriticMarkup back to the text and returns no anchor to wrap', () => {
    const text = 'We visited {--100--}{++150++} plots in total.';
    const { occurrences, matchedAnchor, strategy } = findAnchorInText('visited 150 plots', text);
    assert.strictEqual(strategy, 'stripped');
    assert.strictEqual(matchedAnchor, null);
    assert.strictEqual(occurrences[0], text.indexOf('visited'));
  });
});

describe('stripAnnotationsWithMap', () => {
  it('maps every kept character to its index in the text', () => {
    const text = 'A {--b--}{++c++} {~~d~>e~~} {>>R: note<<}[f]{.mark} g';
    const { text: out, map } = stripAnnotationsWithMap(text);
    assert.strictEqual(out, stripAnnotations(text));
    for (let i = 0; i < out.length; i++) assert.strictEqual(text[map[i]], out[i]);
  });
});

describe('findMarkdownHeadings', () => {
  it('skips fenced code and strips only a spaced attribute block', () => {
    const lines = ['# Intro {#sec:intro}', '```', '# not a heading', '```', '## {>>R: c<<}[Methods]{.mark}'];
    const headings = findMarkdownHeadings(lines);
    assert.deepStrictEqual(headings.map((h) => [h.line, h.level, h.text]), [
      [0, 1, 'Intro'],
      [4, 2, '{>>R: c<<}[Methods]{.mark}'],
    ]);
  });
});

describe('docrev import (bootstrap)', { skip: !hasPandoc() }, () => {
  it('keeps comments, tracked changes and images, split at the top-level headings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-import-'));
    const tsx = path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const result = spawnSync(process.execPath, [tsx, path.join(ROOT, 'bin', 'rev.ts'), 'import', FIXTURE], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, HOME: dir, USERPROFILE: dir },
    });
    assert.strictEqual(result.status, 0, result.stderr);

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md')).sort();
    for (const f of ['abstract.md', 'introduction.md', 'methods.md', 'results.md', 'discussion.md', 'conclusion.md']) {
      assert.ok(files.includes(f), `${f} missing from ${files.join(', ')}`);
    }

    const text = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf-8')).join('\n');
    assert.ok((text.match(/\{>>/g) || []).length >= 290, 'comments kept');
    assert.ok((text.match(/\{\+\+/g) || []).length > 50, 'insertions kept');
    assert.doesNotMatch(text, /\{\.(insertion|deletion|comment-start|comment-end|paragraph-insertion)/);
    assert.doesNotMatch(text, /\]\{\.mark\}\+\}/, 'a comment anchor never takes part of a closing ++}');

    const images = [...text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);
    assert.ok(images.length > 0);
    for (const img of images) {
      assert.ok(img.startsWith('figures/'), img);
      assert.ok(fs.existsSync(path.join(dir, img)), `${img} not extracted`);
    }

    const config = fs.readFileSync(path.join(dir, 'rev.yaml'), 'utf-8');
    assert.match(config, /title: Patterns of habitat niche expansion/);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
