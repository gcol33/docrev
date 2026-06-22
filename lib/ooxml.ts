/**
 * Parser-backed OOXML layer.
 *
 * A `.docx` is a zip of XML parts. Reading those parts with regexes breaks on
 * the variability real Word emits: marker elements carry attributes beyond
 * `w:id`, anchor text spans many runs, the WordprocessingML namespace can be
 * bound to a prefix other than `w`, runs are separated by `<w:tab/>`/`<w:br/>`,
 * and prose lives in parts other than `document.xml` (footnotes, endnotes,
 * headers, footers).
 *
 * This module tokenizes the XML structurally and walks it once into an ordered
 * flow of paragraphs, runs, text, track-change spans, and comment-range
 * markers. Every reader (text extraction, comment anchors, headings) and the
 * comment injector derive from that single walk — there is no second engine to
 * drift from.
 */

import AdmZip from 'adm-zip';

export const WML_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

// =============================================================================
// Package access
// =============================================================================

/** Open a `.docx` package. Throws a clear error if it is not a valid zip. */
export function openDocx(docxPath: string): AdmZip {
  try {
    return new AdmZip(docxPath);
  } catch (err: any) {
    throw new Error(`Invalid Word document (not a valid .docx file): ${err.message}`);
  }
}

/** Read a single part as UTF-8 text, or `null` when the part is absent. */
export function readPartText(zip: AdmZip, partName: string): string | null {
  const entry = zip.getEntry(partName);
  if (!entry) return null;
  return entry.getData().toString('utf8');
}

/**
 * The WordprocessingML parts that carry running prose, in reading order:
 * the main story first, then footnotes, endnotes, headers, and footers.
 * A reader that opens only `document.xml` loses everything else.
 */
export function listProseParts(zip: AdmZip): string[] {
  const parts: string[] = [];
  if (zip.getEntry('word/document.xml')) parts.push('word/document.xml');
  for (const fixed of ['word/footnotes.xml', 'word/endnotes.xml']) {
    if (zip.getEntry(fixed)) parts.push(fixed);
  }
  const headerFooter = zip
    .getEntries()
    .map((e) => e.entryName)
    .filter((name) => /^word\/(header|footer)\d*\.xml$/.test(name))
    .sort();
  parts.push(...headerFooter);
  return parts;
}

// =============================================================================
// Entity coding
// =============================================================================

/** Decode the XML entities that appear in `.docx` text and attribute values. */
export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, '&'); // ampersand last so decoded text is not re-decoded
}

/** Encode text for placement inside an XML element (`<w:t>`). */
export function encodeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Encode text for placement inside a double-quoted XML attribute value. */
export function encodeXmlAttr(text: string): string {
  return encodeXmlText(text).replace(/"/g, '&quot;');
}

// =============================================================================
// Tokenizer
// =============================================================================

export interface XmlAttr {
  /** Qualified name as written, e.g. `w:id`. */
  name: string;
  prefix: string;
  local: string;
  /** Entity-decoded value. */
  value: string;
}

export type XmlTokenKind =
  | 'open'
  | 'close'
  | 'selfclose'
  | 'text'
  | 'comment'
  | 'cdata'
  | 'decl'
  | 'pi';

export interface XmlToken {
  kind: XmlTokenKind;
  /** Byte offset of `<` (or text start) in the source. */
  start: number;
  /** Byte offset just past `>` (or text end) in the source. */
  end: number;
  /** Exact source slice [start, end). */
  raw: string;
  name?: string;
  prefix?: string;
  local?: string;
  attrs?: XmlAttr[];
  /** Entity-decoded text, for `text` and `cdata` tokens. */
  text?: string;
}

function splitQName(name: string): { prefix: string; local: string } {
  const colon = name.indexOf(':');
  return colon === -1
    ? { prefix: '', local: name }
    : { prefix: name.slice(0, colon), local: name.slice(colon + 1) };
}

const WS = /\s/;

function parseTag(raw: string, start: number, end: number): XmlToken {
  const isClose = raw.startsWith('</');
  const selfClose = !isClose && raw.endsWith('/>');
  const body = raw.slice(isClose ? 2 : 1, selfClose ? raw.length - 2 : raw.length - 1);

  let p = 0;
  while (p < body.length && !WS.test(body[p]!) && body[p] !== '/') p++;
  const name = body.slice(0, p);
  const { prefix, local } = splitQName(name);

  const attrs: XmlAttr[] = [];
  while (p < body.length) {
    while (p < body.length && WS.test(body[p]!)) p++;
    if (p >= body.length) break;
    const nameStart = p;
    while (p < body.length && body[p] !== '=' && !WS.test(body[p]!)) p++;
    const attrName = body.slice(nameStart, p);
    while (p < body.length && WS.test(body[p]!)) p++;
    if (body[p] !== '=') {
      // Valueless attribute (not used by WML, but keep the lexer honest).
      if (attrName) {
        const q = splitQName(attrName);
        attrs.push({ name: attrName, prefix: q.prefix, local: q.local, value: '' });
      }
      continue;
    }
    p++; // skip '='
    while (p < body.length && WS.test(body[p]!)) p++;
    const quote = body[p];
    let value = '';
    if (quote === '"' || quote === "'") {
      p++;
      const valueStart = p;
      while (p < body.length && body[p] !== quote) p++;
      value = body.slice(valueStart, p);
      p++; // skip closing quote
    } else {
      const valueStart = p;
      while (p < body.length && !WS.test(body[p]!)) p++;
      value = body.slice(valueStart, p);
    }
    const q = splitQName(attrName);
    attrs.push({ name: attrName, prefix: q.prefix, local: q.local, value: decodeXmlEntities(value) });
  }

  return {
    kind: isClose ? 'close' : selfClose ? 'selfclose' : 'open',
    start,
    end,
    raw,
    name,
    prefix,
    local,
    attrs,
  };
}

/**
 * Tokenize an XML string into an ordered, offset-tagged token stream.
 * Quote-aware so a raw `>` inside an attribute value does not end a tag early.
 */
export function tokenizeXml(xml: string): XmlToken[] {
  const tokens: XmlToken[] = [];
  const n = xml.length;
  let i = 0;

  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      tokens.push({ kind: 'text', start: i, end: n, raw: xml.slice(i, n), text: decodeXmlEntities(xml.slice(i, n)) });
      break;
    }
    if (lt > i) {
      tokens.push({ kind: 'text', start: i, end: lt, raw: xml.slice(i, lt), text: decodeXmlEntities(xml.slice(i, lt)) });
    }

    if (xml.startsWith('<!--', lt)) {
      const close = xml.indexOf('-->', lt + 4);
      const end = close === -1 ? n : close + 3;
      tokens.push({ kind: 'comment', start: lt, end, raw: xml.slice(lt, end) });
      i = end;
      continue;
    }
    if (xml.startsWith('<![CDATA[', lt)) {
      const close = xml.indexOf(']]>', lt + 9);
      const end = close === -1 ? n : close + 3;
      tokens.push({
        kind: 'cdata',
        start: lt,
        end,
        raw: xml.slice(lt, end),
        text: xml.slice(lt + 9, close === -1 ? n : close),
      });
      i = end;
      continue;
    }
    if (xml.startsWith('<?', lt)) {
      const close = xml.indexOf('?>', lt + 2);
      const end = close === -1 ? n : close + 2;
      tokens.push({ kind: xml.startsWith('<?xml', lt) ? 'decl' : 'pi', start: lt, end, raw: xml.slice(lt, end) });
      i = end;
      continue;
    }

    // Element tag: find the closing '>' that is not inside a quoted value.
    let j = lt + 1;
    let quote = '';
    while (j < n) {
      const ch = xml[j];
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '>') {
        break;
      }
      j++;
    }
    const end = j < n ? j + 1 : n;
    tokens.push(parseTag(xml.slice(lt, end), lt, end));
    i = end;
  }

  return tokens;
}

// =============================================================================
// Namespace resolution
// =============================================================================

export interface NsContext {
  uriForPrefix(prefix: string): string | undefined;
  /** True when an element token lives in the WordprocessingML namespace. */
  isWml(token: XmlToken): boolean;
  /** Value of the WML-namespaced attribute with the given local name, if present. */
  wmlAttr(token: XmlToken, local: string): string | undefined;
}

/**
 * Build a namespace context from a token stream. Declarations are read from
 * every element (the root carries them in practice), so the WML namespace is
 * matched by URI rather than by assuming the `w` prefix.
 */
export function resolveNamespaces(tokens: XmlToken[]): NsContext {
  const prefixToUri = new Map<string, string>();
  for (const tok of tokens) {
    if (tok.kind !== 'open' && tok.kind !== 'selfclose') continue;
    for (const attr of tok.attrs ?? []) {
      if (attr.name === 'xmlns') prefixToUri.set('', attr.value);
      else if (attr.prefix === 'xmlns') prefixToUri.set(attr.local, attr.value);
    }
  }

  const uriForPrefix = (prefix: string) => prefixToUri.get(prefix);
  const isWml = (token: XmlToken) => prefixToUri.get(token.prefix ?? '') === WML_NS;
  const wmlAttr = (token: XmlToken, local: string) => {
    for (const attr of token.attrs ?? []) {
      if (attr.local !== local) continue;
      // An unprefixed attribute is in no namespace; a prefixed one resolves
      // through the same table. Marker ids share their element's prefix.
      if (attr.prefix === '' || prefixToUri.get(attr.prefix) === WML_NS) return attr.value;
    }
    return undefined;
  };

  return { uriForPrefix, isWml, wmlAttr };
}

// =============================================================================
// Ordered document flow
// =============================================================================

export type FlowItem =
  | { kind: 'text'; text: string }
  | { kind: 'paraStart'; style: string | null; level: number; xmlStart: number }
  | { kind: 'paraEnd' }
  | { kind: 'runStart'; xmlStart: number; xmlContentStart: number }
  | { kind: 'runEnd'; xmlEnd: number }
  | { kind: 'commentStart'; id: string; xmlStart: number; xmlEnd: number }
  | { kind: 'commentEnd'; id: string; xmlStart: number; xmlEnd: number }
  | { kind: 'commentRef'; id: string }
  | { kind: 'insStart' }
  | { kind: 'insEnd' }
  | { kind: 'delStart' }
  | { kind: 'delEnd' };

/**
 * Walk a part's XML once into an ordered flow. Text-bearing items appear in
 * document order interleaved with paragraph, run, track-change, and
 * comment-range boundaries, each tagged with the source offsets a later
 * injection step needs.
 */
export function walkBody(xml: string, ns?: NsContext): FlowItem[] {
  const tokens = tokenizeXml(xml);
  const nsCtx = ns ?? resolveNamespaces(tokens);
  const flow: FlowItem[] = [];

  // Track nesting so content is read precisely: literal text only counts
  // inside `<w:t>`/`<w:delText>` (never `<w:instrText>` field codes), and
  // `<w:tab/>`/`<w:br/>` only count inside a run (never a `<w:pPr>` tab-stop
  // definition).
  let runDepth = 0;
  let inPPr = 0;
  let textDepth = 0;
  let currentPara: Extract<FlowItem, { kind: 'paraStart' }> | null = null;

  const local = (t: XmlToken) => (nsCtx.isWml(t) ? t.local : undefined);

  for (let idx = 0; idx < tokens.length; idx++) {
    const tok = tokens[idx]!;

    if (tok.kind === 'text') {
      if (textDepth > 0 && tok.text) flow.push({ kind: 'text', text: tok.text });
      continue;
    }
    if (tok.kind === 'cdata') {
      if (textDepth > 0 && tok.text) flow.push({ kind: 'text', text: tok.text });
      continue;
    }
    if (tok.kind !== 'open' && tok.kind !== 'close' && tok.kind !== 'selfclose') continue;

    const ln = local(tok);
    if (ln === undefined) continue;

    if (tok.kind === 'open') {
      switch (ln) {
        case 'p':
          currentPara = { kind: 'paraStart', style: null, level: 0, xmlStart: tok.start };
          flow.push(currentPara);
          break;
        case 'pPr':
          inPPr++;
          break;
        case 't':
        case 'delText':
          textDepth++;
          break;
        case 'r':
          runDepth++;
          flow.push({ kind: 'runStart', xmlStart: tok.start, xmlContentStart: tok.end });
          break;
        case 'ins':
          flow.push({ kind: 'insStart' });
          break;
        case 'del':
          flow.push({ kind: 'delStart' });
          break;
        default:
          break;
      }
    } else if (tok.kind === 'close') {
      switch (ln) {
        case 'p':
          flow.push({ kind: 'paraEnd' });
          currentPara = null;
          break;
        case 'pPr':
          if (inPPr > 0) inPPr--;
          break;
        case 't':
        case 'delText':
          if (textDepth > 0) textDepth--;
          break;
        case 'r':
          if (runDepth > 0) runDepth--;
          flow.push({ kind: 'runEnd', xmlEnd: tok.start });
          break;
        case 'ins':
          flow.push({ kind: 'insEnd' });
          break;
        case 'del':
          flow.push({ kind: 'delEnd' });
          break;
        default:
          break;
      }
    } else {
      // self-close
      switch (ln) {
        case 'pStyle': {
          const val = nsCtx.wmlAttr(tok, 'val');
          if (currentPara && inPPr > 0 && val) {
            currentPara.style = val;
            const m = val.match(/(\d+)/);
            if (/heading/i.test(val)) currentPara.level = m ? parseInt(m[1]!, 10) : 0;
          }
          break;
        }
        case 'tab':
          if (runDepth > 0 && inPPr === 0) flow.push({ kind: 'text', text: '\t' });
          break;
        case 'br':
        case 'cr':
          if (runDepth > 0 && inPPr === 0) flow.push({ kind: 'text', text: '\n' });
          break;
        case 'commentRangeStart': {
          const id = nsCtx.wmlAttr(tok, 'id');
          if (id !== undefined) flow.push({ kind: 'commentStart', id, xmlStart: tok.start, xmlEnd: tok.end });
          break;
        }
        case 'commentRangeEnd': {
          const id = nsCtx.wmlAttr(tok, 'id');
          if (id !== undefined) flow.push({ kind: 'commentEnd', id, xmlStart: tok.start, xmlEnd: tok.end });
          break;
        }
        case 'commentReference': {
          const id = nsCtx.wmlAttr(tok, 'id');
          if (id !== undefined) flow.push({ kind: 'commentRef', id });
          break;
        }
        default:
          break;
      }
    }
  }

  return flow;
}

// =============================================================================
// Derived readers
// =============================================================================

export interface CommentRange {
  id: string;
  /** Concatenated anchor text between the range markers. */
  anchor: string;
  /** Start offset of the anchor in `text`. */
  start: number;
  /** End offset of the anchor in `text`. */
  end: number;
  /** True when the range encloses no text (a zero-width / point anchor). */
  isEmpty: boolean;
}

export interface DocTextModel {
  /** Plain text: runs concatenated, paragraphs joined with nothing between. */
  text: string;
  /** Comment ranges with offsets into `text`. */
  comments: CommentRange[];
  /** Heading paragraphs with their offset into `text`. */
  headings: Array<{ style: string; level: number; text: string; position: number }>;
}

/**
 * Build the plain-text model used for comment-anchor matching. Runs are
 * concatenated and paragraphs are joined with no separator, matching the
 * coordinate system the placement engine expects, but namespace-aware and
 * robust to marker-attribute variation and multi-run anchors.
 */
export function buildDocTextModel(xml: string): DocTextModel {
  const flow = walkBody(xml);
  let text = '';
  const startOffsets = new Map<string, number>();
  const endOffsets = new Map<string, number>();
  const comments: CommentRange[] = [];
  const headings: DocTextModel['headings'] = [];

  let paraStartOffset = 0;
  let paraStyle: string | null = null;
  let paraLevel = 0;
  let paraText = '';

  for (const item of flow) {
    switch (item.kind) {
      case 'text':
        text += item.text;
        paraText += item.text;
        break;
      case 'paraStart':
        paraStartOffset = text.length;
        paraStyle = item.style;
        paraLevel = item.level;
        paraText = '';
        break;
      case 'paraEnd':
        if (paraStyle && /heading/i.test(paraStyle) && paraText.trim()) {
          headings.push({ style: paraStyle, level: paraLevel, text: paraText.trim(), position: paraStartOffset });
        }
        break;
      case 'commentStart':
        if (!startOffsets.has(item.id)) startOffsets.set(item.id, text.length);
        break;
      case 'commentEnd':
        if (!endOffsets.has(item.id)) endOffsets.set(item.id, text.length);
        break;
      default:
        break;
    }
  }

  // The paragraph style can be set after `paraStart` (pStyle lives early in
  // the paragraph), so headings are recorded at paraEnd above.

  for (const [id, start] of startOffsets) {
    const end = endOffsets.get(id);
    if (end === undefined) continue;
    const anchor = text.slice(start, Math.max(start, end));
    comments.push({ id, anchor: anchor.trim(), start, end: Math.max(start, end), isEmpty: !anchor.trim() });
  }

  return { text, comments, headings };
}

// =============================================================================
// Run index (for comment injection)
// =============================================================================

export interface TextRunSlot {
  /** Source offset of the enclosing run's `<w:r>`. */
  runOpenStart: number;
  /** Source offset just past the enclosing run's `</w:r>`. */
  runCloseEnd: number;
  /** Raw `<w:rPr>...</w:rPr>` of the enclosing run, or '' when it has none. */
  rPr: string;
  /** Raw opening `<w:t ...>` tag of this text element. */
  tOpenTag: string;
  /** Source offset just past `<w:t ...>`. */
  contentStart: number;
  /** Source offset of `</w:t>`. */
  contentEnd: number;
  /** Raw (still XML-encoded) text between the `<w:t>` tags. */
  content: string;
}

interface RunFrame {
  openStart: number;
  rPr: string;
  rPrOpenStart: number;
  pending: TextRunSlot[];
}

/**
 * Index every `<w:t>` text element with its enclosing run's exact boundaries
 * and run properties, derived from the token nesting rather than by scanning
 * backwards for the nearest `<w:r`. This locates the correct run even when the
 * text sits inside a hyperlink, a field, or an `mc:AlternateContent` block, and
 * naturally ignores marker-like text that lives in attributes (it is not inside
 * a `<w:t>`).
 */
export function indexTextRuns(xml: string): TextRunSlot[] {
  const tokens = tokenizeXml(xml);
  const ns = resolveNamespaces(tokens);
  const slots: TextRunSlot[] = [];
  const runStack: RunFrame[] = [];

  let tOpenTag = '';
  let tContentStart = -1;
  let inT = false;

  for (const tok of tokens) {
    if (tok.kind === 'open' || tok.kind === 'close' || tok.kind === 'selfclose') {
      const ln = ns.isWml(tok) ? tok.local : undefined;
      const top = runStack[runStack.length - 1];

      if (tok.kind === 'open') {
        if (ln === 'r') {
          runStack.push({ openStart: tok.start, rPr: '', rPrOpenStart: -1, pending: [] });
        } else if (ln === 'rPr' && top) {
          top.rPrOpenStart = tok.start;
        } else if (ln === 't' && top) {
          tOpenTag = tok.raw;
          tContentStart = tok.end;
          inT = true;
        }
      } else if (tok.kind === 'close') {
        if (ln === 'rPr' && top && top.rPrOpenStart >= 0) {
          top.rPr = xml.slice(top.rPrOpenStart, tok.end);
          top.rPrOpenStart = -1;
        } else if (ln === 't' && top && inT) {
          top.pending.push({
            runOpenStart: top.openStart,
            runCloseEnd: -1,
            rPr: top.rPr,
            tOpenTag,
            contentStart: tContentStart,
            contentEnd: tok.start,
            content: xml.slice(tContentStart, tok.start),
          });
          inT = false;
        } else if (ln === 'r') {
          const frame = runStack.pop();
          if (frame) {
            for (const slot of frame.pending) {
              slot.runCloseEnd = tok.end;
              slots.push(slot);
            }
          }
        }
      }
    }
  }

  slots.sort((a, b) => a.contentStart - b.contentStart);
  return slots;
}

// =============================================================================
// Comment bodies + threading
// =============================================================================

export interface ExtractedComment {
  id: string;
  author: string;
  /** Full ISO date string as written, or '' when absent. */
  date: string;
  text: string;
  /** Parent comment id for a reply, resolved from commentsExtended.xml. */
  parentId?: string;
}

/** First attribute with the given local name, regardless of namespace prefix. */
function attrByLocal(token: XmlToken, local: string): string | undefined {
  for (const attr of token.attrs ?? []) {
    if (attr.local === local) return attr.value;
  }
  return undefined;
}

/**
 * Extract comment bodies from `word/comments.xml` and reply threading from
 * `word/commentsExtended.xml`. Structural elements are matched by local name
 * in the WordprocessingML namespace, so a document that binds WML to a prefix
 * other than `w` still yields its comments.
 */
export function extractComments(zip: AdmZip): ExtractedComment[] {
  const commentsXml = readPartText(zip, 'word/comments.xml');
  if (commentsXml === null) return [];

  const tokens = tokenizeXml(commentsXml);
  const ns = resolveNamespaces(tokens);
  const wmlLocal = (t: XmlToken) => (ns.isWml(t) ? t.local : undefined);

  const comments: ExtractedComment[] = [];
  const paraIdToCommentId = new Map<string, string>();

  let current: ExtractedComment | null = null;
  let textDepth = 0;

  for (const tok of tokens) {
    if (tok.kind === 'text' || tok.kind === 'cdata') {
      if (current && textDepth > 0 && tok.text) current.text += tok.text;
      continue;
    }
    const ln =
      tok.kind === 'open' || tok.kind === 'close' || tok.kind === 'selfclose'
        ? wmlLocal(tok)
        : undefined;
    if (ln === undefined) continue;

    // Word stores the threading key (w14:paraId) on each comment paragraph;
    // a reply's second paragraph is an empty self-closed <w:p/>, so read it on
    // open and self-close alike.
    if ((tok.kind === 'open' || tok.kind === 'selfclose') && ln === 'p' && current) {
      const paraId = attrByLocal(tok, 'paraId');
      if (paraId && current.id) paraIdToCommentId.set(paraId, current.id);
    }

    if (tok.kind === 'open') {
      if (ln === 'comment') {
        current = {
          id: ns.wmlAttr(tok, 'id') ?? '',
          author: ns.wmlAttr(tok, 'author') ?? 'Unknown',
          date: ns.wmlAttr(tok, 'date') ?? '',
          text: '',
        };
      } else if ((ln === 't' || ln === 'delText') && current) {
        textDepth++;
      }
    } else if (tok.kind === 'close') {
      if (ln === 'comment' && current) {
        current.text = current.text.trim();
        comments.push(current);
        current = null;
        textDepth = 0;
      } else if ((ln === 't' || ln === 'delText') && textDepth > 0) {
        textDepth--;
      }
    }
  }

  // Resolve reply links from commentsExtended.xml (absent for non-Word sources).
  const extendedXml = readPartText(zip, 'word/commentsExtended.xml');
  if (extendedXml && paraIdToCommentId.size > 0) {
    const parentByCommentId = new Map<string, string>();
    for (const tok of tokenizeXml(extendedXml)) {
      if (tok.kind !== 'selfclose' && tok.kind !== 'open') continue;
      if (tok.local !== 'commentEx') continue;
      const paraId = attrByLocal(tok, 'paraId');
      const parentParaId = attrByLocal(tok, 'paraIdParent');
      if (!paraId || !parentParaId) continue;
      const childId = paraIdToCommentId.get(paraId);
      const parentId = paraIdToCommentId.get(parentParaId);
      if (childId && parentId && childId !== parentId) {
        parentByCommentId.set(childId, parentId);
      }
    }
    for (const c of comments) {
      const parent = parentByCommentId.get(c.id);
      if (parent) c.parentId = parent;
    }
  }

  return comments;
}

/** Parts that can carry comment ranges, in reading order. */
export const COMMENT_PARTS = ['word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'];

/**
 * Comment ranges across every part that can hold them — not just
 * `document.xml`, so a comment anchored in a footnote or endnote is found
 * rather than silently lost. Positions are offsets into the concatenated
 * `fullDocText`.
 */
export function buildCommentAnchorModel(zip: AdmZip): { fullDocText: string; comments: CommentRange[] } {
  let fullDocText = '';
  const comments: CommentRange[] = [];
  for (const part of COMMENT_PARTS) {
    const xml = readPartText(zip, part);
    if (xml === null) continue;
    const model = buildDocTextModel(xml);
    const offset = fullDocText.length;
    fullDocText += model.text;
    for (const c of model.comments) {
      comments.push({ id: c.id, anchor: c.anchor, start: c.start + offset, end: c.end + offset, isEmpty: c.isEmpty });
    }
  }
  return { fullDocText, comments };
}
