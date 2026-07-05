/**
 * Track changes module - Apply markdown annotations as Word track changes
 *
 * Converts CriticMarkup insertions/deletions/substitutions to pandoc-native
 * track-change spans (`[text]{.insertion}` / `[text]{.deletion}`). Pandoc's
 * docx writer emits well-formed `w:ins`/`w:del` run-level revisions from these
 * spans in a single pass, so the output is valid OOXML that Word accepts and
 * that composes with comment injection (see lib/wordcomments.ts).
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import AdmZip from 'adm-zip';

interface NativeTrackChangeOptions {
  author?: string;
  /** ISO-8601 timestamp for the revisions. Defaults to now (no milliseconds). */
  date?: string;
}

export interface NativeTrackChangeStats {
  insertions: number;
  deletions: number;
  substitutions: number;
}

interface ConvertResult {
  text: string;
  stats: NativeTrackChangeStats;
}

interface ApplyResult {
  success: boolean;
  message: string;
  stats?: NativeTrackChangeStats;
}

/** Word/pandoc want revision dates without milliseconds: 2026-07-05T08:33:00Z */
function isoDateNoMillis(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Escape a value for use inside a pandoc span attribute (`author="..."`).
 * Pandoc attribute values are double-quoted; a literal `"` or `\` would break
 * the attribute, so both are backslash-escaped.
 */
function escapeSpanAttr(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Convert CriticMarkup insertions/deletions/substitutions to pandoc-native
 * track-change spans. Comments (`{>>...<<}`) and highlights (`{==...==}`) are
 * left untouched — the caller decides how to handle those (strip, or thread
 * them via wordcomments.ts).
 *
 * A single pandoc pass over the result emits valid `w:ins`/`w:del` revisions,
 * so this composes with the full rev filter chain (crossref, citeproc,
 * reference-doc, macros) instead of post-processing document.xml by hand.
 *
 * @param text - Markdown with CriticMarkup annotations
 * @param options - Author/date for the revisions
 * @returns Converted markdown plus per-type counts
 */
export function criticToNativeTrackChanges(
  text: string,
  options: NativeTrackChangeOptions = {}
): ConvertResult {
  const author = escapeSpanAttr(options.author ?? 'Author');
  const date = escapeSpanAttr(options.date ?? isoDateNoMillis());
  const insAttr = `{.insertion author="${author}" date="${date}"}`;
  const delAttr = `{.deletion author="${author}" date="${date}"}`;

  const stats: NativeTrackChangeStats = { insertions: 0, deletions: 0, substitutions: 0 };
  let result = text;

  // Substitutions first so `{~~old~>new~~}` is consumed before the insertion/
  // deletion passes could see its inner delimiters. Emit delete-then-insert so
  // Word shows the struck-through original followed by the replacement.
  result = result.replace(/\{~~([\s\S]+?)~>([\s\S]+?)~~\}/g, (_m, oldText, newText) => {
    stats.substitutions++;
    return `[${oldText}]${delAttr}[${newText}]${insAttr}`;
  });

  // Insertions: {++text++}
  result = result.replace(/\{\+\+([\s\S]+?)\+\+\}/g, (_m, content) => {
    stats.insertions++;
    return `[${content}]${insAttr}`;
  });

  // Deletions: {--text--}
  result = result.replace(/\{--([\s\S]+?)--\}/g, (_m, content) => {
    stats.deletions++;
    return `[${content}]${delAttr}`;
  });

  return { text: result, stats };
}

/**
 * Enable tracked-revision display in a docx's settings.xml (in place).
 *
 * The `w:ins`/`w:del` elements already render as tracked changes without this,
 * but `w:trackRevisions` tells Word to keep tracking the author's further
 * edits — the expected state for a "return to author" review document.
 */
export function enableTrackRevisions(docxPath: string): void {
  const zip = new AdmZip(docxPath);
  const settingsEntry = zip.getEntry('word/settings.xml');
  if (!settingsEntry) return;
  let settingsXml = zip.readAsText(settingsEntry);
  if (settingsXml.includes('w:trackRevisions')) return;
  // trackRevisions must appear early in the ordered settings sequence; placing
  // it right after the opening tag keeps Word from rejecting the schema order.
  settingsXml = settingsXml.replace(/(<w:settings[^>]*>)/, '$1<w:trackRevisions/>');
  if (!settingsXml.includes('<w:trackRevisions/>')) {
    // No opening tag matched (unexpected) — fall back to before the close tag.
    settingsXml = settingsXml.replace('</w:settings>', '<w:trackRevisions/></w:settings>');
  }
  zip.updateFile('word/settings.xml', Buffer.from(settingsXml, 'utf-8'));
  zip.writeZip(docxPath);
}

/**
 * Build a standalone Word document with track changes from annotated markdown.
 *
 * Used by `rev apply <md> <docx>` for a single markdown file outside a rev
 * project (no crossref/citeproc/reference-doc). Comments are dropped — use the
 * project build (`rev build docx --show-changes`) for the full filter chain and
 * threaded comments.
 *
 * @param mdPath - Path to markdown file with CriticMarkup
 * @param docxPath - Output path for Word document
 * @param options - Author name for the revisions
 * @returns Result with success status and message
 */
export async function buildWithTrackChanges(
  mdPath: string,
  docxPath: string,
  options: NativeTrackChangeOptions = {}
): Promise<ApplyResult> {
  if (!fs.existsSync(mdPath)) {
    return { success: false, message: `File not found: ${mdPath}` };
  }

  const { author = 'Author' } = options;
  const content = fs.readFileSync(mdPath, 'utf-8');
  const { text: converted, stats } = criticToNativeTrackChanges(content, { author });

  const total = stats.insertions + stats.deletions + stats.substitutions;
  const tempMd = path.join(path.dirname(mdPath), `.temp-tc-${process.pid}.md`);

  try {
    fs.writeFileSync(tempMd, converted, 'utf-8');
    execSync(`pandoc "${tempMd}" -o "${docxPath}"`, { encoding: 'utf-8' });
    if (total > 0) enableTrackRevisions(docxPath);
    return { success: true, message: `Created ${docxPath} with track changes`, stats };
  } catch (err) {
    const error = err as Error;
    return { success: false, message: error.message };
  } finally {
    try { fs.unlinkSync(tempMd); } catch { /* best-effort cleanup */ }
  }
}
