/**
 * Tests for git.js
 * Note: Some tests require a git repo context
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
import {
  isGitRepo,
  getCurrentBranch,
  getDefaultBranch,
  getFileAtRef,
  getChangedFiles,
  getFileHistory,
  compareFileVersions,
  getRecentCommits,
  hasUncommittedChanges,
  getTags,
} from '../lib/git.js';

let tempDir;
let originalCwd;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-git-'));
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Initialize a git repo in the temp directory
 */
function initGitRepo() {
  process.chdir(tempDir);
  execSync('git init', { stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { stdio: 'pipe' });
  execSync('git config user.name "Test User"', { stdio: 'pipe' });
}

/**
 * Create a file and commit it
 */
function createAndCommit(filename, content, message) {
  fs.writeFileSync(path.join(tempDir, filename), content);
  execSync(`git add "${filename}"`, { stdio: 'pipe' });
  execSync(`git commit -m "${message}"`, { stdio: 'pipe' });
}

describe('isGitRepo', () => {
  it('should return true for git repo', () => {
    initGitRepo();
    assert.strictEqual(isGitRepo(), true);
  });

  it('should return false for non-git directory', () => {
    process.chdir(tempDir);
    // Set GIT_CEILING_DIRECTORIES to the parent of tempDir to prevent git from finding parent repos
    const originalCeiling = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = path.dirname(tempDir);
    try {
      assert.strictEqual(isGitRepo(), false);
    } finally {
      if (originalCeiling === undefined) {
        delete process.env.GIT_CEILING_DIRECTORIES;
      } else {
        process.env.GIT_CEILING_DIRECTORIES = originalCeiling;
      }
    }
  });
});

describe('getCurrentBranch', () => {
  it('should return current branch name', () => {
    initGitRepo();
    createAndCommit('test.txt', 'content', 'Initial commit');

    const branch = getCurrentBranch();
    assert.ok(branch === 'main' || branch === 'master');
  });

  it('should return null for non-git directory', () => {
    process.chdir(tempDir);
    assert.strictEqual(getCurrentBranch(), null);
  });
});

describe('getDefaultBranch', () => {
  it('should return main or master', () => {
    initGitRepo();
    createAndCommit('test.txt', 'content', 'Initial commit');

    const branch = getDefaultBranch();
    assert.ok(branch === 'main' || branch === 'master');
  });
});

describe('getFileAtRef', () => {
  it('should return file content at specific commit', () => {
    initGitRepo();
    createAndCommit('file.txt', 'version 1', 'First version');
    const hash1 = execSync('git rev-parse HEAD', { stdio: 'pipe' }).toString().trim();

    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'version 2');
    execSync('git add file.txt', { stdio: 'pipe' });
    execSync('git commit -m "Second version"', { stdio: 'pipe' });

    // Current version should be version 2
    const current = getFileAtRef('file.txt', 'HEAD');
    assert.strictEqual(current.trim(), 'version 2');

    // Old version should be version 1
    const old = getFileAtRef('file.txt', hash1);
    assert.strictEqual(old.trim(), 'version 1');
  });

  it('should return null for non-existent file', () => {
    initGitRepo();
    createAndCommit('test.txt', 'content', 'Initial');

    assert.strictEqual(getFileAtRef('nonexistent.txt', 'HEAD'), null);
  });
});

describe('getChangedFiles', () => {
  it('should return list of changed files', () => {
    initGitRepo();
    createAndCommit('file1.txt', 'content', 'Initial');
    const hash1 = execSync('git rev-parse HEAD', { stdio: 'pipe' }).toString().trim();

    createAndCommit('file2.txt', 'new file', 'Add file2');

    const changes = getChangedFiles(hash1, 'HEAD');
    assert.ok(changes.some(c => c.file === 'file2.txt' && c.status === 'added'));
  });

  it('should detect modified files', () => {
    initGitRepo();
    createAndCommit('file.txt', 'original', 'Initial');
    const hash1 = execSync('git rev-parse HEAD', { stdio: 'pipe' }).toString().trim();

    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'modified');
    execSync('git add file.txt', { stdio: 'pipe' });
    execSync('git commit -m "Modify"', { stdio: 'pipe' });

    const changes = getChangedFiles(hash1, 'HEAD');
    assert.ok(changes.some(c => c.file === 'file.txt' && c.status === 'modified'));
  });

  it('should return empty array for no changes', () => {
    initGitRepo();
    createAndCommit('file.txt', 'content', 'Initial');

    const changes = getChangedFiles('HEAD', 'HEAD');
    assert.deepStrictEqual(changes, []);
  });
});

describe('getFileHistory', () => {
  it('should return commit history for file', () => {
    initGitRepo();
    createAndCommit('file.txt', 'v1', 'First');

    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'v2');
    execSync('git add file.txt', { stdio: 'pipe' });
    execSync('git commit -m "Second"', { stdio: 'pipe' });

    const history = getFileHistory('file.txt');
    assert.strictEqual(history.length, 2);
    assert.ok(history[0].message.includes('Second'));
    assert.ok(history[1].message.includes('First'));
  });

  it('should respect limit parameter', () => {
    initGitRepo();
    createAndCommit('file.txt', 'v1', 'First');
    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'v2');
    execSync('git add file.txt && git commit -m "Second"', { stdio: 'pipe' });
    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'v3');
    execSync('git add file.txt && git commit -m "Third"', { stdio: 'pipe' });

    const history = getFileHistory('file.txt', 2);
    assert.strictEqual(history.length, 2);
  });

  it('should return empty array for non-existent file', () => {
    initGitRepo();
    createAndCommit('other.txt', 'content', 'Initial');

    const history = getFileHistory('nonexistent.txt');
    assert.deepStrictEqual(history, []);
  });
});

describe('compareFileVersions', () => {
  it('should return word diff between versions', () => {
    initGitRepo();
    createAndCommit('file.txt', 'The quick brown fox', 'Initial');
    const hash1 = execSync('git rev-parse HEAD', { stdio: 'pipe' }).toString().trim();

    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'The slow brown dog');
    execSync('git add file.txt && git commit -m "Update"', { stdio: 'pipe' });

    const diff = compareFileVersions('file.txt', hash1, 'HEAD');

    // Should have both added and removed words
    assert.ok(diff.added > 0);
    assert.ok(diff.removed > 0);
    assert.ok(Array.isArray(diff.changes));
  });

  it('should handle file not existing at ref', () => {
    initGitRepo();
    createAndCommit('other.txt', 'content', 'Initial');
    const hash1 = execSync('git rev-parse HEAD', { stdio: 'pipe' }).toString().trim();

    createAndCommit('new.txt', 'new content', 'Add new file');

    const diff = compareFileVersions('new.txt', hash1, 'HEAD');
    assert.ok(diff.added > 0);
    assert.strictEqual(diff.removed, 0);
  });
});

describe('getRecentCommits', () => {
  it('should return recent commits', () => {
    initGitRepo();
    createAndCommit('file.txt', 'v1', 'First commit');
    createAndCommit('file2.txt', 'v2', 'Second commit');

    const commits = getRecentCommits(10);
    assert.ok(commits.length >= 2);
    assert.ok(commits[0].hash);
    assert.ok(commits[0].date);
    assert.ok(commits[0].author);
    assert.ok(commits[0].message);
  });

  it('should respect limit', () => {
    initGitRepo();
    createAndCommit('f1.txt', 'a', 'Commit 1');
    createAndCommit('f2.txt', 'b', 'Commit 2');
    createAndCommit('f3.txt', 'c', 'Commit 3');

    const commits = getRecentCommits(2);
    assert.strictEqual(commits.length, 2);
  });
});

describe('hasUncommittedChanges', () => {
  it('should return false for clean repo', () => {
    initGitRepo();
    createAndCommit('file.txt', 'content', 'Initial');

    assert.strictEqual(hasUncommittedChanges(), false);
  });

  it('should return true for modified files', () => {
    initGitRepo();
    createAndCommit('file.txt', 'content', 'Initial');
    fs.writeFileSync(path.join(tempDir, 'file.txt'), 'modified');

    assert.strictEqual(hasUncommittedChanges(), true);
  });

  it('should return true for untracked files', () => {
    initGitRepo();
    createAndCommit('file.txt', 'content', 'Initial');
    fs.writeFileSync(path.join(tempDir, 'untracked.txt'), 'new');

    assert.strictEqual(hasUncommittedChanges(), true);
  });
});

describe('getTags', () => {
  it('should return list of tags', () => {
    initGitRepo();
    createAndCommit('file.txt', 'content', 'Initial');
    execSync('git tag v1.0.0', { stdio: 'pipe' });
    execSync('git tag v1.1.0', { stdio: 'pipe' });

    const tags = getTags();
    assert.ok(tags.includes('v1.0.0'));
    assert.ok(tags.includes('v1.1.0'));
  });

  it('should return empty array for repo with no tags', () => {
    initGitRepo();
    createAndCommit('file.txt', 'content', 'Initial');

    const tags = getTags();
    assert.deepStrictEqual(tags, []);
  });
});
