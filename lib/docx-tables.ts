/**
 * DOCX table layout.
 *
 * Pandoc writes every table with a fixed grid whose widths come from the
 * markdown source (dash counts of a pipe table, or equal shares) and sum to
 * 5.5 in, whatever the page. Word stretches such a table to the page; Google
 * Docs and LibreOffice keep the grid as written, so narrow columns break words
 * mid-word and wide ones wrap after a few words. The header rule pandoc relies
 * on lives in a table style, which Google Docs ignores.
 *
 * This pass sizes each column from its content (the longest word sets the
 * minimum, the cell text the preferred width), fills the text width of the
 * page, and writes the rules (top, bottom, below the header) and the cell font
 * size directly on the table, so every reader renders the same table.
 */

import * as fs from 'fs';
import AdmZip from 'adm-zip';
import { tokenizeXml, resolveNamespaces, encodeXmlAttr, type XmlToken, type NsContext } from './ooxml.js';

export interface DocxTableLayoutOptions {
  /** Cell font sizes to try, largest first (pt). The first that fits every word is used. */
  fontSizes?: number[];
}

const DEFAULT_FONT_SIZES = [10, 9, 8];
/** Text width of a Letter page with 1 in margins, used when the document has no section properties. */
const DEFAULT_TEXT_WIDTH = 9360;
/** Horizontal cell padding (both sides, twips). */
const CELL_PAD = 220;
/** Average glyph width as a fraction of the font size. */
const GLYPH_WIDTH = 0.58;
/** Header text is often bold. */
const HEADER_GLYPH_FACTOR = 1.15;
/** A column never asks for more than this many characters per line. */
const PREFERRED_CHARS = 60;

const TBLPR_ORDER = [
  'tblStyle', 'tblpPr', 'tblOverlap', 'bidiVisual', 'tblStyleRowBandSize', 'tblStyleColBandSize',
  'tblW', 'jc', 'tblCellSpacing', 'tblInd', 'tblBorders', 'shd', 'tblLayout', 'tblCellMar',
  'tblLook', 'tblCaption', 'tblDescription',
];
const TCPR_ORDER = [
  'cnfStyle', 'tcW', 'gridSpan', 'hMerge', 'vMerge', 'tcBorders', 'shd', 'noWrap', 'tcMar',
  'textDirection', 'tcFitText', 'vAlign', 'hideMark',
];
const RPR_ORDER = [
  'rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps', 'strike', 'dstrike', 'outline',
  'shadow', 'emboss', 'imprint', 'noProof', 'snapToGrid', 'vanish', 'webHidden', 'color', 'spacing',
  'w', 'kern', 'position', 'sz', 'szCs', 'highlight', 'u', 'effect', 'bdr', 'shd', 'fitText',
  'vertAlign', 'rtl', 'cs', 'em', 'lang', 'eastAsianLayout', 'specVanish', 'oMath',
];

interface ElNode {
  kind: 'el';
  open: XmlToken;
  close?: XmlToken;
  children: XNode[];
  /** Replacement markup; when set, serialisation emits it instead of the element. */
  replaced?: string;
}
interface LeafNode {
  kind: 'leaf';
  tok: XmlToken;
}
/** Markup inserted by this pass. */
interface RawNode {
  kind: 'raw';
  text: string;
}
type XNode = ElNode | LeafNode | RawNode;

/** Build the element tree of tokens[from..] up to the close of the element opened at `from`. */
function buildElement(tokens: XmlToken[], from: number): { node: ElNode; next: number } {
  const open = tokens[from];
  const node: ElNode = { kind: 'el', open, children: [] };
  if (open.kind === 'selfclose') return { node, next: from + 1 };
  let i = from + 1;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.kind === 'close') {
      node.close = tok;
      return { node, next: i + 1 };
    }
    if (tok.kind === 'open' || tok.kind === 'selfclose') {
      const child = buildElement(tokens, i);
      node.children.push(child.node);
      i = child.next;
    } else {
      node.children.push({ kind: 'leaf', tok });
      i++;
    }
  }
  return { node, next: i };
}

function serialize(node: XNode): string {
  if (node.kind === 'leaf') return node.tok.raw;
  if (node.kind === 'raw') return node.text;
  if (node.replaced !== undefined) return node.replaced;
  if (node.open.kind === 'selfclose' && node.children.length === 0) return node.open.raw;
  return wrap(node, node.children.map(serialize).join(''));
}

/** The element's own tags around new content; a self-closing tag is reopened as a container. */
function wrap(node: ElNode, inner: string): string {
  const name = node.open.name ?? '';
  const attrs = (node.open.attrs ?? []).map(a => ` ${a.name}="${encodeXmlAttr(a.value)}"`).join('');
  const openRaw = node.open.kind === 'selfclose' ? `<${name}${attrs}>` : node.open.raw;
  const closeRaw = node.close ? node.close.raw : `</${name}>`;
  return openRaw + inner + closeRaw;
}

class TableContext {
  constructor(private ns: NsContext, private prefix: string) {}

  is(node: XNode, local: string): node is ElNode {
    return node.kind === 'el' && this.ns.isWml(node.open) && node.open.local === local;
  }

  kids(node: ElNode, local: string): ElNode[] {
    return node.children.filter((c): c is ElNode => this.is(c, local));
  }

  kid(node: ElNode, local: string): ElNode | undefined {
    return this.kids(node, local)[0];
  }

  /** Every descendant element with the given WML local name, document order. */
  descendants(node: ElNode, local: string, out: ElNode[] = []): ElNode[] {
    for (const c of node.children) {
      if (c.kind !== 'el') continue;
      if (this.is(c, local)) out.push(c);
      this.descendants(c, local, out);
    }
    return out;
  }

  q(local: string): string {
    return this.prefix ? `${this.prefix}:${local}` : local;
  }

  el(local: string, attrs: Record<string, string | number> = {}, inner?: string): string {
    const a = Object.entries(attrs).map(([k, v]) => ` ${this.q(k)}="${v}"`).join('');
    return inner === undefined ? `<${this.q(local)}${a}/>` : `<${this.q(local)}${a}>${inner}</${this.q(local)}>`;
  }

  border(side: string, size: number): string {
    return size > 0
      ? this.el(side, { val: 'single', sz: size, space: 0, color: '000000' })
      : this.el(side, { val: 'nil' });
  }

  /**
   * Replace the property children named in `set` (null removes one), keep the
   * others, and write them back in schema order.
   */
  setProps(node: ElNode, order: string[], set: Record<string, string | null>): void {
    const kept: { local: string; raw: string; pos: number }[] = [];
    node.children.forEach((c, pos) => {
      if (c.kind === 'raw') {
        kept.push({ local: '', raw: c.text, pos });
        return;
      }
      if (c.kind !== 'el') return;
      const local = c.open.local ?? '';
      if (this.ns.isWml(c.open) && local in set) return;
      kept.push({ local, raw: serialize(c), pos });
    });
    for (const [local, raw] of Object.entries(set)) {
      if (raw !== null) kept.push({ local, raw, pos: -1 });
    }
    const rank = (local: string) => {
      const r = order.indexOf(local);
      return r === -1 ? order.length : r;
    };
    kept.sort((a, b) => rank(a.local) - rank(b.local) || a.pos - b.pos);
    node.replaced = wrap(node, kept.map(k => k.raw).join(''));
  }

  text(node: ElNode): string {
    let s = '';
    const walk = (n: XNode, inText: boolean) => {
      if (n.kind === 'raw') return;
      if (n.kind === 'leaf') {
        if (inText && (n.tok.kind === 'text' || n.tok.kind === 'cdata')) s += n.tok.text ?? '';
        return;
      }
      const isT = n.open.local === 't';
      n.children.forEach(c => walk(c, inText || isT));
    };
    walk(node, false);
    return s;
  }
}

function onOff(node: ElNode | undefined, ns: NsContext): boolean {
  if (!node) return false;
  const v = ns.wmlAttr(node.open, 'val');
  return v === undefined || !['0', 'false', 'off'].includes(v);
}

/** Text width of the page in twips, from the last section's page size and margins. */
export function textWidthTwips(xml: string): number {
  const tokens = tokenizeXml(xml);
  const ns = resolveNamespaces(tokens);
  let width: number | undefined;
  let left = 0;
  let right = 0;
  for (const tok of tokens) {
    if ((tok.kind !== 'open' && tok.kind !== 'selfclose') || !ns.isWml(tok)) continue;
    if (tok.local === 'pgSz') {
      const w = Number(ns.wmlAttr(tok, 'w'));
      if (Number.isFinite(w) && w > 0) width = w;
    } else if (tok.local === 'pgMar') {
      left = Number(ns.wmlAttr(tok, 'left')) || 0;
      right = Number(ns.wmlAttr(tok, 'right')) || 0;
    }
  }
  if (width === undefined) return DEFAULT_TEXT_WIDTH;
  const text = width - left - right;
  return text > 0 ? text : DEFAULT_TEXT_WIDTH;
}

interface CellInfo {
  node: ElNode;
  col: number;
  span: number;
  text: string;
}

/**
 * Column widths (twips) that fill `textWidth`: each column gets at least its
 * longest word, then the spare width goes to columns in proportion to how
 * much more their text asks for.
 */
export function columnWidths(
  rows: { cells: { col: number; span: number; text: string }[]; header: boolean }[],
  ncol: number,
  textWidth: number,
  fontSizes: number[] = DEFAULT_FONT_SIZES,
): { widths: number[]; fontSize: number } {
  const measure = (size: number) => {
    const glyph = size * GLYPH_WIDTH * 20;
    const need = Array(ncol).fill(CELL_PAD + 3 * glyph);
    const want = [...need];
    for (const row of rows) {
      const g = row.header ? glyph * HEADER_GLYPH_FACTOR : glyph;
      for (const cell of row.cells) {
        if (cell.span !== 1 || cell.col >= ncol) continue;
        const txt = cell.text.trim();
        if (!txt) continue;
        const longest = Math.max(...txt.split(/\s+/).map(w => [...w].length));
        need[cell.col] = Math.max(need[cell.col], CELL_PAD + longest * g);
        if (!row.header) {
          want[cell.col] = Math.max(want[cell.col], CELL_PAD + Math.min([...txt].length, PREFERRED_CHARS) * g);
        }
      }
    }
    return { need, want };
  };

  const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
  let fontSize = fontSizes[fontSizes.length - 1];
  let m = measure(fontSize);
  for (const size of fontSizes) {
    const candidate = measure(size);
    if (sum(candidate.need) <= textWidth) {
      fontSize = size;
      m = candidate;
      break;
    }
  }

  let widths: number[];
  const need = m.need;
  const want = m.want.map((w, j) => Math.max(w, need[j]));
  if (sum(need) >= textWidth) {
    widths = need.map(n => (n * textWidth) / sum(need));
  } else if (sum(want) <= textWidth) {
    widths = want.map(w => (w * textWidth) / sum(want));
  } else {
    const spare = textWidth - sum(need);
    const extra = want.map((w, j) => w - need[j]);
    widths = need.map((n, j) => n + (spare * extra[j]) / sum(extra));
  }

  const rounded = widths.map(w => Math.floor(w));
  rounded[ncol - 1] += textWidth - sum(rounded);
  return { widths: rounded, fontSize };
}

function layoutTable(tbl: ElNode, ctx: TableContext, ns: NsContext, textWidth: number, fontSizes: number[]): void {
  const rowNodes = ctx.kids(tbl, 'tr');
  if (rowNodes.length === 0) return;

  const marked = rowNodes.map(tr => {
    const trPr = ctx.kid(tr, 'trPr');
    return onOff(trPr && ctx.kid(trPr, 'tblHeader'), ns);
  });
  const anyMarked = marked.some(Boolean);
  const rows = rowNodes.map((tr, i) => {
    let col = 0;
    const cells: CellInfo[] = ctx.kids(tr, 'tc').map(tc => {
      const tcPr = ctx.kid(tc, 'tcPr');
      const spanNode = tcPr ? ctx.kid(tcPr, 'gridSpan') : undefined;
      const span = Math.max(1, Number(spanNode ? ns.wmlAttr(spanNode.open, 'val') : 1) || 1);
      const info = { node: tc, col, span, text: ctx.text(tc) };
      col += span;
      return info;
    });
    return { cells, header: anyMarked ? marked[i] : i === 0, width: col };
  });

  const grid = ctx.kid(tbl, 'tblGrid');
  const ncol = (grid ? ctx.kids(grid, 'gridCol').length : 0) || Math.max(...rows.map(r => r.width));
  if (ncol === 0) return;

  const { widths, fontSize } = columnWidths(rows, ncol, textWidth, fontSizes);
  const halfPoints = Math.round(fontSize * 2);

  const tblPr = ctx.kid(tbl, 'tblPr');
  const tblPrSet = {
    tblW: ctx.el('tblW', { type: 'dxa', w: textWidth }),
    jc: null,
    tblInd: ctx.el('tblInd', { type: 'dxa', w: 0 }),
    tblBorders: ctx.el('tblBorders', {}, ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(side => ctx.border(side, side === 'top' || side === 'bottom' ? 8 : 0)).join('')),
    tblLayout: ctx.el('tblLayout', { type: 'fixed' }),
  };
  if (tblPr) ctx.setProps(tblPr, TBLPR_ORDER, tblPrSet);

  if (grid) {
    grid.replaced = ctx.el('tblGrid', {}, widths.map(w => ctx.el('gridCol', { w })).join(''));
  }

  for (const row of rows) {
    for (const cell of row.cells) {
      const w = widths.slice(cell.col, cell.col + cell.span).reduce((s, x) => s + x, 0);
      const set: Record<string, string | null> = { tcW: ctx.el('tcW', { type: 'dxa', w }) };
      if (row.header) set.tcBorders = ctx.el('tcBorders', {}, ctx.border('bottom', 6));
      const tcPr = ctx.kid(cell.node, 'tcPr');
      if (tcPr) {
        ctx.setProps(tcPr, TCPR_ORDER, set);
      } else {
        const order = TCPR_ORDER.filter(k => k in set);
        cell.node.children.unshift({ kind: 'raw', text: ctx.el('tcPr', {}, order.map(k => set[k]).join('')) });
      }
    }
  }

  const size = { sz: ctx.el('sz', { val: halfPoints }), szCs: ctx.el('szCs', { val: halfPoints }) };
  for (const r of ctx.descendants(tbl, 'r')) {
    const rPr = ctx.kid(r, 'rPr');
    if (rPr) {
      ctx.setProps(rPr, RPR_ORDER, size);
    } else {
      r.children.unshift({ kind: 'raw', text: ctx.el('rPr', {}, size.sz + size.szCs) });
    }
  }
}

/** Lay out every top-level table of a document.xml string. */
export function layoutTablesXml(xml: string, options: DocxTableLayoutOptions = {}): { xml: string; tables: number } {
  const tokens = tokenizeXml(xml);
  const ns = resolveNamespaces(tokens);
  const textWidth = textWidthTwips(xml);
  const fontSizes = options.fontSizes ?? DEFAULT_FONT_SIZES;

  const edits: { start: number; end: number; text: string }[] = [];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok.kind === 'open' && ns.isWml(tok) && tok.local === 'tbl') {
      const { node, next } = buildElement(tokens, i);
      const ctx = new TableContext(ns, tok.prefix ?? '');
      layoutTable(node, ctx, ns, textWidth, fontSizes);
      edits.push({ start: tok.start, end: node.close ? node.close.end : tok.end, text: serialize(node) });
      i = next;
    } else {
      i++;
    }
  }

  let out = xml;
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { xml: out, tables: edits.length };
}

/** Lay out the tables of a DOCX file in place. Returns the number of tables changed. */
export function layoutDocxTables(docxPath: string, options: DocxTableLayoutOptions = {}): number {
  const zip = new AdmZip(docxPath);
  const entry = zip.getEntry('word/document.xml');
  if (!entry) return 0;
  const { xml, tables } = layoutTablesXml(entry.getData().toString('utf8'), options);
  if (tables === 0) return 0;
  zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));
  fs.writeFileSync(docxPath, zip.toBuffer());
  return tables;
}
