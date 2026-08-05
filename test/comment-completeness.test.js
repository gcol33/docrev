/**
 * Regression: gcol33/docrev#10 — `rev comments` / `rev status` silently listed
 * only a subset of the comments in a `.docx` (35 of 45 in the report), while
 * `rev verify-anchors` saw all of them.
 *
 * Both listing commands read a docx through `readDocxAsAnnotatedMarkdown` and
 * then count with `getComments`. Comments whose anchor landed inside a tracked
 * deletion, or whose text tripped the caption/code heuristics, or which were
 * threaded replies, were dropped on the re-parse. The authoritative count comes
 * from `extractWordComments`, so the invariant is:
 *
 *   getComments(readDocxAsAnnotatedMarkdown(docx)).length === extractWordComments(docx).length
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';

import { readDocxAsAnnotatedMarkdown, extractWordComments } from '../lib/import.js';
import { getComments } from '../lib/annotations.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml';

const paraId = (id) => id.toString(16).toUpperCase().padStart(8, '0');

/**
 * Build a docx with threaded comments. Each entry: {id, author, text, parent?,
 * inDel?}. `inDel` wraps the comment's anchor inside a tracked deletion.
 */
function buildThreadedDocx(comments) {
  const anchorPhrase = (id) => `anchor-${id}-phrase`;

  const bodyParas = comments.map((c) => {
    const lead = `<w:r><w:t xml:space="preserve">Line ${c.id}: intro </w:t></w:r>`;
    const a = anchorPhrase(c.id);
    if (c.inDel) {
      return (
        `<w:p>${lead}` +
        `<w:del w:id="90${c.id}" w:author="${c.author}" w:date="2026-01-01T00:00:00Z">` +
        `<w:commentRangeStart w:id="${c.id}"/>` +
        `<w:r><w:delText xml:space="preserve">${a}</w:delText></w:r>` +
        `<w:commentRangeEnd w:id="${c.id}"/>` +
        `<w:r><w:commentReference w:id="${c.id}"/></w:r>` +
        `</w:del>` +
        `<w:r><w:t xml:space="preserve"> tail.</w:t></w:r></w:p>`
      );
    }
    return (
      `<w:p>${lead}` +
      `<w:commentRangeStart w:id="${c.id}"/>` +
      `<w:r><w:t xml:space="preserve">${a}</w:t></w:r>` +
      `<w:commentRangeEnd w:id="${c.id}"/>` +
      `<w:r><w:commentReference w:id="${c.id}"/></w:r>` +
      `<w:r><w:t xml:space="preserve"> tail.</w:t></w:r></w:p>`
    );
  }).join('\n');

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:document xmlns:w="${W}" xmlns:w14="${W14}">\n<w:body>\n${bodyParas}\n</w:body>\n</w:document>`;

  const commentEls = comments.map((c) =>
    `<w:comment w:id="${c.id}" w:author="${c.author}" w:date="2026-01-01T00:00:00Z">` +
    `<w:p w14:paraId="${paraId(c.id)}"><w:r><w:t xml:space="preserve">MARK-${c.id}: ${c.text}</w:t></w:r></w:p>` +
    `</w:comment>`
  ).join('\n');

  const commentsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:comments xmlns:w="${W}" xmlns:w14="${W14}">\n${commentEls}\n</w:comments>`;

  const commentExEls = comments.map((c) => {
    const p = c.parent != null ? ` w15:paraIdParent="${paraId(c.parent)}"` : '';
    return `<w15:commentEx w15:paraId="${paraId(c.id)}"${p} w15:done="0"/>`;
  }).join('\n');

  const commentsExtendedXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w15:commentsEx xmlns:w15="${W15}">\n${commentExEls}\n</w15:commentsEx>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>` +
    `<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>` +
    `</Types>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`;

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rIdC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>` +
    `<Relationship Id="rIdCE" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>` +
    `</Relationships>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes));
  zip.addFile('_rels/.rels', Buffer.from(rootRels));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(docRels));
  zip.addFile('word/document.xml', Buffer.from(documentXml));
  zip.addFile('word/comments.xml', Buffer.from(commentsXml));
  zip.addFile('word/commentsExtended.xml', Buffer.from(commentsExtendedXml));
  return zip;
}

describe('comment listing completeness (issue #10)', () => {
  let tempDir;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-count-'));
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('lists every comment: threaded, in-deletion, and heuristic-tripping', async () => {
    const comments = [
      { id: 1, author: 'Franz Essl', text: 'plain top-level comment' },
      { id: 2, author: 'Reviewer 2', text: 'this anchor is inside deleted text', inDel: true },
      { id: 3, author: 'S Dullinger', text: 'see the .pdf export; const values look off => fix' },
      // 3-deep chain 10 <- 11 <- 12 (middle reply is the one that used to vanish)
      { id: 10, author: 'Reviewer 1', text: 'parent of chain' },
      { id: 11, author: 'Reviewer 1', text: 'middle reply of chain', parent: 10 },
      { id: 12, author: 'Reviewer 1', text: 'leaf reply of chain', parent: 11 },
      // flat parent + two replies
      { id: 20, author: 'Anna G', text: 'flat parent' },
      { id: 21, author: 'Anna G', text: 'flat reply one', parent: 20 },
      { id: 22, author: 'Anna G', text: 'flat reply two', parent: 20 },
      // reply whose text also trips the caption/code heuristics
      { id: 30, author: 'Reviewer 3', text: 'root here' },
      { id: 31, author: 'Reviewer 3', text: 'reply mentioning figures/panel.png and import x', parent: 30 },
    ];

    const docxPath = path.join(tempDir, 'threaded.docx');
    buildThreadedDocx(comments).writeZip(docxPath);

    const authoritative = await extractWordComments(docxPath);
    assert.strictEqual(authoritative.length, comments.length, 'sanity: docx carries all comments');

    const md = await readDocxAsAnnotatedMarkdown(docxPath);
    const listed = getComments(md);

    assert.strictEqual(
      listed.length,
      authoritative.length,
      `rev comments must list all ${authoritative.length} comments, got ${listed.length}`
    );

    // Every id is present exactly once (no cluster collapsed or dropped).
    const listedIds = new Set(
      listed
        .map((g) => {
          const m = (g.author + ' ' + g.content).match(/MARK-(\d+)/);
          return m ? Number(m[1]) : null;
        })
        .filter((x) => x != null)
    );
    for (const c of comments) {
      assert.ok(listedIds.has(c.id), `comment #${c.id} should be listed`);
    }
  });
});
