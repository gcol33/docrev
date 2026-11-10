/**
 * Tests for templates.js
 * Tests project template management
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  TEMPLATES,
  getTemplate,
  listTemplates,
} from '../lib/templates.js';

describe('TEMPLATES', () => {
  it('should have paper template', () => {
    assert.ok(TEMPLATES.paper);
    assert.ok(TEMPLATES.paper.name);
    assert.ok(TEMPLATES.paper.description);
    assert.ok(TEMPLATES.paper.files);
  });

  it('should have minimal template', () => {
    assert.ok(TEMPLATES.minimal);
    assert.ok(TEMPLATES.minimal.files);
  });

  it('should have thesis template', () => {
    assert.ok(TEMPLATES.thesis);
    assert.ok(TEMPLATES.thesis.files);
  });

  it('should have review template', () => {
    assert.ok(TEMPLATES.review);
    assert.ok(TEMPLATES.review.files);
  });

  it('paper template should have required files', () => {
    const paper = TEMPLATES.paper;

    assert.ok(paper.files['rev.yaml']);
    assert.ok(paper.files['introduction.md']);
    assert.ok(paper.files['methods.md']);
    assert.ok(paper.files['results.md']);
    assert.ok(paper.files['discussion.md']);
    assert.ok(paper.files['references.bib']);
    assert.ok(paper.files['.gitignore']);
  });

  it('paper template should have directories', () => {
    assert.ok(Array.isArray(TEMPLATES.paper.directories));
    assert.ok(TEMPLATES.paper.directories.includes('figures'));
  });

  it('thesis template should have more sections', () => {
    const thesis = TEMPLATES.thesis;

    assert.ok(thesis.files['abstract.md']);
    assert.ok(thesis.files['literature.md']);
    assert.ok(thesis.files['conclusion.md']);
    assert.ok(thesis.files['appendix.md']);
  });

  it('minimal template should be simple', () => {
    const minimal = TEMPLATES.minimal;
    const fileCount = Object.keys(minimal.files).length;

    assert.ok(fileCount <= 3);
    assert.ok(minimal.files['content.md']);
    assert.ok(minimal.files['rev.yaml']);
  });

  it('templates should have valid YAML in rev.yaml', () => {
    for (const [name, template] of Object.entries(TEMPLATES)) {
      const revYaml = template.files['rev.yaml'];
      assert.ok(revYaml, `${name} should have rev.yaml`);
      assert.ok(revYaml.includes('title:'), `${name} rev.yaml should have title`);
    }
  });
});

describe('getTemplate', () => {
  it('should return template by name', () => {
    const paper = getTemplate('paper');

    assert.ok(paper);
    assert.strictEqual(paper.name, 'Academic Paper');
  });

  it('should be case-insensitive', () => {
    const upper = getTemplate('PAPER');
    const lower = getTemplate('paper');
    const mixed = getTemplate('Paper');

    assert.deepStrictEqual(upper, lower);
    assert.deepStrictEqual(upper, mixed);
  });

  it('should return null for unknown template', () => {
    const result = getTemplate('nonexistent');

    assert.strictEqual(result, null);
  });

  it('should return all known templates', () => {
    const paper = getTemplate('paper');
    const minimal = getTemplate('minimal');
    const thesis = getTemplate('thesis');
    const review = getTemplate('review');

    assert.ok(paper);
    assert.ok(minimal);
    assert.ok(thesis);
    assert.ok(review);
  });
});

describe('listTemplates', () => {
  it('should return array of template info', () => {
    const templates = listTemplates();

    assert.ok(Array.isArray(templates));
    assert.ok(templates.length >= 4);
  });

  it('should include id, name, and description', () => {
    const templates = listTemplates();

    for (const t of templates) {
      assert.ok(t.id, 'Template should have id');
      assert.ok(t.name, 'Template should have name');
      assert.ok(t.description, 'Template should have description');
    }
  });

  it('should include paper template', () => {
    const templates = listTemplates();

    assert.ok(templates.some(t => t.id === 'paper'));
  });

  it('should include minimal template', () => {
    const templates = listTemplates();

    assert.ok(templates.some(t => t.id === 'minimal'));
  });

  it('should match TEMPLATES keys', () => {
    const templates = listTemplates();
    const templateIds = templates.map(t => t.id);
    const expectedIds = Object.keys(TEMPLATES);

    assert.deepStrictEqual(templateIds.sort(), expectedIds.sort());
  });
});

describe('Template content validation', () => {
  it('paper rev.yaml should have crossref config', () => {
    const yaml = TEMPLATES.paper.files['rev.yaml'];

    assert.ok(yaml.includes('crossref:'));
    assert.ok(yaml.includes('figureTitle:'));
    assert.ok(yaml.includes('tableTitle:'));
  });

  it('paper rev.yaml should have pdf config', () => {
    const yaml = TEMPLATES.paper.files['rev.yaml'];

    assert.ok(yaml.includes('pdf:'));
    assert.ok(yaml.includes('documentclass:'));
    assert.ok(yaml.includes('fontsize:'));
  });

  it('paper rev.yaml should have docx config', () => {
    const yaml = TEMPLATES.paper.files['rev.yaml'];

    assert.ok(yaml.includes('docx:'));
    assert.ok(yaml.includes('reference:'));
  });

  it('section files should start with heading', () => {
    const paper = TEMPLATES.paper;
    const sectionFiles = ['introduction.md', 'methods.md', 'results.md', 'discussion.md'];

    for (const file of sectionFiles) {
      const content = paper.files[file];
      assert.ok(content.startsWith('#'), `${file} should start with heading`);
    }
  });

  it('gitignore should exclude build outputs', () => {
    const gitignore = TEMPLATES.paper.files['.gitignore'];

    assert.ok(gitignore.includes('*.pdf'));
    assert.ok(gitignore.includes('*.docx'));
    assert.ok(gitignore.includes('paper.md'));
  });

  it('references.bib should have example entry', () => {
    const bib = TEMPLATES.paper.files['references.bib'];

    assert.ok(bib.includes('@article'));
    assert.ok(bib.includes('author'));
    assert.ok(bib.includes('title'));
  });
});
