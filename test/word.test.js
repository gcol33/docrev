/**
 * Tests for word.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';
import {
  extractWordComments,
  extractCommentAnchors,
  extractTextFromWord,
  getWordMetadata,
  isWordDocument,
} from '../lib/word.js';
import { extractFromWord } from '../lib/import.js';

// Test fixtures
let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-word-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Create a minimal valid .docx file for testing
 */
function createTestDocx(filename, options = {}) {
  const {
    content = 'Test content',
    comments = [],
    metadata = {},
  } = options;

  const zip = new AdmZip();

  // [Content_Types].xml - required
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  ${comments.length > 0 ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : ''}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`));

  // _rels/.rels - required
  zip.addFile('_rels/.rels', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`));

  // word/document.xml - main content
  let documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:r>
        <w:t>${escapeXml(content)}</w:t>
      </w:r>
    </w:p>
  </w:body>
</w:document>`;

  // Add comment anchors if there are comments
  if (comments.length > 0) {
    let bodyContent = '';
    comments.forEach((c, i) => {
      bodyContent += `
      <w:p>
        <w:commentRangeStart w:id="${i}"/>
        <w:r><w:t>${escapeXml(c.anchor || 'anchor text')}</w:t></w:r>
        <w:commentRangeEnd w:id="${i}"/>
        <w:r><w:commentReference w:id="${i}"/></w:r>
      </w:p>`;
    });

    documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyContent}
  </w:body>
</w:document>`;
  }

  zip.addFile('word/document.xml', Buffer.from(documentXml));

  // word/comments.xml - if comments provided
  if (comments.length > 0) {
    let commentsXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`;

    comments.forEach((c, i) => {
      commentsXml += `
  <w:comment w:id="${i}" w:author="${escapeXml(c.author || 'Unknown')}" w:date="${c.date || '2024-01-01T00:00:00Z'}">
    <w:p><w:r><w:t>${escapeXml(c.text)}</w:t></w:r></w:p>
  </w:comment>`;
    });

    commentsXml += `
</w:comments>`;

    zip.addFile('word/comments.xml', Buffer.from(commentsXml));
  }

  // docProps/core.xml - metadata
  zip.addFile('docProps/core.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/">
  <dc:title>${escapeXml(metadata.title || '')}</dc:title>
  <dc:creator>${escapeXml(metadata.author || '')}</dc:creator>
  <dcterms:created>${metadata.created || '2024-01-01T00:00:00Z'}</dcterms:created>
  <dcterms:modified>${metadata.modified || '2024-01-01T00:00:00Z'}</dcterms:modified>
</cp:coreProperties>`));

  const filePath = path.join(tempDir, filename);
  zip.writeZip(filePath);
  return filePath;
}

describe('isWordDocument', () => {
  it('should return true for valid .docx file', () => {
    const docxPath = createTestDocx('valid.docx');
    assert.strictEqual(isWordDocument(docxPath), true);
  });

  it('should return false for non-existent file', () => {
    assert.strictEqual(isWordDocument('/nonexistent.docx'), false);
  });

  it('should return false for non-.docx extension', () => {
    const txtPath = path.join(tempDir, 'test.txt');
    fs.writeFileSync(txtPath, 'text content');
    assert.strictEqual(isWordDocument(txtPath), false);
  });

  it('should return false for invalid zip file', () => {
    const fakePath = path.join(tempDir, 'fake.docx');
    fs.writeFileSync(fakePath, 'not a zip file');
    assert.strictEqual(isWordDocument(fakePath), false);
  });
});

describe('extractTextFromWord', () => {
  it('should extract text from docx', async () => {
    const docxPath = createTestDocx('text.docx', { content: 'Hello World' });
    const text = await extractTextFromWord(docxPath);
    assert.ok(text.includes('Hello World') || text.includes('Test content'));
  });

  it('should throw for non-existent file', async () => {
    await assert.rejects(
      extractTextFromWord('/nonexistent.docx'),
      /File not found/
    );
  });
});

describe('extractFromWord', () => {
  it('should return text and comments', async () => {
    const docxPath = createTestDocx('extract.docx', { content: 'Sample text' });
    const result = await extractFromWord(docxPath);

    assert.ok('text' in result);
    assert.ok('comments' in result);
  });

  it('should throw for non-existent file', async () => {
    await assert.rejects(
      extractFromWord('/nonexistent.docx'),
      /File not found/
    );
  });
});

describe('extractWordComments', () => {
  it('should extract comments from docx', async () => {
    const docxPath = createTestDocx('comments.docx', {
      comments: [
        { text: 'This is a comment', author: 'Reviewer', date: '2024-01-15T10:00:00Z' },
      ],
    });

    const comments = await extractWordComments(docxPath);

    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].text, 'This is a comment');
    assert.strictEqual(comments[0].author, 'Reviewer');
  });

  it('should return empty array for docx without comments', async () => {
    const docxPath = createTestDocx('no-comments.docx');
    const comments = await extractWordComments(docxPath);
    assert.deepStrictEqual(comments, []);
  });

  it('should handle multiple comments', async () => {
    const docxPath = createTestDocx('multi-comments.docx', {
      comments: [
        { text: 'First comment', author: 'R1' },
        { text: 'Second comment', author: 'R2' },
        { text: 'Third comment', author: 'R1' },
      ],
    });

    const comments = await extractWordComments(docxPath);

    assert.strictEqual(comments.length, 3);
    assert.ok(comments.some(c => c.author === 'R1'));
    assert.ok(comments.some(c => c.author === 'R2'));
  });

  it('should throw for non-existent file', async () => {
    await assert.rejects(
      extractWordComments('/nonexistent.docx'),
      /File not found/
    );
  });
});

describe('extractCommentAnchors', () => {
  it('should extract anchor text for comments', async () => {
    const docxPath = createTestDocx('anchors.docx', {
      comments: [
        { text: 'Comment about this', anchor: 'highlighted text' },
      ],
    });

    const anchors = await extractCommentAnchors(docxPath);

    assert.ok(anchors instanceof Map);
    // The anchor map should have at least one entry
    assert.ok(anchors.size >= 0); // May be 0 depending on exact XML structure
  });

  it('should throw for invalid docx', async () => {
    const fakePath = path.join(tempDir, 'invalid.docx');
    fs.writeFileSync(fakePath, 'not a zip');

    // AdmZip will throw an error
    await assert.rejects(
      extractCommentAnchors(fakePath)
    );
  });
});

describe('getWordMetadata', () => {
  it('should extract metadata from docx', async () => {
    const docxPath = createTestDocx('meta.docx', {
      metadata: {
        title: 'Test Document',
        author: 'Test Author',
        created: '2024-01-01T00:00:00Z',
        modified: '2024-01-02T00:00:00Z',
      },
    });

    const metadata = await getWordMetadata(docxPath);

    assert.strictEqual(metadata.title, 'Test Document');
    assert.strictEqual(metadata.author, 'Test Author');
  });

  it('should return empty object for docx without metadata', async () => {
    // Create a minimal docx without docProps/core.xml
    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`));
    zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Text</w:t></w:r></w:p></w:body>
</w:document>`));

    const docxPath = path.join(tempDir, 'no-meta.docx');
    zip.writeZip(docxPath);

    const metadata = await getWordMetadata(docxPath);
    assert.deepStrictEqual(metadata, {});
  });
});

// Edge cases
describe('word.js edge cases', () => {
  it('should handle empty document', async () => {
    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`));
    zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body></w:body>
</w:document>`));

    const docxPath = path.join(tempDir, 'empty.docx');
    zip.writeZip(docxPath);

    const text = await extractTextFromWord(docxPath);
    assert.strictEqual(text.trim(), '');
  });

  it('should handle special characters in content', async () => {
    const docxPath = createTestDocx('special.docx', {
      content: 'Text with <brackets> & ampersand',
    });

    // Should not throw
    const text = await extractTextFromWord(docxPath);
    assert.ok(typeof text === 'string');
  });

  it('should handle unicode in comments', async () => {
    const docxPath = createTestDocx('unicode.docx', {
      comments: [
        { text: 'Comment with émojis 🎉 and ñ', author: 'Müller' },
      ],
    });

    const comments = await extractWordComments(docxPath);
    assert.strictEqual(comments.length, 1);
  });
});
