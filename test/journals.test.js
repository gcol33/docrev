/**
 * Tests for journals.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  listJournals,
  getJournalProfile,
  validateManuscript,
  countForWordLimit,
  stripBackMatter,
  excludeFromWordCount,
  wordLimitBreakdown,
  JOURNAL_PROFILES,
} from '../lib/journals.js';
import { countWords } from '../lib/utils.js';

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
    assert.strictEqual(off.wordCount, off.bodyWords + off.abstractWords + off.figureCaptionWords + off.statementWords);

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
      assert.strictEqual(on.wordCount, on.bodyWords + on.figureCaptionWords + on.statementWords + 500);
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

describe('countForWordLimit', () => {
  it('strips the frontmatter of every section file, not only the first', () => {
    const intro = ['---', 'title: Intro', '---', '', 'One two three.'].join('\n');
    const methods = ['---', 'title: Methods section heading', '---', '', 'Four five.'].join('\n');
    const count = countForWordLimit([intro, methods], { main: 100 });
    assert.strictEqual(count.bodyWords, 5);
  });

  it('finds an abstract whose heading and text sit in different files', () => {
    const count = countForWordLimit(['# Abstract', 'One two three.\n\n# Introduction\n\nBody here.'], { main: 100 });
    assert.strictEqual(count.abstractWords, 3);
    assert.strictEqual(count.bodyWords, 4);
  });

  it('matches validateManuscript on a single document', () => {
    const text = ['# Abstract', '', 'Short abstract.', '', '# Results', '', '![Six words in this figure caption](f.png)', '', 'Body text.'].join('\n');
    const count = countForWordLimit([text], getJournalProfile('nature').requirements.wordLimit);
    const stats = validateManuscript(text, 'nature').stats;
    assert.strictEqual(count.wordCount, stats.wordCount);
  });

  it('drops references/supporting-info back matter from the body, whether it trails the discussion or fills its own file', () => {
    const discussion = ['# Discussion', '', 'Five words end the discussion.', '', '# Supporting Information', '', 'See the supplement for details please.'].join('\n');
    const backmatter = ['# References', '', 'Smith, J. (2020). A paper.'].join('\n');
    const count = countForWordLimit([discussion, backmatter], { main: 100 });
    // "Discussion" (the heading text) plus the five words of prose under it;
    // the whole second file is references and contributes nothing anywhere.
    assert.strictEqual(count.bodyWords, 6);
    assert.strictEqual(count.statementWords, 0);
  });

  it('counts statements toward the body by default, unset per file to statementWords', () => {
    const ackHeading = '# Acknowledgements';
    const ackBody = 'Thanks to everyone who helped with this.';
    const discussion = ['# Discussion', '', 'Five words end the discussion.', '', ackHeading, '', ackBody].join('\n');
    const backmatter = ['# Author contributions', '', 'GC did everything.', '', '# Data availability', '', 'Archived openly on Zenodo forever.'].join('\n');
    const count = countForWordLimit([discussion, backmatter], { main: 100 });
    assert.strictEqual(count.bodyWords, 6);
    assert.strictEqual(count.counted.statements, true);
    assert.strictEqual(count.statementWords, countWords(`${ackHeading}\n\n${ackBody}`) + countWords(backmatter));
    assert.strictEqual(count.wordCount, count.bodyWords + count.statementWords);
  });

  it('excludes statements from wordCount when the profile turns them off', () => {
    const discussion = ['# Discussion', '', 'Five words end the discussion.', '', '# Funding', '', 'Funded by a grant.'].join('\n');
    const count = countForWordLimit([discussion], { main: 100, includeStatements: false });
    assert.strictEqual(count.counted.statements, false);
    assert.ok(count.statementWords > 0);
    assert.strictEqual(count.wordCount, count.bodyWords);
  });

  it('lets a rev.yaml override win over the profile for includeStatements', () => {
    const discussion = ['# Discussion', '', 'Five words end the discussion.', '', '# Funding', '', 'Funded by a grant.'].join('\n');
    const on = countForWordLimit([discussion], { main: 100, includeStatements: false }, null, { includeStatements: true });
    assert.strictEqual(on.counted.statements, true);
    assert.strictEqual(on.wordCount, on.bodyWords + on.statementWords);

    const off = countForWordLimit([discussion], { main: 100, includeStatements: true }, null, { includeStatements: false });
    assert.strictEqual(off.counted.statements, false);
    assert.strictEqual(off.wordCount, off.bodyWords);
  });

  it('extends the built-in statement list with statementHeadings from the profile and from rev.yaml', () => {
    const text = ['# Discussion', '', 'Body words here.', '', '# Author Note', '', 'A note with four words.'].join('\n');
    const untouched = stripBackMatter(text);
    assert.strictEqual(untouched.statement, ''); // "Author Note" isn't built in, so it's body text

    const viaProfile = countForWordLimit([text], { main: 100, statementHeadings: ['Author Note'] });
    assert.ok(viaProfile.statementWords > 0);

    const viaOverride = countForWordLimit([text], { main: 100 }, null, { statementHeadings: ['Author Note'] });
    assert.strictEqual(viaOverride.statementWords, viaProfile.statementWords);
  });

  it('matches a back-matter heading only when it IS the heading, not when it starts one', () => {
    const methods = [
      '# Methods',
      '',
      'We used the following approach in this study today.',
      '',
      '## Reference plots',
      '',
      'Reference plots were generated for each site visited.',
      '',
      '### Funding of the survey',
      '',
      'The survey itself, as opposed to this manuscript, was funded separately.',
      '',
      '## Ethics',
      '',
      'All work in this study followed institutional ethics guidance fully.',
    ].join('\n');
    const { main, statement } = stripBackMatter(methods);
    // "Reference plots" and "Funding of the survey" have extra words after the
    // statement name, so the whole-line match leaves them as body text; only
    // "## Ethics" is the whole heading text of a built-in statement.
    assert.ok(main.includes('## Reference plots'));
    assert.ok(main.includes('Reference plots were generated'));
    assert.ok(main.includes('### Funding of the survey'));
    assert.ok(main.includes('was funded separately.'));
    assert.ok(!main.includes('Ethics'));
    assert.strictEqual(statement.trim(), '## Ethics\n\nAll work in this study followed institutional ethics guidance fully.');
  });

  it('drops a mid-file Supporting Information subsection without touching the rest of the section', () => {
    const methods = [
      '# Methods',
      '',
      'Body before the subsection.',
      '',
      '## Supporting Information',
      '',
      'This subsection is dropped outright, not counted as a statement either.',
      '',
      '## Statistics',
      '',
      'Body after the subsection.',
    ].join('\n');
    const { main, statement } = stripBackMatter(methods);
    assert.ok(main.includes('Body before the subsection.'));
    assert.ok(main.includes('## Statistics'));
    assert.ok(main.includes('Body after the subsection.'));
    assert.ok(!main.includes('Supporting Information'));
    assert.strictEqual(statement, ''); // always excluded, never a statement
  });

  it('ends a mid-file statement at the next heading of the same or higher level', () => {
    const text = [
      '# Discussion',
      '',
      'Discussion body.',
      '',
      '## Funding',
      '',
      'Funded by a grant.',
      '',
      '# Conclusion',
      '',
      'Conclusion body.',
    ].join('\n');
    const { main, statement } = stripBackMatter(text);
    // "Conclusion" is a level-1 heading, same level as "Discussion" and higher
    // than the level-2 "Funding", so it ends the statement and returns to body.
    assert.ok(main.includes('# Conclusion'));
    assert.ok(main.includes('Conclusion body.'));
    assert.ok(!main.includes('Funding'));
    assert.strictEqual(statement.trim(), '## Funding\n\nFunded by a grant.');
  });

  it('leaves a section with no back-matter heading untouched', () => {
    assert.deepStrictEqual(stripBackMatter('# Methods\n\nWe did the thing.'), { main: '# Methods\n\nWe did the thing.', statement: '' });
  });

  it('does not truncate on the word "references" used in prose, only a References heading', () => {
    const withNonHeading = '# Methods\n\nWe cite prior references here without a heading.';
    assert.deepStrictEqual(stripBackMatter(withNonHeading), { main: withNonHeading, statement: '' });
  });
});

describe('excludeFromWordCount', () => {
  it('drops a file matched by exact path or by basename', () => {
    const files = ['sections/intro.md', 'sections/peer_review.md', 'sections/methods.md'];
    assert.deepStrictEqual(excludeFromWordCount(files, ['peer_review.md']), ['sections/intro.md', 'sections/methods.md']);
    assert.deepStrictEqual(excludeFromWordCount(files, ['sections/peer_review.md']), ['sections/intro.md', 'sections/methods.md']);
  });

  it('returns the files unchanged when nothing is excluded', () => {
    const files = ['a.md', 'b.md'];
    assert.strictEqual(excludeFromWordCount(files, undefined), files);
    assert.deepStrictEqual(excludeFromWordCount(files, []), files);
  });
});

describe('wordLimitBreakdown', () => {
  it('lists only the parts the profile counts', () => {
    const count = countForWordLimit(['# Abstract', 'One two three.\n\n# Introduction\n\nFour five.'], { main: 100, includeFigureCaptions: false });
    // Statements default on, even with no statement headings present (0 words),
    // matching a plain count with no journal in play.
    assert.strictEqual(wordLimitBreakdown(count), `body ${count.bodyWords} + abstract ${count.abstractWords} + statements ${count.statementWords}`);
  });

  it('drops the statements part when a profile turns includeStatements off', () => {
    const count = countForWordLimit(['# Abstract', 'One two three.\n\n# Introduction\n\nFour five.'], { main: 100, includeFigureCaptions: false, includeStatements: false });
    assert.strictEqual(wordLimitBreakdown(count), `body ${count.bodyWords} + abstract ${count.abstractWords}`);
  });
});
