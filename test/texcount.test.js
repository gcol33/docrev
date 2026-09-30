import { describe, it } from 'node:test';
import assert from 'node:assert';
import { countTexWords } from '../lib/tex-count.js';

describe('countTexWords', () => {
  it('counts the abstract, each section and back matter separately', () => {
    const tex = String.raw`
\documentclass{article}
\begin{document}
\begin{abstract}
Five abstract words here now.
\end{abstract}
\section{Introduction}
Six words stand in the introduction section.
\section{Methods}
Four words in methods.
\appendix
\section{Extra details}
Three back words.
\end{document}
`;
    const r = countTexWords(tex);
    assert.strictEqual(r.abstract, 5);
    assert.deepStrictEqual(r.sections.map(s => s.name), ['Introduction', 'Methods']);
    assert.strictEqual(r.sections[0].words, 8); // "Introduction" (1) + body (7)
    assert.strictEqual(r.sections[1].words, 5); // "Methods" (1) + body (4)
    assert.strictEqual(r.back, 5); // "Extra details" (2) + "Three back words." (3)
    assert.strictEqual(r.total, r.abstract + r.sections.reduce((s, x) => s + x.words, 0) + r.back);
  });

  it('drops the bibliography from every bucket', () => {
    const tex = String.raw`
\begin{document}
\section{Results}
Two results words.
\begin{thebibliography}{9}
\bibitem{a} Author, A. Some very long reference title that should never be counted.
\end{thebibliography}
\end{document}
`;
    const r = countTexWords(tex);
    assert.strictEqual(r.sections[0].words, 4); // "Results" (1) + body (3)
    assert.strictEqual(r.total, 4);
  });

  it('counts a figure caption under figures, not the section body', () => {
    const tex = String.raw`
\begin{document}
\section{Results}
Prose before the figure.
\begin{figure}
\includegraphics{plot.png}
\caption{Four words in caption.}
\label{fig:one}
\end{figure}
More prose after.
\end{document}
`;
    const r = countTexWords(tex);
    assert.strictEqual(r.figures, 4);
    assert.strictEqual(r.sections[0].words, 8); // "Results" (1) + "Prose before the figure." (4) + "More prose after." (3)
  });

  it('drops an unescaped comment but keeps an escaped percent sign', () => {
    const tex = String.raw`
\begin{document}
\section{Notes}
Real words here. % this comment must not be counted
A rate of 5\% was observed.
\end{document}
`;
    const r = countTexWords(tex);
    assert.strictEqual(r.sections[0].words, 10); // "Notes" (1) + "Real words here." (3) + "A rate of 5\% was observed." (6)
  });

  it('counts each equation as one word by default, and drops it with excludeFormulas', () => {
    const tex = String.raw`
\begin{document}
\section{Model}
The variance is
\begin{equation}
\sigma^2 = var(X)
\end{equation}
where $X$ is the design matrix.
\end{document}
`;
    const withEq = countTexWords(tex);
    const withoutEq = countTexWords(tex, { excludeFormulas: true });
    assert.strictEqual(withEq.sections[0].words - withoutEq.sections[0].words, 2); // the \begin{equation} block and the $X$
  });

  it('unwraps formatting commands and keeps their text', () => {
    const tex = String.raw`
\begin{document}
\section{Intro}
This is \textbf{very} \emph{important} work.
\end{document}
`;
    const r = countTexWords(tex);
    assert.strictEqual(r.sections[0].words, 6);
  });

  it('drops citation and label commands entirely', () => {
    const tex = String.raw`
\begin{document}
\section{Intro}
As shown \citep{smith2020}, this holds \label{sec:intro}.
\end{document}
`;
    const r = countTexWords(tex);
    assert.strictEqual(r.sections[0].words, 5); // "Intro" (1) + "As shown , this holds ." (4)
  });
});
