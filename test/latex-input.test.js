/**
 * LaTeX/knitr manuscript → docx build and Word comment sync back into the
 * source (gcol33/docrev#25).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';
import { findCommands, texToProse } from '../lib/tex-utils.js';
import { segmentLatexUnits, unitBookmarkName } from '../lib/latex-units.js';
import { profileFor, definedMacroNames } from '../lib/latex-classes.js';
import { parseAux, prepareLatexForPandoc, cleanBibliography, buildLatexDocx } from '../lib/latex-input.js';
import { syncLatexComments } from '../lib/latex-sync.js';
import { buildCommentBookmarkModel } from '../lib/ooxml.js';
import { loadConfig } from '../lib/build.js';
import { hasPandoc } from '../lib/dependencies.js';
import { addWordComments } from './helpers/add-word-comment.mjs';

const RNW = String.raw`\documentclass[article]{jss}
\usepackage{amsmath}
\newcommand{\fct}[1]{\code{#1()}}

<<setup, include=FALSE>>=
n <- 42
@

\author{Ann Author}
\title{\pkg{demo}: A Test in \proglang{R}}
\Plaintitle{demo}

\Abstract{
% @p:abs
The package \pkg{demo} computes things for \Sexpr{n} users.
}

\Keywords{testing, \proglang{R}}

\begin{document}

\section{Introduction} \label{sec:intro}

% @p:intro.first
First paragraph cites \citet{Smith2020} and points to
Section~\ref{sec:methods} and Equation~\eqref{eq:one}.

Second paragraph has no marker and mentions \fct{run\_it}.

% @p:fig.one
\begin{figure}[t]
\centering

\caption{A figure caption.\label{fig:one}}
\end{figure}

\section{Methods} \label{sec:methods}

% @p:methods.eq
The model is
\begin{equation}
y = x \label{eq:one}
\end{equation}
as Figure~\ref{fig:one} shows.

% @p:code.demo
<<demo>>=
summary(1:3)
@

\bibliography{refs}

\end{document}
`;

/** What knitr writes for RNW: chunk code and output in Schunk, \Sexpr evaluated. */
const TEX = RNW
  .replace('<<setup, include=FALSE>>=\nn <- 42\n@\n', '')
  .replace('\\Sexpr{n}', '42')
  .replace('<<demo>>=\nsummary(1:3)\n@', '\\begin{Schunk}\n\\begin{Sinput}\nR> summary(1:3)\n\\end{Sinput}\n\\begin{Soutput}\n   Min. 1st Qu.\n\n      1     1.5\n\\end{Soutput}\n\\end{Schunk}');

const AUX = String.raw`\relax
\newlabel{sec:intro}{{1}{1}{Introduction}{section.1}{}}
\newlabel{fig:one}{{1}{2}{A figure caption}{figure.1}{}}
\@writefile{lof}{\contentsline {figure}{\numberline {1}{\ignorespaces A figure caption.}}{2}{figure.1}\protected@file@percent }
\newlabel{sec:methods}{{2}{2}{Methods}{section.2}{}}
\newlabel{eq:one}{{1}{2}{}{equation.1}{}}
`;

const BIB = `@Manual{Smith2020,
  author = {Ann Smith},
  title = {{\\pkg{quickdemo}}: Quick Demos in \\proglang{R}},
  year = {2020},
}
`;

describe('tex-utils', () => {
  it('reads optional and braced arguments, skipping whitespace', () => {
    const [cmd] = findCommands('x \\section[short] {Long {nested}} y', 'section', 1);
    assert.deepStrictEqual(cmd.optional.map((g) => g.content), ['short']);
    assert.deepStrictEqual(cmd.args.map((g) => g.content), ['Long {nested}']);
  });

  it('does not match a longer command name', () => {
    assert.strictEqual(findCommands('\\citep{a} \\cite{b}', 'cite', 1).length, 1);
  });

  it('reads a tie as a space', () => {
    assert.match(texToProse('Layer~I prepares', true), /Layer I prepares/);
  });
});

describe('latex-units', () => {
  const units = (src, kind) => segmentLatexUnits(src, kind, ['Abstract']);

  it('gives the .Rnw and its knitted .tex the same keys in the same order', () => {
    const rnw = units(RNW, 'rnw').map((u) => u.key);
    const tex = units(TEX, 'tex').map((u) => u.key);
    assert.deepStrictEqual(tex, rnw);
    assert.deepStrictEqual(rnw, [
      'abs', 'abs+1', 'intro.first', 'intro.first+1', 'fig.one', 'fig.one+1', 'methods.eq', 'code.demo', 'code.demo+1',
    ]);
  });

  it('keeps a float with a blank line inside as one unit', () => {
    const fig = units(TEX, 'tex').find((u) => u.key === 'fig.one');
    assert.ok(fig.lines.some((l) => l.text.includes('\\caption')));
  });

  it('lets a marker followed by a blank line name the next paragraph', () => {
    const src = '\\begin{document}\n% @p:a\n\nText.\n\\end{document}\n';
    assert.deepStrictEqual(units(src, 'tex').map((u) => u.key), ['a']);
  });

  it('skips a code-only paragraph without a marker', () => {
    const src = '\\begin{document}\nText.\n\n<<x>>=\n1\n@\n\nMore.\n\\end{document}\n';
    assert.deepStrictEqual(units(src, 'rnw').map((u) => u.key), ['+1', '+2']);
  });

  it('names bookmarks distinctly within the Word limit', () => {
    assert.notStrictEqual(unitBookmarkName('a.b'), unitBookmarkName('a_2Eb'));
    assert.strictEqual(unitBookmarkName('intro.first+1'), 'rp_intro_2Efirst_2B1');
    const long = unitBookmarkName('x'.repeat(60));
    assert.ok(long.length <= 40 && long.startsWith('rp_h'));
  });
});

describe('latex-classes', () => {
  it('selects the jss profile from \\documentclass', () => {
    const p = profileFor(RNW);
    assert.deepStrictEqual(p.abstract, ['Abstract']);
    assert.strictEqual(p.macros.pkg.body, '\\textbf{#1}');
  });

  it('finds the macros a document defines itself', () => {
    const names = definedMacroNames('\\newcommand{\\fct}[1]{x}\\newcommand\\cls{y}\\def\\z{}');
    assert.deepStrictEqual([...names].sort(), ['cls', 'fct', 'z']);
  });
});

describe('parseAux', () => {
  it('reads labels and the list of figures', () => {
    const aux = parseAux(AUX);
    assert.deepStrictEqual(aux.labels.get('eq:one'), { number: '1', page: '2', title: '', anchor: 'equation.1' });
    assert.deepStrictEqual(aux.figures, ['1']);
    assert.deepStrictEqual(aux.tables, []);
  });
});

describe('prepareLatexForPandoc', () => {
  const prepared = prepareLatexForPandoc(TEX, {
    sourceDir: os.tmpdir(),
    cacheDir: os.tmpdir(),
    aux: parseAux(AUX),
    renderFigures: false,
  });
  const tex = prepared.tex;

  it('defines the class macros, keeping the document\'s own definition', () => {
    assert.match(tex, /\\newcommand\{\\pkg\}\[1\]\{\\textbf\{#1\}\}/);
    assert.doesNotMatch(tex, /\\newcommand\{\\fct\}\[1\]\{\\texttt/);
  });

  it('moves the abstract and keywords into the body', () => {
    assert.doesNotMatch(tex, /\\Abstract\{/);
    assert.match(tex, /\\begin\{document\}\s*\\begin\{abstract\}[\s\S]*computes things for 42 users[\s\S]*\\end\{abstract\}/);
    assert.match(tex, /\\textit\{Keywords\}: testing/);
  });

  it('numbers headings, captions and equations and resolves references from the .aux', () => {
    assert.match(tex, /\\section\{1 Introduction\}/);
    assert.match(tex, /\\section\{2 Methods\}/);
    assert.match(tex, /\\caption\{Figure 1: A figure caption\./);
    assert.match(tex, /y = x \\qquad\(1\)\n\\end\{equation\}/);
    assert.match(tex, /Section~2 and Equation~\(1\)/);
    assert.match(tex, /as Figure~1 shows/);
    assert.doesNotMatch(tex, /\\label\{/);
    assert.deepStrictEqual(prepared.warnings, []);
  });

  it('turns knitr code and output into verbatim blocks', () => {
    assert.doesNotMatch(tex, /Schunk|Sinput|Soutput/);
    assert.match(tex, /\\begin\{verbatim\}\nR> summary\(1:3\)\n\\end\{verbatim\}/);
  });

  it('anchors every unit and leaves the reference list to citeproc', () => {
    assert.strictEqual(prepared.anchors, 9);
    assert.match(tex, /\\hypertarget\{rp_abs\}\{\}/);
    assert.match(tex, /\\hypertarget\{refs\}\{\}/);
    assert.deepStrictEqual(prepared.bibliographies.map((b) => path.basename(b)), ['refs.bib']);
  });
});

describe('cleanBibliography', () => {
  it('reduces class macros to their braced argument', () => {
    const out = cleanBibliography(BIB, profileFor(RNW));
    assert.match(out, /title = \{\{\{quickdemo\}\}: Quick Demos in \{R\}\}/);
  });
});

describe('buildCommentBookmarkModel', () => {
  it('assigns each comment the last accepted bookmark before it', () => {
    const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const xml = `<w:document xmlns:w="${W}"><w:body>
      <w:p><w:bookmarkStart w:id="1" w:name="rp_a"/><w:r><w:t>Alpha </w:t></w:r><w:commentRangeStart w:id="0"/><w:r><w:t>beta</w:t></w:r><w:commentRangeEnd w:id="0"/></w:p>
      <w:p><w:bookmarkStart w:id="2" w:name="heading-id"/><w:r><w:t>Gamma</w:t></w:r><w:commentRangeStart w:id="1"/><w:r><w:t>delta</w:t></w:r><w:commentRangeEnd w:id="1"/></w:p>
    </w:body></w:document>`;
    const model = buildCommentBookmarkModel(xml, (n) => n.startsWith('rp_'));
    assert.deepStrictEqual(model.comments, [
      { id: '0', anchor: 'beta', bookmark: 'rp_a' },
      { id: '1', anchor: 'delta', bookmark: 'rp_a' },
    ]);
  });
});

describe('LaTeX source round trip', { skip: !hasPandoc() }, () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-latex-'));
    fs.mkdirSync(path.join(dir, 'paper'));
    fs.writeFileSync(path.join(dir, 'paper', 'paper.Rnw'), RNW);
    fs.writeFileSync(path.join(dir, 'paper', 'paper.tex'), TEX);
    fs.writeFileSync(path.join(dir, 'paper', 'paper.aux'), AUX);
    fs.writeFileSync(path.join(dir, 'paper', 'refs.bib'), BIB);
    // The .tex is knitted from the .Rnw, so it is the newer of the two.
    const later = new Date(Date.now() + 2000);
    fs.utimesSync(path.join(dir, 'paper', 'paper.tex'), later, later);
    fs.utimesSync(path.join(dir, 'paper', 'paper.aux'), later, later);
    fs.writeFileSync(path.join(dir, 'rev.yaml'), 'source: paper/paper.Rnw\noutputDir: output\n');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  async function build() {
    const result = await buildLatexDocx(dir, loadConfig(dir));
    assert.ok(result.success, result.error);
    return result;
  }

  it('builds a docx with the class macro text, numbers, citations and anchors', async () => {
    const result = await build();
    assert.strictEqual(path.basename(result.outputPath), 'paper.docx');
    const xml = new AdmZip(result.outputPath).readAsText('word/document.xml');
    const text = xml.replace(/<[^>]+>/g, '');
    assert.match(text, /The package demo computes things for 42 users/);
    assert.match(text, /run_it\(\)/);
    assert.match(text, /Figure 1: A figure caption/);
    assert.match(text, /Section\s2 and Equation\s\(1\)/);
    assert.match(text, /Quick Demos in R/);
    for (const key of ['abs', 'intro.first', 'intro.first+1', 'methods.eq']) {
      assert.ok(xml.includes(`w:name="${unitBookmarkName(key)}"`), `bookmark for ${key}`);
    }
  });

  it('writes Word comments into the .Rnw by paragraph, once', async () => {
    const { outputPath } = await build();
    addWordComments(outputPath, [
      { anchor: 'points to', author: 'Reviewer 1', text: 'Which section?' },
      { replyTo: 0, author: 'Ann', text: 'Methods.' },
      { anchor: 'Second paragraph has no marker', author: 'Reviewer 2', text: 'Add a marker.' },
      { anchor: 'computes things', author: 'Reviewer 1', text: 'How many?' },
    ]);
    const rnwPath = path.join(dir, 'paper', 'paper.Rnw');

    // The author edits the source after sending the docx: a new paragraph
    // before the commented ones and a reworded first sentence.
    const edited = RNW
      .replace('\\section{Introduction} \\label{sec:intro}\n', '\\section{Introduction} \\label{sec:intro}\n\n% @p:intro.new\nA new opening paragraph.\n')
      .replace('First paragraph cites', 'The first paragraph cites');
    fs.writeFileSync(rnwPath, edited);

    const first = syncLatexComments(outputPath, rnwPath);
    assert.strictEqual(first.placed, 4);
    assert.strictEqual(first.unanchored, 0);
    const lines = fs.readFileSync(rnwPath, 'utf-8').split('\n');
    const at = (needle) => lines.findIndex((l) => l.includes(needle));
    assert.strictEqual(at('{>>Reviewer 1: Which section?<<}{>>↪ Ann: Methods.<<}'), at('The first paragraph cites') - 1);
    assert.strictEqual(at('{>>Reviewer 2: Add a marker.<<}'), at('and mentions \\fct{run') - 1);
    assert.strictEqual(at('{>>Reviewer 1: How many?<<}'), at('computes things for') - 1);
    assert.match(lines[at('Which section?')], /^% \{==points to==\}/);

    const second = syncLatexComments(outputPath, rnwPath);
    assert.strictEqual(second.deduped, 4);
    assert.strictEqual(second.placed, 0);
  });
});
