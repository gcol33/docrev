/**
 * Behaviour of the DOI resolver: one content-negotiation path, and an honest
 * distinction between "not found" and "could not reach the registry". Uses a
 * mocked global fetch so no network is touched.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { checkDoi, checkBibDois } from '../lib/doi.js';
import { parseRetryAfter } from '../lib/rate-limiter.js';

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

afterEach(() => {
  mock.restoreAll();
});

describe('parseRetryAfter', () => {
  it('parses a delay in seconds', () => {
    assert.strictEqual(parseRetryAfter('120'), 120000);
  });
  it('parses an HTTP-date', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    const future = 'Thu, 01 Jan 2026 00:00:30 GMT';
    assert.strictEqual(parseRetryAfter(future, now), 30000);
  });
  it('returns null for junk or missing headers', () => {
    assert.strictEqual(parseRetryAfter(null), null);
    assert.strictEqual(parseRetryAfter('not-a-date'), null);
  });
});

describe('checkDoi (content negotiation)', () => {
  it('resolves a registered DOI to CSL-JSON metadata', async () => {
    mock.method(globalThis, 'fetch', async () =>
      jsonResponse(200, {
        title: 'A Great Paper',
        author: [{ given: 'John', family: 'Smith' }, { given: 'Jane', family: 'Doe' }],
        issued: { 'date-parts': [[2020, 5]] },
        'container-title': 'Nature',
        type: 'article-journal',
      }),
    );
    const result = await checkDoi('10.1038/nature12345', { skipCache: true });
    assert.strictEqual(result.valid, true);
    assert.strictEqual(result.source, 'doi.org');
    assert.strictEqual(result.metadata.title, 'A Great Paper');
    assert.deepStrictEqual(result.metadata.authors, ['John Smith', 'Jane Doe']);
    assert.strictEqual(result.metadata.year, 2020);
    assert.strictEqual(result.metadata.journal, 'Nature');
  });

  it('reports a definitive not-found for an unregistered DOI', async () => {
    mock.method(globalThis, 'fetch', async () => jsonResponse(404, {}));
    const result = await checkDoi('10.9999/does-not-exist', { skipCache: true });
    assert.strictEqual(result.valid, false);
    assert.ok(!result.unreachable, 'a 404 is not unreachable');
  });

  it('marks a network failure as unreachable, not invalid', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('getaddrinfo ENOTFOUND doi.org');
    });
    const result = await checkDoi('10.1038/nature12345', { skipCache: true });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.unreachable, true);
  });

  it('marks a 5xx as unreachable, not invalid', async () => {
    mock.method(globalThis, 'fetch', async () => jsonResponse(503, {}));
    const result = await checkDoi('10.1038/nature12345', { skipCache: true });
    assert.strictEqual(result.valid, false);
    assert.strictEqual(result.unreachable, true);
  });
});

describe('checkBibDois counts unreachable separately', () => {
  let tempDir;
  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-doicheck-'));
  });
  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('an offline run reports unreachable, not a wall of invalid', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('network down');
    });
    const bibPath = path.join(tempDir, 'refs.bib');
    // A DOI unique to this test so a cached result from another test cannot
    // mask the offline path (unreachable results are never cached).
    fs.writeFileSync(
      bibPath,
      '@article{Offline2026,\n  title = {X},\n  year = {2026},\n  doi = {10.5555/offline-only-9d3f}\n}\n',
    );
    const result = await checkBibDois(bibPath);
    assert.strictEqual(result.invalid, 0, 'unreachable is not invalid');
    assert.strictEqual(result.unreachable, 1);
  });
});
