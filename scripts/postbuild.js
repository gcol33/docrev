#!/usr/bin/env node

/**
 * Post-build fixups for compiled TypeScript output.
 *
 * tsc compiles bin/rev.ts → dist/bin/rev.js but:
 *   1. Preserves the #!/usr/bin/env tsx shebang (needs to be node)
 *   2. Relative paths like '../package.json' break (bin/ → dist/bin/ adds a level)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const revPath = join(__dirname, '..', 'dist', 'bin', 'rev.js');

let content = readFileSync(revPath, 'utf-8');

// Fix shebang: tsx → node
content = content.replace('#!/usr/bin/env tsx', '#!/usr/bin/env node');

// Fix package.json path: ../package.json → ../../package.json
// (bin/rev.ts uses ../package.json which is correct from bin/, but from dist/bin/ needs one more level)
content = content.replace("'../package.json'", "'../../package.json'");

writeFileSync(revPath, content, 'utf-8');
console.log('postbuild: fixed dist/bin/rev.js (shebang + paths)');
