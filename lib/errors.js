/**
 * Error handling utilities with actionable suggestions
 */

import chalk from 'chalk';
import path from 'path';
import fs from 'fs';

/**
 * Format an error message with optional suggestions
 * @param {string} message - Main error message
 * @param {string[]} suggestions - Actionable suggestions
 * @returns {string}
 */
export function formatError(message, suggestions = []) {
  const lines = [chalk.red(`Error: ${message}`)];

  if (suggestions.length > 0) {
    lines.push('');
    for (const suggestion of suggestions) {
      lines.push(chalk.dim(`  ${suggestion}`));
    }
  }

  return lines.join('\n');
}

/**
 * Get actionable suggestions for file not found errors
 * @param {string} filePath - The file path that wasn't found
 * @returns {string[]}
 */
export function getFileNotFoundSuggestions(filePath) {
  const suggestions = [];
  const ext = path.extname(filePath).toLowerCase();
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);

  // Check if directory exists
  if (!fs.existsSync(dir)) {
    suggestions.push(`Directory does not exist: ${dir}`);
    suggestions.push(`Create it with: mkdir -p "${dir}"`);
    return suggestions;
  }

  // Look for similar files
  try {
    const files = fs.readdirSync(dir);
    const similar = findSimilarFiles(base, files, 3);

    if (similar.length > 0) {
      suggestions.push('Did you mean:');
      for (const f of similar) {
        suggestions.push(`  ${path.join(dir, f)}`);
      }
    }
  } catch {
    // Directory not readable
  }

  // Extension-specific suggestions
  if (ext === '.md' || ext === '') {
    suggestions.push('Run "rev status" to see files in the current project');
  } else if (ext === '.docx') {
    suggestions.push('Use "rev import <docx>" to import Word documents');
  } else if (ext === '.bib') {
    suggestions.push('Create a bibliography with "rev doi bib <doi>"');
    suggestions.push('Or check references.bib in your project');
  } else if (ext === '.pdf') {
    suggestions.push('Build PDFs with "rev build pdf"');
  }

  return suggestions;
}

/**
 * Get actionable suggestions for dependency errors
 * @param {string} dependency - The missing dependency
 * @returns {string[]}
 */
export function getDependencySuggestions(dependency) {
  const suggestions = [];
  const platform = process.platform;

  switch (dependency.toLowerCase()) {
    case 'pandoc':
      suggestions.push('Pandoc is required for document conversion');
      if (platform === 'darwin') {
        suggestions.push('Install with: brew install pandoc');
      } else if (platform === 'win32') {
        suggestions.push('Install from: https://pandoc.org/installing.html');
        suggestions.push('Or with: winget install --id JohnMacFarlane.Pandoc');
      } else {
        suggestions.push('Install with: sudo apt install pandoc');
        suggestions.push('Or from: https://pandoc.org/installing.html');
      }
      suggestions.push('Run "rev install" to check all dependencies');
      break;

    case 'pdflatex':
    case 'xelatex':
    case 'latex':
      suggestions.push('LaTeX is required for PDF generation');
      if (platform === 'darwin') {
        suggestions.push('Install with: brew install --cask mactex');
        suggestions.push('Or minimal: brew install --cask basictex');
      } else if (platform === 'win32') {
        suggestions.push('Install MiKTeX from: https://miktex.org/download');
        suggestions.push('Or TeX Live from: https://tug.org/texlive/');
      } else {
        suggestions.push('Install with: sudo apt install texlive-full');
        suggestions.push('Or minimal: sudo apt install texlive-latex-base');
      }
      suggestions.push('Alternative: Use "rev build docx" for Word output');
      break;

    case 'pandoc-crossref':
      suggestions.push('pandoc-crossref enables figure/table/equation numbering');
      if (platform === 'darwin') {
        suggestions.push('Install with: brew install pandoc-crossref');
      } else if (platform === 'win32') {
        suggestions.push('Download from: https://github.com/lierdakil/pandoc-crossref/releases');
      } else {
        suggestions.push('Install with: sudo apt install pandoc-crossref');
        suggestions.push('Or from: https://github.com/lierdakil/pandoc-crossref/releases');
      }
      suggestions.push('Cross-references will work but wonʼt be numbered without it');
      break;
  }

  return suggestions;
}

/**
 * Get actionable suggestions for configuration errors
 * @param {string} field - The problematic config field
 * @param {string} issue - What's wrong with it
 * @returns {string[]}
 */
export function getConfigSuggestions(field, issue) {
  const suggestions = [];

  switch (field) {
    case 'bibliography':
      suggestions.push('Create a references.bib file in your project');
      suggestions.push('Or set bibliography in rev.yaml:');
      suggestions.push('  bibliography: path/to/refs.bib');
      break;

    case 'sections':
      suggestions.push('List your sections in rev.yaml:');
      suggestions.push('  sections:');
      suggestions.push('    - introduction.md');
      suggestions.push('    - methods.md');
      suggestions.push('Or run "rev init" to auto-detect');
      break;

    case 'user':
      suggestions.push('Set your name for comment attribution:');
      suggestions.push('  rev config user "Your Name"');
      break;

    case 'csl':
      suggestions.push('CSL styles control citation format');
      suggestions.push('Download styles from: https://www.zotero.org/styles');
      suggestions.push('Or use: citation-style: apa (common styles available)');
      break;

    default:
      suggestions.push(`Check rev.yaml for "${field}" configuration`);
      suggestions.push('Run "rev help config" for configuration options');
  }

  if (issue === 'typo') {
    suggestions.unshift('This looks like a typo in rev.yaml');
  }

  return suggestions;
}

/**
 * Get suggestions for comment/annotation errors
 * @param {string} issue - The issue type
 * @returns {string[]}
 */
export function getAnnotationSuggestions(issue) {
  const suggestions = [];

  switch (issue) {
    case 'no_comments':
      suggestions.push('Comments use CriticMarkup syntax:');
      suggestions.push('  {>>Author: Comment text<<}');
      suggestions.push('Import from Word with: rev import <docx>');
      break;

    case 'no_changes':
      suggestions.push('Track changes use CriticMarkup syntax:');
      suggestions.push('  {++inserted text++}');
      suggestions.push('  {--deleted text--}');
      suggestions.push('  {~~old~>new~~}');
      suggestions.push('Import from Word with: rev import <docx>');
      break;

    case 'invalid_number':
      suggestions.push('Use "rev comments <file>" to see comment numbers');
      suggestions.push('Or "rev status <file>" for a summary');
      break;

    case 'no_author':
      suggestions.push('Set your author name:');
      suggestions.push('  rev config user "Your Name"');
      suggestions.push('Or use --author "Name" flag');
      break;
  }

  return suggestions;
}

/**
 * Get suggestions for build errors
 * @param {string} issue - The build issue
 * @param {object} context - Additional context
 * @returns {string[]}
 */
export function getBuildSuggestions(issue, context = {}) {
  const suggestions = [];

  switch (issue) {
    case 'no_sections':
      suggestions.push('No section files found to build');
      suggestions.push('Create markdown files or run "rev new" to start a project');
      suggestions.push('Or run "rev init" to auto-detect existing files');
      break;

    case 'missing_bib':
      suggestions.push('Bibliography file not found');
      if (context.bibPath) {
        suggestions.push(`Expected: ${context.bibPath}`);
      }
      suggestions.push('Create references.bib or update rev.yaml');
      suggestions.push('Add citations with: rev doi bib <doi>');
      break;

    case 'pandoc_failed':
      suggestions.push('Pandoc conversion failed');
      suggestions.push('Check for syntax errors in your markdown');
      suggestions.push('Run "rev validate" to check document structure');
      if (context.format === 'pdf') {
        suggestions.push('Try "rev build docx" as an alternative');
      }
      break;

    case 'latex_error':
      suggestions.push('LaTeX compilation failed');
      suggestions.push('Common issues:');
      suggestions.push('  - Missing packages (run tlmgr to install)');
      suggestions.push('  - Invalid characters in text');
      suggestions.push('  - Math mode errors');
      suggestions.push('Try "rev build docx" to bypass LaTeX');
      break;
  }

  return suggestions;
}

/**
 * Find similar filenames using Levenshtein distance
 * @param {string} target - Target filename
 * @param {string[]} candidates - Available filenames
 * @param {number} limit - Max results
 * @returns {string[]}
 */
function findSimilarFiles(target, candidates, limit = 3) {
  const scored = candidates
    .map(c => ({ name: c, distance: levenshtein(target.toLowerCase(), c.toLowerCase()) }))
    .filter(c => c.distance <= 3) // Only reasonably similar
    .sort((a, b) => a.distance - b.distance);

  return scored.slice(0, limit).map(c => c.name);
}

/**
 * Simple Levenshtein distance
 */
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Print error and exit
 * @param {string} message - Error message
 * @param {string[]} suggestions - Suggestions
 */
export function exitWithError(message, suggestions = []) {
  console.error(formatError(message, suggestions));
  process.exit(1);
}

/**
 * Validate file exists with helpful error
 * @param {string} filePath - File to check
 * @param {string} fileType - Type description for error message
 */
export function requireFile(filePath, fileType = 'File') {
  if (!fs.existsSync(filePath)) {
    exitWithError(
      `${fileType} not found: ${filePath}`,
      getFileNotFoundSuggestions(filePath)
    );
  }
}
