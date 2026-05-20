/**
 * Tests for the placeholder-macro registry (lib/macros.ts).
 *
 * Covers:
 *   - Built-in \tofill ships and renders bold orange [X].
 *   - User macros from rev.yaml extend / override built-ins.
 *   - Per-format style picker honors overrides.
 *   - LaTeX preamble uses \providecommand (so user defs win).
 *   - Sidecar JSON writes the expected shape.
 *   - End-to-end DOCX build (when pandoc available) produces real <w:color>
 *     runs — no Span+style regression.
 *   - End-to-end HTML build (when pandoc available) emits the inline-style
 *     span.
 *   - Backward compat: user-supplied filter still works alongside built-in.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawnSync } from 'child_process';
import AdmZip from 'adm-zip';

import {
  BUILTIN_MACROS,
  mergeMacros,
  validateMacro,
  pickStyle,
  generateLatexPreamble,
  writeMacrosSidecar,
  getMacroFilterPath,
} from '../lib/macros.js';

import { runPandoc, DEFAULT_CONFIG, combineSections } from '../lib/build.js';

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-macros-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function hasPandoc() {
  try {
    const r = spawnSync('pandoc', ['--version'], { encoding: 'utf-8' });
    return r.status === 0;
  } catch {
    return false;
  }
}

describe('BUILTIN_MACROS', () => {
  it('ships a \\tofill macro with bold orange default', () => {
    const tofill = BUILTIN_MACROS.find((m) => m.name === 'tofill');
    assert.ok(tofill, 'expected built-in \\tofill macro');
    assert.strictEqual(tofill.default.color, 'C2410C');
    assert.strictEqual(tofill.default.bold, true);
    assert.strictEqual(tofill.default.bracket, true);
  });
});

describe('validateMacro', () => {
  it('accepts a minimal valid macro', () => {
    assert.deepStrictEqual(validateMacro({ name: 'note' }), []);
  });

  it('rejects missing name', () => {
    const errs = validateMacro({ default: { color: 'C2410C' } });
    assert.ok(errs.some((e) => e.includes('name')));
  });

  it('rejects malformed hex color', () => {
    const errs = validateMacro({ name: 'note', default: { color: '#C2410C' } });
    assert.ok(errs.some((e) => e.toLowerCase().includes('hex')));
  });

  it('rejects bad name shape', () => {
    const errs = validateMacro({ name: '1bad' });
    assert.ok(errs.some((e) => e.includes('name')));
  });

  it('rejects non-boolean bold', () => {
    const errs = validateMacro({ name: 'note', default: { bold: 'yes' } });
    assert.ok(errs.some((e) => e.includes('bold')));
  });
});

describe('mergeMacros', () => {
  it('returns built-ins when user macros undefined', () => {
    const macros = mergeMacros(undefined);
    assert.ok(macros.find((m) => m.name === 'tofill'));
  });

  it('appends user macros by name', () => {
    const macros = mergeMacros([
      { name: 'note', default: { color: '1E40AF', bold: true, prefix: 'NOTE: ' } },
    ]);
    assert.ok(macros.find((m) => m.name === 'tofill'));
    const note = macros.find((m) => m.name === 'note');
    assert.ok(note);
    assert.strictEqual(note.default.color, '1E40AF');
    assert.strictEqual(note.default.prefix, 'NOTE: ');
  });

  it('overrides built-in by same name', () => {
    const macros = mergeMacros([
      { name: 'tofill', default: { color: '00FF00' } },
    ]);
    const tofill = macros.find((m) => m.name === 'tofill');
    assert.strictEqual(tofill.default.color, '00FF00');
  });

  it('drops invalid user macros without disabling built-ins', () => {
    // Silence the validation warning in test output.
    const origWarn = console.warn;
    console.warn = () => {};
    try {
      const macros = mergeMacros([{ name: '1bad' }, { /* no name */ }]);
      assert.ok(macros.find((m) => m.name === 'tofill'));
    } finally {
      console.warn = origWarn;
    }
  });
});

describe('pickStyle', () => {
  const macro = {
    name: 'tofill',
    default: { color: 'C2410C', bold: true, bracket: true },
    formats: { html: { color: '111111', italic: true } },
  };

  it('returns format override when present', () => {
    const style = pickStyle(macro, 'html');
    assert.strictEqual(style.color, '111111');
    assert.strictEqual(style.italic, true);
    // No merge with default — format override replaces it entirely.
    assert.strictEqual(style.bold, undefined);
  });

  it('falls back to default when no format override', () => {
    const style = pickStyle(macro, 'docx');
    assert.strictEqual(style.color, 'C2410C');
    assert.strictEqual(style.bold, true);
  });

  it('returns {} when neither default nor format set', () => {
    const style = pickStyle({ name: 'bare' }, 'docx');
    assert.deepStrictEqual(style, {});
  });
});

describe('generateLatexPreamble', () => {
  it('emits \\providecommand (not \\newcommand) so user defs win', () => {
    const preamble = generateLatexPreamble(BUILTIN_MACROS);
    assert.ok(preamble.includes('\\providecommand{\\tofill}'));
    assert.ok(!preamble.includes('\\newcommand{\\tofill}'));
  });

  it('wraps with textcolor[HTML]{...} when color set', () => {
    const preamble = generateLatexPreamble(BUILTIN_MACROS);
    assert.ok(preamble.includes('\\textcolor[HTML]{C2410C}'));
    assert.ok(preamble.includes('\\textbf{'));
  });

  it('loads xcolor with HTML option', () => {
    const preamble = generateLatexPreamble(BUILTIN_MACROS);
    assert.ok(preamble.includes('xcolor'));
    assert.ok(preamble.includes('HTML'));
  });
});

describe('writeMacrosSidecar', () => {
  it('writes .macros.json with the expected shape', () => {
    const sidecar = writeMacrosSidecar(tempDir, BUILTIN_MACROS);
    assert.ok(fs.existsSync(sidecar));
    const parsed = JSON.parse(fs.readFileSync(sidecar, 'utf-8'));
    assert.ok(Array.isArray(parsed.macros));
    assert.strictEqual(parsed.macros[0].name, 'tofill');
  });
});

describe('macro-filter.lua is shipped next to macros.js', () => {
  it('exists at the resolved path', () => {
    const filterPath = getMacroFilterPath();
    assert.ok(fs.existsSync(filterPath), `expected lua filter at ${filterPath}`);
  });
});

// =============================================================================
// End-to-end pandoc tests. Skipped automatically when pandoc isn't installed
// (CI runs them on ubuntu/windows where pandoc is available via apt/choco).
// =============================================================================

function setupProject(dir, sectionContent, extraConfig = {}) {
  fs.writeFileSync(path.join(dir, 'content.md'), sectionContent);
  const config = {
    ...DEFAULT_CONFIG,
    title: 'Test Doc',
    sections: ['content.md'],
    ...extraConfig,
  };
  combineSections(dir, config);
  return config;
}

describe('end-to-end: \\tofill in DOCX', { skip: !hasPandoc() }, () => {
  it('renders as bold orange [X] via real <w:color> + <w:b> runs', async () => {
    const config = setupProject(
      tempDir,
      '# Section\n\nPlaceholder \\tofill{TBD} inline.\n'
    );

    const outputPath = path.join(tempDir, 'out.docx');
    const result = await runPandoc(
      path.join(tempDir, 'paper.md'),
      'docx',
      config,
      { outputPath }
    );
    assert.ok(result.success, `pandoc failed: ${result.error}`);

    const zip = new AdmZip(outputPath);
    const docXml = zip.readAsText('word/document.xml');
    assert.ok(docXml, 'document.xml missing');

    // Real <w:color w:val="C2410C"/> proves we emitted raw OpenXML, not the
    // Span+style fallback that pandoc 3.x silently drops.
    assert.ok(
      docXml.includes('w:val="C2410C"'),
      'expected <w:color w:val="C2410C"/> in docx — did Span+style regression happen?'
    );
    assert.ok(docXml.includes('<w:b/>'), 'expected bold run property');
    // And the bracketed content shows up literally.
    assert.ok(docXml.includes('[TBD]'), 'expected [TBD] in document text');
  });

  it('does not leave the docrev_macros_file metadata leaking into output', async () => {
    const config = setupProject(
      tempDir,
      '# Section\n\nSome \\tofill{LEAK} text.\n'
    );
    const outputPath = path.join(tempDir, 'out.docx');
    const result = await runPandoc(
      path.join(tempDir, 'paper.md'),
      'docx',
      config,
      { outputPath }
    );
    assert.ok(result.success);
    const zip = new AdmZip(outputPath);
    const docXml = zip.readAsText('word/document.xml');
    assert.ok(!docXml.includes('docrev_macros_file'), 'metadata key leaked into output');
  });

  it('cleans up .macros.json after the build', async () => {
    const config = setupProject(tempDir, '# S\n\n\\tofill{X}\n');
    const outputPath = path.join(tempDir, 'out.docx');
    await runPandoc(path.join(tempDir, 'paper.md'), 'docx', config, { outputPath });
    assert.ok(!fs.existsSync(path.join(tempDir, '.macros.json')), 'sidecar should be removed');
  });
});

describe('end-to-end: custom user macro', { skip: !hasPandoc() }, () => {
  it('renders \\note{X} as blue [NOTE: X] in DOCX', async () => {
    const config = setupProject(
      tempDir,
      '# Section\n\nSee \\note{follow up}.\n',
      {
        macros: [
          { name: 'note', default: { color: '1E40AF', bold: true, prefix: 'NOTE: ' } },
        ],
      }
    );
    const outputPath = path.join(tempDir, 'out.docx');
    const result = await runPandoc(
      path.join(tempDir, 'paper.md'),
      'docx',
      config,
      { outputPath }
    );
    assert.ok(result.success, `pandoc failed: ${result.error}`);

    const zip = new AdmZip(outputPath);
    const docXml = zip.readAsText('word/document.xml');
    assert.ok(docXml.includes('w:val="1E40AF"'), 'expected blue color run');
    assert.ok(docXml.includes('[NOTE: follow up]'), 'expected prefixed bracket text');
  });
});

describe('end-to-end: tex preamble injection', { skip: !hasPandoc() }, () => {
  it('emits \\providecommand for \\tofill in .tex output', async () => {
    const config = setupProject(
      tempDir,
      '# Section\n\nPlaceholder \\tofill{TBD}.\n'
    );
    const outputPath = path.join(tempDir, 'out.tex');
    const result = await runPandoc(
      path.join(tempDir, 'paper.md'),
      'tex',
      config,
      { outputPath }
    );
    assert.ok(result.success, `pandoc failed: ${result.error}`);
    const tex = fs.readFileSync(outputPath, 'utf-8');
    assert.ok(tex.includes('\\providecommand{\\tofill}'), 'preamble not injected');
    assert.ok(tex.includes('\\tofill{TBD}'), 'tofill call not preserved in tex');
  });

  it('removes .macros.tex after build', async () => {
    const config = setupProject(tempDir, '# S\n\n\\tofill{X}\n');
    const outputPath = path.join(tempDir, 'out.tex');
    await runPandoc(path.join(tempDir, 'paper.md'), 'tex', config, { outputPath });
    assert.ok(!fs.existsSync(path.join(tempDir, '.macros.tex')), 'preamble file should be removed');
  });
});

describe('backward compat: user-supplied filter and preamble', { skip: !hasPandoc() }, () => {
  it('does not break when project ships its own tofill_filter.lua', async () => {
    // A local filter that no-ops on \tofill (we just want to prove docrev's
    // built-in filter doesn't conflict — the build still completes and our
    // OpenXML run is present from the built-in path).
    fs.writeFileSync(
      path.join(tempDir, 'tofill_filter.lua'),
      [
        'function RawInline(el) return el end',
        'function RawBlock(el) return el end',
      ].join('\n')
    );
    const config = setupProject(tempDir, '# S\n\nNote \\tofill{Z}.\n');
    const outputPath = path.join(tempDir, 'out.docx');
    const result = await runPandoc(
      path.join(tempDir, 'paper.md'),
      'docx',
      config,
      { outputPath }
    );
    assert.ok(result.success, `pandoc failed: ${result.error}`);
    const zip = new AdmZip(outputPath);
    const docXml = zip.readAsText('word/document.xml');
    // Built-in still emitted the colored run regardless of the user's local filter.
    assert.ok(docXml.includes('w:val="C2410C"'));
  });
});
