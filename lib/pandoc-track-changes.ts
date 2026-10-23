/**
 * Word tracked changes as CriticMarkup, through pandoc's document tree.
 *
 * `pandoc --track-changes=all` reads a .docx into spans classed `insertion`,
 * `deletion`, `comment-start`, `comment-end` and `paragraph-insertion`, and
 * reviewers' edits nest: a comment ends inside a deletion, a deletion falls
 * inside an earlier insertion. The tree keeps that nesting, so the spans are
 * rewritten there and pandoc's own Markdown writer prints the result.
 */

import * as path from 'path';
import { spawn } from 'child_process';

interface PandocNode {
  t: string;
  c?: unknown;
}

export interface PandocDocument {
  'pandoc-api-version': number[];
  meta: Record<string, PandocNode>;
  blocks: PandocNode[];
}

export interface TrackChangeStats {
  insertions: number;
  deletions: number;
}

export interface CriticMarkupOptions {
  /**
   * Directory image paths are written relative to, with forward slashes.
   * Without it, image paths stay as pandoc wrote them.
   */
  imageBase?: string;
}

type Change = 'insertion' | 'deletion';

const DELIMITERS: Record<Change, [string, string]> = {
  insertion: ['{++', '++}'],
  deletion: ['{--', '--}'],
};

/** Span classes whose whole content is dropped: comment text and paragraph marks. */
const DROPPED = ['comment-start', 'comment-end', 'paragraph-insertion', 'paragraph-deletion'];

const isNode = (v: unknown): v is PandocNode =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as PandocNode).t === 'string';

function spanParts(node: PandocNode): { classes: string[]; content: PandocNode[] } {
  const [attr, content] = node.c as [[string, string[], [string, string][]], PandocNode[]];
  return { classes: attr[1], content };
}

const raw = (text: string): PandocNode => ({ t: 'RawInline', c: ['markdown', text] });

/** Whether inlines print anything: text other than whitespace, math, code or an image. */
function hasContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasContent);
  if (!isNode(value)) return false;
  if (value.t === 'Str') return String(value.c).trim().length > 0;
  if (['Math', 'Code', 'Image', 'RawInline'].includes(value.t)) return true;
  return hasContent(value.c);
}

/** Plain text of inlines, for metadata such as the title. */
export function inlinesText(value: unknown): string {
  if (Array.isArray(value)) return value.map(inlinesText).join('');
  if (!isNode(value)) return '';
  if (value.t === 'Str') return String(value.c);
  if (value.t === 'Space' || value.t === 'SoftBreak' || value.t === 'LineBreak') return ' ';
  if (value.t === 'Math' || value.t === 'Code') return String((value.c as unknown[])[1]);
  return inlinesText(value.c);
}

/**
 * Rewrites the tracked-change spans of a pandoc document in place:
 * insertions and deletions become CriticMarkup, comment markers and paragraph
 * marks are removed (comments are placed separately from comments.xml), and
 * highlight (`mark`) spans are unwrapped. A change nested in the opposite
 * change (text inserted and then deleted, or deleted together with an
 * insertion inside it) has no net effect and is dropped.
 */
export function trackChangesToCriticMarkup(doc: PandocDocument, options: CriticMarkupOptions = {}): TrackChangeStats {
  const stats: TrackChangeStats = { insertions: 0, deletions: 0 };

  const walk = (value: unknown, inside: Change | null): unknown => {
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const item of value) {
        if (isNode(item) && item.t === 'Span') {
          const { classes, content } = spanParts(item);
          if (DROPPED.some((c) => classes.includes(c))) continue;
          const change = (['insertion', 'deletion'] as Change[]).find((c) => classes.includes(c));
          if (change) {
            if (inside && inside !== change) continue;
            const inner = walk(content, change) as PandocNode[];
            if (inside === change) {
              out.push(...inner);
            } else if (hasContent(inner)) {
              stats[change === 'insertion' ? 'insertions' : 'deletions']++;
              out.push(raw(DELIMITERS[change][0]), ...inner, raw(DELIMITERS[change][1]));
            }
            continue;
          }
          if (classes.includes('mark')) {
            out.push(...(walk(content, inside) as unknown[]));
            continue;
          }
        }
        if (isNode(item) && item.t === 'Image' && options.imageBase) {
          const [attr, alt, [url, title]] = item.c as [unknown, unknown, [string, string]];
          const target = path.isAbsolute(url) ? path.relative(options.imageBase, url).split(path.sep).join('/') : url;
          out.push({ t: 'Image', c: [attr, walk(alt, inside), [target, title]] });
          continue;
        }
        out.push(walk(item, inside));
      }
      return out;
    }
    if (isNode(value) && value.t === 'Header') {
      // pandoc derives a heading's identifier from all its text, comments
      // included; once spans are rewritten the identifier no longer matches
      // the heading, so it is dropped unless it is a cross-reference label.
      const [level, attr, inlines] = value.c as [number, [string, string[], [string, string][]], unknown[]];
      const rewritten = walk(inlines, inside);
      const changed = JSON.stringify(rewritten) !== JSON.stringify(inlines);
      const id = changed && !attr[0].includes(':') ? '' : attr[0];
      return { t: 'Header', c: [level, [id, attr[1], attr[2]], rewritten] };
    }
    if (isNode(value)) return value.c === undefined ? value : { t: value.t, c: walk(value.c, inside) };
    return value;
  };

  doc.blocks = walk(doc.blocks, null) as PandocNode[];
  for (const key of Object.keys(doc.meta)) {
    doc.meta[key] = walk(doc.meta[key], null) as PandocNode;
  }
  return stats;
}

/** Runs pandoc with the given arguments, feeding `input` on stdin. */
export function runPandocCapture(args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('pandoc', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString('utf-8'));
      else reject(new Error(Buffer.concat(err).toString('utf-8') || `pandoc exited with ${code}`));
    });
    child.stdin.end(input ?? '');
  });
}

export interface DocxMarkdown {
  text: string;
  stats: TrackChangeStats;
  title: string | null;
  authors: string[];
}

/**
 * A .docx as Markdown with its tracked changes in CriticMarkup, plus the
 * title and authors pandoc reads from the Title and Author paragraphs.
 */
export async function docxToCriticMarkdown(
  docxPath: string,
  options: CriticMarkupOptions & { mediaDir?: string } = {}
): Promise<DocxMarkdown> {
  const readArgs = [docxPath, '-t', 'json', '--track-changes=all'];
  if (options.mediaDir) readArgs.push(`--extract-media=${options.mediaDir}`);
  const doc = JSON.parse(await runPandocCapture(readArgs)) as PandocDocument;
  const stats = trackChangesToCriticMarkup(doc, options);

  const title = doc.meta.title ? inlinesText(doc.meta.title.c).trim() || null : null;
  const authorMeta = doc.meta.author;
  const authorList = authorMeta?.t === 'MetaList' ? (authorMeta.c as PandocNode[]) : authorMeta ? [authorMeta] : [];
  const authors = authorList.map((a) => inlinesText(a.c).trim()).filter(Boolean);

  const text = await runPandocCapture(['-f', 'json', '-t', 'markdown', '--wrap=none'], JSON.stringify(doc));
  return { text, stats, title, authors };
}
