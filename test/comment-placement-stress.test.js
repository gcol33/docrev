/**
 * Stress tests for the docx → markdown comment-placement pipeline.
 *
 * Anchors live as `<w:commentRangeStart/End w:id="N">` markers in the docx
 * (real, structural). Re-insertion into markdown is done by text matching
 * (lib/anchor-match.ts) since CriticMarkup `{>>...<<}` has no native anchor
 * concept. These tests exercise the failure modes that matter in practice:
 *
 *   - scale (100+ comments)
 *   - anchor drift when the target md was edited after docx export
 *   - ambiguity (anchor phrase appearing N times)
 *   - graceful degradation when the anchored text was deleted
 *   - reply clusters surviving anchor edits
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import AdmZip from 'adm-zip';

import { prepareMarkdownWithMarkers, injectCommentsAtMarkers } from '../lib/wordcomments.js';
import {
  extractWordComments,
  extractCommentAnchors,
  insertCommentsIntoMarkdown,
} from '../lib/import.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `docrev-${prefix}-`));
}

function minimalDocxZip(content) {
  // Mirror createTestDocx() from wordcomments.test.js; one paragraph,
  // one run, one <w:t>. Comment markers ⟦CMS:n⟧/⟦CME:n⟧ in `content`
  // are converted to commentRangeStart/End by injectCommentsAtMarkers.
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${content}</w:t></w:r></w:p></w:body>
</w:document>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypes));
  zip.addFile('_rels/.rels', Buffer.from(rels));
  zip.addFile('word/document.xml', Buffer.from(documentXml));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(docRels));
  return zip;
}

async function buildDocxWithComments(markdown, tmpDir) {
  const docxPath = path.join(tmpDir, 'src.docx');
  const { comments, markedMarkdown } = prepareMarkdownWithMarkers(markdown);
  minimalDocxZip(markedMarkdown).writeZip(docxPath);
  const result = await injectCommentsAtMarkers(docxPath, comments, docxPath);
  assert.strictEqual(result.success, true, 'inject failed: ' + (result.error || ''));
  return { docxPath, prepared: comments, injectResult: result };
}

async function syncTo(docxPath, targetMarkdown, options = {}) {
  const extracted = await extractWordComments(docxPath);
  const { anchors } = await extractCommentAnchors(docxPath);
  const synced = insertCommentsIntoMarkdown(targetMarkdown, extracted, anchors, {
    quiet: true,
    wrapAnchor: false,
    ...options,
  });
  return { extracted, anchors, synced };
}

function countCriticComments(text) {
  return (text.match(/\{>>/g) || []).length;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('comment placement stress', () => {
  it('places 100 distinct comments in a long document', async () => {
    const tmpDir = makeTmp('cp-scale');
    try {
      // Build a document with 100 anchored sentences. Each anchor is unique
      // (sentence index encoded) so no ambiguity — pure throughput test.
      const sentences = [];
      for (let i = 0; i < 100; i++) {
        sentences.push(`Sentence number ${i} contains anchored phrase alpha-${i} for review.`);
      }
      const sourceParts = sentences.map(
        (s, i) => `${s.replace(`alpha-${i}`, `{>>R: comment ${i}<<}alpha-${i}`)}`,
      );
      const sourceMarkdown = sourceParts.join(' ');
      const { docxPath } = await buildDocxWithComments(sourceMarkdown, tmpDir);

      // Target = same prose, no comments.
      const target = sentences.join(' ');

      const start = performance.now();
      const { synced, extracted } = await syncTo(docxPath, target);
      const elapsed = performance.now() - start;

      assert.strictEqual(extracted.length, 100, 'all 100 comments should extract');
      assert.strictEqual(countCriticComments(synced), 100, 'all 100 should be re-placed');
      assert.ok(elapsed < 10000, `placement took ${elapsed.toFixed(0)}ms (budget 10000ms)`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('preserves placement when anchor phrase survives but surrounding prose drifts', async () => {
    const tmpDir = makeTmp('cp-drift');
    try {
      // Realistic editing pattern: reviewer anchors on a unique phrase,
      // author rewrites the surrounding paragraph but keeps the phrase.
      // Direct match should still hit; this stresses the per-comment
      // disambiguation under bulk surrounding-prose changes.
      const N = 40;
      const sourceParts = [];
      const targetParts = [];
      for (let i = 0; i < N; i++) {
        sourceParts.push(
          `Section ${i} introductory filler varies widely. ` +
            `{>>R: drift-${i}<<} [marker-${i}-here]{.mark} ` +
            `closes the section with detail.`,
        );
        targetParts.push(
          `Section ${i} was rewritten entirely with new prose. ` +
            `marker-${i}-here remains the focal phrase. ` +
            `Final wording differs throughout the paragraph.`,
        );
      }
      const sourceMarkdown = sourceParts.join(' ');
      const target = targetParts.join(' ');

      const { docxPath } = await buildDocxWithComments(sourceMarkdown, tmpDir);
      const { synced, extracted } = await syncTo(docxPath, target);

      assert.strictEqual(extracted.length, N);
      const placed = countCriticComments(synced);
      assert.ok(
        placed >= Math.floor(N * 0.9),
        `expected ≥90% placement when anchor survives, got ${placed}/${N}`,
      );

      // Spot-check: comment N must land near "marker-N-here" in the synced
      // text — not on a different section's marker.
      for (let i = 0; i < N; i += 7) {
        const commentIdx = synced.indexOf(`drift-${i}`);
        const markerIdx = synced.indexOf(`marker-${i}-here`);
        assert.ok(commentIdx >= 0, `comment drift-${i} missing from synced output`);
        assert.ok(markerIdx >= 0, `marker-${i}-here missing from synced output`);
        assert.ok(
          Math.abs(commentIdx - markerIdx) < 200,
          `comment drift-${i} drifted to wrong section ` +
            `(distance to marker-${i}-here: ${Math.abs(commentIdx - markerIdx)})`,
        );
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('falls back to docx structural marker when anchor and context BOTH drift', async () => {
    const tmpDir = makeTmp('cp-double-drift');
    try {
      // Pathological case for text matching: anchor span is empty AND both
      // before/after context were rewritten in the target. There is nothing
      // for the text-matching fallback chain to grip onto — but the docx
      // carried a real `<w:commentRangeStart>` marker at a known text-offset.
      // The proportional-fallback uses that offset to land the comment in
      // roughly the right neighborhood instead of dropping it.
      const N = 10;
      const sourceParts = [];
      const targetParts = [];
      for (let i = 0; i < N; i++) {
        sourceParts.push(
          `Sentence ${i} contains ecological signal ${i} measured across populations and was noteworthy.`,
        );
        targetParts.push(
          `Phrase ${i} reports a biological reading ${i} observed within communities and was striking.`,
        );
      }
      const sourceMarkdown = sourceParts
        .map((s, i) => s.replace(`signal ${i}`, `{>>R: drop-${i}<<}signal ${i}`))
        .join(' ');
      const target = targetParts.join(' ');

      const { docxPath } = await buildDocxWithComments(sourceMarkdown, tmpDir);
      const { synced, extracted } = await syncTo(docxPath, target);

      assert.strictEqual(extracted.length, N);
      const placed = countCriticComments(synced);
      // The structural marker is always present in the docx, so the fallback
      // should place every comment somewhere — no silent drops.
      assert.strictEqual(
        placed,
        N,
        `proportional fallback should place all ${N} comments via docx marker offset, got ${placed}`,
      );

      // Order preserved: comment N should sit at proportional position N/N
      // through the target. So drop-0 lands earlier than drop-9.
      const positions = [];
      for (let i = 0; i < N; i++) {
        const idx = synced.indexOf(`drop-${i}`);
        assert.ok(idx >= 0, `comment drop-${i} missing from synced output`);
        positions.push(idx);
      }
      for (let i = 1; i < N; i++) {
        assert.ok(
          positions[i] >= positions[i - 1],
          `proportional fallback should preserve docx order: drop-${i} (pos ${positions[i]}) ` +
            `should come after drop-${i - 1} (pos ${positions[i - 1]})`,
        );
      }

      // Prose untouched.
      const stripped = synced.replace(/\{>>[^<]+<<\}/g, '');
      assert.strictEqual(
        stripped.replace(/\s+/g, ' ').trim(),
        target.replace(/\s+/g, ' ').trim(),
        'prose must equal target after stripping comments — no corruption allowed',
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('disambiguates among 20 occurrences via before/after context', async () => {
    const tmpDir = makeTmp('cp-ambig');
    try {
      // Build a doc where the literal anchor "the species" appears 20×.
      // Three of those occurrences carry a comment with distinct
      // surrounding context. Without context-aware tie-breaking, all
      // three would land on the same (leftmost) occurrence.
      const filler = (label) =>
        `Context filler ${label}: the species was studied in detail across many populations.`;
      const parts = [];
      for (let i = 0; i < 20; i++) {
        if (i === 3) {
          parts.push(`Alpine zone introduction. {>>R1: pick #3<<}the species at high altitude.`);
        } else if (i === 11) {
          parts.push(`Coastal zone introduction. {>>R2: pick #11<<}the species near the shore.`);
        } else if (i === 18) {
          parts.push(`Desert zone introduction. {>>R3: pick #18<<}the species under arid stress.`);
        } else {
          parts.push(filler(`f${i}`));
        }
      }
      const sourceMarkdown = parts.join(' ');
      const { docxPath } = await buildDocxWithComments(sourceMarkdown, tmpDir);

      // Target = identical prose minus the comments.
      const target = sourceMarkdown.replace(/\{>>[^<]+<<\}/g, '');
      const { synced, extracted } = await syncTo(docxPath, target);

      assert.strictEqual(extracted.length, 3);
      assert.strictEqual(countCriticComments(synced), 3);

      // Each comment should land near its distinctive context word.
      const altitudeIdx = synced.indexOf('high altitude');
      const shoreIdx = synced.indexOf('near the shore');
      const aridIdx = synced.indexOf('under arid');

      const r1Idx = synced.indexOf('R1: pick #3');
      const r2Idx = synced.indexOf('R2: pick #11');
      const r3Idx = synced.indexOf('R3: pick #18');

      // Each comment should sit closer to its intended context than to the
      // others. Distance < 200 chars to its target, > 200 to the wrong ones.
      assert.ok(
        Math.abs(r1Idx - altitudeIdx) < 200,
        `R1 should be near "high altitude" (got distance ${Math.abs(r1Idx - altitudeIdx)})`,
      );
      assert.ok(
        Math.abs(r2Idx - shoreIdx) < 200,
        `R2 should be near "near the shore" (got distance ${Math.abs(r2Idx - shoreIdx)})`,
      );
      assert.ok(
        Math.abs(r3Idx - aridIdx) < 200,
        `R3 should be near "under arid" (got distance ${Math.abs(r3Idx - aridIdx)})`,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('degrades gracefully when anchored text was deleted from target', async () => {
    const tmpDir = makeTmp('cp-deleted');
    try {
      // Three comments. Two anchors survive in target; one anchor's text
      // is fully deleted. Pipeline must not crash and must not fabricate
      // a placement; it should either land via context or drop the
      // unmatched comment.
      const sourceMarkdown =
        'Opening sentence anchored phrase one stands here. ' +
        'Middle sentence with {>>R: should be dropped<<}vanishing phrase that gets cut. ' +
        'Closing sentence anchored phrase two stands here.';
      const { docxPath } = await buildDocxWithComments(sourceMarkdown, tmpDir);

      const target =
        'Opening sentence anchored phrase one stands here. ' +
        'Middle sentence with completely rewritten content here. ' +
        'Closing sentence anchored phrase two stands here.';
      const { synced, extracted } = await syncTo(docxPath, target);

      assert.strictEqual(extracted.length, 1);
      // It either places via context (acceptable) or drops the comment.
      // Must not throw, must not duplicate, must not corrupt the prose.
      const placed = countCriticComments(synced);
      assert.ok(placed <= 1, `placed ${placed} copies of one comment`);
      // The non-comment prose must equal the target.
      const stripped = synced.replace(/\{>>[^<]+<<\}/g, '');
      assert.strictEqual(
        stripped.replace(/\s+/g, ' ').trim(),
        target.replace(/\s+/g, ' ').trim(),
        'prose should match target after stripping comments',
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('keeps a 4-deep reply cluster together when anchor was edited', async () => {
    const tmpDir = makeTmp('cp-cluster');
    try {
      // One parent + 3 replies sharing the same anchor span. After sync
      // into edited target prose the cluster must still emit adjacently
      // so prepareMarkdownWithMarkers picks the threading back up.
      const sourceMarkdown =
        'Plant diversity {>>R1: parent question<<} {>>R2: first reply<<} ' +
        '{>>R3: second reply<<} {>>R4: third reply<<} [in central Europe]{.mark} is high.';
      const { docxPath } = await buildDocxWithComments(sourceMarkdown, tmpDir);

      // Target: same content but "central Europe" → "the Alps" (anchor
      // surrounding context drifts; partial-start should still win).
      const target = 'Plant diversity in the Alps is high.';
      const { synced, extracted } = await syncTo(docxPath, target);

      assert.strictEqual(extracted.length, 4, 'should extract 4 comments (1 parent + 3 replies)');
      assert.strictEqual(countCriticComments(synced), 4, 'all 4 should re-place');

      // Every reply must sit immediately next to the parent (no prose
      // between members of the cluster).
      assert.match(
        synced,
        /\{>>[^<]*parent question<<\}\{>>[^<]*first reply<<\}\{>>[^<]*second reply<<\}\{>>[^<]*third reply<<\}/,
        'cluster should land back-to-back with no prose between members',
      );

      // Re-prepare confirms threading detection survived the round-trip.
      const reprepared = prepareMarkdownWithMarkers(synced);
      const replyCount = reprepared.comments.filter((c) => c.isReply).length;
      assert.strictEqual(
        replyCount,
        3,
        `expected 3 replies after round-trip, got ${replyCount}`,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  it('survives unicode anchors (smart quotes, em-dash, accents)', async () => {
    const tmpDir = makeTmp('cp-unicode');
    try {
      const sourceMarkdown =
        'The author wrote {>>R: about smart quotes<<}“signal—noise” ' +
        'in his thesis on écologie populaire and saw {>>R2: matters here<<}résultats variés in the field.';
      const { docxPath } = await buildDocxWithComments(sourceMarkdown, tmpDir);

      const target =
        'The author wrote “signal—noise” ' +
        'in his thesis on écologie populaire and saw résultats variés in the field.';
      const { synced, extracted } = await syncTo(docxPath, target);

      assert.strictEqual(extracted.length, 2);
      assert.strictEqual(countCriticComments(synced), 2, 'unicode anchors must round-trip');
      // Text content (non-comment) preserved exactly.
      const stripped = synced.replace(/\{>>[^<]+<<\}/g, '');
      assert.strictEqual(
        stripped.replace(/\s+/g, ' ').trim(),
        target.replace(/\s+/g, ' ').trim(),
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });
});
