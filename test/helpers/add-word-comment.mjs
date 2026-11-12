/**
 * Add comments to an existing .docx the way Word stores them: a
 * commentRangeStart/End pair around the anchor text inside its paragraph, a
 * commentReference run after it, the comment body in word/comments.xml, and
 * the part registered in [Content_Types].xml and document.xml.rels. Replies
 * are threaded through word/commentsExtended.xml (w15:paraIdParent).
 *
 * Used to simulate a reviewer's round of comments on a docx docrev built.
 */
import AdmZip from 'adm-zip';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * @param {string} docxPath
 * @param {Array<{ anchor?: string, author: string, text: string, replyTo?: number }>} comments
 *   `anchor`: text inside one `<w:t>` of the body to wrap; `replyTo`: index of
 *   the comment this one replies to (shares its range).
 */
export function addWordComments(docxPath, comments) {
  const zip = new AdmZip(docxPath);
  let doc = zip.readAsText('word/document.xml');

  comments.forEach((c, id) => {
    if (c.replyTo !== undefined) return;
    const needle = esc(c.anchor);
    const at = doc.indexOf(needle);
    if (at === -1) throw new Error(`anchor not found in document.xml: ${c.anchor}`);
    // Split the run at the anchor: close the text and run, mark the range, reopen.
    const runStart = Math.max(doc.lastIndexOf('<w:r>', at), doc.lastIndexOf('<w:r ', at));
    const tOpenEnd = doc.indexOf('>', doc.lastIndexOf('<w:t', at)) + 1;
    const rPr = (doc.slice(runStart, tOpenEnd).match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
    const replies = comments.map((r, i) => (r.replyTo === id ? i : -1)).filter((i) => i !== -1);
    const ids = [id, ...replies];
    const before = doc.slice(tOpenEnd, at);
    const tClose = doc.indexOf('</w:t>', at);
    const after = doc.slice(at + needle.length, tClose);
    const run = (text) => `<w:r>${rPr}<w:t xml:space="preserve">${text}</w:t></w:r>`;
    const replacement =
      `${before}</w:t></w:r>` +
      ids.map((i) => `<w:commentRangeStart w:id="${i}"/>`).join('') +
      run(needle) +
      ids.map((i) => `<w:commentRangeEnd w:id="${i}"/><w:r><w:commentReference w:id="${i}"/></w:r>`).join('') +
      `<w:r>${rPr}<w:t xml:space="preserve">${after}`;
    doc = doc.slice(0, tOpenEnd) + replacement + doc.slice(tClose);
  });
  zip.updateFile('word/document.xml', Buffer.from(doc));

  const paraId = (i) => (0x10000000 + i).toString(16).toUpperCase();
  const commentsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w:comments xmlns:w="${W}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">` +
    comments
      .map(
        (c, i) =>
          `<w:comment w:id="${i}" w:author="${esc(c.author)}" w:date="2026-11-12T10:00:00Z">` +
          `<w:p w14:paraId="${paraId(i)}"><w:r><w:t xml:space="preserve">${esc(c.text)}</w:t></w:r></w:p></w:comment>`
      )
      .join('') +
    `</w:comments>`;
  zip.addFile('word/comments.xml', Buffer.from(commentsXml));

  const extended =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml">` +
    comments
      .map((c, i) =>
        c.replyTo === undefined
          ? `<w15:commentEx w15:paraId="${paraId(i)}" w15:done="0"/>`
          : `<w15:commentEx w15:paraId="${paraId(i)}" w15:paraIdParent="${paraId(c.replyTo)}" w15:done="0"/>`
      )
      .join('') +
    `</w15:commentsEx>`;
  zip.addFile('word/commentsExtended.xml', Buffer.from(extended));

  let types = zip.readAsText('[Content_Types].xml');
  if (!types.includes('/word/comments.xml')) {
    types = types.replace(
      '</Types>',
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
        '<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/></Types>'
    );
    zip.updateFile('[Content_Types].xml', Buffer.from(types));
  }
  let rels = zip.readAsText('word/_rels/document.xml.rels');
  if (!rels.includes('comments.xml')) {
    rels = rels.replace(
      '</Relationships>',
      '<Relationship Id="rIdDocrevComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>' +
        '<Relationship Id="rIdDocrevCommentsEx" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/></Relationships>'
    );
    zip.updateFile('word/_rels/document.xml.rels', Buffer.from(rels));
  }
  zip.writeZip(docxPath);
}
