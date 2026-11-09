#!/usr/bin/env node

/**
 * Builds docs/figures/docrev-hero.svg, the README's graphical abstract, from one
 * real docrev round trip:
 *
 *   1. A reviewer's copy of a short Methods section, written with CriticMarkup,
 *      is built with `docrev build docx --dual --show-changes`: a DOCX with Word
 *      tracked changes and a comment, as a reviewer would return it.
 *   2. The author's clean Methods section syncs that DOCX with `docrev sync`.
 *   3. LibreOffice renders the DOCX to PDF with the comment in the margin and
 *      pdftocairo converts the page to SVG.
 *   4. The figure sets the synced Markdown, as SVG text, beside the part of the
 *      Word page that carries text, on a white background.
 *
 * Needs LibreOffice (`soffice`, or $SOFFICE) and poppler (`pdftocairo`, or
 * $PDFTOCAIRO). Run from the repository root:
 *   node scripts/figures/hero.mjs
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createRequire } from 'module';
import { fileURLToPath, pathToFileURL } from 'url';
import AdmZip from 'adm-zip';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outFile = path.join(root, 'docs', 'figures', 'docrev-hero.svg');

const WIDTH = 1628;
const HEIGHT = 520;

const CARD = { top: 36, height: 448, radius: 14 };
const MD = { left: 48, width: 540, padding: 32, font: 22, lineHeight: 22 * 1.55, advance: 0.55 };
const WORD = { left: 762, width: 818, padding: 24, dpi: 220 };
const ARROW = { left: 600, width: 150, font: 44 };
const MONO = "Consolas, 'DejaVu Sans Mono', Menlo, 'Courier New', monospace";

const PALETTE = {
  paper: '#FFFFFF',
  ink: '#1F2933',
  blue: '#2E6F9E',
  red: '#B5342B',
  green: '#3F7A3D',
  purple: '#7A4F9E',
  grey: '#5C6166',
  mark: '#FBEFB3',
};

const TITLE = 'Alpine plant survey';

const REVIEWED = `# Methods

Along {>>Reviewer 2: How were plots placed?<<}[three elevation gradients]{.mark} in the Austrian Alps, we surveyed {--100--}{++150++} plots. Each plot was visited {~~once~>twice~~} per season, and every vascular plant species was recorded.
`;

const ORIGINAL = `# Methods

Along three elevation gradients in the Austrian Alps, we surveyed 100 plots. Each plot was visited once per season, and every vascular plant species was recorded.
`;

function findTool(envVar, candidates) {
  const fromEnv = process.env[envVar];
  if (fromEnv) return fromEnv;
  for (const candidate of candidates) {
    if (path.isAbsolute(candidate)) {
      if (fs.existsSync(candidate)) return candidate;
    } else if (!spawnSync(candidate, ['--version'], { stdio: 'ignore' }).error) {
      return candidate;
    }
  }
  throw new Error(`None of ${candidates.join(', ')} found; set $${envVar}`);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf-8', ...options });
  if (result.status !== 0) {
    throw new Error(`${path.basename(cmd)} ${args.join(' ')} failed:\n${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

function writeProject(dir, methods, extra = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const yaml = [`title: "${TITLE}"`, 'sections:', '  - methods.md'];
  if (extra.reference) yaml.push('docx:', `  reference: ${extra.reference}`);
  fs.writeFileSync(path.join(dir, 'rev.yaml'), yaml.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'methods.md'), methods);
}

/**
 * pandoc's default reference DOCX on a 5 x 4.5 in page with a 3.4 in text
 * column, so the rendered text is large enough beside the Markdown panel and
 * LibreOffice's comment margin, which scales with the page width, fits the comment.
 */
function writeReferenceDocx(file) {
  run('pandoc', ['-o', file, '--print-default-data-file', 'reference.docx']);
  const zip = new AdmZip(file);
  const page = '<w:pgSz w:w="7200" w:h="6480"/>'
    + '<w:pgMar w:top="576" w:right="1728" w:bottom="576" w:left="576" w:header="0" w:footer="0" w:gutter="0"/>';
  const doc = zip.readAsText('word/document.xml').replace('</w:sectPr>', `${page}</w:sectPr>`);
  zip.updateFile('word/document.xml', Buffer.from(doc));
  zip.writeZip(file);
}

/** Bounding box of the text on page 1 and the page size, in points from the top-left corner. */
async function textBox(pdf) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const { width: pageWidth, height: pageHeight } = page.getViewport({ scale: 1 });
  const { items } = await page.getTextContent();
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, pageWidth, pageHeight };
  for (const item of items) {
    if (!item.str?.trim()) continue;
    const [, , , , x, baseline] = item.transform;
    box.x0 = Math.min(box.x0, x);
    box.x1 = Math.max(box.x1, x + item.width);
    box.y0 = Math.min(box.y0, pageHeight - baseline - item.height);
    box.y1 = Math.max(box.y1, pageHeight - baseline + 0.3 * item.height);
  }
  await doc.destroy();
  return box;
}

const escapeXml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ANNOTATION_COLOURS = {
  delete: PALETTE.red,
  insert: PALETTE.green,
  substitute: PALETTE.blue,
  comment: PALETTE.purple,
};

/**
 * Lines of `text` at most `maxChars` wide, as [start, end) offsets into it. A
 * line breaks after a space, dropping trailing spaces, or before an opening
 * brace or bracket, the break points a browser takes in wrapped monospace text.
 */
function wrapLines(text, maxChars) {
  const lines = [];
  let offset = 0;
  for (const hard of text.split('\n')) {
    const breaks = [0];
    for (let i = 1; i < hard.length; i++) {
      if ((hard[i - 1] === ' ' && hard[i] !== ' ') || ('{['.includes(hard[i]) && hard[i - 1] !== ' ')) breaks.push(i);
    }
    breaks.push(hard.length);
    let start = 0;
    for (let b = 1; b < breaks.length; b++) {
      const prev = breaks[b - 1];
      if (hard.slice(start, breaks[b]).trimEnd().length > maxChars && prev > start) {
        lines.push([offset + start, offset + start + hard.slice(start, prev).trimEnd().length]);
        start = prev;
      }
    }
    lines.push([offset + start, offset + start + hard.slice(start).trimEnd().length]);
    offset += hard.length + 1;
  }
  return lines;
}

/** Maximal runs of equal `key(i)` over [start, end), as [from, to, key]. */
function runs(start, end, key) {
  const out = [];
  for (let i = start; i < end; i++) {
    const k = key(i);
    if (out.length && out[out.length - 1][2] === k) out[out.length - 1][1] = i + 1;
    else out.push([i, i + 1, k]);
  }
  return out;
}

/** The synced Markdown as SVG text, each CriticMarkup annotation in its own colour. */
function markdownSvg(text, parseAnnotations) {
  const colour = new Array(text.length).fill(PALETTE.ink);
  let cursor = 0;
  for (const a of parseAnnotations(text).sort((x, y) => x.position - y.position)) {
    if (a.position < cursor) continue;
    cursor = a.position + a.match.length;
    colour.fill(ANNOTATION_COLOURS[a.type] ?? PALETTE.ink, a.position, cursor);
  }
  const marked = new Array(text.length).fill(false);
  for (const m of text.matchAll(/\[[^\]\n]*\]\{\.mark\}/g)) marked.fill(true, m.index, m.index + m[0].length);

  const charWidth = MD.font * MD.advance;
  const lines = wrapLines(text, Math.floor((MD.width - 2 * MD.padding) / charWidth));
  const x0 = MD.left + MD.padding;
  const top = CARD.top + (CARD.height - lines.length * MD.lineHeight) / 2;
  const x = (i, start) => (x0 + (i - start) * charWidth).toFixed(1);
  const marks = [];
  const texts = [];
  lines.forEach(([start, end], n) => {
    const lineTop = top + n * MD.lineHeight;
    for (const [from, to, on] of runs(start, end, (i) => marked[i])) {
      if (!on) continue;
      marks.push(`<rect x="${x(from, start)}" y="${(lineTop + (MD.lineHeight - 1.2 * MD.font) / 2).toFixed(1)}" `
        + `width="${((to - from) * charWidth).toFixed(1)}" height="${(1.2 * MD.font).toFixed(1)}" fill="${PALETTE.mark}"/>`);
    }
    const tspans = runs(start, end, (i) => colour[i]).map(([from, to, fill]) =>
      `<tspan x="${x(from, start)}" textLength="${((to - from) * charWidth).toFixed(1)}" fill="${fill}">`
      + `${escapeXml(text.slice(from, to))}</tspan>`);
    if (tspans.length) {
      texts.push(`<text y="${(lineTop + MD.lineHeight / 2 + 0.36 * MD.font).toFixed(1)}">${tspans.join('')}</text>`);
    }
  });
  return `<g>${marks.join('')}</g>\n<g font-family="${MONO}" font-size="${MD.font}" fill="${PALETTE.ink}" `
    + `xml:space="preserve" style="white-space: pre">\n${texts.join('\n')}\n</g>`;
}

/** An arrow labelled build or sync between the cards, pointing right or left. */
function arrowSvg(label, labelBaseline, shaftY, pointsRight) {
  const cx = ARROW.left + ARROW.width / 2;
  const x0 = cx - 65;
  const d = pointsRight
    ? `M${x0 + 6} ${shaftY} H${x0 + 110} M${x0 + 96} ${shaftY - 11} L${x0 + 120} ${shaftY} L${x0 + 96} ${shaftY + 11}`
    : `M${x0 + 124} ${shaftY} H${x0 + 20} M${x0 + 34} ${shaftY - 11} L${x0 + 10} ${shaftY} L${x0 + 34} ${shaftY + 11}`;
  return `<text x="${cx}" y="${labelBaseline}" text-anchor="middle" font-family="${MONO}" font-size="${ARROW.font}" `
    + `font-weight="700" fill="${PALETTE.blue}">${label}</text>`
    + `<path d="${d}" fill="none" stroke="${PALETTE.blue}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
}

/**
 * The part of the Word page that carries text, fitted into the right-hand card
 * at most at its natural size for WORD.dpi: the page SVG embedded as an image
 * and cropped by the viewBox.
 */
function wordSvg(pageSvg, box) {
  const pad = 16;
  const crop = { x: box.x0 - pad, y: box.y0 - pad, w: box.x1 - box.x0 + 2 * pad, h: box.y1 - box.y0 + 2 * pad };
  const inner = { x: WORD.left + WORD.padding, y: CARD.top + WORD.padding,
    w: WORD.width - 2 * WORD.padding, h: CARD.height - 2 * WORD.padding };
  const scale = Math.min(WORD.dpi / 72, inner.w / crop.w, inner.h / crop.h);
  const w = crop.w * scale;
  const h = crop.h * scale;
  const href = `data:image/svg+xml;base64,${Buffer.from(pageSvg).toString('base64')}`;
  return `<svg x="${(inner.x + (inner.w - w) / 2).toFixed(1)}" y="${(inner.y + (inner.h - h) / 2).toFixed(1)}" `
    + `width="${w.toFixed(1)}" height="${h.toFixed(1)}" `
    + `viewBox="${crop.x.toFixed(2)} ${crop.y.toFixed(2)} ${crop.w.toFixed(2)} ${crop.h.toFixed(2)}">`
    + `<image width="${box.pageWidth}" height="${box.pageHeight}" href="${href}"/></svg>`;
}

function heroSvg(markdown, word) {
  const card = (left, width) => `<rect x="${left}" y="${CARD.top}" width="${width}" height="${CARD.height}" `
    + `rx="${CARD.radius}" fill="#FFFFFF" filter="url(#shadow)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
<defs><filter id="shadow" x="-5%" y="-5%" width="110%" height="115%">`
    + `<feDropShadow dx="0" dy="2" stdDeviation="5" flood-color="${PALETTE.ink}" flood-opacity="0.14"/></filter></defs>
<rect width="${WIDTH}" height="${HEIGHT}" fill="${PALETTE.paper}"/>
${card(MD.left, MD.width)}
${card(WORD.left, WORD.width)}
${markdown}
${arrowSvg('build', 183, 217, true)}
${arrowSvg('sync', 357, 307, false)}
${word}
</svg>
`;
}

async function main() {
  const soffice = findTool('SOFFICE', ['soffice', 'C:/Program Files/LibreOffice/program/soffice.exe',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice']);
  const pdftocairo = findTool('PDFTOCAIRO', ['pdftocairo']);

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-hero-'));
  // A home of its own: the tracked changes carry this user name, and the
  // developer's ~/.revrc stays untouched.
  fs.writeFileSync(path.join(work, '.revrc'), JSON.stringify({ userName: 'Reviewer 2' }));
  const env = { ...process.env, HOME: work, USERPROFILE: work };
  const tsxCli = require.resolve('tsx/cli');
  const docrev = (cwd, ...args) => run(process.execPath, [tsxCli, path.join(root, 'bin', 'rev.ts'), ...args], { cwd, env });

  const reviewDir = path.join(work, 'review');
  writeProject(reviewDir, REVIEWED, { reference: 'reference.docx' });
  writeReferenceDocx(path.join(reviewDir, 'reference.docx'));
  docrev(reviewDir, 'build', 'docx', '--dual', '--show-changes');
  const reviewed = path.join(reviewDir, 'output', 'alpine-plant-survey-changes.docx');

  const authorDir = path.join(work, 'author');
  writeProject(authorDir, ORIGINAL);
  docrev(authorDir, 'sync', reviewed);
  const synced = fs.readFileSync(path.join(authorDir, 'methods.md'), 'utf-8').trim();

  const pdfFilter = 'pdf:writer_pdf_Export:{"ExportNotes":{"type":"boolean","value":"false"},'
    + '"ExportNotesInMargin":{"type":"boolean","value":"true"}}';
  run(soffice, ['--headless', '--convert-to', pdfFilter, '--outdir', work, reviewed], { env });
  const pdf = path.join(work, 'alpine-plant-survey-changes.pdf');

  const box = await textBox(pdf);
  const pageFile = path.join(work, 'word.svg');
  run(pdftocairo, ['-svg', '-f', '1', '-l', '1', pdf, pageFile]);

  const { parseAnnotations } = await import(pathToFileURL(path.join(root, 'lib', 'annotations.ts')).href);
  const svg = heroSvg(markdownSvg(synced, parseAnnotations), wordSvg(fs.readFileSync(pageFile, 'utf-8'), box));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, svg);
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`Synced Markdown:\n${synced}\n\nWrote ${path.relative(root, outFile)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
