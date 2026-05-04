/**
 * Real-paper regression: 298 reviewer comments (233 parents + 65 replies,
 * 20 authors) on an 8.4k-word manuscript. Locks in 100% placement across
 * realistic editing scenarios.
 *
 * Fixture: test/fixtures/paper-niche-expansion.docx
 *   - Patterns of habitat niche expansion in alien plant species (Colling et al.)
 *   - 361 paragraphs, 2147 runs, 3 tables, 5 zero-width anchors
 *   - Real Word-produced docx (not synthesized)
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import {
  extractWordComments,
  extractCommentAnchors,
  insertCommentsIntoMarkdown,
} from '../lib/import.js';
import { extractTextFromWord } from '../lib/word.js';
import { prepareMarkdownWithMarkers } from '../lib/wordcomments.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCX = path.join(__dirname, 'fixtures', 'paper-niche-expansion.docx');

function countCritic(t) {
  return (t.match(/\{>>/g) || []).length;
}
function strip(t) {
  return t.replace(/\{>>[\s\S]*?<<\}/g, '');
}
function norm(t) {
  return t.replace(/\s+/g, ' ').trim();
}

describe('real paper fixture (298 comments)', () => {
  let extracted;
  let anchors;
  let baseText;
  let N;
  let replyCount;

  before(async () => {
    if (!fs.existsSync(DOCX)) {
      throw new Error(
        `Fixture missing: ${DOCX}\n` +
          `Restore from Drive: 1L1TcYwqV3Bp4tnposkPz5eTMkl_AmFR5`,
      );
    }
    extracted = await extractWordComments(DOCX);
    const anchorResult = await extractCommentAnchors(DOCX);
    anchors = anchorResult.anchors;
    baseText = await extractTextFromWord(DOCX);
    N = extracted.length;
    replyCount = extracted.filter((c) => c.parentId !== undefined).length;
  });

  it('extracts the expected comment counts', () => {
    assert.strictEqual(N, 298, `expected 298 comments, got ${N}`);
    assert.strictEqual(replyCount, 65, `expected 65 replies, got ${replyCount}`);
  });

  it('places 100% on identity target (no drift)', () => {
    const synced = insertCommentsIntoMarkdown(baseText, extracted, anchors, {
      quiet: true,
      wrapAnchor: false,
    });
    const placed = countCritic(synced);
    assert.strictEqual(placed, N, `identity placement: ${placed}/${N}`);
    assert.strictEqual(
      norm(strip(synced)),
      norm(baseText),
      'prose corrupted on identity round-trip',
    );
  });

  it('places 100% under light drift (~0.5% char deletion)', () => {
    const target = baseText
      .split('')
      .filter((ch, i) => !(i % 200 === 17 && /\w/.test(ch)))
      .join('');
    const synced = insertCommentsIntoMarkdown(target, extracted, anchors, {
      quiet: true,
      wrapAnchor: false,
    });
    const placed = countCritic(synced);
    assert.strictEqual(placed, N, `light-drift placement: ${placed}/${N}`);
    assert.strictEqual(norm(strip(synced)), norm(target), 'prose corrupted under light drift');
  });

  it('places 100% under heavy drift (every 5th sentence rewritten)', () => {
    const sents = baseText.split(/(?<=\.)\s+/);
    const target = sents
      .map((s, i) =>
        i % 5 === 0
          ? s.replace(/\b(\w{4,})\b/g, (m) => (m.length > 6 ? m.slice(0, 3) + 'XYZ' : m))
          : s,
      )
      .join(' ');
    const synced = insertCommentsIntoMarkdown(target, extracted, anchors, {
      quiet: true,
      wrapAnchor: false,
    });
    const placed = countCritic(synced);
    assert.strictEqual(placed, N, `heavy-drift placement: ${placed}/${N}`);
  });

  it('places 100% when target is truncated to first half', () => {
    const target = baseText.slice(0, Math.floor(baseText.length / 2));
    const synced = insertCommentsIntoMarkdown(target, extracted, anchors, {
      quiet: true,
      wrapAnchor: false,
    });
    const placed = countCritic(synced);
    assert.strictEqual(placed, N, `truncated placement: ${placed}/${N}`);
  });

  it('places 100% when a new section is prepended', () => {
    const target = 'New introduction added by author. '.repeat(40) + baseText;
    const synced = insertCommentsIntoMarkdown(target, extracted, anchors, {
      quiet: true,
      wrapAnchor: false,
    });
    const placed = countCritic(synced);
    assert.strictEqual(placed, N, `prepended placement: ${placed}/${N}`);
  });

  it('round-trip threading reports exactly 65 replies (no false positives)', () => {
    // The dense (298-comment) reviewer doc used to inflate reply detection
    // to ~88 because positionally-close distinct clusters concatenated under
    // the previous gap<10 adjacency threshold. With strict gap===0 and
    // emit-side collision protection the round-trip count must equal the
    // 65 paraIdParent links from commentsExtended.xml.
    const synced = insertCommentsIntoMarkdown(baseText, extracted, anchors, {
      quiet: true,
      wrapAnchor: false,
    });
    const reprepared = prepareMarkdownWithMarkers(synced);
    const detectedReplies = reprepared.comments.filter((c) => c.isReply).length;
    assert.strictEqual(
      detectedReplies,
      replyCount,
      `round-trip threading: detected ${detectedReplies} replies, expected ${replyCount}`,
    );
  });

  it('completes identity placement under 5s budget on 8.4k-word doc', () => {
    const t0 = performance.now();
    insertCommentsIntoMarkdown(baseText, extracted, anchors, {
      quiet: true,
      wrapAnchor: false,
    });
    const elapsed = performance.now() - t0;
    assert.ok(elapsed < 5000, `placement took ${elapsed.toFixed(0)}ms (budget 5000ms)`);
  });
});
