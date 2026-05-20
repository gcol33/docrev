#!/usr/bin/env node

/**
 * Post-build fixups for compiled TypeScript output.
 *
 * tsc compiles bin/rev.ts → dist/bin/rev.js but:
 *   1. Preserves the #!/usr/bin/env tsx shebang (needs to be node)
 *   2. Relative paths like '../package.json' break (bin/ → dist/bin/ adds a level)
 *
 * Also copies non-TS asset files (lua filters) from lib/ to dist/lib/ so the
 * compiled output can locate them via `import.meta.url`. Without this step
 * the lua filters live in lib/ in the published tarball while the runtime
 * looks for them in dist/lib/.
 */

import { readFileSync, writeFileSync, readdirSync, copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const revPath = join(projectRoot, 'dist', 'bin', 'rev.js');

let content = readFileSync(revPath, 'utf-8');

// Fix shebang: tsx → node
content = content.replace('#!/usr/bin/env tsx', '#!/usr/bin/env node');

// Fix package.json path: ../package.json → ../../package.json
// (bin/rev.ts uses ../package.json which is correct from bin/, but from dist/bin/ needs one more level)
content = content.replace("'../package.json'", "'../../package.json'");

writeFileSync(revPath, content, 'utf-8');
console.log('postbuild: fixed dist/bin/rev.js (shebang + paths)');

// Copy lua filter assets so import.meta.url resolves them at runtime.
const libDir = join(projectRoot, 'lib');
const distLibDir = join(projectRoot, 'dist', 'lib');
if (!existsSync(distLibDir)) {
  mkdirSync(distLibDir, { recursive: true });
}
for (const entry of readdirSync(libDir)) {
  if (entry.endsWith('.lua')) {
    copyFileSync(join(libDir, entry), join(distLibDir, entry));
    console.log(`postbuild: copied ${entry} → dist/lib/`);
  }
}
