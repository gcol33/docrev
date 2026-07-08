/**
 * Issue #8 regression: `rev status <file.docx>` / `rev comments <file.docx>`
 * (and the whole `[file]`-taking class) must NOT read the binary ZIP as UTF-8
 * and regex it for CriticMarkup. Reading a .docx that way silently reports a
 * small, plausible, WRONG count (e.g. "No annotations" for a document full of
 * tracked changes and comments).
 *
 * The fix routes a .docx through the OOXML reader (real insertions/deletions/
 * comments) for read-only commands, refuses it for in-place editors, and guards
 * the annotation parsers so binary input fails loudly instead of silently.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

import { readDocxAsAnnotatedMarkdown } from '../lib/import.js';
import {
  isWordDocument,
  looksLikeZip,
  readAnnotatedInput,
  assertEditableMarkdown,
  InputError,
} from '../lib/input.js';
import {
  countAnnotations,
  getComments,
  parseAnnotations,
  stripAnnotations,
  hasAnnotations,
} from '../lib/annotations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
const CLI_PATH = path.join(PROJECT_ROOT, 'bin', 'rev.ts');
const TSX_PATH = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-docx-input-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Build a small but valid .docx with 2 insertions, 1 deletion, and 2 comments,
 * mirroring the self-contained reproduction in gcol33/docrev#8. Plain
 * paragraphs separate every tracked change so import's adjacent del+ins ->
 * substitution merge never fires — counts are deterministic with or without
 * pandoc installed.
 */
function buildTrackedCommentedDocx(dir) {
  const ins = (id, t) =>
    `<w:ins w:id="${id}" w:author="A" w:date="2026-07-08T06:35:00Z"><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:ins>`;
  const del = (id, t) =>
    `<w:del w:id="${id}" w:author="A" w:date="2026-07-08T06:36:00Z"><w:r><w:delText>${t}</w:delText></w:r></w:del>`;
  const para = (t) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
  const canchor = (id, t) =>
    `<w:commentRangeStart w:id="${id}"/><w:r><w:t xml:space="preserve">${t}</w:t></w:r>` +
    `<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`;

  const body =
    `<w:p><w:r><w:t xml:space="preserve">Lead paragraph. </w:t></w:r>${ins(1, 'inserted alpha')}</w:p>` +
    para('An untouched sentence keeps the changes apart.') +
    `<w:p>${del(2, 'removed beta')}</w:p>` +
    para('Another untouched sentence sits between edits.') +
    `<w:p>${ins(3, 'inserted gamma')}</w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">Body before </w:t></w:r>${canchor(6, 'first anchored span')}<w:r><w:t xml:space="preserve"> and after.</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">More body </w:t></w:r>${canchor(7, 'second anchored span')}<w:r><w:t xml:space="preserve"> end.</w:t></w:r></w:p>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr/></w:body></w:document>`;

  const commentsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="${W}">` +
    `<w:comment w:id="6" w:author="Reviewer One" w:date="2026-07-08T06:35:00Z"><w:p><w:r><w:t>comment one body</w:t></w:r></w:p></w:comment>` +
    `<w:comment w:id="7" w:author="Reviewer Two" w:date="2026-07-08T06:36:00Z"><w:p><w:r><w:t>comment two body</w:t></w:r></w:p></w:comment>` +
    `</w:comments>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/></Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/></Relationships>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes, 'utf-8'));
  zip.addFile('_rels/.rels', Buffer.from(rootRels, 'utf-8'));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(docRels, 'utf-8'));
  zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf-8'));
  zip.addFile('word/comments.xml', Buffer.from(commentsXml, 'utf-8'));

  const file = path.join(dir, 'repro.docx');
  zip.writeZip(file);
  return file;
}

describe('issue #8: docx detection', () => {
  it('recognizes a .docx by extension and by ZIP magic + word/document.xml', () => {
    const docx = buildTrackedCommentedDocx(tempDir);
    assert.ok(isWordDocument(docx), 'extension .docx should be detected');
    assert.ok(looksLikeZip(docx), 'should start with PK zip magic');

    // A .docx renamed to .md is still a Word document by content sniff.
    const misnamed = path.join(tempDir, 'returned.md');
    fs.copyFileSync(docx, misnamed);
    assert.ok(isWordDocument(misnamed), 'content sniff should catch mis-extensioned docx');
  });

  it('treats a real Markdown file as text, not a Word document', () => {
    const md = path.join(tempDir, 'clean.md');
    fs.writeFileSync(md, '# Title\n\nText {++x++} {>>R: note<<}\n');
    assert.ok(!isWordDocument(md));
    assert.ok(!looksLikeZip(md));
  });
});

describe('issue #8: reading a docx as annotated Markdown', () => {
  it('extracts real track changes and comments (not garbage byte-matches)', async () => {
    const docx = buildTrackedCommentedDocx(tempDir);

    const text = await readDocxAsAnnotatedMarkdown(docx);
    const counts = countAnnotations(text);

    assert.strictEqual(counts.inserts, 2, 'two insertions');
    assert.strictEqual(counts.deletes, 1, 'one deletion');
    assert.strictEqual(counts.substitutes, 0, 'no substitutions (separate paragraphs)');

    const comments = getComments(text);
    assert.strictEqual(comments.length, 2, 'two comments');
    const authors = comments.map((c) => c.author).sort();
    assert.deepStrictEqual(authors, ['Reviewer One', 'Reviewer Two']);
    assert.ok(comments.some((c) => c.content.includes('comment one body')));
    assert.ok(comments.some((c) => c.content.includes('comment two body')));
  });

  it('readAnnotatedInput routes a .docx and reads .md verbatim', async () => {
    const docx = buildTrackedCommentedDocx(tempDir);
    const fromDocx = await readAnnotatedInput(docx);
    assert.strictEqual(countAnnotations(fromDocx).total, 5);

    const md = path.join(tempDir, 'plain.md');
    const body = 'Text {++new++} and {--old--} plus {>>R: hi<<}\n';
    fs.writeFileSync(md, body);
    const fromMd = await readAnnotatedInput(md);
    assert.strictEqual(fromMd, body, 'markdown returned byte-for-byte');
  });
});

describe('issue #8: binary guard on the annotation parsers', () => {
  it('countAnnotations/getComments/... throw on raw docx bytes read as text', () => {
    const docx = buildTrackedCommentedDocx(tempDir);
    const rawZipAsText = fs.readFileSync(docx, 'utf-8'); // the old, broken read

    for (const fn of [parseAnnotations, countAnnotations, getComments, stripAnnotations, hasAnnotations]) {
      assert.throws(() => fn(rawZipAsText), /binary content/i, `${fn.name} should reject binary`);
    }
  });

  it('still accepts ordinary Markdown', () => {
    const md = 'Text {++x++} {--y--} {~~a~>b~~} {>>R: c<<}';
    assert.strictEqual(countAnnotations(md).total, 4);
    assert.doesNotThrow(() => parseAnnotations(md));
  });
});

describe('issue #8: in-place editors refuse a docx', () => {
  it('assertEditableMarkdown throws an InputError pointing at rev import', () => {
    const docx = buildTrackedCommentedDocx(tempDir);
    assert.throws(
      () => assertEditableMarkdown(docx),
      (err) => err instanceof InputError && /rev import/i.test(err.suggestions.join(' ')),
    );
    // A markdown file passes the guard.
    const md = path.join(tempDir, 'x.md');
    fs.writeFileSync(md, 'ok');
    assert.doesNotThrow(() => assertEditableMarkdown(md));
  });
});

function runCli(args, cwd) {
  try {
    const stdout = execSync(`"${TSX_PATH}" "${CLI_PATH}" ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err) {
    return { stdout: err.stdout || '', stderr: err.stderr || '', code: err.status ?? 1 };
  }
}

describe('issue #8: CLI on a docx', () => {
  it('rev status <docx> reports real counts, not "No annotations"', () => {
    const docx = buildTrackedCommentedDocx(tempDir);
    const { stdout, stderr, code } = runCli(`--json status "repro.docx"`, tempDir);
    assert.strictEqual(code, 0, stderr);
    const data = JSON.parse(stdout);
    assert.strictEqual(data.annotations.inserts, 2);
    assert.strictEqual(data.annotations.deletes, 1);
    assert.strictEqual(data.comments.length, 2);
  });

  it('rev comments <docx> lists the comments', () => {
    buildTrackedCommentedDocx(tempDir);
    const { stdout, code } = runCli(`comments "repro.docx"`, tempDir);
    assert.strictEqual(code, 0);
    assert.ok(/Reviewer One/.test(stdout) || /comment one body/.test(stdout));
    assert.ok(!/No comments found/.test(stdout));
  });

  it('rev accept <docx> fails loudly instead of corrupting the file', () => {
    buildTrackedCommentedDocx(tempDir);
    const { stderr, code } = runCli(`accept "repro.docx" -a`, tempDir);
    assert.notStrictEqual(code, 0, 'should exit non-zero');
    assert.ok(/Word document/i.test(stderr) && /rev import/i.test(stderr), stderr);
  });
});
