/**
 * Unit tests for the DOCX table layout pass: columns sized from content to the
 * page's text width, rules and cell font size written on the table itself.
 */

import { test } from 'node:test';
import assert from 'node:assert';

import { columnWidths, layoutTablesXml, textWidthTwips } from '../lib/docx-tables.ts';
import { tokenizeXml, resolveNamespaces, extractTableModels } from '../lib/ooxml.ts';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function cell(p, text, tcPr = `<${p}:tcPr />`) {
  return `<${p}:tc>${tcPr}<${p}:p><${p}:r><${p}:t xml:space="preserve">${text}</${p}:t></${p}:r></${p}:p></${p}:tc>`;
}

/** A pandoc-shaped document: fixed 5.5 in grid, header row marked, A4 page with 2.5 cm margins. */
function pandocDoc(p = 'w', rows = [['Term', 'Meaning'], ['Embedding', 'A learned numerical representation of an input species, genus or family']]) {
  const grid = rows[0].map(() => `<${p}:gridCol ${p}:w="${Math.floor(7920 / rows[0].length)}" />`).join('');
  const trs = rows.map((r, i) => {
    const trPr = i === 0 ? `<${p}:trPr><${p}:tblHeader ${p}:val="on" /></${p}:trPr>` : '';
    return `<${p}:tr>${trPr}${r.map(t => cell(p, t)).join('')}</${p}:tr>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><${p}:document xmlns:${p}="${W_NS}"><${p}:body>`
    + `<${p}:tbl><${p}:tblPr><${p}:tblStyle ${p}:val="Table" /><${p}:tblW ${p}:type="pct" ${p}:w="5000" />`
    + `<${p}:tblLayout ${p}:type="fixed" /><${p}:tblLook ${p}:firstRow="1" ${p}:val="0020" /></${p}:tblPr>`
    + `<${p}:tblGrid>${grid}</${p}:tblGrid>${trs}</${p}:tbl>`
    + `<${p}:sectPr><${p}:pgSz ${p}:w="11906" ${p}:h="16838" /><${p}:pgMar ${p}:left="1417" ${p}:right="1417" ${p}:top="1417" ${p}:bottom="1417" /></${p}:sectPr>`
    + `</${p}:body></${p}:document>`;
}

function gridWidths(xml) {
  const tokens = tokenizeXml(xml);
  const ns = resolveNamespaces(tokens);
  return tokens
    .filter(t => (t.kind === 'selfclose' || t.kind === 'open') && ns.isWml(t) && t.local === 'gridCol')
    .map(t => Number(ns.wmlAttr(t, 'w')));
}

test('text width comes from the page size and margins', () => {
  assert.strictEqual(textWidthTwips(pandocDoc()), 11906 - 2 * 1417);
});

test('columns fill the text width and give the longer text the wider column', () => {
  const { xml, tables } = layoutTablesXml(pandocDoc());
  assert.strictEqual(tables, 1);
  const widths = gridWidths(xml);
  assert.strictEqual(widths.reduce((a, b) => a + b, 0), 11906 - 2 * 1417);
  assert.ok(widths[1] > widths[0], `meaning column ${widths[1]} should exceed term column ${widths[0]}`);
});

test('no column is narrower than its longest word', () => {
  const rows = [
    { header: true, cells: [{ col: 0, span: 1, text: 'Target' }, { col: 1, span: 1, text: 'Recorded values' }, { col: 2, span: 1, text: 'x' }] },
    { header: false, cells: [{ col: 0, span: 1, text: 'Location' }, { col: 1, span: 1, text: '40° N–57° N, 4° W–27° E' }, { col: 2, span: 1, text: 'a much longer description that wraps over several lines in the cell' }] },
  ];
  const { widths, fontSize } = columnWidths(rows, 3, 9000);
  const glyph = fontSize * 0.58 * 20;
  assert.ok(widths[0] >= 220 + 'Location'.length * glyph);
  assert.ok(widths[1] >= 220 + 'Recorded'.length * glyph * 1.15);
  assert.strictEqual(widths.reduce((a, b) => a + b, 0), 9000);
});

test('rules, header border, cell widths and font size are written on the table', () => {
  const { xml } = layoutTablesXml(pandocDoc());
  assert.match(xml, /<w:tblBorders><w:top w:val="single" w:sz="8"/);
  assert.match(xml, /<w:tblLayout w:type="fixed"\/>/);
  assert.doesNotMatch(xml, /w:type="pct"/);
  assert.match(xml, /<w:tcPr><w:tcW w:type="dxa" w:w="\d+"\/><w:tcBorders><w:bottom w:val="single" w:sz="6"/);
  assert.match(xml, /<w:r><w:rPr><w:sz w:val="20"\/><w:szCs w:val="20"\/><\/w:rPr><w:t/);
  // tblStyle and tblLook are kept, in schema order around the new properties.
  assert.match(xml, /<w:tblPr><w:tblStyle w:val="Table" \/><w:tblW /);
  assert.match(xml, /<w:tblLayout w:type="fixed"\/><w:tblLook /);
});

test('the table text survives the rewrite', () => {
  const before = extractTableModels(pandocDoc());
  const after = extractTableModels(layoutTablesXml(pandocDoc()).xml);
  assert.deepStrictEqual(after, before);
});

test('the WordprocessingML namespace bound to another prefix is handled', () => {
  const { xml, tables } = layoutTablesXml(pandocDoc('ns0'));
  assert.strictEqual(tables, 1);
  assert.match(xml, /<ns0:tblBorders>/);
  assert.strictEqual(gridWidths(xml).reduce((a, b) => a + b, 0), 11906 - 2 * 1417);
});

test('an existing run size is replaced, not duplicated', () => {
  const doc = pandocDoc().replace('<w:r><w:t xml:space="preserve">Embedding', '<w:r><w:rPr><w:b /><w:sz w:val="28" /><w:vertAlign w:val="superscript" /></w:rPr><w:t xml:space="preserve">Embedding');
  const { xml } = layoutTablesXml(doc);
  assert.match(xml, /<w:rPr><w:b \/><w:sz w:val="20"\/><w:szCs w:val="20"\/><w:vertAlign w:val="superscript" \/><\/w:rPr><w:t xml:space="preserve">Embedding/);
});
