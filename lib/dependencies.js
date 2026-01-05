/**
 * Dependency checking utilities for pandoc, LaTeX, and related tools
 */

import { execSync } from 'child_process';

/**
 * Check if pandoc-crossref is available
 * @returns {boolean}
 */
export function hasPandocCrossref() {
  try {
    execSync('pandoc-crossref --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if pandoc is available
 * @returns {boolean}
 */
export function hasPandoc() {
  try {
    execSync('pandoc --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if LaTeX is available (for PDF generation)
 * @returns {boolean}
 */
export function hasLatex() {
  try {
    execSync('pdflatex --version', { stdio: 'ignore' });
    return true;
  } catch {
    try {
      execSync('xelatex --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Get installation instructions for missing dependencies
 * @param {string} dependency - 'pandoc', 'latex', 'pandoc-crossref'
 * @returns {string}
 */
export function getInstallInstructions(dependency) {
  const platform = process.platform;
  const instructions = {
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

  return platformInstructions[platform] || platformInstructions.linux;
}

/**
 * Check dependencies and return status
 * @returns {{ pandoc: boolean, latex: boolean, crossref: boolean, messages: string[] }}
 */
export function checkDependencies() {
  const status = {
    pandoc: hasPandoc(),
    latex: hasLatex(),
    crossref: hasPandocCrossref(),
    messages: [],
  };

  if (!status.pandoc) {
    status.messages.push(`Pandoc not found. Install with: ${getInstallInstructions('pandoc')}`);
  }
  if (!status.latex) {
    status.messages.push(`LaTeX not found (required for PDF). Install with: ${getInstallInstructions('latex')}`);
  }
  if (!status.crossref) {
    status.messages.push(`pandoc-crossref not found (optional, for figure/table refs). Install with: ${getInstallInstructions('pandoc-crossref')}`);
  }

  return status;
}
