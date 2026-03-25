/**
 * Dependency checking utilities for pandoc, LaTeX, and related tools
 */
import { execSync } from 'child_process';
/**
 * Check if a command is available by running it silently
 */
function commandExists(cmd) {
    try {
        execSync(cmd, { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Check if pandoc-crossref is available
 */
export function hasPandocCrossref() {
    return commandExists('pandoc-crossref --version');
}
/**
 * Check if pandoc is available
 */
export function hasPandoc() {
    return commandExists('pandoc --version');
}
/**
 * Check if LaTeX is available (for PDF generation)
 */
export function hasLatex() {
    return commandExists('pdflatex --version') || commandExists('xelatex --version');
}
/**
 * Get installation instructions for missing dependencies
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
    if (!platformInstructions)
        return '';
    return platformInstructions[platform] || platformInstructions.linux || '';
}
/**
 * Check dependencies and return status
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
//# sourceMappingURL=dependencies.js.map