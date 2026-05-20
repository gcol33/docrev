/**
 * Placeholder/highlight macros for docrev.
 *
 * Users write `\tofill{X}` (or any custom macro they declare) in markdown
 * source and the build pipeline expands it per output format:
 *
 *   - docx: raw OpenXML run with explicit color + bold (Span+style is NOT
 *     honored by pandoc's docx writer, so we emit raw <w:r> nodes).
 *   - pdf / tex / beamer: a `\providecommand` is injected via header-includes,
 *     so the LaTeX command works directly. `\providecommand` means the user
 *     can still override with `\renewcommand` in their own preamble.
 *   - html: raw HTML span with inline style.
 *   - everything else (markdown, gfm, etc.): bold [X] fallback. Never silently
 *     dropped.
 *
 * The mechanism is generic: `\tofill` is the first built-in. Users can add
 * their own macros under `macros:` in rev.yaml, and override the built-in by
 * declaring a macro with the same name.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// =============================================================================
// Types
// =============================================================================

/**
 * Per-format rendering rules for a macro.
 *
 * Fields are independent — set any subset. Unset fields fall back to defaults
 * (no color, no bold, no italic, bracket wrap on, etc.).
 */
export interface MacroFormatStyle {
  /** Hex color without '#' (e.g. "C2410C"). */
  color?: string;
  /** Wrap the rendered content in bold. */
  bold?: boolean;
  /** Wrap the rendered content in italic. */
  italic?: boolean;
  /** Wrap the content in [...] brackets. Default: true. */
  bracket?: boolean;
  /** Optional literal prefix string inside the brackets (e.g. "NOTE: "). */
  prefix?: string;
  /** Optional literal suffix string inside the brackets. */
  suffix?: string;
}

/**
 * Macro definition. `name` is the LaTeX command name without the leading
 * backslash (e.g. "tofill" → \tofill{...}). `formats` holds per-format rules;
 * a missing format key inherits from `default`.
 */
export interface MacroDef {
  name: string;
  /** Default rendering rules; used when a format-specific override is absent. */
  default?: MacroFormatStyle;
  /** Per-format overrides, keyed by pandoc format (docx, pdf, html, ...). */
  formats?: Record<string, MacroFormatStyle>;
}

/**
 * Built-in macros shipped with docrev. The first entry is the original use
 * case: \tofill{X} → bold orange [X] placeholder.
 */
export const BUILTIN_MACROS: MacroDef[] = [
  {
    name: 'tofill',
    default: { color: 'C2410C', bold: true, bracket: true },
  },
];

// =============================================================================
// Validation
// =============================================================================

const MACRO_NAME_RE = /^[A-Za-z][A-Za-z0-9]*$/;
const HEX_COLOR_RE = /^[0-9A-Fa-f]{6}$/;

/**
 * Validate a user-declared macro entry. Returns a list of error strings;
 * empty means the macro is valid.
 */
export function validateMacro(macro: unknown): string[] {
  const errors: string[] = [];

  if (!macro || typeof macro !== 'object' || Array.isArray(macro)) {
    return ['macro must be an object'];
  }
  const m = macro as Partial<MacroDef>;

  if (!m.name || typeof m.name !== 'string') {
    errors.push('macro.name is required');
  } else if (!MACRO_NAME_RE.test(m.name)) {
    errors.push(`macro.name "${m.name}" must match [A-Za-z][A-Za-z0-9]*`);
  }

  const checkStyle = (style: unknown, key: string): void => {
    if (style === undefined) return;
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
      errors.push(`${key} must be an object`);
      return;
    }
    const s = style as MacroFormatStyle;
    if (s.color !== undefined && (typeof s.color !== 'string' || !HEX_COLOR_RE.test(s.color))) {
      errors.push(`${key}.color must be a 6-digit hex string without '#' (got "${s.color}")`);
    }
    for (const flag of ['bold', 'italic', 'bracket'] as const) {
      if (s[flag] !== undefined && typeof s[flag] !== 'boolean') {
        errors.push(`${key}.${flag} must be a boolean`);
      }
    }
    for (const text of ['prefix', 'suffix'] as const) {
      if (s[text] !== undefined && typeof s[text] !== 'string') {
        errors.push(`${key}.${text} must be a string`);
      }
    }
  };

  checkStyle(m.default, 'macro.default');
  if (m.formats !== undefined) {
    if (!m.formats || typeof m.formats !== 'object' || Array.isArray(m.formats)) {
      errors.push('macro.formats must be an object keyed by format name');
    } else {
      for (const [fmt, style] of Object.entries(m.formats)) {
        checkStyle(style, `macro.formats.${fmt}`);
      }
    }
  }

  return errors;
}

// =============================================================================
// Merge
// =============================================================================

/**
 * Merge built-in macros with user-declared macros. User entries override
 * built-ins by `name` (case-sensitive). Invalid entries are dropped with a
 * console warning so a malformed user macro never silently disables the
 * built-in.
 */
export function mergeMacros(userMacros: unknown): MacroDef[] {
  const builtins = new Map<string, MacroDef>();
  for (const m of BUILTIN_MACROS) builtins.set(m.name, m);

  if (!userMacros) return [...builtins.values()];
  if (!Array.isArray(userMacros)) {
    console.warn('macros: rev.yaml `macros` must be a list; ignoring');
    return [...builtins.values()];
  }

  for (const raw of userMacros) {
    const errors = validateMacro(raw);
    if (errors.length > 0) {
      console.warn(`macros: skipping invalid macro: ${errors.join('; ')}`);
      continue;
    }
    const def = raw as MacroDef;
    builtins.set(def.name, def);
  }

  return [...builtins.values()];
}

// =============================================================================
// LaTeX preamble generation (PDF / tex / beamer)
// =============================================================================

/**
 * Build the LaTeX color spec for a style. Returns the wrapping LaTeX with a
 * `#1` placeholder where the argument lands.
 */
function latexCommandBody(style: MacroFormatStyle): string {
  const prefix = style.prefix ? escapeLatex(style.prefix) : '';
  const suffix = style.suffix ? escapeLatex(style.suffix) : '';
  const inner = `${prefix}#1${suffix}`;
  const bracketed = style.bracket === false ? inner : `[${inner}]`;

  let body = bracketed;
  if (style.italic) body = `\\textit{${body}}`;
  if (style.bold) body = `\\textbf{${body}}`;
  if (style.color) body = `\\textcolor[HTML]{${style.color.toUpperCase()}}{${body}}`;
  return body;
}

/**
 * Generate `\providecommand` definitions for all macros. `\providecommand`
 * means user-supplied `\renewcommand` (in a custom header-includes file) still
 * wins, preserving backwards compat with existing projects.
 *
 * Returns an empty string when the macro list is empty.
 */
export function generateLatexPreamble(macros: MacroDef[]): string {
  const lines: string[] = ['% docrev: placeholder macros'];
  // \textcolor in [HTML]{...} requires xcolor with the [HTML] option.
  lines.push('\\PassOptionsToPackage{HTML}{xcolor}');
  // Some templates already load xcolor; \usepackage tolerates duplicates with
  // the same options.
  lines.push('\\usepackage[HTML]{xcolor}');

  for (const m of macros) {
    const style = pickStyle(m, 'latex');
    const body = latexCommandBody(style);
    lines.push(`\\providecommand{\\${m.name}}[1]{${body}}`);
  }

  return lines.join('\n');
}

function escapeLatex(s: string): string {
  // Conservative escape — these are user-authored short literals (prefix/suffix).
  return s
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([&%$#_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

// =============================================================================
// Style resolution per format
// =============================================================================

/**
 * Resolve the effective style for a macro in a given pandoc format. Per-format
 * override wins over the macro's default; both can be partial — fields are
 * not merged across `default` and `formats[fmt]` (the format-specific entry
 * replaces `default` entirely when present), keeping rev.yaml semantics
 * predictable.
 *
 * Falls back to `default` when no `formats[fmt]` exists, and to an empty
 * style ({}) when neither is set.
 */
export function pickStyle(macro: MacroDef, format: string): MacroFormatStyle {
  const fmt = macro.formats?.[format];
  if (fmt) return fmt;
  return macro.default ?? {};
}

// =============================================================================
// Lua filter sidecar
// =============================================================================

/**
 * Serialize the macro list to a compact JSON sidecar consumed by the lua
 * filter at build time. The lua filter reads this file at startup and uses it
 * to expand `\tofill{X}` (or any other declared macro) per FORMAT.
 *
 * Returns the absolute path to the written sidecar.
 */
export function writeMacrosSidecar(directory: string, macros: MacroDef[]): string {
  const sidecarPath = path.join(directory, '.macros.json');
  fs.writeFileSync(sidecarPath, JSON.stringify({ macros }), 'utf-8');
  return sidecarPath;
}

/**
 * Resolve the absolute path to the bundled lua filter. Works both from source
 * (`lib/macro-filter.lua`) and from the compiled package (`dist/lib/...`)
 * because the postbuild script copies .lua files alongside the .js output.
 */
export function getMacroFilterPath(): string {
  // import.meta.url points to the running file: lib/macros.ts in source,
  // dist/lib/macros.js when published. The filter sits next to it.
  //
  // Use fileURLToPath so paths with spaces (Windows: "C:\Users\Gilles Colling\…")
  // resolve correctly. The naive `new URL(...).pathname` returns URL-encoded
  // `%20` segments and fs.existsSync silently fails.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.join(here, 'macro-filter.lua');
}
