/**
 * Tests for build.js
 * Tests configuration loading and helper functions (not pandoc execution)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  DEFAULT_CONFIG,
  loadConfig,
  findSections,
  combineSections,
  buildPandocArgs,
  collectPandocPassthroughArgs,
  processTablesForFormat,
  slugifyTitle,
  getFormatExtension,
  resolveOutputPath,
  detectRawLatexFigures,
  translateRawLatexFigures,
  collectRawLatexFigureWarning,
} from '../lib/build.js';
import { hasPandoc, hasPandocCrossref } from '../lib/dependencies.js';

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-build-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('DEFAULT_CONFIG', () => {
  it('should have required default fields', () => {
    assert.ok(DEFAULT_CONFIG.title);
    assert.ok(Array.isArray(DEFAULT_CONFIG.authors));
    assert.ok(Array.isArray(DEFAULT_CONFIG.sections));
    assert.ok(DEFAULT_CONFIG.crossref);
    assert.ok(DEFAULT_CONFIG.pdf);
    assert.ok(DEFAULT_CONFIG.docx);
  });

  it('should have sensible PDF defaults', () => {
    assert.strictEqual(DEFAULT_CONFIG.pdf.documentclass, 'article');
    assert.strictEqual(DEFAULT_CONFIG.pdf.fontsize, '12pt');
  });
});

describe('loadConfig', () => {
  it('should return default config when no rev.yaml exists', () => {
    const config = loadConfig(tempDir);
    assert.strictEqual(config.title, DEFAULT_CONFIG.title);
    assert.strictEqual(config._configPath, null);
  });

  it('should load and merge rev.yaml with defaults', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), `
title: "My Paper"
authors:
  - name: John Doe
pdf:
  fontsize: 11pt
`);

    const config = loadConfig(tempDir);
    assert.strictEqual(config.title, 'My Paper');
    assert.strictEqual(config.authors[0].name, 'John Doe');
    assert.strictEqual(config.pdf.fontsize, '11pt');
    // Should still have defaults for unspecified fields
    assert.strictEqual(config.pdf.documentclass, 'article');
  });

  it('should throw for invalid YAML', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), `
title: "Valid
  invalid: yaml: here
`);

    assert.throws(() => loadConfig(tempDir), /Failed to parse rev.yaml/);
  });

  it('should deep merge nested configs', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), `
crossref:
  figureTitle: "Fig."
`);

    const config = loadConfig(tempDir);
    assert.strictEqual(config.crossref.figureTitle, 'Fig.');
    // Other crossref defaults should be preserved
    assert.strictEqual(config.crossref.tableTitle, 'Table');
  });
});

describe('findSections', () => {
  it('should use sections from config if provided', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), '# Intro');
    fs.writeFileSync(path.join(tempDir, 'methods.md'), '# Methods');
    fs.writeFileSync(path.join(tempDir, 'extra.md'), '# Extra');

    const sections = findSections(tempDir, ['intro.md', 'methods.md']);
    assert.deepStrictEqual(sections, ['intro.md', 'methods.md']);
  });

  it('should warn for missing section files', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), '# Intro');

    // This should not throw but skip missing files
    const sections = findSections(tempDir, ['intro.md', 'nonexistent.md']);
    assert.strictEqual(sections.length, 1);
    assert.strictEqual(sections[0], 'intro.md');
  });

  it('should auto-detect .md files when no config sections', () => {
    fs.writeFileSync(path.join(tempDir, 'alpha.md'), '# Alpha');
    fs.writeFileSync(path.join(tempDir, 'beta.md'), '# Beta');
    fs.writeFileSync(path.join(tempDir, 'paper.md'), '# Paper'); // Should be excluded

    const sections = findSections(tempDir, []);
    assert.ok(sections.includes('alpha.md'));
    assert.ok(sections.includes('beta.md'));
    assert.ok(!sections.includes('paper.md'));
  });

  it('should exclude special files', () => {
    fs.writeFileSync(path.join(tempDir, 'readme.md'), '# README');
    fs.writeFileSync(path.join(tempDir, 'CLAUDE.md'), '# Claude');
    fs.writeFileSync(path.join(tempDir, 'content.md'), '# Content');

    const sections = findSections(tempDir, []);
    assert.ok(!sections.includes('readme.md'));
    assert.ok(!sections.includes('CLAUDE.md'));
    assert.ok(sections.includes('content.md'));
  });

  it('should read from sections.yaml if exists', () => {
    fs.writeFileSync(path.join(tempDir, 'sections.yaml'), `
sections:
  methods.md:
    order: 2
  intro.md:
    order: 1
`);
    fs.writeFileSync(path.join(tempDir, 'intro.md'), '# Intro');
    fs.writeFileSync(path.join(tempDir, 'methods.md'), '# Methods');

    const sections = findSections(tempDir, []);
    assert.strictEqual(sections[0], 'intro.md');
    assert.strictEqual(sections[1], 'methods.md');
  });
});

describe('combineSections', () => {
  it('should combine section files into paper.md', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), '# Introduction\n\nText here.');
    fs.writeFileSync(path.join(tempDir, 'methods.md'), '# Methods\n\nMore text.');

    const config = {
      ...DEFAULT_CONFIG,
      title: 'Test Paper',
      sections: ['intro.md', 'methods.md'],
    };

    const paperPath = combineSections(tempDir, config);

    assert.strictEqual(paperPath, path.join(tempDir, 'paper.md'));
    assert.ok(fs.existsSync(paperPath));

    const content = fs.readFileSync(paperPath, 'utf-8');
    assert.ok(content.includes('title: Test Paper'));
    assert.ok(content.includes('# Introduction'));
    assert.ok(content.includes('# Methods'));
  });

  it('should strip frontmatter from section files', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), `---
title: Section Title
---

# Introduction

Content here.`);

    const config = {
      ...DEFAULT_CONFIG,
      sections: ['intro.md'],
    };

    const paperPath = combineSections(tempDir, config);
    const content = fs.readFileSync(paperPath, 'utf-8');

    // Should not have nested frontmatter
    const matches = content.match(/---/g);
    assert.strictEqual(matches.length, 2); // Only the main frontmatter
  });

  it('should throw if no sections found', () => {
    const config = { ...DEFAULT_CONFIG, sections: [] };

    assert.throws(() => combineSections(tempDir, config), /No section files found/);
  });

  it('should include bibliography in frontmatter', () => {
    fs.writeFileSync(path.join(tempDir, 'content.md'), '# Content');

    const config = {
      ...DEFAULT_CONFIG,
      sections: ['content.md'],
      bibliography: 'refs.bib',
    };

    const paperPath = combineSections(tempDir, config);
    const content = fs.readFileSync(paperPath, 'utf-8');

    assert.ok(content.includes('bibliography: refs.bib'));
  });
});

describe('buildPandocArgs', () => {
  it('should build PDF arguments', () => {
    const args = buildPandocArgs('pdf', DEFAULT_CONFIG, 'output.pdf');

    assert.ok(args.includes('-t'));
    assert.ok(args.includes('pdf'));
    assert.ok(args.includes('-o'));
    assert.ok(args.includes('output.pdf'));
  });

  it('should build DOCX arguments', () => {
    const args = buildPandocArgs('docx', DEFAULT_CONFIG, 'output.docx');

    assert.ok(args.includes('-t'));
    assert.ok(args.includes('docx'));
  });

  it('should build TEX arguments with standalone', () => {
    const args = buildPandocArgs('tex', DEFAULT_CONFIG, 'output.tex');

    assert.ok(args.includes('-t'));
    assert.ok(args.includes('latex'));
    assert.ok(args.includes('-s')); // standalone
  });

  it('should include bibliography flag when configured', () => {
    const config = { ...DEFAULT_CONFIG, bibliography: 'refs.bib' };
    const args = buildPandocArgs('pdf', config, 'output.pdf');

    assert.ok(args.includes('--citeproc'));
  });

  it('should include PDF-specific variables', () => {
    const args = buildPandocArgs('pdf', DEFAULT_CONFIG, 'output.pdf');

    assert.ok(args.some(a => a.includes('documentclass=article')));
    assert.ok(args.some(a => a.includes('fontsize=12pt')));
    assert.ok(args.some(a => a.includes('geometry:')));
  });

  it('should include reference doc for DOCX when configured', () => {
    const config = {
      ...DEFAULT_CONFIG,
      docx: { ...DEFAULT_CONFIG.docx, reference: 'template.docx' },
    };
    const args = buildPandocArgs('docx', config, 'output.docx');

    assert.ok(args.includes('--reference-doc'));
    assert.ok(args.includes('template.docx'));
  });

  it('should include TOC when configured', () => {
    const config = {
      ...DEFAULT_CONFIG,
      pdf: { ...DEFAULT_CONFIG.pdf, toc: true },
    };
    const args = buildPandocArgs('pdf', config, 'output.pdf');

    assert.ok(args.includes('--toc'));
  });

  it('should include number-sections when configured', () => {
    const config = {
      ...DEFAULT_CONFIG,
      pdf: { ...DEFAULT_CONFIG.pdf, numbersections: true },
    };
    const args = buildPandocArgs('pdf', config, 'output.pdf');

    assert.ok(args.includes('--number-sections'));
  });
});

describe('collectPandocPassthroughArgs', () => {
  it('returns empty array when nothing is configured', () => {
    const args = collectPandocPassthroughArgs('docx', DEFAULT_CONFIG);
    assert.deepStrictEqual(args, []);
  });

  it('includes top-level pandocArgs', () => {
    const config = { ...DEFAULT_CONFIG, pandocArgs: ['--lua-filter=top.lua'] };
    const args = collectPandocPassthroughArgs('docx', config);
    assert.deepStrictEqual(args, ['--lua-filter=top.lua']);
  });

  it('includes format-specific pandocArgs', () => {
    const config = {
      ...DEFAULT_CONFIG,
      docx: { ...DEFAULT_CONFIG.docx, pandocArgs: ['--lua-filter=docx.lua'] },
    };
    const args = collectPandocPassthroughArgs('docx', config);
    assert.deepStrictEqual(args, ['--lua-filter=docx.lua']);
  });

  it('format-specific pandocArgs do not leak into other formats', () => {
    const config = {
      ...DEFAULT_CONFIG,
      docx: { ...DEFAULT_CONFIG.docx, pandocArgs: ['--lua-filter=docx.lua'] },
    };
    const args = collectPandocPassthroughArgs('pdf', config);
    assert.deepStrictEqual(args, []);
  });

  it('concatenates top-level then format-specific then CLI in order', () => {
    const config = {
      ...DEFAULT_CONFIG,
      pandocArgs: ['--lua-filter=top.lua'],
      docx: { ...DEFAULT_CONFIG.docx, pandocArgs: ['--lua-filter=docx.lua'] },
    };
    const args = collectPandocPassthroughArgs('docx', config, ['--lua-filter=cli.lua']);
    assert.deepStrictEqual(args, [
      '--lua-filter=top.lua',
      '--lua-filter=docx.lua',
      '--lua-filter=cli.lua',
    ]);
  });

  it('CLI args are appended last so repeated flags can override config', () => {
    const config = {
      ...DEFAULT_CONFIG,
      pandocArgs: ['--shift-heading-level-by=1'],
    };
    const args = collectPandocPassthroughArgs('docx', config, ['--shift-heading-level-by=2']);
    // Both present; CLI value comes last, so pandoc's last-wins semantics apply
    assert.strictEqual(args[0], '--shift-heading-level-by=1');
    assert.strictEqual(args[1], '--shift-heading-level-by=2');
  });
});

describe('loadConfig pandoc-args mapping', () => {
  it('reads hyphenated pandoc-args at top level into pandocArgs', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), `
title: "X"
pandoc-args:
  - --lua-filter=foo.lua
  - --shift-heading-level-by=1
`);
    const config = loadConfig(tempDir);
    assert.deepStrictEqual(config.pandocArgs, ['--lua-filter=foo.lua', '--shift-heading-level-by=1']);
  });

  it('reads hyphenated pandoc-args inside format blocks', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), `
title: "X"
docx:
  pandoc-args: [--lua-filter=docx.lua]
`);
    const config = loadConfig(tempDir);
    assert.deepStrictEqual(config.docx.pandocArgs, ['--lua-filter=docx.lua']);
  });

  it('accepts camelCase pandocArgs as a fallback', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), `
title: "X"
pandocArgs:
  - --lua-filter=foo.lua
`);
    const config = loadConfig(tempDir);
    assert.deepStrictEqual(config.pandocArgs, ['--lua-filter=foo.lua']);
  });

  it('coerces a single string pandoc-args into a one-element array', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), `
title: "X"
pandoc-args: --lua-filter=foo.lua
`);
    const config = loadConfig(tempDir);
    assert.deepStrictEqual(config.pandocArgs, ['--lua-filter=foo.lua']);
  });
});

describe('slugifyTitle', () => {
  it('returns "paper" for empty title', () => {
    assert.strictEqual(slugifyTitle(''), 'paper');
    assert.strictEqual(slugifyTitle(undefined), 'paper');
    assert.strictEqual(slugifyTitle(null), 'paper');
  });

  it('lowercases and hyphenates a short title', () => {
    assert.strictEqual(slugifyTitle('My Document'), 'my-document');
  });

  it('collapses non-alphanumeric runs into a single hyphen', () => {
    assert.strictEqual(slugifyTitle('Foo --- Bar/Baz!!!'), 'foo-bar-baz');
  });

  it('trims leading/trailing hyphens', () => {
    assert.strictEqual(slugifyTitle('---Foo---'), 'foo');
  });

  it('truncates at last hyphen boundary when too long (no mid-word cut)', () => {
    // The original ADAPT title that triggered Issue 2: 50-char blind cut produced
    // "adapt-alien-dark-diversity-across-plant-communitie" — missing the trailing "s".
    // With the 80-char cap and hyphen-boundary, the whole slug now fits.
    const title = 'ADAPT: Alien dark diversity across plant communities';
    const slug = slugifyTitle(title);
    assert.strictEqual(slug, 'adapt-alien-dark-diversity-across-plant-communities');
  });

  it('truncates at last hyphen boundary for titles longer than the cap', () => {
    // Long enough to exceed 80 chars; should cut at last hyphen, not mid-word
    const title = 'A '.repeat(60).trim(); // 60 "a" words separated by spaces
    const slug = slugifyTitle(title);
    assert.ok(slug.length <= 80, `slug ${slug.length} chars, expected <= 80`);
    assert.ok(!slug.endsWith('-'), 'slug should not end with hyphen');
    // Should be all whole "a"s, not a partial
    assert.ok(/^(a-)+a$/.test(slug), `slug "${slug}" is not whole words`);
  });

  it('falls back to hard cut when no hyphen boundary exists', () => {
    // No word breaks at all — must hard-cut at 80
    const title = 'x'.repeat(200);
    const slug = slugifyTitle(title);
    assert.strictEqual(slug.length, 80);
  });
});

describe('getFormatExtension', () => {
  it('returns canonical extension for each format', () => {
    assert.strictEqual(getFormatExtension('pdf'), '.pdf');
    assert.strictEqual(getFormatExtension('docx'), '.docx');
    assert.strictEqual(getFormatExtension('tex'), '.tex');
    assert.strictEqual(getFormatExtension('beamer'), '.pdf');
    assert.strictEqual(getFormatExtension('pptx'), '.pptx');
  });

  it('defaults to .pdf for unknown formats', () => {
    assert.strictEqual(getFormatExtension('weird'), '.pdf');
  });
});

describe('resolveOutputPath', () => {
  it('falls back to slug under outputDir when no explicit name', () => {
    const config = { ...DEFAULT_CONFIG, title: 'My Paper', outputDir: 'output' };
    const p = resolveOutputPath(tempDir, config, 'docx');
    assert.strictEqual(p, path.join(tempDir, 'output', 'my-paper.docx'));
  });

  it('honors config.output[format] under outputDir', () => {
    const config = {
      ...DEFAULT_CONFIG,
      title: 'My Paper',
      outputDir: 'output',
      output: { docx: 'Final_Report.docx' },
    };
    const p = resolveOutputPath(tempDir, config, 'docx');
    assert.strictEqual(p, path.join(tempDir, 'output', 'Final_Report.docx'));
  });

  it('per-format output does not leak to other formats', () => {
    const config = {
      ...DEFAULT_CONFIG,
      title: 'My Paper',
      outputDir: 'output',
      output: { docx: 'Final_Report.docx' },
    };
    const p = resolveOutputPath(tempDir, config, 'pdf');
    assert.strictEqual(p, path.join(tempDir, 'output', 'my-paper.pdf'));
  });

  it('auto-adds extension if missing from config.output value', () => {
    const config = {
      ...DEFAULT_CONFIG,
      outputDir: 'output',
      output: { docx: 'Final_Report' },
    };
    const p = resolveOutputPath(tempDir, config, 'docx');
    assert.strictEqual(p, path.join(tempDir, 'output', 'Final_Report.docx'));
  });

  it('CLI override beats config.output', () => {
    const config = {
      ...DEFAULT_CONFIG,
      outputDir: 'output',
      output: { docx: 'Configured.docx' },
    };
    const p = resolveOutputPath(tempDir, config, 'docx', { cliOverride: 'FromCli.docx' });
    assert.strictEqual(p, path.join(tempDir, 'output', 'FromCli.docx'));
  });

  it('absolute CLI path bypasses outputDir', () => {
    const config = { ...DEFAULT_CONFIG, outputDir: 'output' };
    const abs = path.resolve(tempDir, 'somewhere', 'else.docx');
    const p = resolveOutputPath(tempDir, config, 'docx', { cliOverride: abs });
    assert.strictEqual(p, abs);
  });

  it('absolute config.output path bypasses outputDir', () => {
    const abs = path.resolve(tempDir, 'somewhere', 'else.docx');
    const config = {
      ...DEFAULT_CONFIG,
      outputDir: 'output',
      output: { docx: abs },
    };
    const p = resolveOutputPath(tempDir, config, 'docx');
    assert.strictEqual(p, abs);
  });

  it('relative CLI path resolves under outputDir', () => {
    const config = { ...DEFAULT_CONFIG, outputDir: 'output' };
    const p = resolveOutputPath(tempDir, config, 'docx', { cliOverride: 'cli-out.docx' });
    assert.strictEqual(p, path.join(tempDir, 'output', 'cli-out.docx'));
  });

  it('appends suffix before extension (e.g. -changes)', () => {
    const config = {
      ...DEFAULT_CONFIG,
      outputDir: 'output',
      output: { docx: 'Report.docx' },
    };
    const p = resolveOutputPath(tempDir, config, 'docx', { suffix: '-changes' });
    assert.strictEqual(p, path.join(tempDir, 'output', 'Report-changes.docx'));
  });

  it('appends suffix to slug fallback', () => {
    const config = { ...DEFAULT_CONFIG, title: 'My Paper', outputDir: 'output' };
    const p = resolveOutputPath(tempDir, config, 'beamer', { suffix: '-slides' });
    assert.strictEqual(p, path.join(tempDir, 'output', 'my-paper-slides.pdf'));
  });

  it('respects outputDir: null (writes alongside paper.md)', () => {
    const config = { ...DEFAULT_CONFIG, title: 'My Paper', outputDir: null };
    const p = resolveOutputPath(tempDir, config, 'docx');
    assert.strictEqual(p, path.join(tempDir, 'my-paper.docx'));
  });

  it('long ADAPT-style title produces full slug at 80-char cap', () => {
    // Regression for the original bug: blind 50-char slice cut "communities" → "communitie".
    const config = {
      ...DEFAULT_CONFIG,
      title: 'ADAPT: Alien dark diversity across plant communities',
      outputDir: 'output',
    };
    const p = resolveOutputPath(tempDir, config, 'docx');
    assert.strictEqual(p, path.join(tempDir, 'output', 'adapt-alien-dark-diversity-across-plant-communities.docx'));
  });
});

describe('loadConfig output mapping', () => {
  it('reads output: { docx, pdf } per-format map', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), `
title: "X"
output:
  docx: Custom_Name.docx
  pdf: Custom_Name.pdf
`);
    const config = loadConfig(tempDir);
    assert.strictEqual(config.output.docx, 'Custom_Name.docx');
    assert.strictEqual(config.output.pdf, 'Custom_Name.pdf');
  });
});

describe('hasPandoc', () => {
  it('should return boolean', () => {
    const result = hasPandoc();
    assert.strictEqual(typeof result, 'boolean');
  });
});

describe('hasPandocCrossref', () => {
  it('should return boolean', () => {
    const result = hasPandocCrossref();
    assert.strictEqual(typeof result, 'boolean');
  });
});

describe('processTablesForFormat', () => {
  const pipeTable = `| Parameter | Prior | Description |
|-----------|-------|-------------|
| alpha | Normal(0, 0.5) | Intercept |
| beta | Student-t(3, 0, 1) | Slope |
| sigma | Gamma(2, 0.5) | Error |`;

  it('should convert Normal() to LaTeX math in nowrap columns for pdf', () => {
    const config = { nowrap: ['Prior'] };
    const result = processTablesForFormat(pipeTable, config, 'pdf');

    assert.ok(result.includes('$\\mathcal{N}(0, 0.5)$'));
    assert.ok(!result.includes('Normal(0, 0.5)'));
  });

  it('should convert Student-t() to LaTeX math', () => {
    const config = { nowrap: ['Prior'] };
    const result = processTablesForFormat(pipeTable, config, 'pdf');

    assert.ok(result.includes('$t_{3}(0, 1)$'));
    assert.ok(!result.includes('Student-t(3, 0, 1)'));
  });

  it('should convert Gamma() to LaTeX math', () => {
    const config = { nowrap: ['Prior'] };
    const result = processTablesForFormat(pipeTable, config, 'pdf');

    assert.ok(result.includes('$\\text{Gamma}(2, 0.5)$'));
    assert.ok(!result.includes('Gamma(2, 0.5)'));
  });

  it('should not modify content for non-pdf formats', () => {
    const config = { nowrap: ['Prior'] };
    const result = processTablesForFormat(pipeTable, config, 'docx');

    assert.strictEqual(result, pipeTable);
  });

  it('should not modify content when no nowrap config', () => {
    const result = processTablesForFormat(pipeTable, {}, 'pdf');
    assert.strictEqual(result, pipeTable);

    const result2 = processTablesForFormat(pipeTable, null, 'pdf');
    assert.strictEqual(result2, pipeTable);
  });

  it('should not modify columns not in nowrap list', () => {
    const config = { nowrap: ['Prior'] };
    const result = processTablesForFormat(pipeTable, config, 'pdf');

    // Parameter and Description columns should be unchanged
    assert.ok(result.includes('| alpha |'));
    assert.ok(result.includes('| Intercept |'));
  });

  it('should handle case-insensitive column matching', () => {
    const table = `| PRIOR | Value |
|-------|-------|
| Normal(0, 1) | test |`;

    const config = { nowrap: ['prior'] };
    const result = processTablesForFormat(table, config, 'pdf');

    assert.ok(result.includes('$\\mathcal{N}(0, 1)$'));
  });

  it('should handle partial column name matching', () => {
    const table = `| Prior Distribution | Value |
|-------------------|-------|
| Normal(0, 1) | test |`;

    const config = { nowrap: ['Prior'] };
    const result = processTablesForFormat(table, config, 'pdf');

    assert.ok(result.includes('$\\mathcal{N}(0, 1)$'));
  });

  it('should not modify cells already in math mode', () => {
    const table = `| Prior | Value |
|-------|-------|
| $\\mathcal{N}(0, 1)$ | test |`;

    const config = { nowrap: ['Prior'] };
    const result = processTablesForFormat(table, config, 'pdf');

    // Should remain unchanged
    assert.ok(result.includes('$\\mathcal{N}(0, 1)$'));
    assert.ok(!result.includes('$$'));
  });

  it('should handle Half-Normal distribution', () => {
    const table = `| Prior | Value |
|-------|-------|
| Half-Normal(0, 1) | test |`;

    const config = { nowrap: ['Prior'] };
    const result = processTablesForFormat(table, config, 'pdf');

    assert.ok(result.includes('$\\text{Half-Normal}(0, 1)$'));
  });

  it('should handle Exponential distribution', () => {
    const table = `| Prior | Value |
|-------|-------|
| Exponential(1) | test |`;

    const config = { nowrap: ['Prior'] };
    const result = processTablesForFormat(table, config, 'pdf');

    assert.ok(result.includes('$\\text{Exp}(1)$'));
  });

  it('should work with tex format', () => {
    const config = { nowrap: ['Prior'] };
    const result = processTablesForFormat(pipeTable, config, 'tex');

    assert.ok(result.includes('$\\mathcal{N}(0, 0.5)$'));
  });

  it('should handle multiple nowrap columns', () => {
    const table = `| Col1 | Col2 | Col3 |
|------|------|------|
| Normal(0, 1) | Normal(0, 2) | Normal(0, 3) |`;

    const config = { nowrap: ['Col1', 'Col3'] };
    const result = processTablesForFormat(table, config, 'pdf');

    assert.ok(result.includes('$\\mathcal{N}(0, 1)$'));
    assert.ok(result.includes('Normal(0, 2)')); // Col2 not in nowrap
    assert.ok(result.includes('$\\mathcal{N}(0, 3)$'));
  });

  it('should handle R-hat column matching', () => {
    const table = `| Parameter | $\\widehat{R}$ |
|-----------|---------------|
| alpha | 1.01 |`;

    const config = { nowrap: ['$\\widehat{R}$'] };
    const result = processTablesForFormat(table, config, 'pdf');

    // Should match the column (no conversion needed for numbers)
    assert.ok(result.includes('1.01'));
  });
});

describe('detectRawLatexFigures', () => {
  it('finds a single \\begin{figure} block and reports line/file', () => {
    const content = [
      '# Intro',
      '',
      'Some text here.',
      '',
      '\\begin{figure}[H]',
      '\\centering',
      '\\includegraphics[width=0.8\\textwidth]{figures/map.pdf}',
      '\\caption{Map of study sites.}',
      '\\label{fig:map}',
      '\\end{figure}',
      '',
      'More text.',
    ].join('\n');

    const figs = detectRawLatexFigures(content, 'intro.md');
    assert.strictEqual(figs.length, 1);
    assert.strictEqual(figs[0].file, 'intro.md');
    assert.strictEqual(figs[0].line, 5); // 1-based line of \begin{figure}
    assert.strictEqual(figs[0].exotic, false);
    assert.ok(figs[0].block.includes('\\includegraphics'));
  });

  it('counts multiple blocks correctly', () => {
    const content = `\\begin{figure}\\includegraphics{a.pdf}\\end{figure}

\\begin{figure}\\includegraphics{b.pdf}\\end{figure}

\\begin{figure}\\includegraphics{c.pdf}\\end{figure}`;
    const figs = detectRawLatexFigures(content);
    assert.strictEqual(figs.length, 3);
  });

  it('skips \\begin{figure} blocks without \\includegraphics', () => {
    const content = `\\begin{figure}
\\caption{Empty figure}
\\end{figure}`;
    const figs = detectRawLatexFigures(content);
    assert.strictEqual(figs.length, 0);
  });

  it('flags exotic shapes (\\subfloat, \\rotatebox, multi-include)', () => {
    const subfloat = `\\begin{figure}\\subfloat{\\includegraphics{a.pdf}}\\end{figure}`;
    const rotate = `\\begin{figure}\\rotatebox{90}{\\includegraphics{b.pdf}}\\end{figure}`;
    const multi = `\\begin{figure}\\includegraphics{a.pdf}\\includegraphics{b.pdf}\\end{figure}`;
    for (const block of [subfloat, rotate, multi]) {
      const figs = detectRawLatexFigures(block);
      assert.strictEqual(figs.length, 1, `expected one detection in: ${block}`);
      assert.strictEqual(figs[0].exotic, true, `expected exotic for: ${block}`);
    }
  });

  it('handles figure* (two-column) environment', () => {
    const content = `\\begin{figure*}\\includegraphics{a.pdf}\\caption{X}\\end{figure*}`;
    const figs = detectRawLatexFigures(content);
    assert.strictEqual(figs.length, 1);
    assert.strictEqual(figs[0].exotic, false);
  });
});

describe('translateRawLatexFigures', () => {
  it('translates bare \\includegraphics{path} with no caption/label', () => {
    const input = `Before.

\\begin{figure}
\\includegraphics{figures/map.pdf}
\\end{figure}

After.`;
    const { translated, translatedCount } = translateRawLatexFigures(input);
    assert.strictEqual(translatedCount, 1);
    assert.ok(translated.includes('![](figures/map.pdf)'));
    assert.ok(!translated.includes('\\begin{figure}'));
  });

  it('translates the canonical caption+label+width block', () => {
    const input = `\\begin{figure}[H]
\\centering
\\includegraphics[width=0.8\\textwidth]{figures/map.pdf}
\\caption{Map of study sites.}
\\label{fig:map}
\\end{figure}`;
    const { translated, translatedCount } = translateRawLatexFigures(input);
    assert.strictEqual(translatedCount, 1);
    assert.ok(
      translated.includes('![Map of study sites.](figures/map.pdf) {#fig:map width=80%}'),
      `got: ${translated}`
    );
  });

  it('converts \\linewidth to 100% and 0.5\\textwidth to 50%', () => {
    const half = `\\begin{figure}\\includegraphics[width=0.5\\textwidth]{a.pdf}\\caption{C}\\label{fig:a}\\end{figure}`;
    const full = `\\begin{figure}\\includegraphics[width=\\linewidth]{b.pdf}\\caption{C}\\label{fig:b}\\end{figure}`;
    assert.ok(translateRawLatexFigures(half).translated.includes('width=50%'));
    assert.ok(translateRawLatexFigures(full).translated.includes('width=100%'));
  });

  it('keeps absolute units (8cm) verbatim', () => {
    const input = `\\begin{figure}\\includegraphics[width=8cm]{a.pdf}\\label{fig:a}\\end{figure}`;
    const { translated } = translateRawLatexFigures(input);
    assert.ok(translated.includes('width=8cm'), `got: ${translated}`);
  });

  it('auto-prefixes label with fig: when missing', () => {
    const input = `\\begin{figure}\\includegraphics{a.pdf}\\label{map}\\end{figure}`;
    const { translated } = translateRawLatexFigures(input);
    assert.ok(translated.includes('#fig:map'), `got: ${translated}`);
  });

  it('preserves an explicit fig: label prefix', () => {
    const input = `\\begin{figure}\\includegraphics{a.pdf}\\label{fig:map}\\end{figure}`;
    const { translated } = translateRawLatexFigures(input);
    assert.ok(translated.includes('#fig:map'));
    assert.ok(!translated.includes('#fig:fig:'));
  });

  it('leaves exotic blocks alone (\\subfloat, multi-include)', () => {
    const subfloat = `\\begin{figure}\\subfloat{\\includegraphics{a.pdf}}\\caption{C}\\end{figure}`;
    const multi = `\\begin{figure}\\includegraphics{a.pdf}\\includegraphics{b.pdf}\\caption{C}\\end{figure}`;
    for (const block of [subfloat, multi]) {
      const { translated, translatedCount } = translateRawLatexFigures(block);
      assert.strictEqual(translatedCount, 0);
      assert.strictEqual(translated, block);
    }
  });

  it('leaves unrecognised width units alone', () => {
    const input = `\\begin{figure}\\includegraphics[width=0.5\\paperheight]{a.pdf}\\caption{C}\\label{fig:a}\\end{figure}`;
    const { translated, translatedCount } = translateRawLatexFigures(input);
    assert.strictEqual(translatedCount, 0);
    assert.strictEqual(translated, input);
  });

  it('handles captions with balanced braces (\\textbf{...})', () => {
    const input = `\\begin{figure}\\includegraphics{a.pdf}\\caption{See \\textbf{Map} for details.}\\label{fig:a}\\end{figure}`;
    const { translated, translatedCount } = translateRawLatexFigures(input);
    assert.strictEqual(translatedCount, 1);
    assert.ok(translated.includes('See \\textbf{Map} for details.'), `got: ${translated}`);
  });

  it('translates multiple blocks in one pass', () => {
    const input = `\\begin{figure}\\includegraphics{a.pdf}\\caption{A}\\label{fig:a}\\end{figure}

text

\\begin{figure}\\includegraphics{b.pdf}\\caption{B}\\label{fig:b}\\end{figure}`;
    const { translated, translatedCount } = translateRawLatexFigures(input);
    assert.strictEqual(translatedCount, 2);
    assert.ok(translated.includes('![A](a.pdf)'));
    assert.ok(translated.includes('![B](b.pdf)'));
  });

  it('returns content unchanged when there are no figure blocks', () => {
    const input = `# Heading

Just prose with no figures.`;
    const { translated, translatedCount } = translateRawLatexFigures(input);
    assert.strictEqual(translatedCount, 0);
    assert.strictEqual(translated, input);
  });
});

describe('collectRawLatexFigureWarning', () => {
  it('returns null when there are no raw LaTeX figure blocks', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), '# Intro\n\nJust prose, no figures.\n');
    const config = { ...DEFAULT_CONFIG, title: 'X', sections: ['intro.md'] };
    assert.strictEqual(collectRawLatexFigureWarning(tempDir, config), null);
  });

  it('omits non-exotic blocks when translateRawFigures defaults to true', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), `# Intro

\\begin{figure}
\\subfloat{\\includegraphics{a.pdf}}
\\caption{Exotic block}
\\end{figure}

\\begin{figure}
\\includegraphics{b.pdf}
\\caption{Clean block}
\\end{figure}
`);
    const config = { ...DEFAULT_CONFIG, title: 'X', sections: ['intro.md'] };
    const w = collectRawLatexFigureWarning(tempDir, config);
    assert.ok(w, 'expected a warning');
    assert.ok(w.includes('intro.md:'), 'warning should cite file:line');
    assert.ok(w.includes('too complex to auto-translate'));
    assert.ok(w.includes('a.pdf'), 'exotic block path should appear');
    assert.ok(!w.includes('b.pdf'), 'clean block should be translated, not warned');
  });

  it('warns about every block when translateRawFigures is false', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), `# Intro

\\begin{figure}
\\includegraphics{a.pdf}
\\caption{Clean A}
\\end{figure}

\\begin{figure}
\\includegraphics{b.pdf}
\\caption{Clean B}
\\end{figure}
`);
    const config = {
      ...DEFAULT_CONFIG,
      title: 'X',
      sections: ['intro.md'],
      docx: { ...DEFAULT_CONFIG.docx, translateRawFigures: false },
    };
    const w = collectRawLatexFigureWarning(tempDir, config);
    assert.ok(w, 'expected a warning');
    assert.ok(w.includes('translateRawFigures: false'));
    assert.ok(w.includes('a.pdf'));
    assert.ok(w.includes('b.pdf'));
  });

  it('reports correct line numbers in source files', () => {
    fs.writeFileSync(path.join(tempDir, 'methods.md'), `# Methods

Some prose.

\\begin{figure}
\\subfloat{\\includegraphics{x.pdf}}
\\end{figure}
`);
    const config = { ...DEFAULT_CONFIG, title: 'X', sections: ['methods.md'] };
    const w = collectRawLatexFigureWarning(tempDir, config);
    assert.ok(w);
    assert.ok(w.includes('methods.md:5'), `expected methods.md:5, got:\n${w}`);
  });
});
