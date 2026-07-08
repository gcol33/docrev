/**
 * Regression tests for the 2026-07 stability review fixes.
 *
 * Each describe block pins one fixed defect so it cannot reappear:
 * caption-match anchors, CRLF table protection, escaped-dollar math,
 * visible-comment over-matching, reply-anchor nested brackets, XML entity
 * decoding, namespace-prefix table extraction, and output suffix naming.
 */

import { strict as assert } from 'assert';
import { describe, it, beforeEach, afterEach } from 'node:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';

import { restoreImagesFromRegistry, parseVisibleComments, convertVisibleComments } from '../lib/restore-references.js';
import { protectTables, protectMath } from '../lib/protect-restore.js';
import { prepareMarkdownWithMarkers } from '../lib/wordcomments.js';
import { decodeXmlEntities, extractTableModels } from '../lib/ooxml.js';
import { withOutputSuffix } from '../lib/build.js';
import { extractWordTables } from '../lib/import.js';
import { levenshtein } from '../lib/utils.js';

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-review-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('restoreImagesFromRegistry caption match', () => {
  it('emits the {#fig:label} anchor for a caption-matched image', () => {
    const registry = {
      version: 1,
      created: '2026-07-08T00:00:00.000Z',
      figures: [
        {
          type: 'fig',
          label: 'map',
          number: '1',
          caption: 'Map of study sites.',
          path: 'figures/map.png',
        },
      ],
    };
    fs.mkdirSync(path.join(tempDir, '.rev'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.rev', 'image-registry.json'),
      JSON.stringify(registry),
      'utf-8'
    );

    const text = '![Map of study sites.](media/image1.png)';
    const result = restoreImagesFromRegistry(text, tempDir);

    assert.equal(result.restored, 1);
    assert.ok(
      result.text.includes('![Map of study sites.](figures/map.png){#fig:map}'),
      `anchor missing from restored image: ${result.text}`
    );
  });
});

describe('protectTables CRLF handling', () => {
  const table = ['| A | B |', '|---|---|', '| 1 | 2 |'];

  it('protects LF tables', () => {
    const md = `before\n\n${table.join('\n')}\n\nafter`;
    const { text, tables } = protectTables(md);
    assert.equal(tables.length, 1);
    assert.ok(text.includes('TABLEBLOCK0ENDTABLE'));
  });

  it('protects CRLF tables', () => {
    const md = `before\r\n\r\n${table.join('\r\n')}\r\n\r\nafter`;
    const { text, tables } = protectTables(md);
    assert.equal(tables.length, 1);
    assert.ok(text.includes('TABLEBLOCK0ENDTABLE'));
  });
});

describe('protectMath escaped dollars', () => {
  it('does not treat escaped \\$ amounts as math', () => {
    const md = 'costs \\$5 versus \\$10 per sample';
    const { text, mathBlocks } = protectMath(md);
    assert.equal(mathBlocks.length, 0);
    assert.equal(text, md);
  });

  it('still protects real inline math', () => {
    const { text, mathBlocks } = protectMath('the model $y = a + bx$ fits');
    assert.equal(mathBlocks.length, 1);
    assert.ok(text.includes('MATHBLOCK0ENDMATH'));
  });

  it('protects math containing LaTeX commands', () => {
    const { mathBlocks } = protectMath('rate $\\alpha + \\beta$ here');
    assert.equal(mathBlocks.length, 1);
    assert.equal(mathBlocks[0].original, '$\\alpha + \\beta$');
  });
});

describe('visible comment matching', () => {
  it('converts an author-prefixed bracket to a CriticMarkup comment', () => {
    const out = convertVisibleComments('Text [Smith: please clarify] more.');
    assert.ok(out.includes('{>>Smith: please clarify<<}'));
  });

  it('leaves documentary lead-ins like [Note: ...] alone', () => {
    const input = 'Text [Note: see appendix] more.';
    assert.equal(convertVisibleComments(input), input);
    assert.equal(parseVisibleComments(input).length, 0);
  });

  it('leaves markdown links with colons in the text alone', () => {
    const input = 'See [Section: Methods](docs/methods.md) for details.';
    assert.equal(convertVisibleComments(input), input);
  });

  it('leaves bracketed text with digits alone', () => {
    const input = 'As shown in [Table 1: results] the effect is small.';
    assert.equal(convertVisibleComments(input), input);
  });

  it('leaves image alt text alone', () => {
    const input = '![Caption: overview](figures/x.png)';
    assert.equal(convertVisibleComments(input), input);
  });
});

describe('reply anchor with nested brackets', () => {
  it('places parent markers when the propagated anchor contains ]', () => {
    const md =
      'Range {>>Ana: check this<<} {>>↪ Ben: agreed<<} [[0..9]]{.mark} stays.';
    const { markedMarkdown, comments } = prepareMarkdownWithMarkers(md);

    assert.equal(comments.length, 2);
    const parent = comments[0];
    const reply = comments[1];
    assert.equal(reply.isReply, true);
    assert.equal(reply.parentIdx, 0);
    assert.equal(parent.anchor, '[0..9]');

    // The anchor text survives in the marked markdown between markers.
    assert.ok(
      markedMarkdown.includes('[0..9]'),
      `anchor text dropped: ${markedMarkdown}`
    );
    assert.ok(markedMarkdown.includes('stays.'));
  });
});

describe('decodeXmlEntities', () => {
  it('does not double-unescape &amp;lt;', () => {
    assert.equal(decodeXmlEntities('a &amp;lt; b'), 'a &lt; b');
  });

  it('decodes astral-plane numeric references', () => {
    assert.equal(decodeXmlEntities('&#128512;'), '\u{1F600}');
    assert.equal(decodeXmlEntities('&#x1F600;'), '\u{1F600}');
  });
});

describe('table extraction with a non-w namespace prefix', () => {
  function docxWithPrefix(prefix) {
    const p = prefix;
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<${p}:document xmlns:${p}="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<${p}:body>
<${p}:tbl>
<${p}:tblGrid><${p}:gridCol ${p}:w="2000"/><${p}:gridCol ${p}:w="2000"/></${p}:tblGrid>
<${p}:tr>
<${p}:tc><${p}:tcPr></${p}:tcPr><${p}:p><${p}:r><${p}:t>H1</${p}:t></${p}:r></${p}:p></${p}:tc>
<${p}:tc><${p}:tcPr></${p}:tcPr><${p}:p><${p}:r><${p}:t>H2</${p}:t></${p}:r></${p}:p></${p}:tc>
</${p}:tr>
<${p}:tr>
<${p}:tc><${p}:tcPr></${p}:tcPr><${p}:p><${p}:r><${p}:t>a</${p}:t></${p}:r></${p}:p></${p}:tc>
<${p}:tc><${p}:tcPr></${p}:tcPr><${p}:p><${p}:r><${p}:t>b</${p}:t></${p}:r></${p}:p></${p}:tc>
</${p}:tr>
</${p}:tbl>
</${p}:body>
</${p}:document>`;

    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`, 'utf8'));
    zip.addFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
    return zip.toBuffer();
  }

  it('extracts tables when WordprocessingML is bound to a different prefix', async () => {
    const docPath = path.join(tempDir, 'prefixed.docx');
    fs.writeFileSync(docPath, docxWithPrefix('x'));

    const tables = await extractWordTables(docPath);
    assert.equal(tables.length, 1);
    assert.equal(tables[0].rowCount, 2);
    assert.equal(tables[0].colCount, 2);
    assert.ok(tables[0].markdown.includes('H1'));
    assert.ok(tables[0].markdown.includes('b'));
  });

  it('extractTableModels reads gridSpan and vMerge structurally', () => {
    const xml = `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:tbl>
<w:tblGrid><w:gridCol/><w:gridCol/></w:tblGrid>
<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>Wide</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p><w:r><w:t>hidden</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>B</w:t></w:r></w:p></w:tc></w:tr>
</w:tbl>
</w:body></w:document>`;
    const models = extractTableModels(xml);
    assert.equal(models.length, 1);
    assert.equal(models[0].gridCols, 2);
    assert.equal(models[0].rows[0][0].gridSpan, 2);
    assert.equal(models[0].rows[0][0].text, 'Wide');
    assert.equal(models[0].rows[1][0].vMergeContinuation, true);
    assert.equal(models[0].rows[1][0].text, '');
    assert.equal(models[0].rows[1][1].text, 'B');
  });
});

describe('withOutputSuffix', () => {
  it('inserts the suffix before the extension', () => {
    assert.equal(withOutputSuffix('out/paper.docx', '_comments'), 'out/paper_comments.docx');
    assert.equal(withOutputSuffix('paper.pdf', '_comments'), 'paper_comments.pdf');
  });
});

describe('shared levenshtein', () => {
  it('computes edit distance', () => {
    assert.equal(levenshtein('kitten', 'sitting'), 3);
    assert.equal(levenshtein('', 'abc'), 3);
    assert.equal(levenshtein('same', 'same'), 0);
  });
});
