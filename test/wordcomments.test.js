/**
 * Tests for wordcomments.js - Word comment injection
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { injectComments } from '../lib/wordcomments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Create a minimal valid DOCX for testing
 */
function createTestDocx(content = 'This is test content with some text here.') {
  const zip = new AdmZip();

  // Minimal document.xml
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
  describe('injectComments', () => {
    it('should handle document with no comments', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/docrev-test-');
      const docxPath = path.join(tmpDir, 'test.docx');
      const outputPath = path.join(tmpDir, 'output.docx');

      const zip = createTestDocx();
      zip.writeZip(docxPath);

      const markdown = 'This is test content with some text here.';
      const result = await injectComments(docxPath, markdown, outputPath);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.commentCount, 0);
      assert.strictEqual(fs.existsSync(outputPath), true);

      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should inject a single comment', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/docrev-test-');
      const docxPath = path.join(tmpDir, 'test.docx');
      const outputPath = path.join(tmpDir, 'output.docx');

      const zip = createTestDocx();
      zip.writeZip(docxPath);

      const markdown = 'This is test content {>>Reviewer: This needs clarification<<} with some text here.';
      const result = await injectComments(docxPath, markdown, outputPath);

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
      const tmpDir = fs.mkdtempSync('/tmp/docrev-test-');
      const docxPath = path.join(tmpDir, 'test.docx');
      const outputPath = path.join(tmpDir, 'output.docx');

      const zip = createTestDocx();
      zip.writeZip(docxPath);

      const markdown = 'This is test content {>>Reviewer: Question here<<} {>>Author: My reply<<} with some text.';
      const result = await injectComments(docxPath, markdown, outputPath);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.commentCount, 2); // Parent + reply

      const outputZip = new AdmZip(outputPath);
      const commentsXml = outputZip.readAsText(outputZip.getEntry('word/comments.xml'));
      assert.ok(commentsXml.includes('Reviewer'), 'Should include reviewer');
      assert.ok(commentsXml.includes('Author'), 'Should include reply author');
      assert.ok(commentsXml.includes('Question here'), 'Should include question');
      assert.ok(commentsXml.includes('My reply'), 'Should include reply');

      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should handle multiple comments', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/docrev-test-');
      const docxPath = path.join(tmpDir, 'test.docx');
      const outputPath = path.join(tmpDir, 'output.docx');

      const zip = createTestDocx('First part. Second part. Third part.');
      zip.writeZip(docxPath);

      const markdown = `First part. {>>A: Comment 1<<} Second part. {>>B: Comment 2<<} Third part.`;
      const result = await injectComments(docxPath, markdown, outputPath);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.commentCount, 2);

      fs.rmSync(tmpDir, { recursive: true });
    });

    it('should handle missing input file', async () => {
      const result = await injectComments('/nonexistent/file.docx', 'text', '/tmp/out.docx');
      assert.strictEqual(result.success, false);
      assert.ok(result.error.includes('not found'));
    });

    it('should escape XML special characters', async () => {
      const tmpDir = fs.mkdtempSync('/tmp/docrev-test-');
      const docxPath = path.join(tmpDir, 'test.docx');
      const outputPath = path.join(tmpDir, 'output.docx');

      const zip = createTestDocx('This is test content with some text here.');
      zip.writeZip(docxPath);

      const markdown = 'This is test content {>>User: Comment with <special> & "chars"<<} with some text here.';
      const result = await injectComments(docxPath, markdown, outputPath);

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.commentCount, 1);

      const outputZip = new AdmZip(outputPath);
      const commentsXml = outputZip.readAsText(outputZip.getEntry('word/comments.xml'));
      assert.ok(commentsXml.includes('&lt;special&gt;'), 'Should escape < and >');
      assert.ok(commentsXml.includes('&amp;'), 'Should escape &');

      fs.rmSync(tmpDir, { recursive: true });
    });
  });
});
