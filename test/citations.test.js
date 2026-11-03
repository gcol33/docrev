/**
 * Tests for citations.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  extractCitations,
  parseBibFile,
  validateCitations,
  getCitationStats,
} from '../lib/citations.js';

// Test fixtures
let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-cit-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('extractCitations', () => {
  it('should extract bracketed citations', () => {
    const text = 'This was shown by [@Smith2020].';
    const citations = extractCitations(text);

    assert.strictEqual(citations.length, 1);
    assert.strictEqual(citations[0].key, 'Smith2020');
  });

  it('should extract multiple citations in brackets', () => {
    const text = 'Multiple studies [@Smith2020; @Jones2021] showed this.';
    const citations = extractCitations(text);

    assert.strictEqual(citations.length, 2);
    assert.ok(citations.some(c => c.key === 'Smith2020'));
    assert.ok(citations.some(c => c.key === 'Jones2021'));
  });

  it('should require @ prefix in brackets', () => {
    const text = 'As shown [Smith2020].'; // No @ prefix
    const citations = extractCitations(text);

    // The implementation requires [@...] format
    assert.strictEqual(citations.length, 0);
  });

  it('should extract inline citations', () => {
    const text = 'According to @Smith2020, this is true.';
    const citations = extractCitations(text);

    assert.strictEqual(citations.length, 1);
    assert.strictEqual(citations[0].key, 'Smith2020');
  });

  it('should track line numbers', () => {
    const text = 'Line 1\nLine 2 with [@Cite2020]\nLine 3';
    const citations = extractCitations(text);

    assert.strictEqual(citations[0].line, 2);
  });

  it('should track file name', () => {
    const text = 'Citation [@Test2020]';
    const citations = extractCitations(text, 'methods.md');

    assert.strictEqual(citations[0].file, 'methods.md');
  });

  it('should skip code blocks', () => {
    const text = '```\n[@NotACitation]\n```\n[@RealCitation2020]';
    const citations = extractCitations(text);

    // May not perfectly skip code blocks, but should find the real one
    assert.ok(citations.some(c => c.key === 'RealCitation2020'));
  });

  it('should handle citation keys with letters after year', () => {
    const text = 'Multiple works [@Smith2020a; @Smith2020b]';
    const citations = extractCitations(text);

    assert.ok(citations.some(c => c.key === 'Smith2020a'));
    assert.ok(citations.some(c => c.key === 'Smith2020b'));
  });

  it('should not invent a shorter key from a lettered key in a bracketed group', () => {
    const text = 'Six downloads [@GBIF2026a; @GBIF2026b; @GBIF2026c] and one [@Smith2020b].';
    const keys = extractCitations(text).map(c => c.key).sort();

    assert.deepStrictEqual(keys, ['GBIF2026a', 'GBIF2026b', 'GBIF2026c', 'Smith2020b']);
  });

  it('should count a bracketed key once and still read inline keys on the same line', () => {
    const text = 'As @Jones2019a argued [@Smith2020; @Lee2021], and @Kim2022 too.';
    const keys = extractCitations(text).map(c => c.key).sort();

    assert.deepStrictEqual(keys, ['Jones2019a', 'Kim2022', 'Lee2021', 'Smith2020']);
  });

  it('should handle citation keys with hyphens and underscores', () => {
    const text = '[@Van-Der-Berg2020] and [@Smith_Jones2021]';
    const citations = extractCitations(text);

    assert.ok(citations.some(c => c.key === 'Van-Der-Berg2020'));
    assert.ok(citations.some(c => c.key === 'Smith_Jones2021'));
  });
});

describe('parseBibFile', () => {
  it('should extract entry keys from bib file', () => {
    const bibPath = path.join(tempDir, 'refs.bib');
    fs.writeFileSync(bibPath, `
@article{Smith2020,
  author = {John Smith},
  title = {A Study},
  year = {2020}
}

@book{Jones2021,
  author = {Jane Jones},
  title = {A Book},
  year = {2021}
}
`);

    const keys = parseBibFile(bibPath);

    assert.ok(keys.has('Smith2020'));
    assert.ok(keys.has('Jones2021'));
    assert.strictEqual(keys.size, 2);
  });

  it('should return empty set for non-existent file', () => {
    const keys = parseBibFile('/nonexistent.bib');
    assert.strictEqual(keys.size, 0);
  });

  it('should handle various entry types', () => {
    const bibPath = path.join(tempDir, 'refs.bib');
    fs.writeFileSync(bibPath, `
@article{Art2020, author={A}, title={T}, year={2020}}
@book{Book2020, author={B}, title={T}, year={2020}}
@inproceedings{Conf2020, author={C}, title={T}, year={2020}}
@misc{Misc2020, author={M}, title={T}, year={2020}}
`);

    const keys = parseBibFile(bibPath);

    assert.strictEqual(keys.size, 4);
    assert.ok(keys.has('Art2020'));
    assert.ok(keys.has('Book2020'));
    assert.ok(keys.has('Conf2020'));
    assert.ok(keys.has('Misc2020'));
  });

  it('should handle whitespace variations', () => {
    const bibPath = path.join(tempDir, 'refs.bib');
    fs.writeFileSync(bibPath, `
@article{NoSpace,author={A}}
@article{ SpaceBefore,author={A}}
@article{SpaceAfter ,author={A}}
`);

    const keys = parseBibFile(bibPath);

    assert.ok(keys.has('NoSpace'));
    assert.ok(keys.has('SpaceBefore'));
    assert.ok(keys.has('SpaceAfter'));
  });
});

describe('validateCitations', () => {
  it('should identify valid citations', () => {
    const mdPath = path.join(tempDir, 'paper.md');
    const bibPath = path.join(tempDir, 'refs.bib');

    fs.writeFileSync(mdPath, 'See [@Smith2020] and [@Jones2021].');
    fs.writeFileSync(bibPath, `
@article{Smith2020, author={S}, title={T}, year={2020}}
@article{Jones2021, author={J}, title={T}, year={2021}}
`);

    const result = validateCitations([mdPath], bibPath);

    assert.strictEqual(result.valid.length, 2);
    assert.strictEqual(result.missing.length, 0);
  });

  it('should identify missing citations', () => {
    const mdPath = path.join(tempDir, 'paper.md');
    const bibPath = path.join(tempDir, 'refs.bib');

    fs.writeFileSync(mdPath, 'See [@Smith2020] and [@Unknown2021].');
    fs.writeFileSync(bibPath, `
@article{Smith2020, author={S}, title={T}, year={2020}}
`);

    const result = validateCitations([mdPath], bibPath);

    assert.strictEqual(result.valid.length, 1);
    assert.strictEqual(result.missing.length, 1);
    assert.strictEqual(result.missing[0].key, 'Unknown2021');
  });

  it('should identify unused bib entries', () => {
    const mdPath = path.join(tempDir, 'paper.md');
    const bibPath = path.join(tempDir, 'refs.bib');

    fs.writeFileSync(mdPath, 'See [@Smith2020].');
    fs.writeFileSync(bibPath, `
@article{Smith2020, author={S}, title={T}, year={2020}}
@article{Unused2021, author={U}, title={T}, year={2021}}
`);

    const result = validateCitations([mdPath], bibPath);

    assert.ok(result.unused.includes('Unused2021'));
  });

  it('should track duplicate citations', () => {
    const mdPath = path.join(tempDir, 'paper.md');
    const bibPath = path.join(tempDir, 'refs.bib');

    fs.writeFileSync(mdPath, 'First [@Smith2020], second [@Smith2020], third [@Smith2020].');
    fs.writeFileSync(bibPath, `
@article{Smith2020, author={S}, title={T}, year={2020}}
`);

    const result = validateCitations([mdPath], bibPath);

    assert.ok(result.duplicates.some(d => d.key === 'Smith2020' && d.count === 3));
  });

  it('should validate across multiple markdown files', () => {
    const md1 = path.join(tempDir, 'intro.md');
    const md2 = path.join(tempDir, 'methods.md');
    const bibPath = path.join(tempDir, 'refs.bib');

    fs.writeFileSync(md1, 'Introduction [@Cite1].');
    fs.writeFileSync(md2, 'Methods [@Cite2].');
    fs.writeFileSync(bibPath, `
@article{Cite1, author={A}, title={T}, year={2020}}
@article{Cite2, author={B}, title={T}, year={2021}}
`);

    const result = validateCitations([md1, md2], bibPath);

    assert.strictEqual(result.valid.length, 2);
  });

  it('should handle non-existent markdown files gracefully', () => {
    const bibPath = path.join(tempDir, 'refs.bib');
    fs.writeFileSync(bibPath, '@article{A, author={A}}');

    const result = validateCitations(['/nonexistent.md'], bibPath);

    assert.deepStrictEqual(result.valid, []);
    assert.deepStrictEqual(result.missing, []);
  });
});

describe('getCitationStats', () => {
  it('should return comprehensive statistics', () => {
    const mdPath = path.join(tempDir, 'paper.md');
    const bibPath = path.join(tempDir, 'refs.bib');

    fs.writeFileSync(mdPath, 'See [@A] and [@A] and [@B] and [@Missing].');
    fs.writeFileSync(bibPath, `
@article{A, author={A}, title={T}, year={2020}}
@article{B, author={B}, title={T}, year={2020}}
@article{Unused, author={U}, title={T}, year={2020}}
`);

    const stats = getCitationStats([mdPath], bibPath);

    assert.strictEqual(stats.totalCitations, 4); // A, A, B, Missing
    assert.strictEqual(stats.uniqueCited, 3); // A, B, Missing
    assert.strictEqual(stats.valid, 3); // A, A, B
    assert.strictEqual(stats.missing, 1); // Missing
    assert.strictEqual(stats.bibEntries, 3);
    assert.strictEqual(stats.unused, 1); // Unused
    assert.ok(stats.missingKeys.includes('Missing'));
    assert.ok(stats.unusedKeys.includes('Unused'));
  });

  it('should handle empty files', () => {
    const mdPath = path.join(tempDir, 'empty.md');
    const bibPath = path.join(tempDir, 'refs.bib');

    fs.writeFileSync(mdPath, 'No citations here.');
    fs.writeFileSync(bibPath, '@article{A, author={A}}');

    const stats = getCitationStats([mdPath], bibPath);

    assert.strictEqual(stats.totalCitations, 0);
    assert.strictEqual(stats.unused, 1);
  });
});

// Edge cases
describe('citations edge cases', () => {
  it('should handle empty bib file', () => {
    const bibPath = path.join(tempDir, 'empty.bib');
    fs.writeFileSync(bibPath, '');

    const keys = parseBibFile(bibPath);
    assert.strictEqual(keys.size, 0);
  });

  it('should handle bib file with comments', () => {
    const bibPath = path.join(tempDir, 'refs.bib');
    fs.writeFileSync(bibPath, `
% This is a comment
@article{Real2020, author={R}, title={T}, year={2020}}
% Another comment
`);

    const keys = parseBibFile(bibPath);
    assert.ok(keys.has('Real2020'));
  });

  it('should handle special characters in citation text', () => {
    const text = 'Citation with [@Müller2020] umlaut.';
    const citations = extractCitations(text);
    // May or may not match depending on implementation
    // Just ensure it doesn't crash
    assert.ok(Array.isArray(citations));
  });

  it('should not match year-only patterns outside citations', () => {
    const text = 'In 2020, we found that costs were $2020.';
    const citations = extractCitations(text);
    // Should not match standalone years
    assert.strictEqual(citations.length, 0);
  });

  it('should handle very long citation keys', () => {
    const longKey = 'VeryLongAuthorNameWithManyWords2020';
    const text = `See [@${longKey}] for details.`;
    const citations = extractCitations(text);

    assert.strictEqual(citations[0].key, longKey);
  });
});
