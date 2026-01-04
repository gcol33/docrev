/**
 * Tests for Word table extraction
 */

import { strict as assert } from 'assert';
import { describe, it, before, after } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Import the functions we need to test
// We'll test by creating minimal Word docs programmatically
import { extractWordTables } from '../lib/import.js';

/**
 * Create a minimal valid Word document with a table
 * @param {string[][]} rows - Table rows (first row is header)
 * @param {object} options - { gridSpans: number[][], vMerges: boolean[][] }
 * @returns {Buffer}
 */
function createWordDocWithTable(rows, options = {}) {
  const { gridSpans = [], vMerges = [] } = options;

  // Build table XML
  let tableXml = '<w:tbl>';

  // Table grid
  const colCount = Math.max(...rows.map((r) => r.length));
  tableXml += '<w:tblGrid>';
  for (let i = 0; i < colCount; i++) {
    tableXml += '<w:gridCol w:w="2000"/>';
  }
  tableXml += '</w:tblGrid>';

  // Rows
  for (let r = 0; r < rows.length; r++) {
    tableXml += '<w:tr>';
    for (let c = 0; c < rows[r].length; c++) {
      const gridSpan = gridSpans[r]?.[c] || 1;
      const isVMergeStart = vMerges[r]?.[c] === 'start';
      const isVMergeContinue = vMerges[r]?.[c] === 'continue';

      tableXml += '<w:tc>';
      tableXml += '<w:tcPr>';
      if (gridSpan > 1) {
        tableXml += `<w:gridSpan w:val="${gridSpan}"/>`;
      }
      if (isVMergeStart) {
        tableXml += '<w:vMerge w:val="restart"/>';
      } else if (isVMergeContinue) {
        tableXml += '<w:vMerge/>';
      }
      tableXml += '</w:tcPr>';
      tableXml += '<w:p><w:r><w:t>' + escapeXml(rows[r][c]) + '</w:t></w:r></w:p>';
      tableXml += '</w:tc>';
    }
    tableXml += '</w:tr>';
  }

  tableXml += '</w:tbl>';

  // Create minimal document.xml
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
${tableXml}
</w:body>
</w:document>`;

  // Create minimal [Content_Types].xml
  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  // Create minimal _rels/.rels
  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  // Create zip
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(relsXml, 'utf8'));
  zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));

  return zip.toBuffer();
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

describe('Word Table Extraction', () => {
  const testDir = path.join(__dirname, 'temp-tables');

  before(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  after(() => {
    // Cleanup
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true });
    }
  });

  describe('Basic table extraction', () => {
    it('should extract a simple 2x2 table', async () => {
      const rows = [
        ['Header1', 'Header2'],
        ['Cell1', 'Cell2'],
      ];
      const docBuffer = createWordDocWithTable(rows);
      const docPath = path.join(testDir, 'simple.docx');
      fs.writeFileSync(docPath, docBuffer);

      const tables = await extractWordTables(docPath);

      assert.strictEqual(tables.length, 1);
      assert.strictEqual(tables[0].rowCount, 2);
      assert.strictEqual(tables[0].colCount, 2);
      assert.ok(tables[0].markdown.includes('| Header1 | Header2 |'));
      assert.ok(tables[0].markdown.includes('| Cell1 | Cell2 |'));
    });

    it('should extract a 3x4 table', async () => {
      const rows = [
        ['A', 'B', 'C', 'D'],
        ['1', '2', '3', '4'],
        ['5', '6', '7', '8'],
      ];
      const docBuffer = createWordDocWithTable(rows);
      const docPath = path.join(testDir, 'larger.docx');
      fs.writeFileSync(docPath, docBuffer);

      const tables = await extractWordTables(docPath);

      assert.strictEqual(tables.length, 1);
      assert.strictEqual(tables[0].rowCount, 3);
      assert.strictEqual(tables[0].colCount, 4);
    });

    it('should handle empty cells', async () => {
      const rows = [
        ['Header1', 'Header2', 'Header3'],
        ['', 'Value', ''],
        ['X', '', 'Y'],
      ];
      const docBuffer = createWordDocWithTable(rows);
      const docPath = path.join(testDir, 'empty-cells.docx');
      fs.writeFileSync(docPath, docBuffer);

      const tables = await extractWordTables(docPath);

      assert.strictEqual(tables.length, 1);
      assert.ok(tables[0].markdown.includes('|  | Value |  |'));
      assert.ok(tables[0].markdown.includes('| X |  | Y |'));
    });
  });

  describe('Special characters', () => {
    it('should handle ampersands and angle brackets', async () => {
      const rows = [
        ['Name', 'Value'],
        ['A & B', '<tag>'],
      ];
      const docBuffer = createWordDocWithTable(rows);
      const docPath = path.join(testDir, 'special-chars.docx');
      fs.writeFileSync(docPath, docBuffer);

      const tables = await extractWordTables(docPath);

      assert.strictEqual(tables.length, 1);
      assert.ok(tables[0].markdown.includes('A & B'));
      assert.ok(tables[0].markdown.includes('<tag>'));
    });

    it('should escape pipe characters in cells', async () => {
      const rows = [
        ['Col1', 'Col2'],
        ['A|B', 'C|D'],
      ];
      const docBuffer = createWordDocWithTable(rows);
      const docPath = path.join(testDir, 'pipes.docx');
      fs.writeFileSync(docPath, docBuffer);

      const tables = await extractWordTables(docPath);

      assert.strictEqual(tables.length, 1);
      // Pipes should be escaped as \|
      assert.ok(tables[0].markdown.includes('A\\|B'));
      assert.ok(tables[0].markdown.includes('C\\|D'));
    });

    it('should handle Unicode characters', async () => {
      const rows = [
        ['Greek', 'Math', 'Emoji'],
        ['α β γ', '≤ ≥ ±', '🌍'],
      ];
      const docBuffer = createWordDocWithTable(rows);
      const docPath = path.join(testDir, 'unicode.docx');
      fs.writeFileSync(docPath, docBuffer);

      const tables = await extractWordTables(docPath);

      assert.strictEqual(tables.length, 1);
      assert.ok(tables[0].markdown.includes('α β γ'));
      assert.ok(tables[0].markdown.includes('≤ ≥ ±'));
    });
  });

  describe('Merged cells', () => {
    it('should handle horizontal merge (gridSpan)', async () => {
      const rows = [
        ['Merged Header', '', 'Normal'],
        ['A', 'B', 'C'],
      ];
      const gridSpans = [
        [2, 0, 1], // First cell spans 2 columns
        [1, 1, 1],
      ];
      const docBuffer = createWordDocWithTable(rows, { gridSpans });
      const docPath = path.join(testDir, 'gridspan.docx');
      fs.writeFileSync(docPath, docBuffer);

      const tables = await extractWordTables(docPath);

      assert.strictEqual(tables.length, 1);
      // Merged cells should result in empty cells for spanned columns
      assert.ok(tables[0].markdown.includes('Merged Header'));
      assert.strictEqual(tables[0].colCount, 3);
    });

    it('should handle vertical merge (vMerge)', async () => {
      const rows = [
        ['Header', 'Values'],
        ['Merged', 'Row1'],
        ['', 'Row2'], // vMerge continuation
      ];
      const vMerges = [
        [null, null],
        ['start', null],
        ['continue', null],
      ];
      const docBuffer = createWordDocWithTable(rows, { vMerges });
      const docPath = path.join(testDir, 'vmerge.docx');
      fs.writeFileSync(docPath, docBuffer);

      const tables = await extractWordTables(docPath);

      assert.strictEqual(tables.length, 1);
      assert.strictEqual(tables[0].rowCount, 3);
      // vMerge continuation should have empty content
    });
  });

  describe('Multiple tables', () => {
    it('should extract all tables from document', async () => {
      // Create doc with two tables manually
      const table1Xml = `<w:tbl>
        <w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
        <w:tr><w:tc><w:p><w:r><w:t>T1-A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>T1-B</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>`;
      const table2Xml = `<w:tbl>
        <w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
        <w:tr><w:tc><w:p><w:r><w:t>T2-X</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>T2-Y</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>T2-Z</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>`;

      const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Before table 1</w:t></w:r></w:p>
${table1Xml}
<w:p><w:r><w:t>Between tables</w:t></w:r></w:p>
${table2Xml}
<w:p><w:r><w:t>After table 2</w:t></w:r></w:p>
</w:body>
</w:document>`;

      const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

      const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

      const zip = new AdmZip();
      zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
      zip.addFile('_rels/.rels', Buffer.from(relsXml, 'utf8'));
      zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));

      const docPath = path.join(testDir, 'multi-table.docx');
      fs.writeFileSync(docPath, zip.toBuffer());

      const tables = await extractWordTables(docPath);

      assert.strictEqual(tables.length, 2);
      assert.strictEqual(tables[0].colCount, 2);
      assert.strictEqual(tables[1].colCount, 3);
      assert.ok(tables[0].markdown.includes('T1-A'));
      assert.ok(tables[1].markdown.includes('T2-Z'));
    });
  });

  describe('Edge cases', () => {
    it('should handle document with no tables', async () => {
      const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>Just text, no tables</w:t></w:r></w:p></w:body>
</w:document>`;

      const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

      const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

      const zip = new AdmZip();
      zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
      zip.addFile('_rels/.rels', Buffer.from(relsXml, 'utf8'));
      zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));

      const docPath = path.join(testDir, 'no-tables.docx');
      fs.writeFileSync(docPath, zip.toBuffer());

      const tables = await extractWordTables(docPath);

      assert.strictEqual(tables.length, 0);
    });

    it('should handle single-cell table', async () => {
      const rows = [['Only Cell']];
      const docBuffer = createWordDocWithTable(rows);
      const docPath = path.join(testDir, 'single-cell.docx');
      fs.writeFileSync(docPath, docBuffer);

      const tables = await extractWordTables(docPath);

      assert.strictEqual(tables.length, 1);
      assert.strictEqual(tables[0].rowCount, 1);
      assert.strictEqual(tables[0].colCount, 1);
    });

    it('should handle very long cell content', async () => {
      const longText = 'A'.repeat(500);
      const rows = [
        ['Header', 'Description'],
        ['Short', longText],
      ];
      const docBuffer = createWordDocWithTable(rows);
      const docPath = path.join(testDir, 'long-content.docx');
      fs.writeFileSync(docPath, docBuffer);

      const tables = await extractWordTables(docPath);

      assert.strictEqual(tables.length, 1);
      assert.ok(tables[0].markdown.includes(longText));
    });
  });

  describe('Markdown table format', () => {
    it('should generate valid pipe table with separator row', async () => {
      const rows = [
        ['Col1', 'Col2'],
        ['A', 'B'],
      ];
      const docBuffer = createWordDocWithTable(rows);
      const docPath = path.join(testDir, 'format.docx');
      fs.writeFileSync(docPath, docBuffer);

      const tables = await extractWordTables(docPath);
      const md = tables[0].markdown;

      const lines = md.split('\n');
      assert.strictEqual(lines.length, 3); // header, separator, data
      assert.ok(lines[0].startsWith('|'));
      assert.ok(lines[0].endsWith('|'));
      assert.ok(lines[1].includes('---'));
      assert.ok(lines[2].startsWith('|'));
    });

    it('should normalize column count across rows', async () => {
      // If rows have different cell counts, should normalize
      const rows = [
        ['A', 'B', 'C'],
        ['1', '2'], // Missing third cell
      ];
      const docBuffer = createWordDocWithTable(rows);
      const docPath = path.join(testDir, 'uneven.docx');
      fs.writeFileSync(docPath, docBuffer);

      const tables = await extractWordTables(docPath);

      // All rows should have same column count
      const lines = tables[0].markdown.split('\n');
      const headerCols = (lines[0].match(/\|/g) || []).length;
      const dataCols = (lines[2].match(/\|/g) || []).length;
      assert.strictEqual(headerCols, dataCols);
    });
  });
});
