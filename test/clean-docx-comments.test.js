/**
 * A plain DOCX build carries no CriticMarkup: comments and highlights are
 * removed and tracked changes applied, whatever `docx` settings rev.yaml
 * holds. Comments appear only in the `_comments.docx` twin of a dual build,
 * as threaded Word comments.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import AdmZip from 'adm-zip';

import { build, buildCommentsDocx, loadConfig } from '../lib/build.js';

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-clean-docx-'));
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

const SOURCE =
  '# Intro\n\n' +
  'First sentence.{>>Ann Author: unclear here<<}{>>Bob Reply (round 2): fixed [RESOLVED]<<} Second sentence.\n\n' +
  'A {==highlighted phrase==}{>>Ann Author: why this<<} with {++an insertion++}, ' +
  '{--a deletion--} and {~~old~>new~~} wording.\n';

const CRITIC_MARKERS = ['{>>', '<<}', '{==', '==}', '{++', '++}', '{--', '--}', '{~~', '~~}', '⟦CMS:', '⟦CME:'];

function writeProject(dir, docxYaml) {
  fs.writeFileSync(path.join(dir, 'body.md'), SOURCE);
  fs.writeFileSync(
    path.join(dir, 'rev.yaml'),
    `title: Clean build\nsections:\n  - body.md\n${docxYaml}`
  );
}

function documentText(docxPath) {
  const xml = new AdmZip(docxPath).readAsText('word/document.xml');
  const text = xml
    .replace(/<[^>]+>/g, '')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
  return { xml, text };
}

async function buildDocx(dir) {
  const config = loadConfig(dir);
  const { results, paperPath } = await build(dir, ['docx'], { config, crossref: false });
  const docx = results.find((r) => r.format === 'docx');
  assert.ok(docx && docx.success, docx && docx.error);
  return { config, paperPath, outputPath: docx.outputPath };
}

describe('plain DOCX build strips CriticMarkup', { skip: !hasPandoc() }, () => {
  for (const [label, docxYaml] of [
    ['no docx settings', ''],
    ['docx.keepComments: true in rev.yaml', 'docx:\n  keepComments: true\n'],
  ]) {
    it(`writes no literal CriticMarkup (${label})`, async () => {
      writeProject(tempDir, docxYaml);
      const { outputPath } = await buildDocx(tempDir);
      const { xml, text } = documentText(outputPath);

      for (const marker of CRITIC_MARKERS) {
        assert.ok(!text.includes(marker), `leaked ${marker} into document.xml`);
      }
      for (const commentText of ['unclear here', 'RESOLVED', 'why this', 'Ann Author', 'Bob Reply']) {
        assert.ok(!text.includes(commentText), `comment text "${commentText}" in the body`);
      }
      assert.ok(!xml.includes('<w:commentRangeStart'), 'clean build carries a comment range');

      assert.ok(text.includes('First sentence. Second sentence.'));
      assert.ok(text.includes('A highlighted phrase with an insertion, and new wording.'));
      assert.ok(!text.includes('a deletion'));
    });
  }

  it('dual build: clean file without comments, twin with threaded comments', async () => {
    writeProject(tempDir, 'docx:\n  keepComments: true\n');
    const { config, paperPath, outputPath } = await buildDocx(tempDir);

    const dual = await buildCommentsDocx(tempDir, paperPath, config, outputPath);
    assert.ok(dual.success, dual.error);
    assert.strictEqual(dual.commentCount, 2, 'two parent comments');
    assert.strictEqual(dual.skippedComments, 0);

    const clean = documentText(outputPath);
    for (const marker of CRITIC_MARKERS) {
      assert.ok(!clean.text.includes(marker), `leaked ${marker} into the clean document.xml`);
    }

    const zip = new AdmZip(dual.outputPath);
    const twin = documentText(dual.outputPath);
    for (const marker of CRITIC_MARKERS) {
      assert.ok(!twin.text.includes(marker), `leaked ${marker} into the comments document.xml`);
    }
    assert.ok(twin.xml.includes('<w:commentRangeStart '), 'commentRangeStart missing');
    assert.ok(twin.xml.includes('<w:commentReference '), 'commentReference missing');

    const comments = zip.readAsText('word/comments.xml');
    assert.ok(comments.includes('unclear here'));
    assert.ok(comments.includes('fixed'));
    assert.ok(comments.includes('why this'));
    assert.ok(zip.readAsText('word/commentsExtended.xml').includes('w15:paraIdParent'), 'reply not threaded to parent');
  });
});
