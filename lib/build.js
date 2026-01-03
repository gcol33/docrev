/**
 * Build system - combines sections → paper.md → PDF/DOCX/TEX
 *
 * Features:
 * - Reads rev.yaml config
 * - Combines section files into paper.md (persisted)
 * - Strips annotations appropriately per output format
 * - Runs pandoc with crossref filter
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync, spawn } from 'child_process';
import YAML from 'yaml';
import { stripAnnotations } from './annotations.js';
import { buildRegistry, labelToDisplay, detectDynamicRefs, resolveForwardRefs } from './crossref.js';
import { processVariables, hasVariables } from './variables.js';

/**
 * Default rev.yaml configuration
 */
export const DEFAULT_CONFIG = {
  title: 'Untitled Document',
  authors: [],
  sections: [],
  bibliography: null,
  csl: null,
  crossref: {
    figureTitle: 'Figure',
    tableTitle: 'Table',
    figPrefix: ['Fig.', 'Figs.'],
    tblPrefix: ['Table', 'Tables'],
    secPrefix: ['Section', 'Sections'],
    linkReferences: true,
  },
  pdf: {
    template: null,
    documentclass: 'article',
    fontsize: '12pt',
    geometry: 'margin=1in',
    linestretch: 1.5,
    numbersections: false,
    toc: false,
  },
  docx: {
    reference: null,
    keepComments: true,
    toc: false,
  },
  tex: {
    standalone: true,
  },
};

/**
 * Load rev.yaml config from directory
 * @param {string} directory
 * @returns {object} merged config with defaults
 */
export function loadConfig(directory) {
  const configPath = path.join(directory, 'rev.yaml');

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG, _configPath: null };
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const userConfig = YAML.parse(content) || {};

    // Deep merge with defaults
    const config = {
      ...DEFAULT_CONFIG,
      ...userConfig,
      crossref: { ...DEFAULT_CONFIG.crossref, ...userConfig.crossref },
      pdf: { ...DEFAULT_CONFIG.pdf, ...userConfig.pdf },
      docx: { ...DEFAULT_CONFIG.docx, ...userConfig.docx },
      tex: { ...DEFAULT_CONFIG.tex, ...userConfig.tex },
      _configPath: configPath,
    };

    return config;
  } catch (err) {
    throw new Error(`Failed to parse rev.yaml: ${err.message}`);
  }
}

/**
 * Find section files in directory
 * @param {string} directory
 * @param {string[]} configSections - sections from rev.yaml (optional)
 * @returns {string[]} ordered list of section files
 */
export function findSections(directory, configSections = []) {
  // If sections specified in config, use that order
  if (configSections.length > 0) {
    const sections = [];
    for (const section of configSections) {
      const filePath = path.join(directory, section);
      if (fs.existsSync(filePath)) {
        sections.push(section);
      } else {
        console.warn(`Warning: Section file not found: ${section}`);
      }
    }
    return sections;
  }

  // Try sections.yaml
  const sectionsYamlPath = path.join(directory, 'sections.yaml');
  if (fs.existsSync(sectionsYamlPath)) {
    try {
      const sectionsConfig = YAML.parse(fs.readFileSync(sectionsYamlPath, 'utf-8'));
      if (sectionsConfig.sections) {
        return Object.entries(sectionsConfig.sections)
          .sort((a, b) => (a[1].order ?? 999) - (b[1].order ?? 999))
          .map(([file]) => file)
          .filter((f) => fs.existsSync(path.join(directory, f)));
      }
    } catch {
      // Ignore yaml errors
    }
  }

  // Default: find all .md files except special ones
  const exclude = ['paper.md', 'readme.md', 'claude.md'];
  const files = fs.readdirSync(directory).filter((f) => {
    if (!f.endsWith('.md')) return false;
    if (exclude.includes(f.toLowerCase())) return false;
    return true;
  });

  // Sort alphabetically as fallback
  return files.sort();
}

/**
 * Combine section files into paper.md
 * @param {string} directory
 * @param {object} config
 * @param {object} options
 * @returns {string} path to paper.md
 */
export function combineSections(directory, config, options = {}) {
  const sections = findSections(directory, config.sections);

  if (sections.length === 0) {
    throw new Error('No section files found. Create .md files or specify sections in rev.yaml');
  }

  const parts = [];

  // Add YAML frontmatter
  const frontmatter = buildFrontmatter(config);
  parts.push('---');
  parts.push(YAML.stringify(frontmatter).trim());
  parts.push('---');
  parts.push('');

  // Read all section contents for variable processing
  const sectionContents = [];

  // Check if we need to auto-inject references before supplementary
  // Pandoc places refs at the end by default, which breaks when supplementary follows
  const hasRefsSection = sections.some(s =>
    s.toLowerCase().includes('reference') || s.toLowerCase().includes('refs')
  );
  const suppIndex = sections.findIndex(s =>
    s.toLowerCase().includes('supp') || s.toLowerCase().includes('appendix')
  );
  const hasBibliography = config.bibliography && fs.existsSync(path.join(directory, config.bibliography));

  // Track if we find an explicit refs div in any section
  let hasExplicitRefsDiv = false;

  // Combine sections
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const filePath = path.join(directory, section);
    let content = fs.readFileSync(filePath, 'utf-8');

    // Remove any existing frontmatter from section files
    content = stripFrontmatter(content);
    sectionContents.push(content);

    // Check if this section has an explicit refs div
    if (content.includes('::: {#refs}') || content.includes(':::  {#refs}')) {
      hasExplicitRefsDiv = true;
    }

    // Auto-inject references before supplementary if needed
    if (i === suppIndex && hasBibliography && !hasRefsSection && !hasExplicitRefsDiv) {
      parts.push('# References\n');
      parts.push('::: {#refs}');
      parts.push(':::');
      parts.push('');
      parts.push('');
      options._refsAutoInjected = true;
    }

    parts.push(content.trim());
    parts.push('');
    parts.push(''); // Double newline between sections
  }

  let paperContent = parts.join('\n');

  // Process template variables if any exist
  if (hasVariables(paperContent)) {
    paperContent = processVariables(paperContent, config, { sectionContents });
  }

  // Resolve forward references (refs that appear before their anchor definition)
  // This fixes pandoc-crossref limitation with multi-file documents
  if (hasPandocCrossref()) {
    const registry = buildRegistry(directory, sections);
    const { text, resolved } = resolveForwardRefs(paperContent, registry);
    if (resolved.length > 0) {
      paperContent = text;
      // Store resolved count for optional reporting
      options._forwardRefsResolved = resolved.length;
    }
  }

  const paperPath = path.join(directory, 'paper.md');

  fs.writeFileSync(paperPath, paperContent, 'utf-8');

  return paperPath;
}

/**
 * Build YAML frontmatter from config
 * @param {object} config
 * @returns {object}
 */
function buildFrontmatter(config) {
  const fm = {};

  if (config.title) fm.title = config.title;

  if (config.authors && config.authors.length > 0) {
    fm.author = config.authors;
  }

  if (config.bibliography) {
    fm.bibliography = config.bibliography;
  }

  if (config.csl) {
    fm.csl = config.csl;
  }

  return fm;
}

/**
 * Strip YAML frontmatter from content
 * @param {string} content
 * @returns {string}
 */
function stripFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (match) {
    return content.slice(match[0].length);
  }
  return content;
}

/**
 * Prepare paper.md for specific output format
 * @param {string} paperPath
 * @param {string} format - 'pdf', 'docx', 'tex'
 * @param {object} config
 * @param {object} options
 * @returns {string} path to prepared file
 */
export function prepareForFormat(paperPath, format, config, options = {}) {
  const directory = path.dirname(paperPath);
  let content = fs.readFileSync(paperPath, 'utf-8');

  // Build crossref registry for reference conversion
  // Pass sections from config to ensure correct file ordering
  const registry = buildRegistry(directory, config.sections);

  if (format === 'pdf' || format === 'tex') {
    // Strip all annotations for clean output
    content = stripAnnotations(content);
  } else if (format === 'docx') {
    // Strip track changes, optionally keep comments
    content = stripAnnotations(content, { keepComments: config.docx.keepComments });

    // Convert @fig:label to "Figure 1" for Word readers
    content = convertDynamicRefsToDisplay(content, registry);
  }

  // Write to temporary file
  const preparedPath = path.join(directory, `.paper-${format}.md`);
  fs.writeFileSync(preparedPath, content, 'utf-8');

  return preparedPath;
}

/**
 * Convert @fig:label references to display format (Figure 1)
 * @param {string} text
 * @param {object} registry
 * @returns {string}
 */
function convertDynamicRefsToDisplay(text, registry) {
  const refs = detectDynamicRefs(text);

  // Process in reverse order to preserve positions
  let result = text;
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i];
    const display = labelToDisplay(ref.type, ref.label, registry);

    if (display) {
      result = result.slice(0, ref.position) + display + result.slice(ref.position + ref.match.length);
    }
  }

  return result;
}

/**
 * Build pandoc arguments for format
 * @param {string} format
 * @param {object} config
 * @param {string} outputPath
 * @returns {string[]}
 */
export function buildPandocArgs(format, config, outputPath) {
  const args = [];

  // Output format
  if (format === 'tex') {
    args.push('-t', 'latex');
    if (config.tex.standalone) {
      args.push('-s');
    }
  } else if (format === 'pdf') {
    args.push('-t', 'pdf');
  } else if (format === 'docx') {
    args.push('-t', 'docx');
  }

  args.push('-o', outputPath);

  // Crossref filter (if available)
  if (hasPandocCrossref()) {
    args.push('--filter', 'pandoc-crossref');
  }

  // Bibliography
  if (config.bibliography) {
    args.push('--citeproc');
  }

  // Format-specific options
  if (format === 'pdf') {
    if (config.pdf.template) {
      args.push('--template', config.pdf.template);
    }
    args.push('-V', `documentclass=${config.pdf.documentclass}`);
    args.push('-V', `fontsize=${config.pdf.fontsize}`);
    args.push('-V', `geometry:${config.pdf.geometry}`);
    if (config.pdf.linestretch !== 1) {
      args.push('-V', `linestretch=${config.pdf.linestretch}`);
    }
    if (config.pdf.numbersections) {
      args.push('--number-sections');
    }
    if (config.pdf.toc) {
      args.push('--toc');
    }
  } else if (format === 'docx') {
    if (config.docx.reference) {
      args.push('--reference-doc', config.docx.reference);
    }
    if (config.docx.toc) {
      args.push('--toc');
    }
  }

  return args;
}

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

/**
 * Write crossref.yaml if needed
 * @param {string} directory
 * @param {object} config
 */
function ensureCrossrefConfig(directory, config) {
  const crossrefPath = path.join(directory, 'crossref.yaml');

  if (!fs.existsSync(crossrefPath) && hasPandocCrossref()) {
    fs.writeFileSync(crossrefPath, YAML.stringify(config.crossref), 'utf-8');
  }
}

/**
 * Run pandoc build
 * @param {string} inputPath
 * @param {string} format
 * @param {object} config
 * @param {object} options
 * @returns {Promise<{outputPath: string, success: boolean, error?: string}>}
 */
export async function runPandoc(inputPath, format, config, options = {}) {
  const directory = path.dirname(inputPath);
  const baseName = config.title
    ? config.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50)
    : 'paper';

  const ext = format === 'tex' ? '.tex' : format === 'pdf' ? '.pdf' : '.docx';
  // Allow custom output path via options
  const outputPath = options.outputPath || path.join(directory, `${baseName}${ext}`);

  // Ensure crossref.yaml exists
  ensureCrossrefConfig(directory, config);

  const args = buildPandocArgs(format, config, outputPath);

  // Add crossref metadata file if exists
  const crossrefPath = path.join(directory, 'crossref.yaml');
  if (fs.existsSync(crossrefPath) && hasPandocCrossref()) {
    args.push('--metadata-file', crossrefPath);
  }

  // Input file
  args.push(inputPath);

  return new Promise((resolve) => {
    const pandoc = spawn('pandoc', args, {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    pandoc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pandoc.on('close', (code) => {
      if (code === 0) {
        resolve({ outputPath, success: true });
      } else {
        resolve({ outputPath, success: false, error: stderr || `Exit code ${code}` });
      }
    });

    pandoc.on('error', (err) => {
      resolve({ outputPath, success: false, error: err.message });
    });
  });
}

/**
 * Full build pipeline
 * @param {string} directory
 * @param {string[]} formats - ['pdf', 'docx', 'tex'] or ['all']
 * @param {object} options
 * @returns {Promise<{results: object[], paperPath: string, warnings: string[], forwardRefsResolved: number}>}
 */
export async function build(directory, formats = ['pdf', 'docx'], options = {}) {
  const warnings = [];
  let forwardRefsResolved = 0;

  // Check pandoc
  if (!hasPandoc()) {
    const instruction = getInstallInstructions('pandoc');
    throw new Error(`Pandoc not found. Install with: ${instruction}\nOr run: rev doctor`);
  }

  // Check LaTeX if PDF is requested
  if ((formats.includes('pdf') || formats.includes('all')) && !hasLatex()) {
    warnings.push(`LaTeX not found - PDF generation may fail. Install with: ${getInstallInstructions('latex')}`);
  }

  // Check pandoc-crossref
  if (!hasPandocCrossref()) {
    warnings.push('pandoc-crossref not found - figure/table numbering will not work');
  }

  // Load config (use passed config if provided, otherwise load from file)
  const config = options.config || loadConfig(directory);

  // Combine sections → paper.md
  const buildOptions = { ...options };
  const paperPath = combineSections(directory, config, buildOptions);
  forwardRefsResolved = buildOptions._forwardRefsResolved || 0;
  const refsAutoInjected = buildOptions._refsAutoInjected || false;

  // Expand 'all' to all formats
  if (formats.includes('all')) {
    formats = ['pdf', 'docx', 'tex'];
  }

  const results = [];

  for (const format of formats) {
    // Prepare format-specific version
    const preparedPath = prepareForFormat(paperPath, format, config, options);

    // Run pandoc
    const result = await runPandoc(preparedPath, format, config, options);
    results.push({ format, ...result });

    // Clean up temp file
    try {
      fs.unlinkSync(preparedPath);
    } catch {
      // Ignore cleanup errors
    }
  }

  return { results, paperPath, warnings, forwardRefsResolved, refsAutoInjected };
}

/**
 * Get build status summary
 * @param {object[]} results
 * @returns {string}
 */
export function formatBuildResults(results) {
  const lines = [];

  for (const r of results) {
    if (r.success) {
      lines.push(`  ${r.format.toUpperCase()}: ${path.basename(r.outputPath)}`);
    } else {
      lines.push(`  ${r.format.toUpperCase()}: FAILED - ${r.error}`);
    }
  }

  return lines.join('\n');
}
