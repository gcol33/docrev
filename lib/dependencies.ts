/**
 * Dependency checking utilities for pandoc, LaTeX, and related tools
 */

import { execFileSync } from 'child_process';

/**
 * Run `<file> --version` without a shell and return its stdout, or null when
 * the binary is absent (ENOENT) or exits non-zero (present but broken). Using
 * execFileSync avoids shell quoting and treats both failure modes uniformly.
 */
function runVersion(file: string, args: string[] = ['--version']): string | null {
  try {
    return execFileSync(file, args, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf-8' });
  } catch {
    return null;
  }
}

function commandExists(file: string, args: string[] = ['--version']): boolean {
  return runVersion(file, args) !== null;
}

/**
 * Check if pandoc-crossref is available
 */
export function hasPandocCrossref(): boolean {
  return commandExists('pandoc-crossref');
}

/**
 * Check if pandoc is available
 */
export function hasPandoc(): boolean {
  return commandExists('pandoc');
}

/**
 * Parsed pandoc version (e.g. "3.9"), or null when pandoc is unavailable.
 */
export function getPandocVersion(): string | null {
  const out = runVersion('pandoc');
  if (!out) return null;
  const m = out.match(/pandoc(?:\.exe)?\s+(\d+\.\d+(?:\.\d+)?)/i);
  return m ? m[1]! : null;
}

/**
 * Whether pandoc bundles citeproc and accepts `--citeproc`. That flag and the
 * built-in citeproc arrived in pandoc 2.11; earlier versions need the separate
 * pandoc-citeproc filter.
 */
export function pandocSupportsCiteproc(): boolean {
  const v = getPandocVersion();
  if (!v) return false;
  const parts = v.split('.').map((n) => parseInt(n, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  return major > 2 || (major === 2 && minor >= 11);
}

/**
 * Check if LaTeX is available (for PDF generation)
 */
export function hasLatex(): boolean {
  return commandExists('pdflatex') || commandExists('xelatex');
}

/**
 * Get installation instructions for missing dependencies
 */
export function getInstallInstructions(dependency: string): string {
  const platform = process.platform;
  const instructions: Record<string, Record<string, string>> = {
    pandoc: {
      darwin: 'brew install pandoc',
      win32: 'winget install JohnMacFarlane.Pandoc',
      linux: 'sudo apt install pandoc',
    },
    latex: {
      darwin: 'brew install --cask mactex-no-gui',
      win32: 'Install MiKTeX from https://miktex.org/download',
      linux: 'sudo apt install texlive-latex-base texlive-fonts-recommended',
    },
    'pandoc-crossref': {
      darwin: 'brew install pandoc-crossref',
      win32: 'Download from https://github.com/lierdakil/pandoc-crossref/releases',
      linux: 'Download from https://github.com/lierdakil/pandoc-crossref/releases',
    },
  };

  const platformInstructions = instructions[dependency];
  if (!platformInstructions) return '';

  return platformInstructions[platform] || platformInstructions.linux || '';
}

export interface DependencyStatus {
  pandoc: boolean;
  latex: boolean;
  crossref: boolean;
  messages: string[];
}

/**
 * Check dependencies and return status
 */
export function checkDependencies(): DependencyStatus {
  const status: DependencyStatus = {
    pandoc: hasPandoc(),
    latex: hasLatex(),
    crossref: hasPandocCrossref(),
    messages: [],
  };

  if (!status.pandoc) {
    status.messages.push(`Pandoc not found. Install with: ${getInstallInstructions('pandoc')}`);
  } else if (!pandocSupportsCiteproc()) {
    const version = getPandocVersion();
    status.messages.push(
      `Pandoc ${version ?? '(unknown version)'} is older than 2.11; citation processing (--citeproc) needs 2.11+. Upgrade with: ${getInstallInstructions('pandoc')}`,
    );
  }
  if (!status.latex) {
    status.messages.push(`LaTeX not found (required for PDF). Install with: ${getInstallInstructions('latex')}`);
  }
  if (!status.crossref) {
    status.messages.push(`pandoc-crossref not found (optional, for figure/table refs). Install with: ${getInstallInstructions('pandoc-crossref')}`);
  }

  return status;
}
