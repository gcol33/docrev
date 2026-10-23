#!/usr/bin/env node

/**
 * Builds docs/figures/hero.png, the README's graphical abstract, from one real
 * docrev round trip:
 *
 *   1. A reviewer's copy of a short Methods section, written with CriticMarkup,
 *      is built with `docrev build docx --dual --show-changes`: a DOCX with Word
 *      tracked changes and a comment, as a reviewer would return it.
 *   2. The author's clean Methods section syncs that DOCX with `docrev sync`.
 *   3. LibreOffice renders the DOCX to PDF with the comment in the margin and
 *      pdftoppm rasterises the part of the page that carries text.
 *   4. An HTML page sets the synced Markdown beside the Word page, and a
 *      headless Chromium browser screenshots it.
 *
 * Needs LibreOffice (`soffice`, or $SOFFICE), poppler (`pdftoppm`, `pdftotext`)
 * and Edge or Chrome ($CHROME). Run from the repository root:
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
const outFile = path.join(root, 'docs', 'figures', 'hero.png');

const WIDTH = 1628;
const HEIGHT = 520;
const DPI = 220;

const PALETTE = {
  paper: '#F5F6F8',
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

/** Bounding box of the text on page 1, in points from the top-left corner. */
async function textBox(pdf) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(pdf)), useSystemFonts: true }).promise;
  const page = await doc.getPage(1);
  const pageHeight = page.getViewport({ scale: 1 }).height;
  const { items } = await page.getTextContent();
  const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
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

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The synced Markdown as HTML, each CriticMarkup annotation in its own colour. */
function markdownHtml(text, parseAnnotations) {
  const annotations = parseAnnotations(text).sort((a, b) => a.position - b.position);
  let html = '';
  let cursor = 0;
  for (const a of annotations) {
    if (a.position < cursor) continue;
    html += escapeHtml(text.slice(cursor, a.position));
    html += `<span class="${a.type}">${escapeHtml(a.match)}</span>`;
    cursor = a.position + a.match.length;
  }
  html += escapeHtml(text.slice(cursor));
  return html.replace(/\[([^\]\n]*)\]\{\.mark\}/g, '<span class="highlight">[$1]{.mark}</span>');
}

function pageHtml(markdown, wordPng) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; background: ${PALETTE.paper}; overflow: hidden; }
  body { position: relative; font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: ${PALETTE.ink}; }
  .card { position: absolute; top: 36px; height: 448px; background: #fff; border-radius: 14px;
          box-shadow: 0 2px 10px rgba(31, 41, 51, 0.14); box-sizing: border-box; }
  .md { left: 48px; width: 540px; padding: 0 32px; display: flex; align-items: center; }
  .md pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: 22px/1.55 Consolas, "DejaVu Sans Mono", monospace; }
  .word { left: 762px; width: 818px; display: flex; align-items: center; justify-content: center; padding: 24px; }
  .word img { max-width: 100%; max-height: 100%; }
  .delete { color: ${PALETTE.red}; }
  .insert { color: ${PALETTE.green}; }
  .substitute { color: ${PALETTE.blue}; }
  .comment { color: ${PALETTE.purple}; }
  .highlight { background: ${PALETTE.mark}; }
  .arrow { position: absolute; left: 600px; width: 150px; text-align: center; font: 700 44px/1 Consolas, "DejaVu Sans Mono", monospace; color: ${PALETTE.blue}; }
  .arrow svg { display: block; margin: 10px auto 0; }
  .build { top: 148px; }
  .sync { top: 282px; }
</style></head><body>
  <div class="card md"><pre>${markdown}</pre></div>
  <div class="arrow build">build
    <svg width="130" height="30" viewBox="0 0 130 30"><path d="M6 15 H110 M96 4 L120 15 L96 26" fill="none" stroke="${PALETTE.blue}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>
  <div class="arrow sync">
    <svg width="130" height="30" viewBox="0 0 130 30"><path d="M124 15 H20 M34 4 L10 15 L34 26" fill="none" stroke="${PALETTE.blue}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    sync
  </div>
  <div class="card word"><img src="${pathToFileURL(wordPng).href}" alt=""></div>
</body></html>`;
}

async function main() {
  const soffice = findTool('SOFFICE', ['soffice', 'C:/Program Files/LibreOffice/program/soffice.exe',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice']);
  const chrome = findTool('CHROME', ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', 'chromium', 'google-chrome']);
  const pdftoppm = findTool('PDFTOPPM', ['pdftoppm']);

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
  const pad = 16;
  const px = (pt) => Math.round((pt * DPI) / 72);
  const wordBase = path.join(work, 'word');
  run(pdftoppm, ['-png', '-singlefile', '-r', String(DPI), '-f', '1', '-l', '1',
    '-x', String(px(box.x0 - pad)), '-y', String(px(box.y0 - pad)),
    '-W', String(px(box.x1 - box.x0 + 2 * pad)), '-H', String(px(box.y1 - box.y0 + 2 * pad)),
    pdf, wordBase]);

  const { parseAnnotations } = await import(pathToFileURL(path.join(root, 'lib', 'annotations.ts')).href);
  const htmlFile = path.join(work, 'hero.html');
  fs.writeFileSync(htmlFile, pageHtml(markdownHtml(synced, parseAnnotations), `${wordBase}.png`));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  run(chrome, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--allow-file-access-from-files', `--window-size=${WIDTH},${HEIGHT}`,
    `--screenshot=${outFile}`, pathToFileURL(htmlFile).href]);
  fs.rmSync(work, { recursive: true, force: true });
  console.log(`Synced Markdown:\n${synced}\n\nWrote ${path.relative(root, outFile)}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
