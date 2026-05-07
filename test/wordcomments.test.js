/**
 * Tests for wordcomments.js - Word comment injection
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { prepareMarkdownWithMarkers, injectCommentsAtMarkers } from '../lib/wordcomments.js';
import {
  extractWordComments,
  extractCommentAnchors,
  insertCommentsIntoMarkdown,
} from '../lib/import.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create a minimal valid DOCX for testing
 * @param {string} content - Text content (can include ⟦CMS:n⟧ and ⟦CME:n⟧ markers)
 */
function createTestDocx(content = 'This is test content with some text here.') {
  const zip = new AdmZip();

  // Minimal document.xml - split content into runs to handle markers
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>${content}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

  // Minimal [Content_Types].xml
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  // Minimal relationships
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes));
  zip.addFile('_rels/.rels', Buffer.from(rels));
  zip.addFile('word/document.xml', Buffer.from(documentXml));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(docRels));

  return zip;
}

describe('wordcomments.js', () => {
  describe('prepareMarkdownWithMarkers', () => {
    it('should handle document with no comments', () => {
      const markdown = 'This is test content with some text here.';
      const result = prepareMarkdownWithMarkers(markdown);

      assert.strictEqual(result.comments.length, 0);
      assert.strictEqual(result.markedMarkdown, markdown);
    });

    it('should parse a single comment', () => {
      const markdown = 'This is test content {>>Reviewer: This needs clarification<<} with some text here.';
      const result = prepareMarkdownWithMarkers(markdown);

      assert.strictEqual(result.comments.length, 1);
      assert.strictEqual(result.comments[0].author, 'Reviewer');
      assert.strictEqual(result.comments[0].text, 'This needs clarification');
      assert.strictEqual(result.comments[0].isReply, false);
    });

    it('should detect reply relationships (Guy -> Gilles) on exact concat', () => {
      // Reply detection requires zero-char gap between `<<}` and `{>>` —
      // matching what `insertCommentsIntoMarkdown` emits programmatically.
      // A whitespace gap means independent comments that happened to land
      // close, not a parent→reply chain.
      const markdown = 'This is test content {>>Guy Colling: Question here<<}{>>Gilles Colling: My reply<<} with some text.';
      const result = prepareMarkdownWithMarkers(markdown);

      assert.strictEqual(result.comments.length, 2);
      assert.strictEqual(result.comments[0].author, 'Guy Colling');
      assert.strictEqual(result.comments[0].isReply, false);
      assert.strictEqual(result.comments[1].author, 'Gilles Colling');
      assert.strictEqual(result.comments[1].isReply, true);
      assert.strictEqual(result.comments[1].parentIdx, 0);
    });

    it('treats `↪ ` author prefix as authoritative reply marker', () => {
      // Programmatic emission tags replies with `↪ ` so the round-trip
      // does not depend on positional adjacency. The prefix is stripped
      // from the author before injection so Word renders the real name.
      const markdown = 'Start {>>Bob: original<<}{>>↪ Alice: I disagree<<} end';
      const result = prepareMarkdownWithMarkers(markdown);

      assert.strictEqual(result.comments.length, 2);
      assert.strictEqual(result.comments[0].author, 'Bob');
      assert.strictEqual(result.comments[0].isReply, false);
      assert.strictEqual(result.comments[1].author, 'Alice');
      assert.strictEqual(result.comments[1].isReply, true);
      assert.strictEqual(result.comments[1].parentIdx, 0);
    });

    it('disables adjacency in explicit mode so collisions do not misthread', () => {
      // Once any `↪ ` marker appears the markdown came from sync; distinct
      // comments that happen to land at gap=0 (the real-paper collision
      // case) must NOT be promoted to replies just because of adjacency.
      const markdown =
        'Plant diversity {>>A: first cluster<<}{>>↪ R1: reply to A<<} ' +
        '{>>B: separate<<}{>>C: also separate<<} end.';
      const result = prepareMarkdownWithMarkers(markdown);

      assert.strictEqual(result.comments.length, 4);
      assert.strictEqual(result.comments[0].author, 'A');
      assert.strictEqual(result.comments[0].isReply, false);
      assert.strictEqual(result.comments[1].author, 'R1');
      assert.strictEqual(result.comments[1].isReply, true);
      assert.strictEqual(result.comments[2].author, 'B');
      assert.strictEqual(result.comments[2].isReply, false);
      // C concatenates to B with gap=0 — would mis-thread under the
      // pre-fix loose adjacency rule. In explicit mode it stays a parent.
      assert.strictEqual(result.comments[3].author, 'C');
      assert.strictEqual(result.comments[3].isReply, false);
    });

    it('should handle multiple independent comments', () => {
      const markdown = 'First part. {>>A: Comment 1<<} Second part. Third part. {>>B: Comment 2<<} Fourth part.';
      const result = prepareMarkdownWithMarkers(markdown);

      assert.strictEqual(result.comments.length, 2);
      assert.strictEqual(result.comments[0].author, 'A');
      assert.strictEqual(result.comments[1].author, 'B');
      // Both should be standalone (not adjacent)
      assert.strictEqual(result.comments[0].isReply, false);
      assert.strictEqual(result.comments[1].isReply, false);
    });

    it('should insert markers for parent comments', () => {
      const markdown = 'This is test content {>>Reviewer: Comment<<} with some text here.';
      const result = prepareMarkdownWithMarkers(markdown);

      // Should contain the comment markers (CMS = Comment Marker Start, CME = Comment Marker End)
      assert.ok(result.markedMarkdown.includes('⟦CMS:0⟧'), 'Should contain start marker');
      assert.ok(result.markedMarkdown.includes('⟦CME:0⟧'), 'Should contain end marker');
    });
  });

  describe('injectCommentsAtMarkers', () => {
    it('should handle document with no comments', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-test-'));
      const docxPath = path.join(tmpDir, 'test.docx');
      const outputPath = path.join(tmpDir, 'output.docx');

      const zip = createTestDocx();
      zip.writeZip(docxPath);

      const comments = []; // No comments
      const result = await injectCommentsAtMarkers(docxPath, comments, outputPath);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.commentCount, 0);
      assert.strictEqual(fs.existsSync(outputPath), true);

      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should inject a single comment', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-test-'));
      const docxPath = path.join(tmpDir, 'test.docx');
      const outputPath = path.join(tmpDir, 'output.docx');

      const markdown = 'This is test content {>>Reviewer: This needs clarification<<} with some text here.';
      const { comments, markedMarkdown } = prepareMarkdownWithMarkers(markdown);

      // Create DOCX with markers from markedMarkdown
      const zip = createTestDocx(markedMarkdown);
      zip.writeZip(docxPath);

      const result = await injectCommentsAtMarkers(docxPath, comments, outputPath);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.commentCount, 1);
      assert.strictEqual(fs.existsSync(outputPath), true);

      // Verify the output DOCX contains comments.xml
      const outputZip = new AdmZip(outputPath);
      const commentsEntry = outputZip.getEntry('word/comments.xml');
      assert.ok(commentsEntry, 'Output should contain word/comments.xml');

      const commentsXml = outputZip.readAsText(commentsEntry);
      assert.ok(commentsXml.includes('Reviewer'), 'Comments should include author');
      assert.ok(commentsXml.includes('This needs clarification'), 'Comments should include text');

      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should handle comments with replies', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-test-'));
      const docxPath = path.join(tmpDir, 'test.docx');
      const outputPath = path.join(tmpDir, 'output.docx');

      const markdown = 'This is test content {>>Guy Colling: Question here<<} {>>Gilles Colling: My reply<<} with some text.';
      const { comments, markedMarkdown } = prepareMarkdownWithMarkers(markdown);

      // Create DOCX with markers from markedMarkdown
      const zip = createTestDocx(markedMarkdown);
      zip.writeZip(docxPath);

      const result = await injectCommentsAtMarkers(docxPath, comments, outputPath);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.commentCount, 1); // Parent comment
      assert.strictEqual(result.replyCount, 1); // Reply to parent

      const outputZip = new AdmZip(outputPath);
      const commentsXml = outputZip.readAsText(outputZip.getEntry('word/comments.xml'));
      assert.ok(commentsXml.includes('Guy Colling'), 'Should include parent author');
      assert.ok(commentsXml.includes('Gilles Colling'), 'Should include reply author');
      assert.ok(commentsXml.includes('Question here'), 'Should include question');
      assert.ok(commentsXml.includes('My reply'), 'Should include reply');

      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should handle multiple comments', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-test-'));
      const docxPath = path.join(tmpDir, 'test.docx');
      const outputPath = path.join(tmpDir, 'output.docx');

      const markdown = `First part. {>>A: Comment 1<<} Second part. {>>B: Comment 2<<} Third part.`;
      const { comments, markedMarkdown } = prepareMarkdownWithMarkers(markdown);

      // Create DOCX with markers from markedMarkdown
      const zip = createTestDocx(markedMarkdown);
      zip.writeZip(docxPath);

      const result = await injectCommentsAtMarkers(docxPath, comments, outputPath);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.commentCount, 2);

      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should handle missing input file', async () => {
      const result = await injectCommentsAtMarkers('/nonexistent/file.docx', [], '/tmp/out.docx');
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('not found'));
    });

    it('should escape XML special characters', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-test-'));
      const docxPath = path.join(tmpDir, 'test.docx');
      const outputPath = path.join(tmpDir, 'output.docx');

      const markdown = 'This is test content {>>User: Comment with <special> & "chars"<<} with some text here.';
      const { comments, markedMarkdown } = prepareMarkdownWithMarkers(markdown);

      // Create DOCX with markers from markedMarkdown
      const zip = createTestDocx(markedMarkdown);
      zip.writeZip(docxPath);

      const result = await injectCommentsAtMarkers(docxPath, comments, outputPath);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.commentCount, 1);

      const outputZip = new AdmZip(outputPath);
      const commentsXml = outputZip.readAsText(outputZip.getEntry('word/comments.xml'));
      assert.ok(commentsXml.includes('&lt;special&gt;'), 'Should escape < and >');
      assert.ok(commentsXml.includes('&amp;'), 'Should escape &');

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe('comment threading', () => {
    it('should not thread non-adjacent comments', () => {
      // Comments with significant text between them (> 50 chars) should not be threaded
      const markdown = 'Start {>>Guy Colling: Question<<} This is a very long piece of text that exceeds fifty characters to break threading {>>Gilles Colling: Not a reply<<} end';
      const result = prepareMarkdownWithMarkers(markdown);

      assert.strictEqual(result.comments.length, 2);
      // Both should be standalone due to gap > 50 chars
      assert.strictEqual(result.comments[1].isReply, false);
    });

    it('should thread comments concatenated without whitespace (legacy mode)', () => {
      // No `↪ ` prefix → hand-typed mode → adjacency rule applies.
      const markdown = 'Start {>>Guy Colling: Question<<}{>>Gilles Colling: Reply<<} end';
      const result = prepareMarkdownWithMarkers(markdown);

      assert.strictEqual(result.comments.length, 2);
      assert.strictEqual(result.comments[1].isReply, true);
      assert.strictEqual(result.comments[1].parentIdx, 0);
    });
  });

  describe('round-trip threading (issue #2)', () => {
    /**
     * Build → extract → re-build verifies that the paraIdParent linkage from
     * commentsExtended.xml survives `extractWordComments` and that
     * `insertCommentsIntoMarkdown` reconstructs the cluster instead of
     * scattering replies onto independent anchors. Without the fix, the
     * synced markdown looks like 3 standalone parents and the next build
     * loses the threading.
     */
    it('preserves paraIdParent across sync round-trip', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-thread-'));
      const docxPath = path.join(tmpDir, 'threaded.docx');
      const outputPath = path.join(tmpDir, 'rebuilt.docx');

      // Step 1: build a docx with two parents + one reply on each parent.
      const sourceMarkdown =
        'Plant diversity {>>R1: needs citation<<} {>>R2: agree with R1<<} [in Europe]{.mark} spans biomes. ' +
        'A second sentence {>>R1: this is unclear<<} {>>R2: I disagree<<} [needs work]{.mark} here.';
      const { markedMarkdown, comments: prepared } = prepareMarkdownWithMarkers(sourceMarkdown);
      const zip = createTestDocx(markedMarkdown);
      zip.writeZip(docxPath);
      const inject = await injectCommentsAtMarkers(docxPath, prepared, docxPath);
      assert.strictEqual(inject.success, true);
      assert.strictEqual(inject.commentCount, 2);
      assert.strictEqual(inject.replyCount, 2);

      // Step 2: extractWordComments must surface parentId from commentsExtended.xml.
      const extracted = await extractWordComments(docxPath);
      assert.strictEqual(extracted.length, 4, 'expected 4 comments (2 parents + 2 replies)');
      const replies = extracted.filter(c => c.parentId !== undefined);
      assert.strictEqual(replies.length, 2, 'expected 2 replies with parentId set');
      for (const r of replies) {
        const parent = extracted.find(c => c.id === r.parentId);
        assert.ok(parent, `reply ${r.id} should reference a known parent id`);
        assert.strictEqual(parent.parentId, undefined, 'parent should not itself be a reply');
      }

      // Step 3: simulate `rev sync --comments-only` against the original
      // (un-annotated) markdown. The output must keep each cluster adjacent
      // so prepareMarkdownWithMarkers picks the threading up again.
      const plainMarkdown =
        'Plant diversity in Europe spans biomes. A second sentence needs work here.';
      const { anchors } = await extractCommentAnchors(docxPath);
      const synced = insertCommentsIntoMarkdown(plainMarkdown, extracted, anchors, {
        quiet: true,
        wrapAnchor: false,
      });

      // Each cluster should appear back-to-back: parent then reply, no prose
      // in between, so adjacency-based threading detection fires again.
      assert.match(
        synced,
        /\{>>[^<]*needs citation<<\}\{>>[^<]*agree with R1<<\}/,
        'first cluster should land as one adjacent block',
      );
      assert.match(
        synced,
        /\{>>[^<]*this is unclear<<\}\{>>[^<]*I disagree<<\}/,
        'second cluster should land as one adjacent block',
      );

      // Step 4: re-prepare to confirm threading detection survived the round-trip.
      const reprepared = prepareMarkdownWithMarkers(synced);
      const replyMarks = reprepared.comments.filter(c => c.isReply);
      assert.strictEqual(
        replyMarks.length,
        2,
        `expected 2 replies after round-trip, got ${replyMarks.length} ` +
          `(comments: ${JSON.stringify(reprepared.comments.map(c => ({ author: c.author, isReply: c.isReply })))})`,
      );

      // Step 5: re-injection should still produce a docx with threading metadata.
      const rebuiltZip = createTestDocx(reprepared.markedMarkdown);
      rebuiltZip.writeZip(outputPath);
      const reinject = await injectCommentsAtMarkers(outputPath, reprepared.comments, outputPath);
      assert.strictEqual(reinject.success, true);
      assert.strictEqual(reinject.replyCount, 2, 'rebuilt docx should still have 2 replies');

      const reZip = new AdmZip(outputPath);
      const extEntry = reZip.getEntry('word/commentsExtended.xml');
      assert.ok(extEntry, 'rebuilt docx should contain commentsExtended.xml');
      const extXml = reZip.readAsText(extEntry);
      const parentRefs = (extXml.match(/w15:paraIdParent="/g) || []).length;
      assert.strictEqual(parentRefs, 2, 'rebuilt docx should still link 2 replies via paraIdParent');

      fs.rmSync(tmpDir, { recursive: true });
    });
  });

  describe('marker placement vs XML attributes (issue #4)', () => {
    /**
     * Pandoc renders a markdown image's inline caption text into both the
     * <wp:docPr descr="..."> alt-text attribute on the drawing AND the
     * visible Caption paragraph. The naive `documentXml.indexOf(marker)`
     * landed on the attribute occurrence, where the surrounding run held a
     * <w:drawing> (no <w:t>), so dissectRun returned null and the comment
     * was silently dropped.
     */
    it('anchors comment whose markers appear first inside an XML attribute', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-issue4-'));
      const docxPath = path.join(tmpDir, 'caption.docx');
      const outputPath = path.join(tmpDir, 'output.docx');

      const markedCaption = 'Caption text ⟦CMS:0⟧ with prose ⟦CME:0⟧ here.';
      // Mimic Pandoc's output: marker text duplicated inside a <wp:docPr descr="...">
      // attribute (drawing run, no <w:t>) followed by the visible Caption paragraph.
      const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
  <w:body>
    <w:p>
      <w:r>
        <w:drawing>
          <wp:inline>
            <wp:docPr id="1" name="image" descr="${markedCaption}"/>
          </wp:inline>
        </w:drawing>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Caption"/></w:pPr>
      <w:r>
        <w:t xml:space="preserve">${markedCaption}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

      const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

      const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

      const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

      const zip = new AdmZip();
      zip.addFile('[Content_Types].xml', Buffer.from(contentTypes));
      zip.addFile('_rels/.rels', Buffer.from(rels));
      zip.addFile('word/document.xml', Buffer.from(documentXml));
      zip.addFile('word/_rels/document.xml.rels', Buffer.from(docRels));
      zip.writeZip(docxPath);

      const comments = [
        {
          commentIdx: 0,
          author: 'Reviewer',
          text: 'caption comment',
          isReply: false,
          parentIdx: null,
        },
      ];

      const result = await injectCommentsAtMarkers(docxPath, comments, outputPath);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.commentCount, 1, 'caption-anchored comment should be injected');
      assert.strictEqual(result.skippedComments ?? 0, 0, 'no comments should be skipped');

      const outputZip = new AdmZip(outputPath);
      const commentsXml = outputZip.readAsText(outputZip.getEntry('word/comments.xml'));
      assert.ok(commentsXml.includes('Reviewer'), 'comments.xml should include author');
      assert.ok(commentsXml.includes('caption comment'), 'comments.xml should include text');

      // The anchor range should land in the visible Caption paragraph, not the drawing.
      const docOut = outputZip.readAsText(outputZip.getEntry('word/document.xml'));
      const rangeStartIdx = docOut.indexOf('<w:commentRangeStart');
      const captionStyleIdx = docOut.indexOf('w:val="Caption"');
      assert.ok(rangeStartIdx !== -1, 'commentRangeStart should exist');
      assert.ok(
        rangeStartIdx > captionStyleIdx,
        'commentRangeStart should land after the Caption pStyle, not in the drawing',
      );

      fs.rmSync(tmpDir, { recursive: true });
    });
  });
});
