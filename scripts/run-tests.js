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
 */

import { readdirSync } from 'fs';
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

const tsxCli = require.resolve('tsx/cli');
const result = spawnSync(process.execPath, [tsxCli, '--test', ...files], {
  stdio: 'inherit',
  cwd: root,
});

process.exit(result.status ?? 1);
