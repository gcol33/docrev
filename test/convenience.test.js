/**
 * Tests for convenience commands (Phase 1-3)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
let tempDir;
const revPath = path.resolve(PROJECT_ROOT, 'bin/rev.ts');
const tsxPath = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-conv-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function runRev(args, options = {}) {
  const cwd = options.cwd || tempDir;
  try {
    return execSync(`"${tsxPath}" "${revPath}" ${args}`, {
      cwd,
      encoding: 'utf-8',
      timeout: 30000,
    });
  } catch (err) {
    if (options.expectError) {
      return err.stderr || err.stdout || err.message;
    }
    throw err;
  }
}

describe('rev word-count', () => {
  it('should count words in markdown files', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), 'This is a test document with ten words total here.');
    fs.writeFileSync(path.join(tempDir, 'methods.md'), 'More words in the methods section.');

    const output = runRev('word-count');
    assert.ok(output.includes('intro.md'));
    assert.ok(output.includes('methods.md'));
    assert.ok(output.includes('Total'));
  });

  it('should warn when over limit', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), 'One two three four five.');

    const output = runRev('word-count --limit 3');
    assert.ok(output.includes('Over limit'));
  });

  it('should accept within limit', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), 'One two three four five.');

    const output = runRev('word-count --limit 100');
    assert.ok(output.includes('Within limit'));
  });
});

describe('rev stats', () => {
  it('should show project statistics', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), '# Introduction\n\nThis is the intro. @smith2020');
    fs.writeFileSync(path.join(tempDir, 'methods.md'), '## Methods\n\nSome methods here.');

    const output = runRev('stats');
    assert.ok(output.includes('Sections'));
    assert.ok(output.includes('Words'));
    assert.ok(output.includes('Citations'));
  });
});

describe('rev search', () => {
  it('should find text in markdown files', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), 'climate change is important.');
    fs.writeFileSync(path.join(tempDir, 'methods.md'), 'We study climate patterns.');

    const output = runRev('search climate');
    assert.ok(output.includes('intro.md'));
    assert.ok(output.includes('methods.md'));
  });

  it('should support case-insensitive search', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), 'CLIMATE change is important.');

    const output = runRev('search -i climate');
    assert.ok(output.includes('CLIMATE'));
  });

  it('should report no matches', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), 'Nothing here.');

    const output = runRev('search xyz');
    assert.ok(output.includes('No matches'));
  });
});

describe('rev backup', () => {
  it('should create a backup zip', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), 'Content');
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), 'title: Test');

    const output = runRev('backup');
    assert.ok(output.includes('Backup created'));

    // Check zip was created
    const files = fs.readdirSync(tempDir);
    assert.ok(files.some(f => f.endsWith('.zip')));
  });

  it('should accept custom name', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), 'Content');

    runRev('backup --name my-backup');

    const files = fs.readdirSync(tempDir);
    assert.ok(files.includes('my-backup.zip'));
  });
});

describe('rev export', () => {
  it('should create an export zip', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), 'Content');
    fs.writeFileSync(path.join(tempDir, 'rev.yaml'), 'title: Test Paper');

    const output = runRev('export');
    assert.ok(output.includes('Exported'));

    const files = fs.readdirSync(tempDir);
    assert.ok(files.some(f => f.endsWith('-export.zip')));
  });
});

describe('rev lint', () => {
  it('should report no issues on clean project', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), '# Introduction\n\nSome content here.');

    const output = runRev('lint');
    // May show "No issues" or "0 errors"
    assert.ok(output.includes('No issues') || output.includes('0 error'));
  });

  it('should detect broken cross-references', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), 'See @fig:nonexistent for details.');

    // This may or may not exit with error depending on implementation
    const output = runRev('lint', { expectError: true });
    // Should mention the reference somewhere
    assert.ok(output.includes('fig:nonexistent') || output.includes('Broken') || output.includes('reference'));
  });
});

describe('rev grammar', () => {
  it('should list grammar rules', () => {
    const output = runRev('grammar --rules');
    assert.ok(output.includes('passive-voice'));
    assert.ok(output.includes('weasel-words'));
    assert.ok(output.includes('duplicate-words'));
  });

  it('should check files for issues', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), 'This is very very important really.');

    const output = runRev('grammar');
    // Should find weasel words or duplicate words
    assert.ok(output.includes('very') || output.includes('really') || output.includes('issue'));
  });

  it('should manage custom dictionary', () => {
    // Learn a word
    const learnOutput = runRev('grammar --learn testword123');
    assert.ok(learnOutput.includes('Added'));

    // List dictionary
    const listOutput = runRev('grammar --list');
    assert.ok(listOutput.includes('testword123'));

    // Forget the word
    const forgetOutput = runRev('grammar --forget testword123');
    assert.ok(forgetOutput.includes('Removed'));
  });
});
