/**
 * Tests for information.md: parsing its Terms and Populations, the mechanical term
 * checks against the manuscript, and the negotiated-paragraph pin in journey.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import { parseInformation, informationCheck, entryNames } from '../lib/information.js';
import { parseManuscript } from '../lib/paragraph-markers.js';
import { journeyCheck, parseJourney, paragraphHash, pinNegotiated, BLOCKING } from '../lib/journey.js';

const MANUSCRIPT = [
  '# Introduction',
  '',
  '<!-- @p:intro.gap -->',
  'Each relevé area is reported with the plot. The plot size varies.',
  '',
  '<!-- @p:intro.area -->',
  'The relevé area is the surveyed surface of a plot, in square metres.',
  '',
  '# Methods',
  '',
  '<!-- @p:meth.target -->',
  'A target is a variable the model predicts. The plot size is one target.',
  '',
].join('\n');

const INFORMATION = [
  '# Information: test',
  '',
  '## Terms',
  '',
  '### releve-area',
  '- forms: relevé area; relevé areas',
  '- as: the surveyed surface of a plot',
  '- defined: @p:intro.area',
  '- avoid: plot size',
  '',
  '### target',
  '- forms: target; targets',
  '- as: a variable the model predicts',
  '- defined: none',
  '',
  '### embedding',
  '- forms: embedding',
  '- as: a learned description of each species',
  '- defined: known',
  '',
  '## Quantities',
  '',
  '### mae',
  '- metric: mean absolute error',
  '',
].join('\n');

function check(information = INFORMATION, manuscript = MANUSCRIPT) {
  const blocks = parseManuscript([{ file: 'm.md', content: manuscript }]);
  const { entries, errors } = parseInformation(information);
  return { findings: informationCheck(blocks, entries), entries, errors };
}

describe('parseInformation', () => {
  it('reads Terms and Populations and skips other sections', () => {
    const { entries, errors } = check();
    assert.deepStrictEqual(entries.map((e) => e.id), ['releve-area', 'target', 'embedding']);
    assert.strictEqual(errors.length, 0);
    assert.strictEqual(entries[0].defined, 'intro.area');
    assert.strictEqual(entries[1].defined, null);
    assert.strictEqual(entries[2].known, true);
  });
});

describe('informationCheck', () => {
  it('flags defined: none, not known', () => {
    const { findings } = check();
    const undef = findings.filter((f) => f.kind === 'undefined');
    assert.deepStrictEqual(undef.map((f) => f.entryIds[0]), ['target']);
  });

  it('flags each avoided wording with its paragraph and sentence', () => {
    const drift = check().findings.filter((f) => f.kind === 'synonym-drift');
    assert.deepStrictEqual(drift.map((f) => f.paragraph), ['intro.gap', 'meth.target']);
    assert.match(drift[0].message, /The plot size varies\./);
  });

  it('flags a use before the defining paragraph, once per paragraph', () => {
    const early = check().findings.filter((f) => f.kind === 'use-before-define');
    assert.deepStrictEqual(early.map((f) => f.paragraph), ['intro.gap']);
  });

  it('flags an entry no form of which occurs', () => {
    const unused = check().findings.filter((f) => f.kind === 'unused-entry');
    assert.deepStrictEqual(unused.map((f) => f.entryIds[0]), ['embedding']);
  });

  it('honours an accept line restricted to a paragraph', () => {
    const info = INFORMATION.replace('- avoid: plot size', '- avoid: plot size\n- accept: synonym-drift @p:intro.gap: quoted from the protocol');
    const drift = check(info).findings.filter((f) => f.kind === 'synonym-drift');
    assert.deepStrictEqual(drift.map((f) => [f.paragraph, !!f.accepted]), [['intro.gap', true], ['meth.target', false]]);
  });

  it('flags a form listed under two entries and a gloss using its own name', () => {
    const info = INFORMATION.replace('- forms: target; targets', '- forms: target; targets; relevé area')
      .replace('- as: a learned description of each species', '- as: an embedding of each species');
    const kinds = check(info).findings.map((f) => f.kind);
    assert.ok(kinds.includes('form-collision'));
    assert.ok(kinds.includes('circular-definition'));
  });

  it('flags a definition anchor no paragraph carries', () => {
    const info = INFORMATION.replace('- defined: @p:intro.area', '- defined: @p:intro.nowhere');
    assert.ok(check(info).findings.some((f) => f.kind === 'unresolved-anchor'));
  });

  it('counts shortenings and an acronym of the expansion as one name, a second head word as two', () => {
    assert.deepStrictEqual(entryNames(['constant prediction', 'constant', 'constant predictions']), ['constant']);
    assert.deepStrictEqual(entryNames(['European Vegetation Archive', 'EVA']), ['European Vegetation Archive']);
    assert.deepStrictEqual(entryNames(['network', 'neural network', 'multilayer perceptron (MLP)', 'MLP']),
      ['network', 'multilayer perceptron (MLP)']);
    assert.deepStrictEqual(entryNames(['constant prediction', 'baseline', 'constant baseline']), ['constant prediction', 'baseline']);
    const info = INFORMATION.replace('- forms: relevé area; relevé areas', '- forms: relevé area; relevé areas; sampled surface');
    const many = check(info).findings.filter((f) => f.kind === 'many-names');
    assert.deepStrictEqual(many.map((f) => f.entryIds[0]), ['releve-area']);
  });

  it('flags the other number of a form when no entry lists it', () => {
    const text = MANUSCRIPT + '\n<!-- @p:meth.more -->\nTwo targets differ. Model settings were tuned. The setting matters.\n';
    const info = INFORMATION.replace('- forms: target; targets', '- forms: target; targets\n- glossed: @p:intro.gap')
      .replace('### embedding\n- forms: embedding', '### setting\n- forms: setting\n- as: how test plots are drawn\n- defined: known\n\n### embedding\n- forms: embedding');
    const variants = check(info, text).findings.filter((f) => f.kind === 'unlisted-variant');
    assert.deepStrictEqual(variants.map((f) => f.entryIds[0]), ['setting']);
    assert.match(variants[0].message, /"settings" occurs 1x/);
  });

  it('flags a term not used after its definition and an acronym used in one paragraph', () => {
    const text = [
      '<!-- @p:a -->', 'The gain is the share of error removed, by a multilayer perceptron (MLP).', '',
      '<!-- @p:b -->', 'The multilayer perceptron predicts.', '',
    ].join('\n');
    const info = [
      '## Terms', '',
      '### gain', '- forms: gain', '- as: the share of error removed', '- defined: @p:a', '',
      '### mlp', '- forms: multilayer perceptron; MLP', '- as: a layered network', '- defined: @p:a', '',
    ].join('\n');
    const kinds = check(info, text).findings.map((f) => [f.kind, f.entryIds[0]]);
    assert.ok(kinds.some(([k, e]) => k === 'single-use-term' && e === 'gain'));
    assert.ok(!kinds.some(([k, e]) => k === 'single-use-term' && e === 'mlp'));
    assert.ok(kinds.some(([k, e]) => k === 'unused-acronym' && e === 'mlp'));
  });

  it('blocks undefined terms, avoided wording and use before definition', () => {
    assert.ok(BLOCKING.has('undefined') && BLOCKING.has('synonym-drift'));
    assert.ok(BLOCKING.has('use-before-define'));
  });
});

describe('definition order gate', () => {
  it('blocks an early use and clears it when the definition precedes it', () => {
    const early = check().findings.filter((f) => f.kind === 'use-before-define' && BLOCKING.has(f.kind) && !f.accepted);
    assert.deepStrictEqual(early.map((f) => f.paragraph), ['intro.gap']);
    const definedFirst = INFORMATION.replace('- defined: @p:intro.area', '- defined: @p:intro.gap');
    assert.ok(!check(definedFirst).findings.some((f) => f.kind === 'use-before-define' && BLOCKING.has(f.kind) && !f.accepted));
  });

  it('honours an explicit paragraph-specific acceptance of early use', () => {
    const info = INFORMATION.replace('- avoid: plot size', '- avoid: plot size\n- accept: use-before-define @p:intro.gap: author-approved preview');
    const early = check(info).findings.filter((f) => f.kind === 'use-before-define');
    assert.strictEqual(early.length, 1);
    assert.ok(early[0].accepted);
    assert.ok(!early.some((f) => BLOCKING.has(f.kind) && !f.accepted));
  });
});

describe('negotiated paragraphs', () => {
  const blocks = parseManuscript([{ file: 'm.md', content: MANUSCRIPT }]);
  const text = blocks.find((b) => b.markerId === 'intro.area').text;
  const journeyText = (line) => [
    '# Journey: test', '', '## Introduction', '',
    '### intro.gap', '- job: Says what is missing.', '',
    '### intro.area', '- job: Defines the area.', line, '',
    '## Methods', '', '### meth.target', '- job: Defines the target.', '',
  ].join('\n');
  const kinds = (line, b = blocks) => journeyCheck(b, parseJourney(journeyText(line)).doc)
    .filter((f) => f.kind.startsWith('negotiated')).map((f) => f.kind);

  it('asks for a pin when the line has no hash', () => {
    assert.deepStrictEqual(kinds('- negotiated: Stefan 2026-10-14: keep relevé area'), ['negotiated-unpinned']);
  });

  it('is quiet while the text matches its pin, whitespace aside', () => {
    assert.deepStrictEqual(kinds(`- negotiated: Stefan 2026-10-14 #${paragraphHash(text)}: keep relevé area`), []);
    const rewrapped = blocks.map((b) => (b.markerId === 'intro.area' ? { ...b, text: text.replace(' ', '\n') } : b));
    assert.deepStrictEqual(kinds(`- negotiated: Stefan 2026-10-14 #${paragraphHash(text)}: keep relevé area`, rewrapped), []);
  });

  it('records a change since the pin', () => {
    const changed = blocks.map((b) => (b.markerId === 'intro.area' ? { ...b, text: text + ' Edited.' } : b));
    assert.deepStrictEqual(kinds(`- negotiated: Stefan 2026-10-14 #${paragraphHash(text)}: keep relevé area`, changed),
      ['negotiated-changed']);
    assert.ok(BLOCKING.has('negotiated-changed'));
  });

  it('pins the negotiated lines of the named entries only', () => {
    const before = journeyText('- negotiated: Stefan 2026-10-14: keep relevé area');
    const { content, pinned } = pinNegotiated(before, new Map([['intro.area', 'abcdef12'], ['intro.gap', '12345678']]));
    assert.deepStrictEqual(pinned, ['intro.area']);
    assert.match(content, /- negotiated: Stefan 2026-10-14 #abcdef12: keep relevé area/);
    const again = pinNegotiated(content, new Map([['intro.area', 'abcdef12']]));
    assert.deepStrictEqual(again.pinned, []);
  });
});
