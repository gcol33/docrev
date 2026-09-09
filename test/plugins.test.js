/**
 * Tests for plugins.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as yaml from 'yaml';
import { createProfileTemplate } from '../lib/plugins.js';

describe('createProfileTemplate', () => {
  const template = yaml.parse(createProfileTemplate('My Journal'));

  it('writes sections as the list the validator iterates', () => {
    assert.ok(Array.isArray(template.sections));
    assert.ok(template.sections.includes('Abstract'));
  });

  it('writes the keys that say what the word limit covers', () => {
    assert.strictEqual(template.wordLimit.includeAbstract, true);
    assert.strictEqual(template.wordLimit.includeFigureCaptions, true);
    assert.strictEqual(template.wordLimit.includeTableCells, false);
    assert.strictEqual(template.wordLimit.includeReferences, false);
  });

  it('names the id after the journal', () => {
    assert.strictEqual(template.id, 'my-journal');
    assert.strictEqual(template.name, 'My Journal');
  });
});
