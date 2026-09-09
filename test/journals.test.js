/**
 * Tests for journals.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  listJournals,
  getJournalProfile,
  validateManuscript,
  JOURNAL_PROFILES,
} from '../lib/journals.js';

describe('listJournals', () => {
  it('should return array of journals', () => {
    const journals = listJournals();
    assert.ok(Array.isArray(journals));
    assert.ok(journals.length > 0);
  });

  it('should include nature', () => {
    const journals = listJournals();
    const nature = journals.find(j => j.id === 'nature');
    assert.ok(nature);
    assert.strictEqual(nature.name, 'Nature');
  });

  it('should have id, name, and url for each journal', () => {
    const journals = listJournals();
    for (const j of journals) {
      assert.ok(j.id);
      assert.ok(j.name);
      assert.ok(j.url);
    }
  });
});

describe('getJournalProfile', () => {
  it('should return profile for valid journal', () => {
    const profile = getJournalProfile('nature');
    assert.ok(profile);
    assert.strictEqual(profile.name, 'Nature');
  });

  it('should handle case-insensitive lookup', () => {
    const profile = getJournalProfile('NATURE');
    assert.ok(profile);
  });

  it('should handle spaces as hyphens', () => {
    const profile = getJournalProfile('plos one');
    assert.ok(profile);
    assert.strictEqual(profile.name, 'PLOS ONE');
  });

  it('should return null for unknown journal', () => {
    const profile = getJournalProfile('not-a-journal');
    assert.strictEqual(profile, null);
  });
});

describe('validateManuscript', () => {
  const shortManuscript = `---
title: Test Paper
---

# Abstract

This is a short abstract.

# Introduction

Short intro.

# Methods

Methods here.

# Results

Results here.

# Discussion

Discussion here.
`;

  const longManuscript = `---
title: ${'A '.repeat(100)}Very Long Title
---

# Abstract

${'Word '.repeat(200)}

# Introduction

${'Content '.repeat(5000)}
`;

  it('should validate manuscript structure', () => {
    const result = validateManuscript(shortManuscript, 'nature');
    assert.ok(result);
    assert.ok(result.stats);
    assert.strictEqual(result.journal, 'Nature');
  });

  it('should return unknown journal error', () => {
    const result = validateManuscript(shortManuscript, 'fake-journal');
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors[0].includes('Unknown journal'));
  });

  it('should detect word count over limit', () => {
    const result = validateManuscript(longManuscript, 'nature');
    const wordCountError = result.errors.find(e => e.includes('words'));
    assert.ok(wordCountError);
  });

  it('should track figure count', () => {
    const textWithFigures = `
# Results

![Figure 1](fig1.png){#fig:one}
![Figure 2](fig2.png){#fig:two}
`;
    const result = validateManuscript(textWithFigures, 'plos-one');
    assert.strictEqual(result.stats.figures, 2);
  });

  it('should warn about missing sections', () => {
    const incompleteText = `
# Introduction

Just intro, no other sections.
`;
    const result = validateManuscript(incompleteText, 'nature');
    const sectionWarning = result.warnings.find(w => w.includes('Missing required section'));
    assert.ok(sectionWarning);
  });

  it('should count references', () => {
    const textWithRefs = `
As shown by @smith2020 and @jones2021, the results confirm @brown2019.
`;
    const result = validateManuscript(textWithRefs, 'plos-one');
    assert.strictEqual(result.stats.references, 3);
  });
});

describe('what the word limit counts', () => {
  const manuscript = [
    '# Abstract',
    '',
    'One two three four five.',
    '',
    '**Keywords:** alpha, beta, gamma',
    '',
    '# Introduction',
    '',
    'Body words here that the counter keeps [@smith2020].',
    '',
    '![A caption of exactly six words](fig1.png){#fig:one}',
    '',
    'See @fig:one for the shape.',
    '',
    '| Site | Count |',
    '|------|-------|',
    '| Alpha | 12 |',
    '',
    ': A table caption.',
    '',
    '# Data availability',
    '',
    'Archived openly.',
  ].join('\n');

  it('separates the abstract from the body, and drops its keyword line', () => {
    const stats = validateManuscript(manuscript, 'plos-one').stats;
    assert.strictEqual(stats.abstractWords, 5);
  });

  it('reports table cells and figure captions as their own parts', () => {
    const stats = validateManuscript(manuscript, 'plos-one').stats;
    assert.strictEqual(stats.tableCellWords, 4);
    assert.strictEqual(stats.figureCaptionWords, 6);
  });

  it('counts one table per run of rows, not per five rows', () => {
    const stats = validateManuscript(manuscript, 'plos-one').stats;
    assert.strictEqual(stats.tables, 1);
  });

  it('does not count a cross-reference as a reference', () => {
    const stats = validateManuscript(manuscript, 'plos-one').stats;
    assert.strictEqual(stats.references, 1);
  });

  it('counts the keyword list', () => {
    const stats = validateManuscript(manuscript, 'plos-one').stats;
    assert.strictEqual(stats.keywords, 3);
  });

  it('takes the title from the caller, not from the first heading', () => {
    const stats = validateManuscript(manuscript, 'plos-one', { title: 'A real title' }).stats;
    assert.strictEqual(stats.titleChars, 'A real title'.length);
  });

  it('adds the rendered reference list only when the profile asks for it', () => {
    const off = validateManuscript(manuscript, 'plos-one', { referenceWords: 500 }).stats;
    assert.strictEqual(off.counted.references, false);
    assert.strictEqual(off.wordCount, off.bodyWords + off.abstractWords + off.figureCaptionWords);

    JOURNAL_PROFILES['test-counts-references'] = {
      name: 'Counts references',
      url: 'https://example.org',
      requirements: {
        wordLimit: { main: 8000, includeReferences: true, includeAbstract: false },
      },
    };
    try {
      const on = validateManuscript(manuscript, 'test-counts-references', { referenceWords: 500 }).stats;
      assert.strictEqual(on.counted.references, true);
      assert.strictEqual(on.counted.abstract, false);
      assert.strictEqual(on.wordCount, on.bodyWords + on.figureCaptionWords + 500);
    } finally {
      delete JOURNAL_PROFILES['test-counts-references'];
    }
  });

  it('warns when a profile counts a reference list that could not be rendered', () => {
    JOURNAL_PROFILES['test-unrendered-references'] = {
      name: 'Counts references',
      url: 'https://example.org',
      requirements: { wordLimit: { main: 8000, includeReferences: true } },
    };
    try {
      const result = validateManuscript(manuscript, 'test-unrendered-references');
      assert.ok(result.warnings.some(w => w.includes('could not be rendered')));
      assert.strictEqual(result.stats.referenceWords, null);
    } finally {
      delete JOURNAL_PROFILES['test-unrendered-references'];
    }
  });

  it('ends the abstract at the next heading, not at its first z', () => {
    const withZ = ['# Abstract', '', 'Zonal patterns are analysed here.', '', '# Introduction', '', 'Body.'].join('\n');
    const stats = validateManuscript(withZ, 'plos-one').stats;
    assert.strictEqual(stats.abstractWords, 5);
  });
});
