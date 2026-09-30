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

const MATH_ENVS = ['equation', 'align', 'gather', 'multline', 'eqnarray', 'flalign'];
const CODE_ENVS = ['verbatim', 'Verbatim', 'lstlisting', 'minted'];

// Commands whose brace argument is prose and should be kept as text.
const UNWRAP_COMMANDS = [
  'textbf', 'textit', 'emph', 'underline', 'textsc', 'textrm', 'texttt',
  'textnormal', 'textsl', 'footnote', 'subsection', 'subsubsection',
  'paragraph', 'subparagraph', 'textsuperscript', 'textsubscript', 'uline',
];

// Commands whose brace argument carries no prose (a key, path or label) and
// should be dropped along with the command.
const DROP_COMMANDS = [
  'label', 'ref', 'eqref', 'autoref', 'pageref', 'nameref',
  'cite', 'citep', 'citet', 'citeauthor', 'citeyear', 'citealp', 'citealt',
  'citenum', 'parencite', 'textcite', 'footcite',
  'includegraphics', 'input', 'include', 'footnotemark', 'url', 'href',
];

/** Find the index of the `}` matching the `{` at `text[openIdx]`. -1 if unterminated. */
function findBalanced(text: string, openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; } // skip escaped char, incl. \{ and \}
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Replace every `\name[opt]{arg}` (or `\name*[opt]{arg}`) with `replacer(arg)`.
 * An occurrence with no immediate brace argument is left untouched.
 */
function replaceCommand(text: string, name: string, replacer: (arg: string) => string): string {
  const re = new RegExp(`\\\\${name}\\*?`, 'g');
  let result = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let i = m.index + m[0].length;
    if (text[i] === '[') {
      const close = text.indexOf(']', i);
      if (close !== -1) i = close + 1;
    }
    if (text[i] !== '{') continue;
    const close = findBalanced(text, i);
    if (close === -1) continue;
    result += text.slice(last, m.index) + replacer(text.slice(i + 1, close));
    last = close + 1;
    re.lastIndex = last;
  }
  return result + text.slice(last);
}

/** Strip `%` line comments (an escaped `\%` is a literal percent sign, not a comment). */
function stripComments(text: string): string {
  return text
    .split('\n')
    .map(line => {
      let i = 0;
      while (i < line.length) {
        if (line[i] === '\\') { i += 2; continue; }
        if (line[i] === '%') return line.slice(0, i);
        i++;
      }
      return line;
    })
    .join('\n');
}

/** Replace display/inline math and code listings with one placeholder word each, or drop them. */
function stripMathAndCode(text: string, excludeFormulas: boolean): string {
  const placeholder = (tag: string) => (excludeFormulas ? ' ' : ` ${tag} `);

  return text
    .replace(new RegExp(`\\\\begin\\{(${MATH_ENVS.join('|')})\\*?\\}[\\s\\S]*?\\\\end\\{\\1\\*?\\}`, 'g'), placeholder('EQN'))
    .replace(new RegExp(`\\\\begin\\{(${CODE_ENVS.join('|')})\\}(?:\\[[^\\]]*\\]|\\{[^}]*\\})?[\\s\\S]*?\\\\end\\{\\1\\}`, 'g'), placeholder('CODE'))
    .replace(/\\\[[\s\S]*?\\\]/g, placeholder('EQN'))
    .replace(/\\\([\s\S]*?\\\)/g, placeholder('EQN'))
    .replace(/\$\$[\s\S]*?\$\$/g, placeholder('EQN'))
    .replace(/(?<!\\)\$(?:[^$\\]|\\.)*(?<!\\)\$/g, placeholder('EQN'))
    .replace(/\\verb\*?(.)[\s\S]*?\1/g, placeholder('CODE'));
}

/** Reduce prose-bearing LaTeX down to plain text, ready for word-splitting. */
function texToProse(text: string, excludeFormulas: boolean): string {
  let out = stripMathAndCode(text, excludeFormulas);
  for (const name of UNWRAP_COMMANDS) out = replaceCommand(out, name, arg => ` ${arg} `);
  for (const name of DROP_COMMANDS) out = replaceCommand(out, name, () => ' ');
  return out
    .replace(/\\[a-zA-Z]+\*?/g, ' ') // any remaining command name (\maketitle, \noindent, \\, ...)
    .replace(/[{}]/g, ' ')
    .replace(/&/g, ' ');
}

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
