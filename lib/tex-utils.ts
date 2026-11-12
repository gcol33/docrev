/**
 * Shared LaTeX source primitives: balanced-group scanning, command argument
 * reading, comment stripping and reduction of prose-bearing LaTeX to plain
 * text. Used by the word count (tex-count.ts) and the LaTeX input adapter
 * (latex-input.ts, latex-sync.ts).
 */

export const MATH_ENVS = ['equation', 'align', 'gather', 'multline', 'eqnarray', 'flalign'];
export const CODE_ENVS = ['verbatim', 'Verbatim', 'lstlisting', 'minted'];

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
export function findBalanced(text: string, openIdx: number, open = '{', close = '}'): number {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue; } // skip escaped char, incl. \{ and \}
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** A `{...}` or `[...]` group: offsets of the delimiters and the content between them. */
export interface TexGroup {
  open: number;
  close: number;
  content: string;
}

/** A command occurrence with the argument groups read after it. */
export interface TexCommand {
  name: string;
  /** Offset of the backslash. */
  start: number;
  /** Offset just past the last group read (or the name when no group follows). */
  end: number;
  star: boolean;
  optional: TexGroup[];
  args: TexGroup[];
}

/**
 * Every occurrence of `\name` (not a prefix of a longer command name), with
 * its optional `[...]` groups and up to `braced` `{...}` groups. Whitespace
 * between the name and its groups is skipped, as TeX does. An occurrence
 * missing a required braced group is still returned, with fewer `args`.
 */
export function findCommands(text: string, name: string, braced: number): TexCommand[] {
  const re = new RegExp(`\\\\${name}(?![A-Za-z@])(\\*?)`, 'g');
  const out: TexCommand[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const cmd: TexCommand = { name, start: m.index, end: m.index + m[0].length, star: m[1] === '*', optional: [], args: [] };
    let i = cmd.end;
    for (;;) {
      let j = i;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      if (text[j] === '[' && cmd.args.length === 0) {
        const close = findBalanced(text, j, '[', ']');
        if (close === -1) break;
        cmd.optional.push({ open: j, close, content: text.slice(j + 1, close) });
        i = close + 1;
        continue;
      }
      if (text[j] === '{' && cmd.args.length < braced) {
        const close = findBalanced(text, j);
        if (close === -1) break;
        cmd.args.push({ open: j, close, content: text.slice(j + 1, close) });
        i = close + 1;
        continue;
      }
      break;
    }
    if (cmd.optional.length > 0 || cmd.args.length > 0) cmd.end = i;
    out.push(cmd);
    re.lastIndex = Math.max(cmd.end, m.index + 1);
  }
  return out;
}

/** Apply non-overlapping replacements `[start, end, text]` to `source`. */
export function applyReplacements(source: string, edits: Array<[number, number, string]>): string {
  const sorted = [...edits].sort((a, b) => a[0] - b[0]);
  let out = '';
  let last = 0;
  for (const [start, end, text] of sorted) {
    if (start < last) continue;
    out += source.slice(last, start) + text;
    last = end;
  }
  return out + source.slice(last);
}

/**
 * Replace every `\name[opt]{arg}` (or `\name*[opt]{arg}`) with `replacer(arg)`.
 * An occurrence with no immediate brace argument is left untouched.
 */
export function replaceCommand(text: string, name: string, replacer: (arg: string) => string): string {
  const edits: Array<[number, number, string]> = [];
  for (const cmd of findCommands(text, name, 1)) {
    if (cmd.args.length === 0) continue;
    edits.push([cmd.start, cmd.end, replacer(cmd.args[0]!.content)]);
  }
  return applyReplacements(text, edits);
}

/** Offset of the first unescaped `%` in `line`, or -1 when the line has no comment. */
export function commentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line[i] === '%') return i;
  }
  return -1;
}

/** Strip `%` line comments (an escaped `\%` is a literal percent sign, not a comment). */
export function stripComments(text: string): string {
  return text
    .split('\n')
    .map(line => {
      const idx = commentStart(line);
      return idx === -1 ? line : line.slice(0, idx);
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

/**
 * Reduce prose-bearing LaTeX down to plain text, ready for word-splitting.
 * Math and code become one placeholder word each (`EQN`, `CODE`), or nothing
 * with `excludeFormulas`.
 */
export function texToProse(text: string, excludeFormulas: boolean): string {
  let out = stripMathAndCode(text, excludeFormulas);
  for (const name of UNWRAP_COMMANDS) out = replaceCommand(out, name, arg => ` ${arg} `);
  for (const name of DROP_COMMANDS) out = replaceCommand(out, name, () => ' ');
  return out
    .replace(/(?<!\\)~/g, ' ') // a tie is an unbreakable space between two words
    .replace(/\\[a-zA-Z]+\*?/g, ' ') // any remaining command name (\maketitle, \noindent, \\, ...)
    .replace(/[{}]/g, ' ')
    .replace(/&/g, ' ');
}
