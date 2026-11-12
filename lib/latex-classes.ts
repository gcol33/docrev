/**
 * Document-class macro tables for reading a LaTeX manuscript with pandoc.
 *
 * pandoc's LaTeX reader knows the standard classes but not journal classes:
 * it drops the content of a macro it cannot expand (`\pkg{couplr}` vanishes).
 * Each profile maps a class's macros to pandoc-readable LaTeX. The same table
 * feeds two consumers: `\newcommand` definitions ahead of the pandoc read, and
 * `\providecommand` definitions in the standalone document that renders a
 * TikZ picture (latex-input.ts).
 *
 * Front-matter roles name the commands whose argument is the abstract or the
 * keywords; the adapter moves them into the body, where pandoc reads them.
 */

import { findCommands } from './tex-utils.js';

export interface LatexMacro {
  /** Number of mandatory arguments. */
  args: number;
  /** Replacement body, with `#1`..`#9` for the arguments; '' drops the macro and its arguments. */
  body: string;
}

export interface LatexClassProfile {
  macros: Record<string, LatexMacro>;
  /** Commands whose single argument is the abstract (e.g. jss `\Abstract`). */
  abstract: string[];
  /** Commands whose single argument is the keyword list (e.g. jss `\Keywords`). */
  keywords: string[];
}

const drop = (args: number): LatexMacro => ({ args, body: '' });

/** Macros of packages any class may load. */
const COMMON: LatexClassProfile = {
  macros: {
    orcidlink: drop(1),
    email: { args: 1, body: '\\href{mailto:#1}{#1}' },
  },
  abstract: [],
  keywords: [],
};

/**
 * Journal of Statistical Software (`jss.cls`). `\fct` and `\class` are not
 * defined by the class but by the JSS author template; a document that
 * defines them itself keeps its own definition.
 */
const JSS: LatexClassProfile = {
  macros: {
    pkg: { args: 1, body: '\\textbf{#1}' },
    proglang: { args: 1, body: '#1' },
    code: { args: 1, body: '\\texttt{#1}' },
    fct: { args: 1, body: '\\texttt{#1()}' },
    class: { args: 1, body: "`\\texttt{#1}'" },
    doi: { args: 1, body: '\\href{https://doi.org/#1}{doi:#1}' },
    And: { args: 0, body: '\\and' },
    AND: { args: 0, body: '\\and' },
    Plainauthor: drop(1),
    Plaintitle: drop(1),
    Shorttitle: drop(1),
    Plainkeywords: drop(1),
    Address: drop(1),
    Volume: drop(1),
    Issue: drop(1),
    Month: drop(1),
    Year: drop(1),
    Submitdate: drop(1),
    Acceptdate: drop(1),
  },
  abstract: ['Abstract'],
  keywords: ['Keywords'],
};

/** Profiles by document class name. */
export const LATEX_CLASS_PROFILES: Record<string, LatexClassProfile> = {
  jss: JSS,
};

/** The document class named by `\documentclass{...}`, or null. */
export function documentClassOf(source: string): string | null {
  const cmd = findCommands(source, 'documentclass', 1).find(c => c.args.length === 1);
  return cmd ? cmd.args[0]!.content.trim() : null;
}

/** The common profile merged with the profile of the source's document class. */
export function profileFor(source: string): LatexClassProfile {
  const cls = documentClassOf(source);
  const own = cls ? LATEX_CLASS_PROFILES[cls] : undefined;
  if (!own) return COMMON;
  return {
    macros: { ...COMMON.macros, ...own.macros },
    abstract: [...COMMON.abstract, ...own.abstract],
    keywords: [...COMMON.keywords, ...own.keywords],
  };
}

/**
 * One definition line per macro, skipping names in `exclude` (the macros the
 * document defines itself, whose definition wins).
 */
export function macroDefinitions(
  profile: LatexClassProfile,
  command: 'newcommand' | 'providecommand',
  exclude: Set<string> = new Set()
): string {
  const lines: string[] = [];
  for (const [name, macro] of Object.entries(profile.macros)) {
    if (exclude.has(name)) continue;
    const arity = macro.args > 0 ? `[${macro.args}]` : '';
    lines.push(`\\${command}{\\${name}}${arity}{${macro.body}}`);
  }
  return lines.join('\n');
}

/** Names the document defines with `\newcommand`, `\renewcommand`, `\providecommand` or `\def`. */
export function definedMacroNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const command of ['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand']) {
    for (const cmd of findCommands(source, command, 1)) {
      const m = cmd.args[0]?.content.trim().match(/^\\([A-Za-z@]+)$/);
      if (m) names.add(m[1]!);
    }
  }
  for (const m of source.matchAll(/\\(?:(?:re|provide)?newcommand\*?\s*|def)\\([A-Za-z@]+)/g)) names.add(m[1]!);
  return names;
}
