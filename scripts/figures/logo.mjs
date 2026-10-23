#!/usr/bin/env node

/**
 * Builds docs/figures/logo.svg, the hex logo: a manuscript page whose lines
 * are drawn as one bar per word, coloured by what a reviewer did to the word.
 *
 * The words and their annotations are real: the reviewed manuscript in
 * test/fixtures/paper-niche-expansion.docx, read into CriticMarkup by docrev
 * itself (readDocxAsAnnotatedMarkdown). The script takes the stretch of the
 * manuscript with the most annotations of every kind, lays it out in lines and
 * lets the page scroll upwards by one block per cycle, so the loop is seamless.
 * Readers who ask for reduced motion get the page standing still.
 *
 * Run from the repository root:
 *   node --import tsx scripts/figures/logo.mjs
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const outFile = path.join(root, 'docs', 'figures', 'logo.svg');
const fixture = path.join(root, 'test', 'fixtures', 'paper-niche-expansion.docx');

const PALETTE = {
  border: '#2B3A4A',
  paper: '#F5F6F8',
  name: '#2E6F9E',
  text: '#5C6166',
  delete: '#B5342B',
  insert: '#3F7A3D',
  comment: '#7A4F9E',
};

const CX = 260;
const CY = 300;
const LINES = 16;          // lines per block; the page scrolls one block per cycle
const PITCH = 31;          // line spacing in viewBox units
const BAR = 12;            // bar thickness
const CHAR = 6.6;          // bar length per character
const GAP = 11;            // space between words
const LEFT = -6;           // lines overfill the hex and are clipped by it
const RIGHT = 526;
const TOP = 26;            // baseline of the first line at rest
const SECONDS_PER_LINE = 3;

const hexPoints = (r) => Array.from({ length: 6 }, (_, i) => {
  const a = (Math.PI / 180) * (60 * i - 90);
  return `${(CX + r * Math.cos(a)).toFixed(1)},${(CY + r * Math.sin(a)).toFixed(1)}`;
}).join(' ');

/** Words of a stretch of text; pandoc attribute spans and brackets are not words. */
function words(text) {
  return text
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/[[\]#*_`]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/**
 * The manuscript as a sequence of { word, kind, ann } in reading order; `ann`
 * numbers the annotation a word belongs to (null for unannotated text).
 */
function tokens(text, parseAnnotations) {
  const out = [];
  const push = (s, kind, ann) => { for (const word of words(s)) out.push({ word, kind, ann }); };
  let cursor = 0;
  parseAnnotations(text).sort((x, y) => x.position - y.position).forEach((a, ann) => {
    if (a.position < cursor) return;
    push(text.slice(cursor, a.position), 'text', null);
    if (a.type === 'substitute') {
      push(a.content, 'delete', ann);
      push(a.replacement ?? '', 'insert', ann);
    } else if (a.type === 'highlight') {
      push(a.content, 'text', null);
    } else {
      push(a.content, a.type, ann);
    }
    cursor = a.position + a.match.length;
  });
  push(text.slice(cursor), 'text', null);
  return out;
}

/** Breaks tokens into lines of bars: { x1, x2, kind } per word. */
function layout(toks, start) {
  const lines = [];
  let i = start;
  while (lines.length < LINES && i < toks.length) {
    const line = [];
    let x = LEFT;
    while (i < toks.length) {
      const len = Math.max(1, toks[i].word.length) * CHAR;
      if (line.length > 0 && x + len > RIGHT) break;
      line.push({ x1: x, x2: x + len, kind: toks[i].kind });
      x += len + GAP;
      i++;
    }
    lines.push(line);
  }
  return { lines, end: i };
}

/**
 * The block of LINES lines with the most separate annotations in the lines
 * visible at rest, among blocks that show a deletion, an insertion and a
 * comment in those lines, where no annotation runs
 * longer than MAX_ANN_WORDS words and annotated words stay under a quarter,
 * so the page reads as text with reviewer marks in it.
 */
const MAX_ANN_WORDS = 12;
const VISIBLE = 11;
function pickBlock(toks) {
  let best = null;
  for (let start = 0; start < toks.length; start += 3) {
    const { lines } = layout(toks, start);
    if (lines.length < LINES) break;
    const shown = lines.slice(0, VISIBLE).reduce((n, line) => n + line.length, 0);
    const block = toks.slice(start, start + shown);
    const count = (k) => block.filter((t) => t.kind === k).length;
    if (!count('delete') || !count('insert') || !count('comment')) continue;
    if (count('text') < 0.75 * block.length) continue;
    const sizes = new Map();
    for (const t of block) if (t.ann !== null) sizes.set(t.ann, (sizes.get(t.ann) ?? 0) + 1);
    if ([...sizes.values()].some((n) => n > MAX_ANN_WORDS)) continue;
    const score = sizes.size;
    if (!best || score > best.score) best = { lines, score };
  }
  if (!best) throw new Error('No block with every kind of annotation');
  return best.lines;
}

/** One path per kind for a block drawn with its first baseline at y0. */
function blockPaths(lines, y0) {
  const d = {};
  lines.forEach((line, row) => {
    const y = y0 + row * PITCH;
    for (const bar of line) {
      const h = BAR / 2;
      d[bar.kind] = (d[bar.kind] ?? '') + `M${(bar.x1 + h).toFixed(1)} ${y}H${(bar.x2 - h).toFixed(1)}`;
    }
  });
  return ['text', 'delete', 'insert', 'comment']
    .filter((kind) => d[kind])
    .map((kind) => `<path class="${kind}" d="${d[kind]}"/>`)
    .join('');
}

function svg(lines) {
  const blockHeight = LINES * PITCH;
  const twoBlocks = blockPaths(lines, TOP) + blockPaths(lines, TOP + blockHeight);
  const dur = LINES * SECONDS_PER_LINE;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 600" role="img" aria-label="docrev logo">
<title>docrev logo</title>
<defs>
  <clipPath id="hex"><polygon points="${hexPoints(288)}"/></clipPath>
  <linearGradient id="fade" x1="0" y1="0" x2="0" y2="600" gradientUnits="userSpaceOnUse">
    <stop offset="0.55" stop-color="#fff"/><stop offset="0.68" stop-color="#000"/>
  </linearGradient>
  <mask id="page" maskUnits="userSpaceOnUse" x="0" y="0" width="520" height="600">
    <rect width="520" height="600" fill="url(#fade)"/>
  </mask>
</defs>
<style>
  path { fill: none; stroke-width: ${BAR}; stroke-linecap: round; }
  .text { stroke: ${PALETTE.text}; stroke-opacity: 0.32; }
  .delete { stroke: ${PALETTE.delete}; }
  .insert { stroke: ${PALETTE.insert}; }
  .comment { stroke: ${PALETTE.comment}; }
  .still { display: none; }
  @media (prefers-reduced-motion: reduce) { .moving { display: none; } .still { display: inline; } }
</style>
<polygon points="${hexPoints(288)}" fill="${PALETTE.paper}"/>
<g clip-path="url(#hex)" mask="url(#page)">
  <g class="moving">
    <g>${twoBlocks}<animateTransform attributeName="transform" type="translate" from="0 0" to="0 ${-blockHeight}" dur="${dur}s" repeatCount="indefinite"/></g>
  </g>
  <g class="still">${blockPaths(lines, TOP)}</g>
</g>
<text x="${CX}" y="472" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="78" font-weight="bold" font-style="italic" fill="${PALETTE.name}" stroke="${PALETTE.paper}" stroke-width="10" stroke-linejoin="round" paint-order="stroke">docrev</text>
<polygon points="${hexPoints(291)}" fill="none" stroke="${PALETTE.border}" stroke-width="18" stroke-linejoin="round"/>
</svg>
`;
}

async function main() {
  const { readDocxAsAnnotatedMarkdown } = await import(pathToFileURL(path.join(root, 'lib', 'import.ts')).href);
  const { parseAnnotations } = await import(pathToFileURL(path.join(root, 'lib', 'annotations.ts')).href);
  const text = await readDocxAsAnnotatedMarkdown(fixture);
  const lines = pickBlock(tokens(text, parseAnnotations));
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, svg(lines));
  console.log(`Wrote ${path.relative(root, outFile)} (${fs.statSync(outFile).size} bytes)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
