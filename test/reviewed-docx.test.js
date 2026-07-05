/**
 * Issue #6 regression: `rev build docx --dual --show-changes` must emit ONE
 * docx containing both tracked changes (w:ins/w:del) AND threaded comments
 * (comments.xml + commentsExtended.xml parent/reply links).
 *
 * Before the fix the two were mutually exclusive: --show-changes dropped
 * comments, --dual accepted all changes. buildReviewedDocx merges them in a
 * single pandoc pass (native track-change spans) plus comment injection.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';
import AdmZip from 'adm-zip';

import { DEFAULT_CONFIG, combineSections, buildReviewedDocx } from '../lib/build.js';

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-reviewed-'));
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
  'The habitat niche {--broadens--}{++expands++} over time.' +
  '{>>Franz Essl: bitte umformulieren<<}{>>User: umformuliert<<}\n\n' +
  'A second {~~sentance~>sentence~~} here.{>>Reviewer: check spelling<<}\n';

function setup(dir) {
  fs.writeFileSync(path.join(dir, 'body.md'), SOURCE);
  const config = { ...DEFAULT_CONFIG, title: 'Reviewed', sections: ['body.md'], outputDir: null };
  const paperPath = combineSections(dir, config);
  return { config, paperPath };
}

describe('buildReviewedDocx (issue #6)', { skip: !hasPandoc() }, () => {
  it('emits tracked changes AND threaded comments in one file', async () => {
    const { config, paperPath } = setup(tempDir);
    const out = path.join(tempDir, 'reviewed.docx');

    const res = await buildReviewedDocx(tempDir, paperPath, config, {
      outputPath: out,
      author: 'GC',
      includeComments: true,
    });

    assert.ok(res.success, res.error);
    assert.deepStrictEqual(res.stats, { insertions: 1, deletions: 1, substitutions: 1 });
    assert.strictEqual(res.commentCount, 2, 'two parent comments');
    assert.strictEqual(res.replyCount, 1, 'one threaded reply');
    assert.strictEqual(res.skippedComments, 0);

    const zip = new AdmZip(out);
    const parts = zip.getEntries().map((e) => e.entryName);
    const doc = zip.readAsText('word/document.xml');

    // Tracked changes present and well-formed (run-level, not inside w:t).
    assert.ok(doc.includes('<w:ins '), 'w:ins missing');
    assert.ok(doc.includes('<w:del '), 'w:del missing');
    assert.ok(!/<w:t[^>]*>[^<]*<w:(ins|del)\b/.test(doc), 'revision nested inside w:t');

    // Comment ranges present.
    assert.ok(doc.includes('<w:commentRangeStart '), 'commentRangeStart missing');
    assert.ok(doc.includes('<w:commentReference '), 'commentReference missing');

    // No leftover markers or raw CriticMarkup leaked into the document.
    for (const leak of ['{{TC_', '⟦CMS:', '⟦CME:', '{++', '{--', '{~~', '{>>']) {
      assert.ok(!doc.includes(leak), `leaked ${leak} into document.xml`);
    }

    // Comment part set present.
    for (const part of [
      'word/comments.xml',
      'word/commentsExtended.xml',
      'word/commentsIds.xml',
      'word/commentsExtensible.xml',
      'word/people.xml',
    ]) {
      assert.ok(parts.includes(part), `missing ${part}`);
    }

    // Reply threading: the reply links to its parent paragraph.
    const ext = zip.readAsText('word/commentsExtended.xml');
    assert.ok(ext.includes('w15:paraIdParent'), 'reply not threaded to parent');

    // Comment bodies made it in.
    const comments = zip.readAsText('word/comments.xml');
    assert.ok(comments.includes('bitte umformulieren'));
    assert.ok(comments.includes('umformuliert'));
    assert.ok(comments.includes('check spelling'));

    // Track revisions enabled.
    assert.ok(zip.readAsText('word/settings.xml').includes('w:trackRevisions'));
  });

  it('emits tracked changes only when includeComments is false', async () => {
    const { config, paperPath } = setup(tempDir);
    const out = path.join(tempDir, 'changes.docx');

    const res = await buildReviewedDocx(tempDir, paperPath, config, {
      outputPath: out,
      author: 'GC',
      includeComments: false,
    });

    assert.ok(res.success, res.error);
    assert.strictEqual(res.commentCount, 0);

    const zip = new AdmZip(out);
    const doc = zip.readAsText('word/document.xml');
    assert.ok(doc.includes('<w:ins '), 'w:ins missing');
    assert.ok(doc.includes('<w:del '), 'w:del missing');
    assert.ok(!doc.includes('<w:commentRangeStart '), 'comments should be absent');
    // Comments stripped, not leaked as text.
    assert.ok(!doc.includes('umformulieren'), 'comment text leaked into body');
  });
});
