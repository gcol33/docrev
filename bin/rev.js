#!/usr/bin/env node

// Run the compiled TypeScript entry point directly (no tsx needed)

import { pathToFileURL, fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const compiled = join(__dirname, '..', 'dist', 'bin', 'rev.js');

// Windows requires file:// URLs for dynamic ESM imports
await import(pathToFileURL(compiled).href);
