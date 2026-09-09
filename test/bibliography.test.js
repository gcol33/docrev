/**
 * Tests for bibliography.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renderBibliography } from '../lib/bibliography.js';
import { hasPandoc } from '../lib/dependencies.js';

const BIB = `@article{smith2020,
  title = {A title of five words},
  author = {Smith, Jane and Doe, John},
  journal = {Journal of Testing},
  year = {2020},
  volume = {1},
  pages = {1--10}
}
`;

function withProject(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-bib-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'refs.bib'), BIB, 'utf-8');
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('renderBibliography', () => {
  it('reports no keys rather than rendering an empty list', () => {
    withProject(dir => {
      const result = renderBibliography({ directory: dir, bibliography: 'refs.bib', keys: [] });
      assert.strictEqual(result.reason, 'no-keys');
      assert.strictEqual(result.text, null);
      assert.strictEqual(result.words, 0);
    });
  });

  it('reports a missing bibliography rather than throwing', () => {
    withProject(dir => {
      const result = renderBibliography({ directory: dir, bibliography: 'absent.bib', keys: ['smith2020'] });
      assert.strictEqual(result.reason, 'no-bibliography');
      assert.strictEqual(result.words, 0);
    });
  });

  it('renders the cited entry and counts it', { skip: !hasPandoc() }, () => {
    withProject(dir => {
      const result = renderBibliography({ directory: dir, bibliography: 'refs.bib', keys: ['smith2020'] });
      assert.strictEqual(result.reason, undefined);
      assert.ok(result.text.includes('Smith'));
      assert.ok(result.words > 5);
    });
  });

  it('renders an uncited entry no more than once', { skip: !hasPandoc() }, () => {
    withProject(dir => {
      const once = renderBibliography({ directory: dir, bibliography: 'refs.bib', keys: ['smith2020'] });
      const twice = renderBibliography({
        directory: dir,
        bibliography: 'refs.bib',
        keys: ['smith2020', 'smith2020'],
      });
      assert.strictEqual(twice.words, once.words);
    });
  });
});
