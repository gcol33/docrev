/**
 * Tests for postprocess.js
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { executeScript, runPostprocess } from '../lib/postprocess.js';

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-postprocess-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('executeScript', () => {
  it('should run a Node.js script with environment variables', async () => {
    const scriptPath = path.join(tempDir, 'test.js');
    fs.writeFileSync(scriptPath, 'console.log(process.env.OUTPUT_FILE)');

    const result = await executeScript(scriptPath, { OUTPUT_FILE: '/tmp/test.pdf' });

    assert.ok(result.success);
    assert.ok(result.stdout.includes('/tmp/test.pdf'));
  });

  it('should run a Python script with environment variables', async function () {
    // Skip if Python is not available
    try {
      const { execSync } = await import('child_process');
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      execSync(`${pythonCmd} --version`, { stdio: 'pipe' });
    } catch {
      this.skip();
      return;
    }

    const scriptPath = path.join(tempDir, 'test.py');
    fs.writeFileSync(scriptPath, 'import os; print(os.environ["OUTPUT_FILE"])');

    const result = await executeScript(scriptPath, { OUTPUT_FILE: '/tmp/test.pdf' });

    assert.ok(result.success);
    assert.ok(result.stdout.includes('/tmp/test.pdf'));
  });

  it('should capture exit code on failure', async () => {
    const scriptPath = path.join(tempDir, 'fail.js');
    fs.writeFileSync(scriptPath, 'process.exit(42)');

    const result = await executeScript(scriptPath, {});

    assert.ok(!result.success);
    assert.ok(result.error.includes('42'));
  });

  it('should capture stderr output', async () => {
    const scriptPath = path.join(tempDir, 'stderr.js');
    fs.writeFileSync(scriptPath, 'console.error("error message")');

    const result = await executeScript(scriptPath, {});

    assert.ok(result.success);
    assert.ok(result.stderr.includes('error message'));
  });

  it('should handle script that writes to file', async () => {
    const scriptPath = path.join(tempDir, 'write.js');
    const outputPath = path.join(tempDir, 'output.txt');
    fs.writeFileSync(
      scriptPath,
      `const fs = require('fs'); fs.writeFileSync('${outputPath.replace(/\\/g, '\\\\')}', process.env.OUTPUT_FORMAT);`
    );

    const result = await executeScript(scriptPath, { OUTPUT_FORMAT: 'pdf' });

    assert.ok(result.success);
    assert.ok(fs.existsSync(outputPath));
    assert.strictEqual(fs.readFileSync(outputPath, 'utf-8'), 'pdf');
  });

  it('should run mjs scripts', async () => {
    const scriptPath = path.join(tempDir, 'test.mjs');
    fs.writeFileSync(scriptPath, 'console.log(process.env.TEST_VAR)');

    const result = await executeScript(scriptPath, { TEST_VAR: 'mjs-works' });

    assert.ok(result.success);
    assert.ok(result.stdout.includes('mjs-works'));
  });
});

describe('runPostprocess', () => {
  it('should return success with no postprocess config', async () => {
    const result = await runPostprocess('/tmp/test.pdf', 'pdf', {});

    assert.ok(result.success);
    assert.strictEqual(result.error, undefined);
  });

  it('should return success with empty postprocess config', async () => {
    const result = await runPostprocess('/tmp/test.pdf', 'pdf', {
      postprocess: {},
    });

    assert.ok(result.success);
  });

  it('should run format-specific script', async () => {
    const scriptPath = path.join(tempDir, 'pdf-post.js');
    const markerPath = path.join(tempDir, 'marker.txt');
    fs.writeFileSync(
      scriptPath,
      `const fs = require('fs'); fs.writeFileSync('${markerPath.replace(/\\/g, '\\\\')}', 'ran');`
    );

    const config = {
      postprocess: { pdf: scriptPath },
      _configPath: path.join(tempDir, 'rev.yaml'),
    };

    const result = await runPostprocess(path.join(tempDir, 'out.pdf'), 'pdf', config);

    assert.ok(result.success);
    assert.ok(fs.existsSync(markerPath));
    assert.strictEqual(fs.readFileSync(markerPath, 'utf-8'), 'ran');
  });

  it('should run "all" script for any format', async () => {
    const scriptPath = path.join(tempDir, 'all-post.js');
    const markerPath = path.join(tempDir, 'marker.txt');
    fs.writeFileSync(
      scriptPath,
      `const fs = require('fs'); fs.writeFileSync('${markerPath.replace(/\\/g, '\\\\')}', process.env.OUTPUT_FORMAT);`
    );

    const config = {
      postprocess: { all: scriptPath },
      _configPath: path.join(tempDir, 'rev.yaml'),
    };

    await runPostprocess(path.join(tempDir, 'out.docx'), 'docx', config);

    assert.ok(fs.existsSync(markerPath));
    assert.strictEqual(fs.readFileSync(markerPath, 'utf-8'), 'docx');
  });

  it('should run both format-specific and all scripts', async () => {
    const pdfScript = path.join(tempDir, 'pdf.js');
    const allScript = path.join(tempDir, 'all.js');
    const pdfMarker = path.join(tempDir, 'pdf-marker.txt');
    const allMarker = path.join(tempDir, 'all-marker.txt');

    fs.writeFileSync(
      pdfScript,
      `const fs = require('fs'); fs.writeFileSync('${pdfMarker.replace(/\\/g, '\\\\')}', 'pdf');`
    );
    fs.writeFileSync(
      allScript,
      `const fs = require('fs'); fs.writeFileSync('${allMarker.replace(/\\/g, '\\\\')}', 'all');`
    );

    const config = {
      postprocess: { pdf: pdfScript, all: allScript },
      _configPath: path.join(tempDir, 'rev.yaml'),
    };

    await runPostprocess(path.join(tempDir, 'out.pdf'), 'pdf', config);

    assert.ok(fs.existsSync(pdfMarker));
    assert.ok(fs.existsSync(allMarker));
  });

  it('should report error for missing script', async () => {
    const config = {
      postprocess: { pdf: './nonexistent.js' },
      _configPath: path.join(tempDir, 'rev.yaml'),
    };

    const result = await runPostprocess(path.join(tempDir, 'out.pdf'), 'pdf', config);

    assert.ok(!result.success);
    assert.ok(result.error.includes('not found'));
  });

  it('should report error for failing script', async () => {
    const scriptPath = path.join(tempDir, 'fail.js');
    fs.writeFileSync(scriptPath, 'process.exit(1)');

    const config = {
      postprocess: { pdf: scriptPath },
      _configPath: path.join(tempDir, 'rev.yaml'),
    };

    const result = await runPostprocess(path.join(tempDir, 'out.pdf'), 'pdf', config);

    assert.ok(!result.success);
    assert.ok(result.error.includes('failed') || result.error.includes('Exit code'));
  });

  it('should not run script for different format', async () => {
    const scriptPath = path.join(tempDir, 'docx-only.js');
    const markerPath = path.join(tempDir, 'marker.txt');
    fs.writeFileSync(
      scriptPath,
      `const fs = require('fs'); fs.writeFileSync('${markerPath.replace(/\\/g, '\\\\')}', 'ran');`
    );

    const config = {
      postprocess: { docx: scriptPath },
      _configPath: path.join(tempDir, 'rev.yaml'),
    };

    const result = await runPostprocess(path.join(tempDir, 'out.pdf'), 'pdf', config);

    assert.ok(result.success);
    assert.ok(!fs.existsSync(markerPath));
  });

  it('should pass all environment variables to script', async () => {
    const scriptPath = path.join(tempDir, 'env-check.js');
    const markerPath = path.join(tempDir, 'env.json');
    fs.writeFileSync(
      scriptPath,
      `const fs = require('fs');
       fs.writeFileSync('${markerPath.replace(/\\/g, '\\\\')}', JSON.stringify({
         OUTPUT_FILE: process.env.OUTPUT_FILE,
         OUTPUT_FORMAT: process.env.OUTPUT_FORMAT,
         PROJECT_DIR: process.env.PROJECT_DIR,
         CONFIG_PATH: process.env.CONFIG_PATH,
       }));`
    );

    const outputPath = path.join(tempDir, 'out.pdf');
    const configPath = path.join(tempDir, 'rev.yaml');

    const config = {
      postprocess: { pdf: scriptPath },
      _configPath: configPath,
    };

    await runPostprocess(outputPath, 'pdf', config);

    assert.ok(fs.existsSync(markerPath));
    const envData = JSON.parse(fs.readFileSync(markerPath, 'utf-8'));
    assert.strictEqual(envData.OUTPUT_FILE, outputPath);
    assert.strictEqual(envData.OUTPUT_FORMAT, 'pdf');
    assert.strictEqual(envData.PROJECT_DIR, tempDir);
    assert.strictEqual(envData.CONFIG_PATH, configPath);
  });

  it('should handle relative script paths', async () => {
    const scriptPath = path.join(tempDir, 'relative.js');
    const markerPath = path.join(tempDir, 'marker.txt');
    fs.writeFileSync(
      scriptPath,
      `const fs = require('fs'); fs.writeFileSync('${markerPath.replace(/\\/g, '\\\\')}', 'relative');`
    );

    const config = {
      postprocess: { pdf: './relative.js' },
      _configPath: path.join(tempDir, 'rev.yaml'),
    };

    // Output in tempDir so relative path works
    const result = await runPostprocess(path.join(tempDir, 'out.pdf'), 'pdf', config);

    assert.ok(result.success);
    assert.ok(fs.existsSync(markerPath));
  });
});
