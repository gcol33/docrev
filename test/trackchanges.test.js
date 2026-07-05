/**
 * Tests for trackchanges.js — pandoc-native track-change conversion.
 *
 * CriticMarkup insertions/deletions/substitutions are converted to pandoc
 * `.insertion`/`.deletion` spans; pandoc's docx writer then emits well-formed
 * run-level `w:ins`/`w:del` revisions in a single pass. Unlike the old
 * marker-injection approach, the revisions are NOT nested inside `<w:t>`.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import AdmZip from 'adm-zip';
import {
  criticToNativeTrackChanges,
  enableTrackRevisions,
  buildWithTrackChanges,
} from '../lib/trackchanges.js';

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-tc-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function hasPandoc() {
  try {
    return spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;
  } catch {
    return false;
  }
}

/** Split a docx's document.xml into pretty lines for structural assertions. */
function docXml(docxPath) {
  const zip = new AdmZip(docxPath);
  return zip.readAsText('word/document.xml');
}

describe('criticToNativeTrackChanges', () => {
  it('converts insertions to .insertion spans', () => {
    const { text, stats } = criticToNativeTrackChanges('Hello {++world++} there', { author: 'GC' });
    assert.match(text, /\[world\]\{\.insertion author="GC" date="[^"]+"\}/);
    assert.ok(!text.includes('{++'));
    assert.strictEqual(stats.insertions, 1);
  });

  it('converts deletions to .deletion spans', () => {
    const { text, stats } = criticToNativeTrackChanges('Hello {--old--} there', { author: 'GC' });
    assert.match(text, /\[old\]\{\.deletion author="GC" date="[^"]+"\}/);
    assert.strictEqual(stats.deletions, 1);
  });

  it('converts substitutions to delete-then-insert spans', () => {
    const { text, stats } = criticToNativeTrackChanges('Hello {~~old~>new~~} there', { author: 'GC' });
    assert.match(text, /\[old\]\{\.deletion[^}]+\}\[new\]\{\.insertion[^}]+\}/);
    assert.strictEqual(stats.substitutions, 1);
    // Substitutions are not double-counted as ins/del.
    assert.strictEqual(stats.insertions, 0);
    assert.strictEqual(stats.deletions, 0);
  });

  it('counts a mix of all three types', () => {
    const { stats } = criticToNativeTrackChanges(
      'The {++quick++} brown {--slow--} fox {~~jumps~>leaps~~} over.',
      { author: 'GC' }
    );
    assert.deepStrictEqual(stats, { insertions: 1, deletions: 1, substitutions: 1 });
  });

  it('leaves comments and highlights untouched', () => {
    const src = 'Text {++add++} {>>Author: note<<} and {==highlight==} here';
    const { text } = criticToNativeTrackChanges(src, { author: 'GC' });
    assert.ok(text.includes('{>>Author: note<<}'), 'comment should survive');
    assert.ok(text.includes('{==highlight==}'), 'highlight should survive');
  });

  it('preserves bracketed content inside a change', () => {
    const { text } = criticToNativeTrackChanges('drop {--the value [1] here--} now', { author: 'GC' });
    assert.ok(text.includes('[the value [1] here]{.deletion'), text);
  });

  it('defaults the author to "Author"', () => {
    const { text } = criticToNativeTrackChanges('x {++y++}');
    assert.match(text, /author="Author"/);
  });

  it('escapes quotes in the author name', () => {
    const { text } = criticToNativeTrackChanges('x {++y++}', { author: 'A "Nick" B' });
    assert.ok(text.includes('author="A \\"Nick\\" B"'), text);
  });

  it('returns text unchanged when there are no track changes', () => {
    const src = 'Plain text with a {>>Author: comment<<} only';
    const { text, stats } = criticToNativeTrackChanges(src, { author: 'GC' });
    assert.strictEqual(text, src);
    assert.deepStrictEqual(stats, { insertions: 0, deletions: 0, substitutions: 0 });
  });
});

describe('enableTrackRevisions', () => {
  function makeDocx() {
    const zip = new AdmZip();
    zip.addFile('word/settings.xml', Buffer.from(
      '<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"></w:settings>'
    ));
    const p = path.join(tempDir, 'x.docx');
    zip.writeZip(p);
    return p;
  }

  it('adds w:trackRevisions to settings.xml', () => {
    const p = makeDocx();
    enableTrackRevisions(p);
    const s = new AdmZip(p).readAsText('word/settings.xml');
    assert.ok(s.includes('<w:trackRevisions/>'));
  });

  it('is idempotent', () => {
    const p = makeDocx();
    enableTrackRevisions(p);
    enableTrackRevisions(p);
    const s = new AdmZip(p).readAsText('word/settings.xml');
    assert.strictEqual((s.match(/<w:trackRevisions\/>/g) || []).length, 1);
  });
});

describe('buildWithTrackChanges (pandoc)', { skip: !hasPandoc() }, () => {
  it('emits run-level w:ins/w:del, never nested inside w:t', async () => {
    const md = path.join(tempDir, 'in.md');
    const out = path.join(tempDir, 'out.docx');
    fs.writeFileSync(md, 'The niche {--broadens--}{++expands++} over time.\n');

    const result = await buildWithTrackChanges(md, out, { author: 'GC' });
    assert.ok(result.success, result.message);
    assert.deepStrictEqual(result.stats, { insertions: 1, deletions: 1, substitutions: 0 });

    const xml = docXml(out);
    assert.ok(xml.includes('<w:ins '), 'expected w:ins');
    assert.ok(xml.includes('<w:del '), 'expected w:del');
    // The old marker approach produced `<w:t>...<w:ins>...</w:ins>...</w:t>`
    // (malformed). Assert no revision element opens inside a text element.
    assert.ok(
      !/<w:t[^>]*>[^<]*<w:(ins|del)\b/.test(xml),
      'w:ins/w:del must not be nested inside w:t'
    );
    // Track revisions turned on.
    const settings = new AdmZip(out).readAsText('word/settings.xml');
    assert.ok(settings.includes('w:trackRevisions'));
  });

  it('reports failure for a missing input file', async () => {
    const result = await buildWithTrackChanges(
      path.join(tempDir, 'nope.md'),
      path.join(tempDir, 'out.docx'),
      { author: 'GC' }
    );
    assert.strictEqual(result.success, false);
    assert.ok(result.message.includes('not found'));
  });
});
