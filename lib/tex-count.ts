/**
 * Word counts for a LaTeX manuscript.
 *
 * `countWords` (utils.ts) assumes Markdown syntax; a `.tex` source needs its
 * own strip rules (comments, environments, commands) before the same
 * word-splitting logic applies. Reported separately, matching how a journal
 * states its limit: abstract, each top-level `\section`, figure/table
 * captions, and back matter (from `\appendix` on). The bibliography itself
 * (`\begin{thebibliography}`, `\bibliography{}`, `\printbibliography`) is
 * dropped entirely, never counted.
 */

import { findBalanced, replaceCommand, stripComments, texToProse } from './tex-utils.js';

function countProseWords(text: string): number {
  return text
    .split(/\s+/)
    .filter(w => /[\p{L}\p{N}]/u.test(w)).length;
}

/** A manuscript split into top-level `\section{...}` bodies, plus whatever precedes the first one. */
function splitSections(chunk: string, excludeFormulas: boolean): { front: number; sections: TexSectionCount[] } {
  const sectionRe = /\\section\*?\{/g;
  const found: { title: string; bodyStart: number; headStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = sectionRe.exec(chunk))) {
    const braceOpen = m.index + m[0].length - 1;
    const braceClose = findBalanced(chunk, braceOpen);
    if (braceClose === -1) continue;
    found.push({ title: chunk.slice(braceOpen + 1, braceClose), bodyStart: braceClose + 1, headStart: m.index });
    sectionRe.lastIndex = braceClose + 1;
  }

  const frontText = found.length ? chunk.slice(0, found[0]!.headStart) : chunk;
  const sections: TexSectionCount[] = found.map((f, idx) => {
    const bodyEnd = idx + 1 < found.length ? found[idx + 1]!.headStart : chunk.length;
    const body = chunk.slice(f.bodyStart, bodyEnd);
    const words = countProseWords(texToProse(`${f.title} ${body}`, excludeFormulas));
    return { name: f.title.trim() || `Section ${idx + 1}`, words };
  });
  const front = countProseWords(texToProse(frontText, excludeFormulas));
  return { front, sections };
}

export interface TexSectionCount {
  name: string;
  words: number;
}

export interface TexCountResult {
  front: number;
  abstract: number;
  sections: TexSectionCount[];
  figures: number;
  tables: number;
  back: number;
  total: number;
}

export interface TexCountOptions {
  /** Drop math and code listings entirely instead of counting each as one word. */
  excludeFormulas?: boolean;
}

/**
 * Count the prose words of a LaTeX manuscript, broken down the way a journal
 * states its limit: abstract, each top-level section, figure/table captions,
 * and back matter (from `\appendix` on). The bibliography is excluded, never
 * counted under any bucket.
 */
export function countTexWords(source: string, options: TexCountOptions = {}): TexCountResult {
  const excludeFormulas = options.excludeFormulas ?? false;
  let text = stripComments(source);

  const docMatch = text.match(/\\begin\{document\}([\s\S]*)\\end\{document\}/);
  if (docMatch) text = docMatch[1] ?? '';

  // The reference list is never counted, under any bucket.
  text = text.replace(/\\begin\{thebibliography\}[\s\S]*?\\end\{thebibliography\}/g, ' ');
  text = text.replace(/\\bibliography\{[^}]*\}/g, ' ');
  text = text.replace(/\\bibliographystyle\{[^}]*\}/g, ' ');
  text = text.replace(/\\printbibliography(?:\[[^\]]*\])?/g, ' ');

  // Floats: only the caption is prose; the rest (graphics, tabular data) is dropped.
  let figureWords = 0;
  let tableWords = 0;
  text = text.replace(/\\begin\{(figure|table)\*?\}([\s\S]*?)\\end\{\1\*?\}/g, (_full, kind: string, body: string) => {
    let captionWords = 0;
    replaceCommand(body, 'caption', arg => {
      captionWords += countProseWords(texToProse(arg, excludeFormulas));
      return ' ';
    });
    if (kind === 'figure') figureWords += captionWords;
    else tableWords += captionWords;
    return ' ';
  });

  // Abstract: `\begin{abstract}...\end{abstract}` or `\abstract{...}`.
  let abstractWords = 0;
  const abstractEnv = text.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
  if (abstractEnv) {
    abstractWords = countProseWords(texToProse(abstractEnv[1] ?? '', excludeFormulas));
    text = text.replace(abstractEnv[0]!, ' ');
  } else {
    text = replaceCommand(text, 'abstract', arg => {
      abstractWords = countProseWords(texToProse(arg, excludeFormulas));
      return ' ';
    });
  }

  // Back matter: everything from `\appendix` on, reported separately.
  const appendixIdx = text.search(/\\appendix\b/);
  const mainText = appendixIdx === -1 ? text : text.slice(0, appendixIdx);
  const backText = appendixIdx === -1 ? '' : text.slice(appendixIdx).replace(/^\\appendix\b/, '');

  const { front, sections } = splitSections(mainText, excludeFormulas);
  const back = backText.trim() ? countProseWords(texToProse(backText, excludeFormulas)) : 0;

  const total = front + abstractWords + sections.reduce((s, x) => s + x.words, 0) + figureWords + tableWords + back;

  return { front, abstract: abstractWords, sections, figures: figureWords, tables: tableWords, back, total };
}
