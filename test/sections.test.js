/**
 * Tests for sections.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  extractHeader,
  generateConfig,
  loadConfig,
  saveConfig,
  deriveSectionsFromRev,
  resolveSectionsConfig,
  matchHeading,
  extractSectionsFromText,
  splitAnnotatedPaper,
  getOrderedSections,
} from '../lib/sections.js';

// Test fixtures
let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-test-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('extractHeader', () => {
  it('should extract h1 header from markdown file', () => {
    const filePath = path.join(tempDir, 'test.md');
    fs.writeFileSync(filePath, '# Introduction\n\nSome content here.');
    const header = extractHeader(filePath);
    assert.strictEqual(header, 'Introduction');
  });

  it('should return null for file without header', () => {
    const filePath = path.join(tempDir, 'test.md');
    fs.writeFileSync(filePath, 'No header here, just content.');
    const header = extractHeader(filePath);
    assert.strictEqual(header, null);
  });

  it('should return null for non-existent file', () => {
    const header = extractHeader('/nonexistent/path.md');
    assert.strictEqual(header, null);
  });

  it('should skip h2 headers and find h1', () => {
    const filePath = path.join(tempDir, 'test.md');
    fs.writeFileSync(filePath, '## Subsection\n\n# Main Title\n\nContent.');
    const header = extractHeader(filePath);
    // First h1 found should be returned
    assert.strictEqual(header, 'Main Title');
  });
});

describe('generateConfig', () => {
  it('should generate config from markdown files', () => {
    fs.writeFileSync(path.join(tempDir, 'introduction.md'), '# Introduction\n\nContent');
    fs.writeFileSync(path.join(tempDir, 'methods.md'), '# Methods\n\nContent');
    fs.writeFileSync(path.join(tempDir, 'results.md'), '# Results\n\nContent');

    const config = generateConfig(tempDir);

    assert.ok(config.sections);
    assert.ok(config.sections['introduction.md']);
    assert.ok(config.sections['methods.md']);
    assert.ok(config.sections['results.md']);
  });

  it('should exclude specified patterns', () => {
    fs.writeFileSync(path.join(tempDir, 'paper.md'), '# Paper\n');
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# README\n');
    fs.writeFileSync(path.join(tempDir, 'intro.md'), '# Intro\n');

    const config = generateConfig(tempDir);

    assert.ok(!config.sections['paper.md']);
    assert.ok(!config.sections['README.md']);
    assert.ok(config.sections['intro.md']);
  });

  it('should order sections by common academic structure', () => {
    fs.writeFileSync(path.join(tempDir, 'discussion.md'), '# Discussion\n');
    fs.writeFileSync(path.join(tempDir, 'introduction.md'), '# Introduction\n');
    fs.writeFileSync(path.join(tempDir, 'methods.md'), '# Methods\n');

    const config = generateConfig(tempDir);
    const ordered = getOrderedSections(config);

    assert.ok(ordered.indexOf('introduction.md') < ordered.indexOf('methods.md'));
    assert.ok(ordered.indexOf('methods.md') < ordered.indexOf('discussion.md'));
  });
});

describe('loadConfig and saveConfig', () => {
  it('should save and load config correctly', () => {
    const configPath = path.join(tempDir, 'sections.yaml');
    const config = {
      version: 1,
      sections: {
        'intro.md': { header: 'Introduction', aliases: ['Intro'], order: 0 },
        'methods.md': { header: 'Methods', aliases: [], order: 1 },
      },
    };

    saveConfig(configPath, config);
    const loaded = loadConfig(configPath);

    assert.strictEqual(loaded.sections['intro.md'].header, 'Introduction');
    assert.deepStrictEqual(loaded.sections['intro.md'].aliases, ['Intro']);
  });

  it('should normalize string values to full objects', () => {
    const configPath = path.join(tempDir, 'sections.yaml');
    fs.writeFileSync(configPath, `
version: 1
sections:
  intro.md: Introduction
  methods.md:
    header: Methods
    aliases:
      - Methodology
`);

    const loaded = loadConfig(configPath);

    assert.strictEqual(loaded.sections['intro.md'].header, 'Introduction');
    assert.deepStrictEqual(loaded.sections['intro.md'].aliases, []);
    assert.strictEqual(loaded.sections['methods.md'].header, 'Methods');
  });
});

describe('matchHeading', () => {
  const sections = {
    'introduction.md': { header: 'Introduction', aliases: ['Intro', 'Background'] },
    'methods.md': { header: 'Materials and Methods', aliases: ['Methods'] },
    'results.md': { header: 'Results', aliases: [] },
  };

  it('should match exact header', () => {
    const match = matchHeading('Introduction', sections);
    assert.strictEqual(match.file, 'introduction.md');
  });

  it('should match alias', () => {
    const match = matchHeading('Intro', sections);
    assert.strictEqual(match.file, 'introduction.md');
  });

  it('should be case-insensitive', () => {
    const match = matchHeading('INTRODUCTION', sections);
    assert.strictEqual(match.file, 'introduction.md');
  });

  it('should fuzzy match when 70%+ words match', () => {
    // "Materials and Methods" vs "Materials and Methods section"
    // 3 of 3 words match = 100% > 70%
    const match = matchHeading('Materials and Methods section', sections);
    assert.strictEqual(match.file, 'methods.md');
  });

  it('should return null for unknown heading', () => {
    const match = matchHeading('Completely Unknown Section', sections);
    assert.strictEqual(match, null);
  });
});

describe('extractSectionsFromText', () => {
  const sections = {
    'introduction.md': { header: 'Introduction', aliases: [] },
    'methods.md': { header: 'Methods', aliases: [] },
  };

  it('should extract sections by heading', () => {
    const text = `Introduction

This is the intro content.

Methods

This is the methods content.`;

    const result = extractSectionsFromText(text, sections);

    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].file, 'introduction.md');
    assert.ok(result[0].content.includes('intro content'));
    assert.strictEqual(result[1].file, 'methods.md');
  });

  it('should handle text without matching sections', () => {
    const text = 'Just some random text without any sections.';
    const result = extractSectionsFromText(text, sections);
    assert.strictEqual(result.length, 0);
  });
});

describe('splitAnnotatedPaper', () => {
  const sections = {
    'intro.md': { header: 'Introduction', aliases: [] },
    'methods.md': { header: 'Methods', aliases: [] },
  };

  it('should split using section markers', () => {
    const paper = `<!-- @section:intro.md -->
# Introduction

Intro content here.

<!-- @section:methods.md -->
# Methods

Methods content here.`;

    const result = splitAnnotatedPaper(paper, sections);

    assert.ok(result.has('intro.md'));
    assert.ok(result.has('methods.md'));
    assert.ok(result.get('intro.md').includes('Introduction'));
  });

  it('should fall back to header detection without markers', () => {
    const paper = `# Introduction

Intro content.

# Methods

Methods content.`;

    const result = splitAnnotatedPaper(paper, sections);

    assert.ok(result.has('intro.md'));
    assert.ok(result.has('methods.md'));
  });
});

describe('getOrderedSections', () => {
  it('should order by order property', () => {
    const config = {
      sections: {
        'z.md': { header: 'Z', order: 2 },
        'a.md': { header: 'A', order: 0 },
        'm.md': { header: 'M', order: 1 },
      },
    };

    const ordered = getOrderedSections(config);

    assert.deepStrictEqual(ordered, ['a.md', 'm.md', 'z.md']);
  });

  it('should put unordered sections last', () => {
    const config = {
      sections: {
        'first.md': { header: 'First', order: 0 },
        'unknown.md': { header: 'Unknown' }, // no order
        'second.md': { header: 'Second', order: 1 },
      },
    };

    const ordered = getOrderedSections(config);

    assert.strictEqual(ordered[0], 'first.md');
    assert.strictEqual(ordered[1], 'second.md');
    assert.strictEqual(ordered[2], 'unknown.md');
  });
});

describe('deriveSectionsFromRev', () => {
  it('should derive a config from the rev.yaml sections list, using H1 headers', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), 'sections:\n  - intro.md\n  - methods.md\n');
    fs.writeFileSync(path.join(tempDir, 'intro.md'), '# Introduction\n\nText.');
    fs.writeFileSync(path.join(tempDir, 'methods.md'), '## 2 Methods\n\nText.');

    const config = deriveSectionsFromRev(tempDir);
    assert.ok(config);
    assert.strictEqual(config.sections['intro.md'].header, 'Introduction');
    // subsection header (## 2 Methods) is preserved, not just H1
    assert.strictEqual(config.sections['methods.md'].header, '2 Methods');
    // order follows the list
    assert.strictEqual(config.sections['intro.md'].order, 0);
    assert.strictEqual(config.sections['methods.md'].order, 1);
  });

  it('should fall back to a title-cased file name when a section file has no header', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), 'sections:\n  - state_of_art.md\n');
    fs.writeFileSync(path.join(tempDir, 'state_of_art.md'), 'No header here.');

    const config = deriveSectionsFromRev(tempDir);
    assert.strictEqual(config.sections['state_of_art.md'].header, 'State Of Art');
  });

  it('should return null when rev.yaml is absent', () => {
    assert.strictEqual(deriveSectionsFromRev(tempDir), null);
  });

  it('should return null when rev.yaml has no sections list', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), 'title: Just a title\n');
    assert.strictEqual(deriveSectionsFromRev(tempDir), null);
  });
});

describe('resolveSectionsConfig', () => {
  it('should prefer an explicit sections.yaml over rev.yaml', () => {
    fs.writeFileSync(
      path.join(tempDir, 'sections.yaml'),
      'sections:\n  intro.md:\n    header: Explicit Header\n'
    );
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), 'sections:\n  - intro.md\n');
    fs.writeFileSync(path.join(tempDir, 'intro.md'), '# Derived Header\n\nText.');

    const resolved = resolveSectionsConfig(tempDir);
    assert.ok(resolved);
    assert.strictEqual(resolved.config.sections['intro.md'].header, 'Explicit Header');
    assert.ok(resolved.source.endsWith('sections.yaml'));
  });

  it('should derive from rev.yaml when no sections.yaml exists', () => {
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), 'sections:\n  - intro.md\n');
    fs.writeFileSync(path.join(tempDir, 'intro.md'), '# Introduction\n\nText.');

    const resolved = resolveSectionsConfig(tempDir);
    assert.ok(resolved);
    assert.strictEqual(resolved.config.sections['intro.md'].header, 'Introduction');
    assert.ok(resolved.source.endsWith('rev.yaml'));
  });

  it('should return null when neither config source is present', () => {
    assert.strictEqual(resolveSectionsConfig(tempDir), null);
  });
});
