# Implementation Plan: Table Formatting & Postprocess Scripting

## Overview

Two features to implement:
1. **Table formatting config** - Make `tables:` config in rev.yaml actually work
2. **Postprocess scripting** - Allow users to run custom transformations on output

---

## Part 1: Table Formatting

### Problem Statement

Pandoc's longtable with proportional `p{}` column widths forces text wrapping. Users need:
- Columns that don't wrap (e.g., `N(0, 0.5)` should stay on one line)
- Custom alignment per column
- Math notation conversion (Normal → 𝒩)

### Why Previous Attempt Failed

The Lua filter approach failed because:
1. Pandoc calculates column widths from markdown before the filter runs
2. Setting `ColWidthDefault` in Lua results in `0.0000` width, not auto-width
3. `\mbox{}` in a `p{}` column overflows instead of expanding

### Solution: LaTeX Header Injection

Instead of a Lua filter, inject LaTeX packages/commands via `header-includes`.

#### Implementation Steps

**Step 1: Add `pdf.header-includes` config option**

File: `lib/build.js`

```javascript
// In DEFAULT_CONFIG.pdf:
pdf: {
  template: null,
  documentclass: 'article',
  fontsize: '12pt',
  geometry: 'margin=1in',
  linestretch: 1.5,
  numbersections: false,
  toc: false,
  headerIncludes: null,  // NEW: string or array of LaTeX code
},
```

**Step 2: Pass header-includes to pandoc**

File: `lib/build.js`, in `buildPandocArgs()`:

```javascript
if (format === 'pdf') {
  // ... existing code ...

  // Header includes (LaTeX preamble additions)
  if (config.pdf.headerIncludes) {
    const includes = Array.isArray(config.pdf.headerIncludes)
      ? config.pdf.headerIncludes
      : [config.pdf.headerIncludes];
    for (const inc of includes) {
      args.push('-V', `header-includes=${inc}`);
    }
  }
}
```

**Step 3: Create table-focused presets**

File: `lib/build.js`, new function:

```javascript
/**
 * Generate LaTeX header-includes for table configuration
 * @param {object} tablesConfig
 * @returns {string[]} LaTeX code lines
 */
function generateTableLatex(tablesConfig) {
  const lines = [];

  if (!tablesConfig) return lines;

  // Always include array package for column type customization
  lines.push('\\usepackage{array}');

  // Add nowrap column type: use with N{width} in manual tables
  // This creates a column that doesn't wrap but respects minipage
  if (tablesConfig.nowrap) {
    lines.push('% Nowrap column type for tables');
    lines.push('\\newcolumntype{N}[1]{>{\\raggedright\\arraybackslash}p{#1}}');
  }

  // Small tables
  if (tablesConfig.small) {
    lines.push('% Apply small font to longtable environment');
    lines.push('\\AtBeginEnvironment{longtable}{\\small}');
    lines.push('\\usepackage{etoolbox}');  // for AtBeginEnvironment
  }

  return lines;
}
```

**Step 4: Integrate into build pipeline**

File: `lib/build.js`, in `buildPandocArgs()`:

```javascript
if (format === 'pdf' || format === 'tex') {
  // Generate table-specific LaTeX if tables config exists
  const tableLatex = generateTableLatex(config.tables);
  if (tableLatex.length > 0) {
    for (const line of tableLatex) {
      args.push('-V', `header-includes=${line}`);
    }
  }
}
```

**Step 5: Add markdown preprocessing for nowrap columns**

Since we can't change pandoc's column width calculation, we preprocess the markdown to wrap nowrap column content in `\mbox{}` directly.

File: `lib/build.js`, new function:

```javascript
/**
 * Process markdown tables to apply nowrap to specified columns
 * Wraps cell content in \mbox{} for LaTeX output
 * @param {string} content - Markdown content
 * @param {object} tablesConfig - tables config from rev.yaml
 * @param {string} format - output format
 * @returns {string} processed content
 */
function processTablesForFormat(content, tablesConfig, format) {
  if (!tablesConfig?.nowrap?.length || format !== 'pdf') {
    return content;
  }

  const nowrapPatterns = tablesConfig.nowrap.map(p => p.toLowerCase());

  // Match pipe tables
  const tableRegex = /(\|[^\n]+\|\n\|[-:| ]+\|\n)((?:\|[^\n]+\|\n)+)/g;

  return content.replace(tableRegex, (match, header, body) => {
    // Parse header to find nowrap column indices
    const headerCells = header.split('|').slice(1, -1).map(c => c.trim().toLowerCase());
    const nowrapCols = headerCells.map((cell, i) =>
      nowrapPatterns.some(p => cell.includes(p)) ? i : -1
    ).filter(i => i >= 0);

    if (nowrapCols.length === 0) return match;

    // Process body rows
    const processedBody = body.split('\n').filter(l => l.trim()).map(row => {
      const cells = row.split('|').slice(1, -1);
      nowrapCols.forEach(colIdx => {
        if (cells[colIdx]) {
          const content = cells[colIdx].trim();
          // Skip if already has LaTeX or is empty
          if (content && !content.startsWith('\\') && !content.startsWith('$')) {
            // Convert distribution notation to math
            let processed = content
              .replace(/Normal\(([^)]+)\)/g, '$\\mathcal{N}($1)$')
              .replace(/Student-t\((\d+),\s*([^)]+)\)/g, '$t_{$1}($2)$')
              .replace(/Gamma\(([^)]+)\)/g, '$\\text{Gamma}($1)$');
            cells[colIdx] = ` ${processed} `;
          }
        }
      });
      return '|' + cells.join('|') + '|';
    }).join('\n');

    return header + processedBody + '\n';
  });
}
```

**Step 6: Call from prepareForFormat**

```javascript
export function prepareForFormat(paperPath, format, config, options = {}) {
  // ... existing code ...

  if (format === 'pdf' || format === 'tex') {
    content = stripAnnotations(content);
    // NEW: Process tables for nowrap columns
    content = processTablesForFormat(content, config.tables, format);
  }

  // ... rest of function ...
}
```

#### Test Plan for Tables

File: `test/tables.test.js`

```javascript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { processTablesForFormat, generateTableLatex } from '../lib/build.js';

describe('Table Processing', () => {
  describe('generateTableLatex', () => {
    it('returns empty array with no config', () => {
      assert.deepStrictEqual(generateTableLatex(null), []);
      assert.deepStrictEqual(generateTableLatex({}), []);
    });

    it('adds array package when nowrap specified', () => {
      const result = generateTableLatex({ nowrap: ['Prior'] });
      assert.ok(result.includes('\\usepackage{array}'));
    });

    it('adds small table styling when small=true', () => {
      const result = generateTableLatex({ small: true });
      assert.ok(result.some(l => l.includes('\\small')));
      assert.ok(result.some(l => l.includes('etoolbox')));
    });
  });

  describe('processTablesForFormat', () => {
    const sampleTable = `| Component | Prior | Justification |
|:----------|:------|:--------------|
| Intercept | Normal(1.5, 0.5) | Weak prior |
| Slope | Normal(0, 0.3) | Centered |`;

    it('returns unchanged for non-pdf format', () => {
      const config = { nowrap: ['Prior'] };
      const result = processTablesForFormat(sampleTable, config, 'docx');
      assert.strictEqual(result, sampleTable);
    });

    it('returns unchanged with no nowrap config', () => {
      const result = processTablesForFormat(sampleTable, {}, 'pdf');
      assert.strictEqual(result, sampleTable);
    });

    it('converts Normal() to mathcal N in nowrap columns', () => {
      const config = { nowrap: ['Prior'] };
      const result = processTablesForFormat(sampleTable, config, 'pdf');
      assert.ok(result.includes('$\\mathcal{N}(1.5, 0.5)$'));
      assert.ok(result.includes('$\\mathcal{N}(0, 0.3)$'));
    });

    it('converts Student-t() to subscript notation', () => {
      const table = `| Param | Prior |
|-------|-------|
| SD | Student-t(3, 0, 2.5) |`;
      const config = { nowrap: ['Prior'] };
      const result = processTablesForFormat(table, config, 'pdf');
      assert.ok(result.includes('$t_{3}(0, 2.5)$'));
    });

    it('does not modify columns not in nowrap list', () => {
      const config = { nowrap: ['Prior'] };
      const result = processTablesForFormat(sampleTable, config, 'pdf');
      assert.ok(result.includes('Weak prior'));  // unchanged
      assert.ok(!result.includes('$Weak prior$'));
    });

    it('handles case-insensitive column matching', () => {
      const config = { nowrap: ['PRIOR'] };
      const result = processTablesForFormat(sampleTable, config, 'pdf');
      assert.ok(result.includes('$\\mathcal{N}'));
    });

    it('skips cells that already have math', () => {
      const table = `| Param | Prior |
|-------|-------|
| X | $\\mathcal{N}(0, 1)$ |`;
      const config = { nowrap: ['Prior'] };
      const result = processTablesForFormat(table, config, 'pdf');
      // Should not double-wrap
      assert.ok(!result.includes('$$'));
    });
  });
});
```

#### Usage Example

```yaml
# rev.yaml
tables:
  nowrap:
    - Prior
    - "$\\widehat{R}$"
  small: false
```

```markdown
| Parameter | Prior | Justification |
|:----------|:------|:--------------|
| Intercept | Normal(1.5, 0.5) | Prior P ~82% |
| Slope | Normal(0, 0.5) | Moderate |
```

Output: Prior column cells become `$\mathcal{N}(1.5, 0.5)$` in PDF.

---

## Part 2: Postprocess Scripting

### Problem Statement

Users need fine-grained control over output that pandoc/docrev can't provide:
- Custom LaTeX tweaks after generation
- Search/replace in generated files
- Format-specific post-processing (e.g., inject custom XML into DOCX)

### Design Principles

1. **Start simple** - Shell scripts first, DSL later if needed
2. **Per-format** - Different postprocess for PDF vs DOCX
3. **Safe defaults** - Scripts must be explicitly enabled
4. **Debugging** - Clear error messages, optional verbose mode

### Implementation Approach

#### Phase 1: Shell Script Postprocessing (MVP)

**Config Schema:**

```yaml
# rev.yaml
postprocess:
  pdf: ./scripts/fix-tables.sh      # Run after PDF generated
  docx: ./scripts/add-headers.ps1   # Run after DOCX generated
  all: ./scripts/common.sh          # Run after any format
```

**Implementation Steps:**

**Step 1: Add postprocess to DEFAULT_CONFIG**

File: `lib/build.js`

```javascript
export const DEFAULT_CONFIG = {
  // ... existing ...
  postprocess: {
    pdf: null,
    docx: null,
    tex: null,
    pptx: null,
    beamer: null,
    all: null,
  },
};
```

**Step 2: Add postprocess runner**

File: `lib/postprocess.js` (new file)

```javascript
import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';

/**
 * Run postprocess script for a given format
 * @param {string} outputPath - Path to generated file
 * @param {string} format - Output format (pdf, docx, etc.)
 * @param {object} config - Full config object
 * @param {object} options - { verbose: boolean }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function runPostprocess(outputPath, format, config, options = {}) {
  const postprocessConfig = config.postprocess || {};

  // Collect scripts to run (format-specific + all)
  const scripts = [];
  if (postprocessConfig[format]) {
    scripts.push(postprocessConfig[format]);
  }
  if (postprocessConfig.all) {
    scripts.push(postprocessConfig.all);
  }

  if (scripts.length === 0) {
    return { success: true };
  }

  const directory = path.dirname(outputPath);
  const errors = [];

  for (const scriptPath of scripts) {
    const absoluteScript = path.isAbsolute(scriptPath)
      ? scriptPath
      : path.join(directory, scriptPath);

    if (!fs.existsSync(absoluteScript)) {
      errors.push(`Postprocess script not found: ${scriptPath}`);
      continue;
    }

    try {
      const result = await executeScript(absoluteScript, {
        OUTPUT_FILE: outputPath,
        OUTPUT_FORMAT: format,
        PROJECT_DIR: directory,
        CONFIG_PATH: config._configPath || '',
      }, options);

      if (!result.success) {
        errors.push(`Script ${scriptPath} failed: ${result.error}`);
      }
    } catch (err) {
      errors.push(`Script ${scriptPath} error: ${err.message}`);
    }
  }

  return {
    success: errors.length === 0,
    error: errors.join('\n'),
  };
}

/**
 * Execute a script with environment variables
 * @param {string} scriptPath
 * @param {object} env - Environment variables to set
 * @param {object} options
 * @returns {Promise<{success: boolean, stdout: string, stderr: string, error?: string}>}
 */
async function executeScript(scriptPath, env, options = {}) {
  return new Promise((resolve) => {
    const ext = path.extname(scriptPath).toLowerCase();
    let command, args;

    // Determine how to run based on extension
    if (ext === '.ps1') {
      command = 'powershell';
      args = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    } else if (ext === '.py') {
      command = 'python';
      args = [scriptPath];
    } else if (ext === '.js') {
      command = 'node';
      args = [scriptPath];
    } else {
      // Assume shell script
      command = process.platform === 'win32' ? 'bash' : '/bin/bash';
      args = [scriptPath];
    }

    const proc = spawn(command, args, {
      env: { ...process.env, ...env },
      cwd: path.dirname(scriptPath),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      if (options.verbose) {
        process.stdout.write(data);
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (options.verbose) {
        process.stderr.write(data);
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, stdout, stderr, error: err.message });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, stdout, stderr });
      } else {
        resolve({
          success: false,
          stdout,
          stderr,
          error: `Exit code ${code}: ${stderr.trim() || 'Unknown error'}`
        });
      }
    });
  });
}

export { executeScript };
```

**Step 3: Integrate into runPandoc**

File: `lib/build.js`

```javascript
import { runPostprocess } from './postprocess.js';

// In runPandoc(), after pandoc completes successfully:

pandoc.on('close', async (code) => {
  if (code === 0) {
    // Existing PPTX post-processing...
    if (format === 'pptx') {
      // ...
    }

    // NEW: Run user postprocess scripts
    const postResult = await runPostprocess(outputPath, format, config, options);
    if (!postResult.success) {
      console.error(`Postprocess warning: ${postResult.error}`);
    }

    resolve({ outputPath, success: true });
  } else {
    resolve({ outputPath: null, success: false, error: stderr });
  }
});
```

**Step 4: Add CLI verbose flag**

File: `lib/commands/build.js`

```javascript
.option('--verbose', 'Show detailed output including postprocess scripts')

// Pass to build():
await build(targetDir, formats, { verbose: options.verbose });
```

#### Phase 2: DSL for Common Operations (Future)

If shell scripts prove insufficient, add a simple declarative DSL:

```yaml
# rev.yaml
postprocess:
  pdf:
    - type: replace
      pattern: "\\\\begin{longtable}"
      replacement: "\\\\begin{longtable}[l]"
    - type: inject
      after: "\\\\begin{document}"
      content: "\\\\newcommand{\\\\N}{\\\\mathcal{N}}"
    - type: script
      path: ./scripts/final-fixes.sh
```

This would require:
- New file: `lib/postprocess-dsl.js`
- Operation handlers for each type
- Validation of DSL syntax
- Clear error messages for invalid operations

#### Test Plan for Postprocessing

File: `test/postprocess.test.js`

```javascript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runPostprocess, executeScript } from '../lib/postprocess.js';

describe('Postprocessing', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('executeScript', () => {
    it('runs shell script with environment variables', async () => {
      const scriptPath = path.join(tempDir, 'test.sh');
      fs.writeFileSync(scriptPath, '#!/bin/bash\necho "$OUTPUT_FILE"', { mode: 0o755 });

      const result = await executeScript(scriptPath, { OUTPUT_FILE: '/tmp/test.pdf' });
      assert.ok(result.success);
      assert.ok(result.stdout.includes('/tmp/test.pdf'));
    });

    it('returns error for non-existent script', async () => {
      const result = await executeScript('/nonexistent/script.sh', {});
      assert.ok(!result.success);
    });

    it('captures exit code on failure', async () => {
      const scriptPath = path.join(tempDir, 'fail.sh');
      fs.writeFileSync(scriptPath, '#!/bin/bash\nexit 1', { mode: 0o755 });

      const result = await executeScript(scriptPath, {});
      assert.ok(!result.success);
      assert.ok(result.error.includes('Exit code 1'));
    });

    it('runs PowerShell scripts on Windows', async function() {
      if (process.platform !== 'win32') {
        this.skip();
        return;
      }

      const scriptPath = path.join(tempDir, 'test.ps1');
      fs.writeFileSync(scriptPath, 'Write-Host $env:OUTPUT_FILE');

      const result = await executeScript(scriptPath, { OUTPUT_FILE: 'C:\\test.pdf' });
      assert.ok(result.success);
      assert.ok(result.stdout.includes('C:\\test.pdf'));
    });

    it('runs Python scripts', async () => {
      const scriptPath = path.join(tempDir, 'test.py');
      fs.writeFileSync(scriptPath, 'import os; print(os.environ["OUTPUT_FILE"])');

      const result = await executeScript(scriptPath, { OUTPUT_FILE: '/tmp/test.pdf' });
      assert.ok(result.success);
      assert.ok(result.stdout.includes('/tmp/test.pdf'));
    });

    it('runs Node.js scripts', async () => {
      const scriptPath = path.join(tempDir, 'test.js');
      fs.writeFileSync(scriptPath, 'console.log(process.env.OUTPUT_FILE)');

      const result = await executeScript(scriptPath, { OUTPUT_FILE: '/tmp/test.pdf' });
      assert.ok(result.success);
      assert.ok(result.stdout.includes('/tmp/test.pdf'));
    });
  });

  describe('runPostprocess', () => {
    it('returns success with no postprocess config', async () => {
      const result = await runPostprocess('/tmp/test.pdf', 'pdf', {});
      assert.ok(result.success);
    });

    it('runs format-specific script', async () => {
      const scriptPath = path.join(tempDir, 'pdf-post.sh');
      const markerPath = path.join(tempDir, 'marker.txt');
      fs.writeFileSync(scriptPath, `#!/bin/bash\necho "ran" > "${markerPath}"`, { mode: 0o755 });

      const config = {
        postprocess: { pdf: scriptPath },
        _configPath: path.join(tempDir, 'rev.yaml'),
      };

      const result = await runPostprocess(path.join(tempDir, 'out.pdf'), 'pdf', config);
      assert.ok(result.success);
      assert.ok(fs.existsSync(markerPath));
    });

    it('runs "all" script for any format', async () => {
      const scriptPath = path.join(tempDir, 'all-post.sh');
      const markerPath = path.join(tempDir, 'marker.txt');
      fs.writeFileSync(scriptPath, `#!/bin/bash\necho "$OUTPUT_FORMAT" > "${markerPath}"`, { mode: 0o755 });

      const config = {
        postprocess: { all: scriptPath },
        _configPath: path.join(tempDir, 'rev.yaml'),
      };

      await runPostprocess(path.join(tempDir, 'out.docx'), 'docx', config);
      assert.ok(fs.existsSync(markerPath));
      assert.strictEqual(fs.readFileSync(markerPath, 'utf-8').trim(), 'docx');
    });

    it('runs both format-specific and all scripts', async () => {
      const pdfScript = path.join(tempDir, 'pdf.sh');
      const allScript = path.join(tempDir, 'all.sh');
      const pdfMarker = path.join(tempDir, 'pdf-marker.txt');
      const allMarker = path.join(tempDir, 'all-marker.txt');

      fs.writeFileSync(pdfScript, `#!/bin/bash\ntouch "${pdfMarker}"`, { mode: 0o755 });
      fs.writeFileSync(allScript, `#!/bin/bash\ntouch "${allMarker}"`, { mode: 0o755 });

      const config = {
        postprocess: { pdf: pdfScript, all: allScript },
        _configPath: path.join(tempDir, 'rev.yaml'),
      };

      await runPostprocess(path.join(tempDir, 'out.pdf'), 'pdf', config);
      assert.ok(fs.existsSync(pdfMarker));
      assert.ok(fs.existsSync(allMarker));
    });

    it('reports error for missing script', async () => {
      const config = {
        postprocess: { pdf: './nonexistent.sh' },
        _configPath: path.join(tempDir, 'rev.yaml'),
      };

      const result = await runPostprocess(path.join(tempDir, 'out.pdf'), 'pdf', config);
      assert.ok(!result.success);
      assert.ok(result.error.includes('not found'));
    });

    it('reports error for failing script', async () => {
      const scriptPath = path.join(tempDir, 'fail.sh');
      fs.writeFileSync(scriptPath, '#!/bin/bash\nexit 42', { mode: 0o755 });

      const config = {
        postprocess: { pdf: scriptPath },
        _configPath: path.join(tempDir, 'rev.yaml'),
      };

      const result = await runPostprocess(path.join(tempDir, 'out.pdf'), 'pdf', config);
      assert.ok(!result.success);
      assert.ok(result.error.includes('42') || result.error.includes('failed'));
    });
  });
});
```

---

## Implementation Order

### Sprint 1: Table Preprocessing (2-3 hours)

1. [ ] Add `processTablesForFormat()` function to `lib/build.js`
2. [ ] Integrate into `prepareForFormat()`
3. [ ] Write tests in `test/tables.test.js`
4. [ ] Test with paper 2 priors table
5. [ ] Document in README

### Sprint 2: Postprocess Shell Scripts (3-4 hours)

1. [ ] Create `lib/postprocess.js` with `executeScript()` and `runPostprocess()`
2. [ ] Add `postprocess` to `DEFAULT_CONFIG`
3. [ ] Add config merging in `loadConfig()`
4. [ ] Integrate into `runPandoc()` after output generation
5. [ ] Add `--verbose` flag to CLI
6. [ ] Write tests in `test/postprocess.test.js`
7. [ ] Create example scripts in `examples/postprocess/`
8. [ ] Document in README

### Sprint 3: Header Includes (1-2 hours)

1. [ ] Add `pdf.headerIncludes` config option
2. [ ] Add `generateTableLatex()` helper
3. [ ] Pass to pandoc in `buildPandocArgs()`
4. [ ] Add tests
5. [ ] Document

### Future: DSL (if needed)

Only implement if shell scripts prove insufficient for common use cases.

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `lib/postprocess.js` | Postprocess script execution |
| `test/tables.test.js` | Table processing tests |
| `test/postprocess.test.js` | Postprocess tests |
| `examples/postprocess/fix-tables.sh` | Example PDF postprocess |
| `examples/postprocess/inject-headers.ps1` | Example DOCX postprocess |

### Modified Files

| File | Changes |
|------|---------|
| `lib/build.js` | Add `processTablesForFormat()`, `generateTableLatex()`, integrate postprocess, add configs |
| `lib/commands/build.js` | Add `--verbose` flag |

---

## Example Usage After Implementation

### Table Config

```yaml
# rev.yaml
tables:
  nowrap:
    - Prior
    - Value
    - Count
  small: true
```

### Postprocess Scripts

```yaml
# rev.yaml
postprocess:
  pdf: ./scripts/fix-latex.sh
  docx: ./scripts/add-metadata.py
  all: ./scripts/notify.js
```

Example `fix-latex.sh`:
```bash
#!/bin/bash
# Receives: OUTPUT_FILE, OUTPUT_FORMAT, PROJECT_DIR, CONFIG_PATH

# Example: Replace longtable alignment
if [ "$OUTPUT_FORMAT" = "pdf" ]; then
  echo "PDF postprocessing not needed (can't modify PDF)"
fi
```

Example `add-metadata.py`:
```python
#!/usr/bin/env python3
import os
from docx import Document

doc = Document(os.environ['OUTPUT_FILE'])
doc.core_properties.author = "Research Team"
doc.save(os.environ['OUTPUT_FILE'])
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Table preprocessing breaks edge cases | Medium | Medium | Extensive tests, careful regex |
| Shell script security concerns | Low | High | Document that scripts run with user permissions |
| Cross-platform script compatibility | Medium | Medium | Support multiple interpreters, document requirements |
| Performance overhead from postprocess | Low | Low | Scripts are optional, run after main build |

---

## Success Criteria

1. **Tables**: `Normal(0, 0.5)` in nowrap column → `$\mathcal{N}(0, 0.5)$` in PDF output
2. **Postprocess**: User script receives correct environment variables and can modify output
3. **Tests**: All new tests pass, existing tests unchanged
4. **Docs**: README updated with examples for both features
