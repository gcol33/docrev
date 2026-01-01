import { describe, it } from 'node:test';
import assert from 'node:assert';
import { validateConfig, revYamlSchema } from '../lib/schema.js';

describe('schema validation', () => {
  describe('validateConfig', () => {
    it('accepts valid minimal config', () => {
      const result = validateConfig({
        title: 'My Paper',
      });
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('accepts valid full config', () => {
      const result = validateConfig({
        title: 'My Paper',
        version: '1.0',
        authors: [
          { name: 'John Doe', affiliation: 'University', email: 'john@example.com' },
          'Jane Smith',
        ],
        sections: ['intro.md', 'methods.md', 'results.md'],
        bibliography: 'refs.bib',
        csl: 'nature.csl',
        crossref: {
          figureTitle: 'Figure',
          figPrefix: ['Fig.', 'Figs.'],
          linkReferences: true,
        },
        pdf: {
          documentclass: 'article',
          fontsize: '12pt',
          linestretch: 1.5,
        },
        docx: {
          keepComments: true,
        },
      });
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('rejects invalid section filenames', () => {
      const result = validateConfig({
        sections: ['intro.txt', 'methods.md'],
      });
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => e.path.includes('sections')));
    });

    it('rejects invalid documentclass', () => {
      const result = validateConfig({
        pdf: { documentclass: 'invalid' },
      });
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => e.path === 'pdf.documentclass'));
    });

    it('rejects invalid fontsize format', () => {
      const result = validateConfig({
        pdf: { fontsize: '12' }, // missing 'pt'
      });
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => e.path === 'pdf.fontsize'));
    });

    it('rejects out-of-range linestretch', () => {
      const result = validateConfig({
        pdf: { linestretch: 5 },
      });
      assert.strictEqual(result.valid, false);
      assert(result.errors.some(e => e.path === 'pdf.linestretch'));
    });

    it('accepts string author', () => {
      const result = validateConfig({
        authors: ['John Doe'],
      });
      assert.strictEqual(result.valid, true);
    });

    it('accepts object author with required name', () => {
      const result = validateConfig({
        authors: [{ name: 'John Doe' }],
      });
      assert.strictEqual(result.valid, true);
    });

    it('warns on empty sections', () => {
      const result = validateConfig({
        sections: [],
      });
      assert(result.warnings.some(w => w.path === 'sections'));
    });

    it('warns on possible typos in config keys', () => {
      const result = validateConfig({
        tittle: 'My Paper', // typo
      });
      assert(result.warnings.some(w => w.message.includes('did you mean')));
    });

    it('accepts crossref prefix as string', () => {
      const result = validateConfig({
        crossref: {
          figPrefix: 'Fig.',
        },
      });
      assert.strictEqual(result.valid, true);
    });

    it('accepts crossref prefix as array', () => {
      const result = validateConfig({
        crossref: {
          figPrefix: ['Fig.', 'Figs.'],
        },
      });
      assert.strictEqual(result.valid, true);
    });

    it('validates orcid format', () => {
      const validResult = validateConfig({
        authors: [{ name: 'John', orcid: '0000-0002-1234-5678' }],
      });
      assert.strictEqual(validResult.valid, true);

      const invalidResult = validateConfig({
        authors: [{ name: 'John', orcid: '1234-5678' }],
      });
      assert.strictEqual(invalidResult.valid, false);
    });
  });

  describe('revYamlSchema', () => {
    it('has required properties defined', () => {
      assert(revYamlSchema.properties.title);
      assert(revYamlSchema.properties.authors);
      assert(revYamlSchema.properties.sections);
      assert(revYamlSchema.properties.bibliography);
      assert(revYamlSchema.properties.pdf);
      assert(revYamlSchema.properties.docx);
      assert(revYamlSchema.properties.crossref);
    });
  });
});
