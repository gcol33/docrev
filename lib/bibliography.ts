/**
 * Rendered-bibliography measurement.
 *
 * A journal that counts the reference list toward its word limit is counting
 * text that does not exist in the sources: the list is produced by citeproc at
 * build time from the .bib and the CSL. Measuring it therefore means rendering
 * it, which this module does with the same pandoc + citeproc pass the build
 * uses, over a document whose only content is a `nocite` list of the keys the
 * manuscript cites. Estimating instead (entries x an average length) would miss
 * exactly the case that matters, a style whose author-list rule turns six
 * consortium papers into a third of the budget.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { resolveCSL } from './csl.js';
import { countWords } from './utils.js';

export interface BibliographyRequest {
  /** Project directory; relative bibliography and CSL paths resolve against it. */
  directory: string;
  /** Bibliography file, as `rev.yaml` spells it. */
  bibliography: string;
  /** CSL style name or path, or null for pandoc's default. */
  csl?: string | null;
  /** Citation keys to render, in any order. */
  keys: string[];
}

export interface BibliographyResult {
  /** The rendered list as plain text, or null when it could not be rendered. */
  text: string | null;
  /** Word count of the rendered list; 0 when text is null. */
  words: number;
  /** Why nothing was rendered, for the caller to report. */
  reason?: 'no-keys' | 'no-bibliography' | 'no-pandoc' | 'pandoc-failed';
}

/**
 * Render the reference list for `keys` and count its words.
 *
 * Never throws: a missing pandoc, a missing .bib or a pandoc error come back
 * as a null text with a reason, so validation still reports the numbers it can
 * measure rather than failing outright.
 */
export function renderBibliography(req: BibliographyRequest): BibliographyResult {
  const keys = [...new Set(req.keys)].sort();
  if (keys.length === 0) return { text: null, words: 0, reason: 'no-keys' };

  const bibPath = path.isAbsolute(req.bibliography)
    ? req.bibliography
    : path.join(req.directory, req.bibliography);
  if (!fs.existsSync(bibPath)) return { text: null, words: 0, reason: 'no-bibliography' };

  const cslPath = req.csl ? resolveCSL(req.csl, req.directory) : null;

  // A document with no body: citeproc appends the bibliography at the end, so
  // the whole output is the list, with no heading to strip back off.
  const doc = ['---', 'nocite: |', `  ${keys.map(k => `@${k}`).join(', ')}`, '---', ''].join('\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-bib-'));
  const tmpFile = path.join(tmpDir, 'nocite.md');
  try {
    fs.writeFileSync(tmpFile, doc, 'utf-8');

    const args = [tmpFile, '--citeproc', `--bibliography=${bibPath}`, '--to=plain', '--wrap=none'];
    if (cslPath) args.push(`--csl=${cslPath}`);

    const run = spawnSync('pandoc', args, { encoding: 'utf-8' });
    if (run.error) {
      const missing = (run.error as NodeJS.ErrnoException).code === 'ENOENT';
      return { text: null, words: 0, reason: missing ? 'no-pandoc' : 'pandoc-failed' };
    }
    if (run.status !== 0) return { text: null, words: 0, reason: 'pandoc-failed' };

    const text = (run.stdout || '').trim();
    if (!text) return { text: null, words: 0, reason: 'pandoc-failed' };

    return { text, words: countWords(text) };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
