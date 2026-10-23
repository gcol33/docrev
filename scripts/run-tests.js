#!/usr/bin/env node

/**
 * Cross-platform test runner.
 *
 * `tsx --test test/*.test.js` depends on who expands the glob: bash does,
 * cmd.exe does not, and Node's own --test glob support only exists on newer
 * Node versions. Quoting the pattern breaks Linux CI (bash passes it through
 * literally and Node 20 cannot expand it); leaving it unquoted breaks Windows
 * runners on old Node. Enumerating the files here removes the shell from the
 * equation entirely.
 *
 * The tests run with HOME and USERPROFILE (the Windows home that os.homedir()
 * reads) set to a fresh temporary directory, so ~/.revrc, the DOI and CSL
 * caches, user profiles and the Claude Code skill folder they write never
 * touch the real ones. Extra arguments (e.g. --watch) go to `tsx --test`.
 */

import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const files = readdirSync(join(root, 'test'))
  .filter((f) => /\.test\.(js|ts)$/.test(f))
  .sort()
  .map((f) => join('test', f));

if (files.length === 0) {
  console.error('No test files found under test/');
  process.exit(1);
}

const home = mkdtempSync(join(tmpdir(), 'docrev-test-home-'));
const tsxCli = require.resolve('tsx/cli');
const result = spawnSync(process.execPath, [tsxCli, '--test', ...process.argv.slice(2), ...files], {
  stdio: 'inherit',
  cwd: root,
  env: { ...process.env, HOME: home, USERPROFILE: home },
});
rmSync(home, { recursive: true, force: true });

process.exit(result.status ?? 1);
