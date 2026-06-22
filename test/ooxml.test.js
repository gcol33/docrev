/**
 * Unit tests for the parser-backed OOXML layer. These exercise the real-world
 * shapes that regex/string-splice readers miss: marker attributes beyond
 * w:id, anchor text split across runs, the WordprocessingML namespace bound to
 * a non-`w` prefix, content tabs as run separators, and XML entities.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import AdmZip from 'adm-zip';

import {
  tokenizeXml,
  resolveNamespaces,
  buildDocTextModel,
  decodeXmlEntities,
  encodeXmlText,
  encodeXmlAttr,
  listProseParts,
  openDocx,
  readPartText,
  WML_NS,
} from '../lib/ooxml.ts';

import {
  buildMessyCommentDocx,
  buildAltPrefixDocx,
  buildFootnoteDocx,
} from './helpers/realworld-docx.mjs';

function docXml(docxPath) {
  return new AdmZip(docxPath).getEntry('word/document.xml').getData().toString('utf8');
}

test('tokenizer reconstructs the source byte-for-byte', () => {
  const xml = `<w:p><w:r><w:t xml:space="preserve">a &amp; b</w:t></w:r><w:tab/></w:p>`;
  const tokens = tokenizeXml(xml);
  assert.equal(tokens.map((t) => t.raw).join(''), xml);
});

test('tokenizer is quote-aware: a raw > inside an attribute does not end the tag', () => {
  const xml = `<w:t w:val="a > b">x</w:t>`;
  const tokens = tokenizeXml(xml);
  const open = tokens.find((t) => t.kind === 'open');
  assert.equal(open.attrs.find((a) => a.local === 'val').value, 'a > b');
});

test('attributes decode entities; w:id is found regardless of attribute order', () => {
  const xml = `<w:commentRangeStart w16cid:durableId="9" w:id="3"/>`;
  const tokens = tokenizeXml(xml);
  const ns = resolveNamespaces(tokenizeXml(`<w:document xmlns:w="${WML_NS}"><w:body/></w:document>`));
  assert.equal(ns.wmlAttr(tokens[0], 'id'), '3');
});

test('decode/encode round-trips the five XML entities', () => {
  assert.equal(decodeXmlEntities('a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;'), `a & <b> "c" 'd'`);
  assert.equal(encodeXmlText('a & <b>'), 'a &amp; &lt;b&gt;');
  assert.equal(encodeXmlAttr('"x" & y'), '&quot;x&quot; &amp; y');
});

test('messy doc: multi-run anchor with tab and entity is read whole', () => {
  const model = buildDocTextModel(docXml(buildMessyCommentDocx()));
  // "niche " + "A&B" + tab + "expansion" — entity decoded, tab preserved.
  assert.equal(model.comments.length, 1);
  assert.equal(model.comments[0].id, '0');
  assert.equal(model.comments[0].anchor, 'niche A&B\texpansion');
  assert.equal(model.comments[0].isEmpty, false);
  assert.ok(model.text.includes('The niche A&B\texpansion was measured.'));
});

test('alt-prefix doc: WordML bound to x: still extracts text and the comment range', () => {
  const xml = docXml(buildAltPrefixDocx());
  const ns = resolveNamespaces(tokenizeXml(xml));
  assert.equal(ns.uriForPrefix('x'), WML_NS);
  const model = buildDocTextModel(xml);
  assert.equal(model.text, 'arable land cover dropped sharply');
  assert.equal(model.comments.length, 1);
  assert.equal(model.comments[0].anchor, 'arable land cover dropped sharply');
});

test('content tab inside a run separates words; tab-stop in pPr does not', () => {
  const xml =
    `<w:document xmlns:w="${WML_NS}"><w:body>` +
    `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>` +
    `<w:r><w:t>left</w:t></w:r><w:r><w:tab/><w:t>right</w:t></w:r></w:p>` +
    `</w:body></w:document>`;
  const model = buildDocTextModel(xml);
  // Only the in-run tab contributes; the pPr tab-stop definition is ignored.
  assert.equal(model.text, 'left\tright');
});

test('headings are detected by paragraph style with their text offset', () => {
  const xml =
    `<w:document xmlns:w="${WML_NS}"><w:body>` +
    `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Methods</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t>We measured.</w:t></w:r></w:p>` +
    `</w:body></w:document>`;
  const model = buildDocTextModel(xml);
  assert.equal(model.headings.length, 1);
  assert.equal(model.headings[0].text, 'Methods');
  assert.equal(model.headings[0].level, 2);
  assert.equal(model.headings[0].position, 0);
});

test('empty (point) comment range is reported as empty, not dropped', () => {
  const xml =
    `<w:document xmlns:w="${WML_NS}"><w:body><w:p>` +
    `<w:r><w:t>before </w:t></w:r>` +
    `<w:commentRangeStart w:id="7"/><w:commentRangeEnd w:id="7"/>` +
    `<w:r><w:commentReference w:id="7"/></w:r>` +
    `<w:r><w:t>after</w:t></w:r></w:p></w:body></w:document>`;
  const model = buildDocTextModel(xml);
  assert.equal(model.comments.length, 1);
  assert.equal(model.comments[0].isEmpty, true);
  assert.equal(model.comments[0].start, 'before '.length);
});

test('footnote prose lives in a part beyond document.xml', () => {
  const zip = openDocx(buildFootnoteDocx());
  const parts = listProseParts(zip);
  assert.ok(parts.includes('word/document.xml'));
  assert.ok(parts.includes('word/footnotes.xml'));
  const footnoteText = buildDocTextModel(readPartText(zip, 'word/footnotes.xml')).text;
  assert.ok(footnoteText.includes('Standardized by grid-cell area'));
});
