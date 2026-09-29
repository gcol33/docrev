/**
 * `rev build story` / `rev build journey` (gcol33/docrev#12): a sidecar
 * builds to its own docx, never touching the main paper's configured output
 * path.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

import { DEFAULT_CONFIG, buildSidecarDoc } from '../lib/build.js';

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-sidecar-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function hasPandoc() {
  try {
    return spawnSync('pandoc', ['--version'], { encoding: 'utf-8' }).status === 0;
  } catch {
    return false;
  }
}

const JOURNEY_MD = `# Journey: Test Paper

## Introduction

### intro.setup  [S1]
- job: Introduces the problem.
- leaves: Why a certificate is needed.
`;

describe('buildSidecarDoc', { skip: !hasPandoc() }, () => {
  it('builds journey.md to its own docx without touching the paper output', async () => {
    fs.writeFileSync(path.join(tempDir, 'journey.md'), JOURNEY_MD);
    fs.writeFileSync(path.join(tempDir, 'paper.docx'), 'not a real docx, just a sentinel');

    const config = {
      ...DEFAULT_CONFIG,
      title: 'Test Paper',
      outputDir: null,
      output: { docx: 'paper.docx' },
    };

    const result = await buildSidecarDoc(tempDir, config, 'journey', 'docx');

    assert.strictEqual(result.success, true, result.error);
    assert.ok(result.outputPath.endsWith('-journey.docx'));
    assert.ok(fs.existsSync(result.outputPath));

    // The main paper's configured output must be untouched.
    assert.strictEqual(fs.readFileSync(path.join(tempDir, 'paper.docx'), 'utf-8'), 'not a real docx, just a sentinel');
  });

  it('reports a clear error when the sidecar file is missing', async () => {
    const config = { ...DEFAULT_CONFIG, title: 'Test Paper' };
    const result = await buildSidecarDoc(tempDir, config, 'story', 'docx');
    assert.strictEqual(result.success, false);
    assert.match(result.error, /story\.md not found/);
  });
});
