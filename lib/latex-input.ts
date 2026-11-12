/**
 * Build a Word document from a LaTeX (`.tex`) or knitr (`.Rnw`) manuscript.
 *
 * A project names its source in rev.yaml:
 *
 *   source: jss/couplr-jss.Rnw
 *   knit: Rscript -e "knitr::knit('couplr-jss.Rnw')"   # optional, run in the source's folder
 *
 * pandoc reads LaTeX, but a journal manuscript needs preparation first, done
 * here on a copy of the knitted `.tex`:
 *
 * 1. Class macros (latex-classes.ts) become `\newcommand` definitions pandoc
 *    expands; the class's abstract and keywords move into the body.
 * 2. Section, figure and table numbers and every `\ref` come from the `.aux`
 *    of the last LaTeX run, so the docx carries the PDF's numbers.
 * 3. TikZ pictures are rendered standalone with the document's preamble, and
 *    PDF figures converted to PNG, since Word shows neither.
 * 4. Sweave/knitr code environments become verbatim blocks.
 * 5. Bibliography fields lose class macros (`{\pkg{quickmatch}}`), which
 *    citeproc would otherwise render as nothing.
 * 6. Each paragraph unit (latex-units.ts) gets a bookmark, by which
 *    `docrev sync` anchors Word comments back to the source (latex-sync.ts).
 */

import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { spawnSync, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import type { BuildConfig } from './build.js';
import { profileFor, macroDefinitions, definedMacroNames, type LatexClassProfile } from './latex-classes.js';
import { segmentLatexUnits, unitBookmarkName, type LatexSourceKind } from './latex-units.js';
import { findCommands, applyReplacements, replaceCommand, type TexCommand } from './tex-utils.js';

/** True when rev.yaml names a LaTeX or knitr source. */
export function hasLatexSource(config: { source?: string | null }): boolean {
  return typeof config.source === 'string' && /\.(tex|rnw)$/i.test(config.source);
}

export function latexSourceKind(file: string): LatexSourceKind {
  return /\.rnw$/i.test(file) ? 'rnw' : 'tex';
}

// =============================================================================
// .aux
// =============================================================================

export interface AuxLabel {
  number: string;
  page: string;
  title: string;
  /** hyperref anchor, e.g. `figure.2`, whose prefix names the counter. */
  anchor: string;
}

export interface AuxData {
  labels: Map<string, AuxLabel>;
  /** Numbered list-of-figures and list-of-tables entries, in order. */
  figures: string[];
  tables: string[];
}

/** Read labels and the numbered list-of-figures/tables entries from the `.aux` LaTeX writes. */
export function parseAux(text: string): AuxData {
  const labels = new Map<string, AuxLabel>();
  for (const cmd of findCommands(text, 'newlabel', 2)) {
    if (cmd.args.length < 2) continue;
    const key = cmd.args[0]!.content;
    const fields = findGroupsIn(cmd.args[1]!.content);
    if (fields.length < 2) continue;
    labels.set(key, {
      number: fields[0]!,
      page: fields[1]!,
      title: fields[2] ?? '',
      anchor: fields[3] ?? '',
    });
  }

  const figures: string[] = [];
  const tables: string[] = [];
  for (const cmd of findCommands(text, '@writefile', 2)) {
    if (cmd.args.length < 2) continue;
    const list = cmd.args[0]!.content;
    for (const line of findCommands(cmd.args[1]!.content, 'contentsline', 2)) {
      if (line.args.length < 2) continue;
      const level = line.args[0]!.content.trim();
      const num = findCommands(line.args[1]!.content, 'numberline', 1)[0]?.args[0]?.content.trim();
      if (!num) continue;
      if (list === 'lof' && level === 'figure') {
        figures.push(num);
      } else if (list === 'lot' && level === 'table') {
        tables.push(num);
      }
    }
  }
  return { labels, figures, tables };
}

/** The top-level `{...}` groups of `text`, in order. */
function findGroupsIn(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '{') {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) out.push(text.slice(start, i));
    }
  }
  return out;
}

// =============================================================================
// Source preparation
// =============================================================================

/** Code environments rewritten to `verbatim`, whose content pandoc keeps as written. */
const VERBATIM_ENVS = ['Sinput', 'Soutput', 'Scode', 'Code', 'CodeInput', 'CodeOutput', 'Verbatim'];
/** Environments pandoc already reads as code; protected but left as they are. */
const NATIVE_CODE_ENVS = ['verbatim', 'lstlisting', 'minted'];
/** Wrappers knitr writes around a chunk's code and output, dropped. */
const CHUNK_WRAPPER_ENVS = ['Schunk', 'CodeChunk', 'knitrout'];
const EQUATION_ENVS = ['equation', 'multline'];
const ALIGNED_ENVS = ['align', 'gather', 'eqnarray', 'flalign', 'alignat'];

const REF_NAMES: Record<string, string> = {
  figure: 'Figure', table: 'Table', section: 'Section', subsection: 'Section',
  subsubsection: 'Section', equation: 'Equation', appendix: 'Appendix', chapter: 'Chapter',
  page: 'page', item: 'item', footnote: 'footnote', theorem: 'Theorem', lemma: 'Lemma',
};

export interface PrepareContext {
  /** Folder of the `.tex`; relative graphics paths resolve against it. */
  sourceDir: string;
  /** Cache for rendered figures and the cleaned bibliography. */
  cacheDir: string;
  aux: AuxData | null;
  /** Render TikZ and convert PDF figures (false in tests that check text only). */
  renderFigures?: boolean;
}

export interface PreparedLatex {
  tex: string;
  /** Bibliography files the source names, resolved against the source folder. */
  bibliographies: string[];
  warnings: string[];
  anchors: number;
}

/**
 * Turn a LaTeX manuscript into LaTeX pandoc reads faithfully (see the module
 * comment for the steps).
 */
export function prepareLatexForPandoc(source: string, ctx: PrepareContext): PreparedLatex {
  const warnings: string[] = [];
  const profile = profileFor(source);
  const preambleForFigures = extractPreambleDefinitions(source);

  // 1. Paragraph anchors, placed on the untouched source so unit offsets hold.
  // A knitted .tex segments to the same keys as its .Rnw (latex-units.ts).
  const units = segmentLatexUnits(source, 'tex', profile.abstract);
  let tex = applyReplacements(
    source,
    units.map(u => [u.contentOffset, u.contentOffset, `\\hypertarget{${unitBookmarkName(u.key)}}{}\n\n`] as [number, number, string])
  );

  // 2. Code: protect every code block from the rewrites below.
  const code: string[] = [];
  const protect = (block: string) => `DOCREVCODEBLOCK${code.push(block) - 1}X`;
  tex = tex.replace(
    new RegExp(`\\\\begin\\{(${[...VERBATIM_ENVS, ...NATIVE_CODE_ENVS].join('|')})\\}([\\s\\S]*?)\\\\end\\{\\1\\}`, 'g'),
    (full, env: string, body: string) => {
      if (NATIVE_CODE_ENVS.includes(env) && env !== 'minted') return protect(full);
      const content = env === 'minted' ? body.replace(/^\{[^}]*\}/, '') : body;
      return protect(`\\begin{verbatim}${content.startsWith('\n') ? '' : '\n'}${content}\\end{verbatim}`);
    }
  );
  tex = tex.replace(new RegExp(`\\\\(begin|end)\\{(${CHUNK_WRAPPER_ENVS.join('|')})\\}`, 'g'), '');

  // 3. Front matter roles: abstract and keywords move into the body.
  const roleText = (names: string[]): string | null => {
    for (const name of names) {
      const cmd = findCommands(tex, name, 1).find(c => c.args.length === 1);
      if (cmd) {
        const content = cmd.args[0]!.content;
        tex = tex.slice(0, cmd.start) + tex.slice(cmd.end);
        return content;
      }
    }
    return null;
  };
  const abstract = roleText(profile.abstract);
  const keywords = roleText(profile.keywords);
  const frontBody =
    (abstract !== null ? `\n\\begin{abstract}\n${abstract.trim()}\n\\end{abstract}\n` : '') +
    (keywords !== null ? `\n\\noindent\\textit{Keywords}: ${keywords.trim()}\n` : '');
  if (frontBody) tex = tex.replace('\\begin{document}', () => `\\begin{document}\n${frontBody}`);

  // 4. Class macro definitions, ahead of the document's own preamble.
  const definitions = macroDefinitions(profile, 'newcommand', definedMacroNames(tex));
  const docclass = findCommands(tex, 'documentclass', 1)[0];
  if (definitions && docclass) tex = tex.slice(0, docclass.end) + `\n${definitions}\n` + tex.slice(docclass.end);

  // 5-8. Numbers and references from the .aux.
  if (ctx.aux) {
    tex = numberHeadings(tex, ctx.aux, warnings);
    tex = numberCaptions(tex, ctx.aux, warnings);
    tex = tagEquations(tex, ctx.aux);
    tex = resolveRefs(tex, ctx.aux, warnings);
  }
  tex = replaceCommand(tex, 'label', () => '');

  // 9. Figures.
  if (ctx.renderFigures !== false) {
    tex = renderTikzPictures(tex, preambleForFigures, profile, ctx, warnings);
    tex = convertGraphics(tex, ctx, warnings);
  }

  // 10. Bibliography: citeproc fills the `refs` Div where the list was.
  const bibliographies: string[] = [];
  const refsBlock = '\\section*{References}\n\n\\hypertarget{refs}{}\n';
  const bibEdits: Array<[number, number, string]> = [];
  for (const cmd of findCommands(tex, 'bibliography', 1)) {
    if (!cmd.args[0]) continue;
    for (const name of cmd.args[0].content.split(',').map(s => s.trim()).filter(Boolean)) {
      bibliographies.push(path.resolve(ctx.sourceDir, /\.bib$/i.test(name) ? name : `${name}.bib`));
    }
    bibEdits.push([cmd.start, cmd.end, refsBlock]);
  }
  for (const cmd of findCommands(tex, 'addbibresource', 1)) {
    if (cmd.args[0]) bibliographies.push(path.resolve(ctx.sourceDir, cmd.args[0].content.trim()));
    bibEdits.push([cmd.start, cmd.end, '']);
  }
  for (const cmd of findCommands(tex, 'printbibliography', 0)) bibEdits.push([cmd.start, cmd.end, refsBlock]);
  for (const cmd of findCommands(tex, 'bibliographystyle', 1)) bibEdits.push([cmd.start, cmd.end, '']);
  tex = applyReplacements(tex, bibEdits);

  // Restore code blocks.
  tex = tex.replace(/DOCREVCODEBLOCK(\d+)X/g, (_m, i: string) => code[Number(i)]!);

  return { tex, bibliographies, warnings, anchors: units.length };
}

const HEADING_LEVELS = ['section', 'subsection', 'subsubsection'] as const;

/** Letter numbering of appendix sections: A..Z, then AA, AB, ... */
function alph(n: number): string {
  let out = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) out = String.fromCharCode(65 + ((k - 1) % 26)) + out;
  return out;
}

/**
 * Prefix each numbered heading with its number, counted as LaTeX counts
 * (starred headings skipped, `\appendix` restarting sections at A). Many
 * classes write no table of contents to the `.aux`, so the count is checked
 * against the labelled headings instead: a level is numbered only when at
 * least one of its labels confirms the count and none contradicts it.
 */
function numberHeadings(tex: string, aux: AuxData, warnings: string[]): string {
  const bodyStart = tex.indexOf('\\begin{document}');
  const items: Array<{ level: number; cmd: TexCommand } | { appendix: number }> = [];
  HEADING_LEVELS.forEach((name, level) => {
    for (const cmd of findCommands(tex, name, 1)) {
      if (cmd.start > bodyStart && !cmd.star && cmd.args.length === 1) items.push({ level, cmd });
    }
  });
  for (const cmd of findCommands(tex, 'appendix', 0)) if (cmd.start > bodyStart) items.push({ appendix: cmd.start });
  items.sort((a, b) => ('appendix' in a ? a.appendix : a.cmd.start) - ('appendix' in b ? b.appendix : b.cmd.start));

  const counters = [0, 0, 0];
  let inAppendix = false;
  const numbered: Array<{ level: number; cmd: TexCommand; number: string }> = [];
  for (const item of items) {
    if ('appendix' in item) {
      inAppendix = true;
      counters.fill(0);
      continue;
    }
    counters[item.level]!++;
    for (let l = item.level + 1; l < counters.length; l++) counters[l] = 0;
    const top = inAppendix ? alph(counters[0]!) : String(counters[0]);
    numbered.push({ level: item.level, cmd: item.cmd, number: [top, ...counters.slice(1, item.level + 1)].join('.') });
  }

  const confirmed = [false, false, false];
  const contradicted = [false, false, false];
  for (const h of numbered) {
    const key = tex.slice(h.cmd.end).match(/^\s*\\label\{([^}]+)\}/)?.[1];
    const label = key ? aux.labels.get(key) : undefined;
    if (!label) continue;
    if (label.number === h.number) confirmed[h.level] = true;
    else contradicted[h.level] = true;
  }
  const edits: Array<[number, number, string]> = [];
  HEADING_LEVELS.forEach((name, level) => {
    if (contradicted[level]) {
      warnings.push(`\\${name} numbers counted from the source disagree with the .aux; ${name} headings left unnumbered (rebuild the PDF to refresh the .aux)`);
    }
  });
  for (const h of numbered) {
    if (!confirmed[h.level] || contradicted[h.level]) continue;
    const arg = h.cmd.args[0]!;
    edits.push([arg.open + 1, arg.open + 1, `${h.number} `]);
  }
  return applyReplacements(tex, edits);
}

/** Prefix each figure and table caption with `Figure N:` / `Table N:` from the `.aux` lists. */
function numberCaptions(tex: string, aux: AuxData, warnings: string[]): string {
  const edits: Array<[number, number, string]> = [];
  for (const [env, label, numbers] of [['figure', 'Figure', aux.figures], ['table', 'Table', aux.tables]] as const) {
    // Offsets of each caption's opening brace in `tex`.
    const captionBraces: number[] = [];
    const envRe = new RegExp(`\\\\begin\\{${env}\\*?\\}([\\s\\S]*?)\\\\end\\{${env}\\*?\\}`, 'dg');
    for (const m of tex.matchAll(envRe)) {
      const bodyStart = m.indices![1]![0];
      for (const cap of findCommands(m[1]!, 'caption', 1)) {
        if (cap.args.length === 1) captionBraces.push(bodyStart + cap.args[0]!.open);
      }
    }
    if (captionBraces.length === 0) continue;
    if (captionBraces.length !== numbers.length) {
      warnings.push(`${captionBraces.length} ${env} caption(s) but ${numbers.length} in the .aux list of ${env}s; ${env} captions left unnumbered (rebuild the PDF to refresh the .aux)`);
      continue;
    }
    captionBraces.forEach((brace, i) => {
      edits.push([brace + 1, brace + 1, `${label} ${numbers[i]}: `]);
    });
  }
  return applyReplacements(tex, edits);
}

/** Write each labelled equation's number into the equation, since Word math drops `\tag`. */
function tagEquations(tex: string, aux: AuxData): string {
  const tag = (key: string) => {
    const n = aux.labels.get(key)?.number;
    return n ? `\\qquad(${n})` : '';
  };
  const envs = [...EQUATION_ENVS, ...ALIGNED_ENVS].join('|');
  return tex.replace(new RegExp(`(\\\\begin\\{(${envs})(\\*?)\\})([\\s\\S]*?)(\\\\end\\{\\2\\3\\})`, 'g'),
    (_full, open: string, env: string, _star: string, body: string, close: string) => {
      if (EQUATION_ENVS.includes(env)) {
        let suffix = '';
        const stripped = replaceCommand(body, 'label', key => { suffix = tag(key.trim()); return ''; });
        return `${open}${stripped.replace(/\s+$/, '')}${suffix ? ` ${suffix}` : ''}\n${close}`;
      }
      return `${open}${replaceCommand(body, 'label', key => tag(key.trim()))}${close}`;
    });
}

/** Replace `\ref`-family commands with the numbers LaTeX printed. */
function resolveRefs(tex: string, aux: AuxData, warnings: string[]): string {
  const missing = new Set<string>();
  const lookup = (key: string): AuxLabel | null => {
    const label = aux.labels.get(key);
    if (!label) missing.add(key);
    return label ?? null;
  };
  const named = (key: string, capital: boolean): string => {
    const label = lookup(key);
    if (!label) return '??';
    const counter = label.anchor.split('.')[0] ?? '';
    const name = REF_NAMES[counter] ?? '';
    const shown = capital || !name ? name : name.toLowerCase();
    return shown ? `${shown}~${label.number}` : label.number;
  };
  const each = (arg: string, fn: (key: string) => string) => arg.split(',').map(k => fn(k.trim())).join(', ');

  let out = tex;
  out = replaceCommand(out, 'eqref', arg => each(arg, k => `(${lookup(k)?.number ?? '??'})`));
  out = replaceCommand(out, 'pageref', arg => each(arg, k => lookup(k)?.page ?? '??'));
  out = replaceCommand(out, 'nameref', arg => each(arg, k => lookup(k)?.title ?? '??'));
  out = replaceCommand(out, 'autoref', arg => each(arg, k => named(k, true)));
  out = replaceCommand(out, 'Cref', arg => each(arg, k => named(k, true)));
  out = replaceCommand(out, 'cref', arg => each(arg, k => named(k, false)));
  out = replaceCommand(out, 'ref', arg => each(arg, k => lookup(k)?.number ?? '??'));
  if (missing.size > 0) {
    warnings.push(`${missing.size} reference(s) not in the .aux, shown as ??: ${[...missing].slice(0, 8).join(', ')}${missing.size > 8 ? ', ...' : ''}`);
  }
  return out;
}

// =============================================================================
// Figures
// =============================================================================

/** Preamble commands a standalone TikZ render needs, in source order. */
const FIGURE_PREAMBLE_COMMANDS: Array<[string, number]> = [
  ['usepackage', 1], ['RequirePackage', 1], ['usetikzlibrary', 1], ['usepgfplotslibrary', 1],
  ['pgfplotsset', 1], ['tikzset', 1], ['definecolor', 3], ['colorlet', 2], ['DeclareMathOperator', 2],
];

/** The preamble commands and macro definitions of the source, for a standalone figure document. */
export function extractPreambleDefinitions(source: string): string {
  const begin = source.indexOf('\\begin{document}');
  const preamble = begin === -1 ? source : source.slice(0, begin);
  const found: Array<[number, string]> = [];
  for (const [name, braced] of FIGURE_PREAMBLE_COMMANDS) {
    for (const cmd of findCommands(preamble, name, braced)) {
      if (cmd.args.length === braced) found.push([cmd.start, preamble.slice(cmd.start, cmd.end)]);
    }
  }
  // \newcommand{\name}[n][default]{body} and \newcommand\name[n]{body}.
  const defRe = /\\(?:re|provide)?newcommand\*?\s*(?:\{\\[A-Za-z@]+\}|\\[A-Za-z@]+)/g;
  for (const m of preamble.matchAll(defRe)) {
    let i = m.index! + m[0].length;
    for (;;) {
      while (/\s/.test(preamble[i] ?? '')) i++;
      if (preamble[i] !== '[') break;
      const close = preamble.indexOf(']', i);
      if (close === -1) break;
      i = close + 1;
    }
    if (preamble[i] !== '{') continue;
    let depth = 0;
    let j = i;
    for (; j < preamble.length; j++) {
      if (preamble[j] === '\\') { j++; continue; }
      if (preamble[j] === '{') depth++;
      else if (preamble[j] === '}' && --depth === 0) break;
    }
    found.push([m.index!, preamble.slice(m.index!, j + 1)]);
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, text]) => text).join('\n');
}

function hasTool(name: string): boolean {
  const probe = spawnSync(name, ['-v'], { stdio: 'ignore', shell: false });
  return !probe.error;
}

function sha(text: string | Buffer): string {
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 16);
}

/** PNG rendering of page 1 of a PDF, cached by content. */
function pdfToPng(pdfPath: string, cacheDir: string, warnings: string[]): string | null {
  const out = path.join(cacheDir, `pdf-${sha(fs.readFileSync(pdfPath))}`);
  if (fs.existsSync(`${out}.png`)) return `${out}.png`;
  const run = spawnSync('pdftocairo', ['-png', '-r', '300', '-singlefile', '-f', '1', '-l', '1', pdfPath, out], { encoding: 'utf-8' });
  if (run.error || run.status !== 0) {
    warnings.push(`Could not convert ${path.basename(pdfPath)} to PNG with pdftocairo (poppler): ${run.error?.message ?? run.stderr}`);
    return null;
  }
  return `${out}.png`;
}

/** Path relative to the source folder with forward slashes, as `\includegraphics` takes it. */
function texPath(file: string, sourceDir: string): string {
  return path.relative(sourceDir, file).split(path.sep).join('/');
}

/** Render each `tikzpicture` as a standalone document and include the PNG instead. */
function renderTikzPictures(tex: string, preamble: string, profile: LatexClassProfile, ctx: PrepareContext, warnings: string[]): string {
  const re = /\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/g;
  if (!re.test(tex)) return tex;
  if (!hasTool('pdflatex') || !hasTool('pdftocairo')) {
    warnings.push('TikZ figures need pdflatex and pdftocairo (poppler) on PATH; they are left out of the docx');
    return tex.replace(re, '[TikZ figure not rendered]');
  }
  fs.mkdirSync(ctx.cacheDir, { recursive: true });
  const classMacros = macroDefinitions(profile, 'providecommand');
  return tex.replace(re, (picture) => {
    const doc = [
      '\\documentclass[tikz,border=4pt]{standalone}',
      preamble,
      classMacros,
      '\\begin{document}',
      picture,
      '\\end{document}',
      '',
    ].join('\n');
    const stem = `tikz-${sha(doc)}`;
    const png = path.join(ctx.cacheDir, `${stem}.png`);
    if (!fs.existsSync(png)) {
      fs.writeFileSync(path.join(ctx.cacheDir, `${stem}.tex`), doc, 'utf-8');
      const env = { ...process.env, TEXINPUTS: `${ctx.sourceDir}${path.delimiter}${process.env.TEXINPUTS ?? ''}` };
      const latex = spawnSync('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', `${stem}.tex`], { cwd: ctx.cacheDir, env, encoding: 'utf-8' });
      if (latex.status !== 0) {
        warnings.push(`TikZ figure failed to compile; see ${path.join(ctx.cacheDir, `${stem}.log`)}`);
        return '[TikZ figure not rendered]';
      }
      const conv = spawnSync('pdftocairo', ['-png', '-r', '300', '-singlefile', `${stem}.pdf`, stem], { cwd: ctx.cacheDir, encoding: 'utf-8' });
      if (conv.status !== 0) {
        warnings.push(`TikZ figure rendered but PNG conversion failed: ${conv.stderr}`);
        return '[TikZ figure not rendered]';
      }
    }
    return `\\includegraphics{${texPath(png, ctx.sourceDir)}}`;
  });
}

/** Extensions pdflatex tries for an `\includegraphics` path without one, in its order. */
const GRAPHICS_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.PDF', '.PNG', '.JPG', '.eps'];

/** Point every `\includegraphics` at a file Word displays: resolved, PDF converted to PNG. */
function convertGraphics(tex: string, ctx: PrepareContext, warnings: string[]): string {
  const searchDirs = [ctx.sourceDir];
  const gp = findCommands(tex, 'graphicspath', 1)[0];
  if (gp?.args[0]) {
    for (const dir of gp.args[0].content.match(/\{([^}]*)\}/g) ?? []) {
      searchDirs.push(path.resolve(ctx.sourceDir, dir.slice(1, -1)));
    }
  }
  const resolve = (name: string): string | null => {
    const candidates = path.extname(name) ? [name] : GRAPHICS_EXTENSIONS.map(ext => name + ext);
    for (const dir of searchDirs) {
      for (const c of candidates) {
        const full = path.resolve(dir, c);
        if (fs.existsSync(full)) return full;
      }
    }
    return null;
  };

  const edits: Array<[number, number, string]> = [];
  for (const cmd of findCommands(tex, 'includegraphics', 1)) {
    const arg = cmd.args[0];
    if (!arg) continue;
    const name = arg.content.trim();
    const file = resolve(name);
    if (!file) {
      warnings.push(`Figure file not found: ${name}`);
      continue;
    }
    let target = file;
    if (/\.pdf$/i.test(file)) {
      fs.mkdirSync(ctx.cacheDir, { recursive: true });
      const png = pdfToPng(file, ctx.cacheDir, warnings);
      if (!png) continue;
      target = png;
    } else if (/\.eps$/i.test(file)) {
      warnings.push(`EPS figure ${name} is not converted; Word may not display it`);
    }
    edits.push([arg.open + 1, arg.close, texPath(target, ctx.sourceDir)]);
  }
  return applyReplacements(tex, edits);
}

// =============================================================================
// Bibliography
// =============================================================================

/**
 * A bibliography with every one-argument class macro reduced to its braced
 * argument, so `{\pkg{quickmatch}}: Quick ...` reads `{{quickmatch}}: Quick ...`
 * and citeproc keeps the case LaTeX printed.
 */
export function cleanBibliography(bib: string, profile: LatexClassProfile): string {
  let out = bib;
  for (const [name, macro] of Object.entries(profile.macros)) {
    if (macro.args === 1) out = replaceCommand(out, name, arg => `{${arg}}`);
  }
  return out;
}

// =============================================================================
// Build
// =============================================================================

export interface LatexBuildOptions {
  output?: string;
  pandocArgs?: string[];
  verbose?: boolean;
}

export interface LatexBuildResult {
  success: boolean;
  outputPath?: string;
  error?: string;
  warnings: string[];
  /** The knitted or given `.tex` the docx was built from. */
  texPath: string;
  anchors: number;
}

function newerThan(a: string, b: string): boolean {
  return fs.statSync(a).mtimeMs > fs.statSync(b).mtimeMs;
}

/** Folder of the bundled lua filters. */
function libDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

/**
 * Knit the `.Rnw` when rev.yaml gives a `knit` command, and return the `.tex`
 * to build from.
 */
export function resolveLatexTex(directory: string, config: BuildConfig, warnings: string[]): string {
  const sourcePath = path.resolve(directory, config.source!);
  if (!fs.existsSync(sourcePath)) throw new Error(`source not found: ${config.source}`);
  if (latexSourceKind(sourcePath) === 'tex') return sourcePath;

  const sourceDir = path.dirname(sourcePath);
  const texPath = sourcePath.replace(/\.rnw$/i, '.tex');
  if (config.knit) {
    try {
      execSync(config.knit, { cwd: sourceDir, stdio: 'pipe' });
    } catch (err) {
      const e = err as { stderr?: Buffer; message: string };
      throw new Error(`knit command failed: ${e.stderr?.toString().trim() || e.message}`);
    }
  }
  if (!fs.existsSync(texPath)) {
    throw new Error(`${path.basename(texPath)} not found next to ${path.basename(sourcePath)}; knit it first or set \`knit:\` in rev.yaml`);
  }
  if (newerThan(sourcePath, texPath)) {
    warnings.push(`${path.basename(sourcePath)} is newer than ${path.basename(texPath)}; the docx shows the last knitted version`);
  }
  return texPath;
}

/** Build the docx from the LaTeX source rev.yaml names. */
export async function buildLatexDocx(directory: string, config: BuildConfig, options: LatexBuildOptions = {}): Promise<LatexBuildResult> {
  const warnings: string[] = [];
  const texPath = resolveLatexTex(directory, config, warnings);
  const sourceDir = path.dirname(texPath);
  const stem = path.basename(texPath, path.extname(texPath));
  const cacheDir = path.join(directory, '.rev', 'latex');
  fs.mkdirSync(cacheDir, { recursive: true });

  const auxPath = path.join(sourceDir, `${stem}.aux`);
  let aux: AuxData | null = null;
  if (fs.existsSync(auxPath)) {
    aux = parseAux(fs.readFileSync(auxPath, 'utf-8'));
    if (newerThan(texPath, auxPath)) {
      warnings.push(`${stem}.aux is older than ${stem}.tex; numbers and references are those of the last LaTeX run`);
    }
  } else {
    warnings.push(`No ${stem}.aux next to ${stem}.tex: compile the PDF first so numbers and references match it; references show as ??`);
  }

  const source = fs.readFileSync(texPath, 'utf-8');
  const prepared = prepareLatexForPandoc(source, { sourceDir, cacheDir, aux });
  warnings.push(...prepared.warnings);

  const profile = profileFor(source);
  const extraArgs: string[] = ['--lua-filter', path.join(libDir(), 'latex-anchors.lua'), '--resource-path', sourceDir];
  const bibArgs: string[] = [];
  for (const bib of prepared.bibliographies) {
    if (!fs.existsSync(bib)) {
      warnings.push(`Bibliography not found: ${bib}`);
      continue;
    }
    const cleaned = path.join(cacheDir, path.basename(bib));
    fs.writeFileSync(cleaned, cleanBibliography(fs.readFileSync(bib, 'utf-8'), profile), 'utf-8');
    bibArgs.push('--bibliography', cleaned);
  }
  if (bibArgs.length > 0) extraArgs.push('--citeproc', ...bibArgs);
  if (config.csl) extraArgs.push('--csl', path.resolve(directory, config.csl));

  // The prepared copy sits beside the source so relative paths keep resolving.
  const preparedPath = path.join(sourceDir, `.${stem}.docrev.tex`);
  fs.writeFileSync(preparedPath, prepared.tex, 'utf-8');

  const { runPandoc, resolveOutputPath } = await import('./build.js');
  // Named after the source unless -o or output.docx says otherwise; the
  // title in rev.yaml plays no part, the LaTeX carries its own.
  const cliOverride = options.output ?? (config.output?.docx ? undefined : stem);
  const outputPath = resolveOutputPath(directory, config, 'docx', { cliOverride });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  try {
    const result = await runPandoc(preparedPath, 'docx', { ...config, bibliography: null }, {
      outputPath,
      crossref: false,
      verbose: options.verbose,
      pandocArgs: [...extraArgs, ...(options.pandocArgs ?? [])],
    });
    if (result.warnings) warnings.push(...result.warnings);
    return { success: result.success, outputPath: result.outputPath, error: result.error, warnings, texPath, anchors: prepared.anchors };
  } finally {
    fs.rmSync(preparedPath, { force: true });
  }
}
