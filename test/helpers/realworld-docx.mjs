/**
 * Builders for .docx fixtures that reproduce real-world OOXML shapes which
 * hand-written single-run test docx never exercise:
 *
 *   - comment-range markers carrying attributes beyond w:id (Word emits
 *     w16cid:durableId), and w:id not necessarily the first attribute
 *   - anchor text split across several runs, each with its own rPr
 *   - XML entities and xml:space="preserve" inside <w:t>
 *   - <w:tab/> / <w:br/> between runs that must render as separators
 *   - text living in parts other than document.xml (footnotes)
 *   - the WordprocessingML namespace bound to a prefix other than "w"
 *
 * These are the cases the regex/string-splice readers miss. They are the spec
 * for the parser-backed OOXML layer.
 */

import AdmZip from 'adm-zip';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const W16CID = 'http://schemas.microsoft.com/office/word/2018/wordml/cid';

function contentTypes({ comments = false, footnotes = false } = {}) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  ${comments ? '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' : ''}
  ${footnotes ? '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>' : ''}
</Types>`;
}

function rootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function documentRels({ comments = false, footnotes = false } = {}) {
  const rels = [];
  if (comments)
    rels.push(
      '<Relationship Id="rIdC" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>',
    );
  if (footnotes)
    rels.push(
      '<Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>',
    );
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels.join('\n  ')}
</Relationships>`;
}

function writeZip(parts) {
  const zip = new AdmZip();
  for (const [name, body] of Object.entries(parts)) {
    zip.addFile(name, Buffer.from(body, 'utf-8'));
  }
  const file = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-fx-')),
    'fixture.docx',
  );
  zip.writeZip(file);
  return file;
}

/**
 * A single comment whose anchor ("niche A&B expansion", with a tab) is split
 * across three runs, the range markers carry an extra w16cid:durableId
 * attribute (w:id is not the only attribute), and the document binds the
 * WordprocessingML namespace to the prefix `w` but also uses xml:space.
 */
export function buildMessyCommentDocx() {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}" xmlns:w16cid="${W16CID}">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve">The </w:t></w:r>
      <w:commentRangeStart w:id="0" w16cid:durableId="1846271"/>
      <w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">niche </w:t></w:r>
      <w:r><w:t xml:space="preserve">A&amp;B</w:t></w:r>
      <w:r><w:tab/><w:t>expansion</w:t></w:r>
      <w:commentRangeEnd w:id="0"/>
      <w:r><w:commentReference w:id="0"/></w:r>
      <w:r><w:t xml:space="preserve"> was measured.</w:t></w:r>
    </w:p>
  </w:body>
</w:document>`;

  const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="${W}">
  <w:comment w:id="0" w:author="Reviewer 2" w:date="2026-01-02T00:00:00Z">
    <w:p><w:r><w:t>Define &quot;niche&quot; here.</w:t></w:r></w:p>
  </w:comment>
</w:comments>`;

  return writeZip({
    '[Content_Types].xml': contentTypes({ comments: true }),
    '_rels/.rels': rootRels(),
    'word/_rels/document.xml.rels': documentRels({ comments: true }),
    'word/document.xml': documentXml,
    'word/comments.xml': commentsXml,
  });
}

/**
 * The WordprocessingML namespace bound to a non-`w` prefix. A reader that
 * hardcodes the literal `w:` prefix extracts nothing; a reader that matches
 * by namespace URI + local name extracts the text and the comment marker.
 */
export function buildAltPrefixDocx() {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<x:document xmlns:x="${W}">
  <x:body>
    <x:p>
      <x:commentRangeStart x:id="0"/>
      <x:r><x:t>arable land cover dropped sharply</x:t></x:r>
      <x:commentRangeEnd x:id="0"/>
      <x:r><x:commentReference x:id="0"/></x:r>
    </x:p>
  </x:body>
</x:document>`;

  const commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<x:comments xmlns:x="${W}">
  <x:comment x:id="0" x:author="Reviewer 1" x:date="2026-01-03T00:00:00Z">
    <x:p><x:r><x:t>Quantify the drop.</x:t></x:r></x:p>
  </x:comment>
</x:comments>`;

  return writeZip({
    '[Content_Types].xml': contentTypes({ comments: true }),
    '_rels/.rels': rootRels(),
    'word/_rels/document.xml.rels': documentRels({ comments: true }),
    'word/document.xml': documentXml,
    'word/comments.xml': commentsXml,
  });
}

/**
 * Body text plus a footnote whose text lives in footnotes.xml. A reader that
 * only opens document.xml loses the footnote prose entirely.
 */
export function buildFootnoteDocx() {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${W}">
  <w:body>
    <w:p>
      <w:r><w:t xml:space="preserve">Temperature explained the most variance.</w:t></w:r>
      <w:r><w:footnoteReference w:id="2"/></w:r>
    </w:p>
  </w:body>
</w:document>`;

  const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="${W}">
  <w:footnote w:id="2">
    <w:p><w:r><w:t>Standardized by grid-cell area before fitting.</w:t></w:r></w:p>
  </w:footnote>
</w:footnotes>`;

  return writeZip({
    '[Content_Types].xml': contentTypes({ footnotes: true }),
    '_rels/.rels': rootRels(),
    'word/_rels/document.xml.rels': documentRels({ footnotes: true }),
    'word/document.xml': documentXml,
    'word/footnotes.xml': footnotesXml,
  });
}
