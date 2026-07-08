/**
 * Input routing: read a command's `[file]` argument as CriticMarkup Markdown,
 * transparently handling Word documents.
 *
 * `rev status`/`rev comments` and friends were written to `readFileSync(file,
 * 'utf-8')` every argument and regex it for CriticMarkup. A `.docx` is a binary
 * ZIP; decoded as UTF-8 it occasionally yields a stray `{~~..~>..~~}` byte
 * sequence, so the tool reported a small, plausible, wrong count with no error
 * (gcol33/docrev#8). This module is the single front door that both:
 *
 *   - detects a Word document by extension AND by ZIP magic + `word/document.xml`
 *     (so a mis-extensioned `.docx` renamed to `.md`/`.txt` is still caught), and
 *   - converts it to the same annotated Markdown `rev import` produces, so every
 *     downstream reader (`countAnnotations`, `getComments`, ...) sees real tags.
 *
 * Commands that only read report through `readAnnotatedInput`; commands that
 * edit in place call `assertEditableMarkdown` first and refuse a `.docx` with a
 * pointer to `rev import`, since CriticMarkup cannot be written back into a
 * binary ZIP.
 */

import * as fs from 'fs';
import * as path from 'path';
import { openDocx } from './ooxml.js';
import { exitWithError, requireFile } from './errors.js';

/** ZIP local-file-header magic: the first four bytes of any `.docx`. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** OOXML Word extensions (all ZIP-backed, none Markdown). */
const WORD_EXTENSIONS = new Set(['.docx', '.docm', '.dotx', '.dotm']);

/**
 * A file cannot be read as (or converted to) CriticMarkup Markdown. Carries
 * actionable suggestions so the command layer can render a helpful error.
 */
export class InputError extends Error {
  suggestions: string[];
  constructor(message: string, suggestions: string[] = []) {
    super(message);
    this.name = 'InputError';
    this.suggestions = suggestions;
  }
}

/** Read the first bytes of a file, or an empty buffer if unreadable. */
function readMagic(file: string, length = 4): Buffer {
  let fd: number | undefined;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, n);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/** True when the file begins with the ZIP local-file-header magic. */
export function looksLikeZip(file: string): boolean {
  return readMagic(file).equals(ZIP_MAGIC);
}

/**
 * True when `file` is a Word document: it carries a Word extension, or it is a
 * ZIP whose package contains `word/document.xml`. The content sniff catches a
 * `.docx` renamed to `.md`/`.txt`, so those never get regexed as CriticMarkup.
 */
export function isWordDocument(file: string): boolean {
  if (WORD_EXTENSIONS.has(path.extname(file).toLowerCase())) return true;
  if (!looksLikeZip(file)) return false;
  try {
    return openDocx(file).getEntry('word/document.xml') !== null;
  } catch {
    return false;
  }
}

/** A NUL byte in the head reliably marks binary; UTF-8 Markdown never has one. */
function isBinaryBuffer(buf: Buffer): boolean {
  if (buf.length >= 4 && buf.subarray(0, 4).equals(ZIP_MAGIC)) return true;
  return buf.subarray(0, Math.min(buf.length, 8192)).includes(0x00);
}

/**
 * Read a file as the CriticMarkup Markdown a command expects. A Word document
 * is converted through the existing OOXML/pandoc reader (real insertions,
 * deletions, substitutions, and comments); a Markdown/text file is read as
 * UTF-8. A non-Word binary (image, PDF, unknown ZIP) is rejected rather than
 * silently miscounted.
 *
 * @throws InputError if the file is a binary that is not a Word document, or a
 *   Word document that cannot be parsed.
 */
export async function readAnnotatedInput(file: string): Promise<string> {
  if (isWordDocument(file)) {
    const { readDocxAsAnnotatedMarkdown } = await import('./import.js');
    try {
      return await readDocxAsAnnotatedMarkdown(file);
    } catch (err) {
      throw new InputError(
        `Failed to read Word document ${path.basename(file)}: ${(err as Error).message}`,
        ['Run "rev import <docx>" to convert it to annotated Markdown first'],
      );
    }
  }

  const buf = fs.readFileSync(file);
  if (isBinaryBuffer(buf)) {
    throw new InputError(
      `${path.basename(file)} is not a text or Markdown file (binary content).`,
      [
        'Word documents: run "rev import <docx>" first, or pass the imported .md',
        'This command reads CriticMarkup Markdown, not binary files',
      ],
    );
  }
  return buf.toString('utf-8');
}

/**
 * Guard for commands that edit the file in place (accept/reject/resolve/reply/
 * review). A `.docx` cannot hold CriticMarkup, so refuse it with a pointer to
 * `rev import` instead of corrupting the document.
 *
 * @throws InputError if `file` is a Word document.
 */
export function assertEditableMarkdown(file: string): void {
  if (isWordDocument(file)) {
    const base = path.basename(file);
    throw new InputError(
      `${base} is a Word document; this command edits Markdown in place.`,
      [
        `Run "rev import ${base}" to get an editable Markdown file, then edit that`,
        'Read-only inspection works directly: "rev status" / "rev comments"',
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Command-facing wrappers: translate InputError into the CLI's error surface.
// ---------------------------------------------------------------------------

/**
 * Command front door: verify the file exists, then read it as annotated
 * Markdown (converting a `.docx` on the way). On a bad input, print a friendly
 * error and exit — matching how the rest of the CLI reports failures.
 */
export async function loadAnnotated(file: string, fileType = 'Markdown file'): Promise<string> {
  requireFile(file, fileType);
  try {
    return await readAnnotatedInput(file);
  } catch (err) {
    if (err instanceof InputError) exitWithError(err.message, err.suggestions);
    throw err;
  }
}

/**
 * Command front door for editing commands: verify existence and refuse a Word
 * document (which cannot be edited in place), printing guidance and exiting.
 */
export function requireEditableMarkdown(file: string, fileType = 'Markdown file'): void {
  requireFile(file, fileType);
  try {
    assertEditableMarkdown(file);
  } catch (err) {
    if (err instanceof InputError) exitWithError(err.message, err.suggestions);
    throw err;
  }
}
