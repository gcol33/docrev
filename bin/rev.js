#!/usr/bin/env node

// Wrapper to run the TypeScript entry point via tsx
// This allows `rev` command to work after npm link / npm install

import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tsEntry = join(__dirname, 'rev.ts');

// Run tsx with the TypeScript entry point
const result = spawnSync('npx', ['tsx', tsEntry, ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true
});

process.exit(result.status ?? 0);
