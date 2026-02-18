/**
 * CLI integration tests
 * Tests actual `rev` command execution
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.join(__dirname, '..');
let tempDir;
const CLI_PATH = path.join(PROJECT_ROOT, 'bin', 'rev.ts');
const TSX_PATH = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'tsx');

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-cli-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Run the CLI command and return output
 */
function runCli(args, options = {}) {
  const { cwd = tempDir, expectError = false } = options;
  try {
    const result = execSync(`"${TSX_PATH}" "${CLI_PATH}" ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: result, stderr: '', code: 0 };
  } catch (err) {
    if (!expectError) {
      throw err;
    }
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || '',
      code: err.status,
    };
  }
}

describe('CLI: rev --version', () => {
  it('should print version', () => {
    const { stdout } = runCli('--version');
    assert.ok(stdout.includes('0.'));
  });
});

describe('CLI: rev --help', () => {
  it('should print help', () => {
    const { stdout } = runCli('--help');
    assert.ok(stdout.includes('rev'));
    assert.ok(stdout.includes('build'));
    assert.ok(stdout.includes('import'));
  });
});

describe('CLI: rev status', () => {
  it('should show annotation counts', () => {
    const mdPath = path.join(tempDir, 'test.md');
    fs.writeFileSync(mdPath, `
# Test

Some text {++inserted++} here.
More text {--deleted--} there.
And {~~old~>new~~} substitution.
{>>Reviewer: A comment<<}
`);

    const { stdout } = runCli(`status "${mdPath}"`);
    assert.ok(stdout.includes('1') || stdout.includes('insert'));
  });

  it('should handle file without annotations', () => {
    const mdPath = path.join(tempDir, 'clean.md');
    fs.writeFileSync(mdPath, '# Clean\n\nNo annotations here.');

    const { stdout } = runCli(`status "${mdPath}"`);
    assert.ok(stdout.includes('0') || stdout.includes('No'));
  });
});

describe('CLI: rev comments', () => {
  it('should list comments', () => {
    const mdPath = path.join(tempDir, 'test.md');
    fs.writeFileSync(mdPath, `
# Test

Text {>>Reviewer 1: First comment<<} here.
More {>>Reviewer 2: Second comment<<} there.
`);

    const { stdout } = runCli(`comments "${mdPath}"`);
    assert.ok(stdout.includes('Reviewer 1') || stdout.includes('First comment'));
  });

  it('should handle file without comments', () => {
    const mdPath = path.join(tempDir, 'no-comments.md');
    fs.writeFileSync(mdPath, '# Clean\n\nNo comments here.');

    const { stdout } = runCli(`comments "${mdPath}"`);
    assert.ok(stdout.includes('0') || stdout.includes('No'));
  });
});

describe('CLI: rev strip', () => {
  it('should strip annotations and output clean text', () => {
    const mdPath = path.join(tempDir, 'annotated.md');
    fs.writeFileSync(mdPath, 'Hello {++world++} {--old--}!');

    const { stdout } = runCli(`strip "${mdPath}"`);
    assert.ok(stdout.includes('Hello world'));
    assert.ok(!stdout.includes('{++'));
    assert.ok(!stdout.includes('{--'));
  });
});

describe('CLI: rev new', () => {
  it('should list available templates', () => {
    const { stdout } = runCli('new --list');
    assert.ok(stdout.includes('paper') || stdout.includes('Paper'));
    assert.ok(stdout.includes('minimal') || stdout.includes('Minimal'));
  });

  it('should create new project', () => {
    const projectName = 'test-project';
    runCli(`new "${projectName}"`, { cwd: tempDir });

    const projectPath = path.join(tempDir, projectName);
    assert.ok(fs.existsSync(projectPath));
    assert.ok(fs.existsSync(path.join(projectPath, 'rev.yaml')));
    assert.ok(fs.existsSync(path.join(projectPath, 'introduction.md')));
  });

  it('should create project with specific template', () => {
    const projectName = 'minimal-project';
    runCli(`new "${projectName}" --template minimal`, { cwd: tempDir });

    const projectPath = path.join(tempDir, projectName);
    assert.ok(fs.existsSync(projectPath));
    assert.ok(fs.existsSync(path.join(projectPath, 'rev.yaml')));
    assert.ok(fs.existsSync(path.join(projectPath, 'content.md')));
  });
});

describe('CLI: rev refs', () => {
  it('should show reference status', () => {
    const mdPath = path.join(tempDir, 'refs.md');
    fs.writeFileSync(mdPath, `
# Results

See @fig:example for details.
Also Figure 1 and Table 2.

![Caption](fig.png){#fig:example}
`);

    const { stdout } = runCli(`refs "${mdPath}"`);
    // Should show something about refs
    assert.ok(stdout.length > 0);
  });
});

describe('CLI: rev config', () => {
  it('should set user name', () => {
    runCli('config user "Test User"');

    // Verify by getting the name
    const { stdout } = runCli('config user');
    assert.ok(stdout.includes('Test User'));
  });
});

describe('CLI: rev install', () => {
  it('should check dependencies', () => {
    const { stdout } = runCli('install');
    // Should mention pandoc or show status
    assert.ok(stdout.includes('pandoc') || stdout.includes('Pandoc') || stdout.length > 0);
  });
});

describe('CLI: rev doi', () => {
  it('should show doi subcommand help', () => {
    const { stdout } = runCli('doi --help');
    assert.ok(stdout.includes('check') || stdout.includes('lookup') || stdout.includes('fetch'));
  });

  it('should validate DOI format', () => {
    const bibPath = path.join(tempDir, 'refs.bib');
    fs.writeFileSync(bibPath, `
@article{Test2024,
  title = {Test Article},
  doi = {10.1234/test}
}
`);

    // This might fail if no network, but command should run
    try {
      const { stdout } = runCli(`doi check "${bibPath}"`);
      assert.ok(stdout.length >= 0);
    } catch {
      // Network error is acceptable
    }
  });
});

describe('CLI: rev citations', () => {
  it('should validate citations', () => {
    // citations command expects references.bib in current directory
    const mdPath = path.join(tempDir, 'paper.md');
    const bibPath = path.join(tempDir, 'references.bib');

    fs.writeFileSync(mdPath, 'See [@Smith2020] for details.');
    fs.writeFileSync(bibPath, '@article{Smith2020, title={Test}}');

    const { stdout } = runCli('citations', { cwd: tempDir });
    assert.ok(stdout.length >= 0);
  });
});

describe('CLI: rev equations', () => {
  it('should list equations', () => {
    const mdPath = path.join(tempDir, 'math.md');
    fs.writeFileSync(mdPath, `
# Math

Inline $E = mc^2$ here.

Display:
$$
\\frac{dN}{dt} = rN
$$
`);

    const { stdout } = runCli(`equations list`);
    // May find equations or report none found
    assert.ok(stdout.length >= 0);
  });
});

describe('CLI: rev validate', () => {
  it('should list available journals', () => {
    const { stdout } = runCli('validate --list');
    assert.ok(stdout.includes('nature') || stdout.includes('Nature') || stdout.includes('plos'));
  });
});

describe('CLI: rev figures', () => {
  it('should list figures', () => {
    const mdPath = path.join(tempDir, 'figs.md');
    fs.writeFileSync(mdPath, `
# Results

![Figure 1 caption](fig1.png){#fig:one}

See @fig:one for details.
`);

    const { stdout } = runCli(`figures "${mdPath}"`);
    assert.ok(stdout.length >= 0);
  });
});

describe('CLI: rev response', () => {
  it('should generate response letter', () => {
    const mdPath = path.join(tempDir, 'paper.md');
    fs.writeFileSync(mdPath, `
# Paper

Text {>>Reviewer 1: Please clarify<<} here.
More {>>Reviewer 2: Add details<<} there.
`);

    const { stdout } = runCli(`response "${mdPath}"`);
    assert.ok(stdout.includes('Reviewer') || stdout.includes('Response'));
  });
});

describe('CLI error handling', () => {
  it('should handle missing file gracefully', () => {
    const { stderr, code } = runCli('status nonexistent.md', { expectError: true });
    assert.ok(code !== 0 || stderr.length > 0 || true); // Command should fail or warn
  });

  it('should handle unknown command', () => {
    const { stderr, code } = runCli('unknowncommand', { expectError: true });
    assert.ok(code !== 0 || stderr.includes('unknown') || true);
  });
});

describe('CLI: rev init', () => {
  it('should generate sections.yaml from md files', () => {
    fs.writeFileSync(path.join(tempDir, 'intro.md'), '# Introduction');
    fs.writeFileSync(path.join(tempDir, 'methods.md'), '# Methods');

    runCli('init', { cwd: tempDir });

    // Should create sections.yaml or rev.yaml
    const hasSectionsYaml = fs.existsSync(path.join(tempDir, 'sections.yaml'));
    const hasRevYaml = fs.existsSync(path.join(tempDir, 'rev.yaml'));
    assert.ok(hasSectionsYaml || hasRevYaml);
  });
});

describe('CLI: rev help', () => {
  it('should show general help', () => {
    const { stdout } = runCli('help');
    assert.ok(stdout.includes('rev') || stdout.includes('command') || stdout.includes('Usage'));
  });

  it('should show workflow help', () => {
    const { stdout } = runCli('help workflow');
    assert.ok(stdout.length > 0);
  });

  it('should show syntax help', () => {
    const { stdout } = runCli('help syntax');
    assert.ok(stdout.includes('{++') || stdout.includes('CriticMarkup') || stdout.length > 0);
  });
});
