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
import { processSlideMarkdown, hasSlideSyntax } from './slides.js';
import { generatePptxTemplate, templateNeedsRegeneration, injectMediaIntoPptx, injectSlideNumbers, applyThemeFonts, applyCentering, applyBuildupColors } from './pptx-template.js';
import { getThemePath, getThemeNames, PPTX_THEMES } from './pptx-themes.js';
import { runPostprocess } from './postprocess.js';
import { hasPandoc, hasPandocCrossref, hasLatex } from './dependencies.js';
import { buildImageRegistry, writeImageRegistry } from './image-registry.js';

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
  // Slide formats
  beamer: {
    theme: 'default',
    colortheme: null,
    fonttheme: null,
    aspectratio: null, // '169' for 16:9, '43' for 4:3
    navigation: null, // 'horizontal', 'vertical', 'frame', 'empty'
    section: true, // section divider slides
    notes: 'show', // 'show' (presenter view), 'only' (notes only), 'hide', or false
    fit_images: true, // scale images to fit within slide bounds
  },
  pptx: {
    theme: 'default', // Built-in theme: default, dark, academic, minimal, corporate
    reference: null, // Custom reference-doc (overrides theme)
    media: null, // directory with logo images (e.g., logo-left.png, logo-right.png)
  },
  // Table formatting
  tables: {
    nowrap: [], // Column headers to apply nowrap formatting (converts Normal() → $\mathcal{N}()$ etc.)
  },
  // Postprocess scripts
  postprocess: {
    pdf: null,
    docx: null,
    tex: null,
    pptx: null,
    beamer: null,
    all: null, // Runs after any format
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
      beamer: { ...DEFAULT_CONFIG.beamer, ...userConfig.beamer },
      pptx: { ...DEFAULT_CONFIG.pptx, ...userConfig.pptx },
      tables: { ...DEFAULT_CONFIG.tables, ...userConfig.tables },
      postprocess: { ...DEFAULT_CONFIG.postprocess, ...userConfig.postprocess },
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
 * Process markdown tables to apply nowrap formatting to specified columns.
 * Converts distribution notation (Normal, Student-t, Gamma) to LaTeX math.
 * @param {string} content - Markdown content
 * @param {object} tablesConfig - tables config from rev.yaml
 * @param {string} format - output format (pdf, docx, etc.)
 * @returns {string} processed content
 */
export function processTablesForFormat(content, tablesConfig, format) {
  // Only process for PDF/TeX output
  if (format !== 'pdf' && format !== 'tex') {
    return content;
  }

  // Check if we have nowrap columns configured
  if (!tablesConfig?.nowrap?.length) {
    return content;
  }

  const nowrapPatterns = tablesConfig.nowrap.map((p) => p.toLowerCase());

  // Match pipe tables: header row, separator row, body rows
  // Header: | Col1 | Col2 | Col3 |
  // Separator: |:-----|:-----|:-----|
  // Body: | val1 | val2 | val3 |
  const tableRegex = /^(\|[^\n]+\|\r?\n\|[-:| ]+\|\r?\n)((?:\|[^\n]+\|\r?\n?)+)/gm;

  return content.replace(tableRegex, (match, headerAndSep, body) => {
    // Split header from separator
    const lines = headerAndSep.split(/\r?\n/);
    const headerLine = lines[0];

    // Parse header cells to find nowrap column indices
    const headerCells = headerLine
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim().toLowerCase());

    const nowrapCols = [];
    headerCells.forEach((cell, i) => {
      if (nowrapPatterns.some((p) => cell.includes(p))) {
        nowrapCols.push(i);
      }
    });

    // If no nowrap columns found in this table, return unchanged
    if (nowrapCols.length === 0) {
      return match;
    }

    // Process body rows
    const bodyLines = body.split(/\r?\n/).filter((l) => l.trim());
    const processedBody = bodyLines
      .map((row) => {
        // Split row into cells, keeping the pipe structure
        const cells = row.split('|');
        // cells[0] is empty (before first |), cells[last] is empty (after last |)

        nowrapCols.forEach((colIdx) => {
          const cellIdx = colIdx + 1; // Account for empty first element
          if (cells[cellIdx] !== undefined) {
            const cellContent = cells[cellIdx].trim();

            // Skip if empty, already math, or already has LaTeX commands
            if (!cellContent || cellContent.startsWith('$') || cellContent.startsWith('\\')) {
              return;
            }

            // Convert distribution notation to LaTeX math
            // Order matters: compound names (Half-Normal) must come before simple names (Normal)
            let processed = cellContent;

            // Half-Normal(x) → $\text{Half-Normal}(x)$ (must come before Normal)
            processed = processed.replace(/Half-Normal\(([^)]+)\)/g, '$\\text{Half-Normal}($1)$');

            // Normal(x, y) → $\mathcal{N}(x, y)$
            processed = processed.replace(/Normal\(([^)]+)\)/g, '$\\mathcal{N}($1)$');

            // Student-t(df, loc, scale) → $t_{df}(loc, scale)$
            processed = processed.replace(/Student-t\((\d+),\s*([^)]+)\)/g, '$t_{$1}($2)$');

            // Gamma(a, b) → $\text{Gamma}(a, b)$
            processed = processed.replace(/Gamma\(([^)]+)\)/g, '$\\text{Gamma}($1)$');

            // Exponential(x) → $\text{Exp}(x)$
            processed = processed.replace(/Exponential\(([^)]+)\)/g, '$\\text{Exp}($1)$');

            // Update cell with padding
            cells[cellIdx] = ` ${processed} `;
          }
        });

        return cells.join('|');
      })
      .join('\n');

    return headerAndSep + processedBody + '\n';
  });
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

    // Process tables for nowrap columns (convert Normal() → $\mathcal{N}()$ etc.)
    content = processTablesForFormat(content, config.tables, format);
  } else if (format === 'docx') {
    // Strip track changes, optionally keep comments
    content = stripAnnotations(content, { keepComments: config.docx.keepComments });

    // Convert @fig:label to "Figure 1" for Word readers
    content = convertDynamicRefsToDisplay(content, registry);
  } else if (format === 'beamer' || format === 'pptx') {
    // Strip annotations for slide output
    content = stripAnnotations(content);

    // Process slide syntax (::: step, ::: notes)
    if (hasSlideSyntax(content)) {
      content = processSlideMarkdown(content, format);
    }
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
  } else if (format === 'beamer') {
    args.push('-t', 'beamer');
  } else if (format === 'pptx') {
    args.push('-t', 'pptx');
  }

  // Output file (use basename since we set cwd to directory in runPandoc)
  args.push('-o', path.basename(outputPath));

  // Crossref filter (if available) - skip for slides
  if (hasPandocCrossref() && format !== 'beamer' && format !== 'pptx') {
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
  } else if (format === 'beamer') {
    // Beamer slide options
    const beamer = config.beamer || {};
    if (beamer.theme) {
      args.push('-V', `theme=${beamer.theme}`);
    }
    if (beamer.colortheme) {
      args.push('-V', `colortheme=${beamer.colortheme}`);
    }
    if (beamer.fonttheme) {
      args.push('-V', `fonttheme=${beamer.fonttheme}`);
    }
    if (beamer.aspectratio) {
      args.push('-V', `aspectratio=${beamer.aspectratio}`);
    }
    if (beamer.navigation) {
      args.push('-V', `navigation=${beamer.navigation}`);
    }
    // Speaker notes - default to 'show' which creates presenter view PDF
    // Options: 'show' (dual screen), 'only' (notes only), 'hide' (no notes), false (disabled)
    const notesMode = beamer.notes !== undefined ? beamer.notes : 'show';
    if (notesMode && notesMode !== 'hide' && notesMode !== false) {
      args.push('-V', `classoption=notes=${notesMode}`);
    }
    // Fit images within slide bounds (default: true)
    if (beamer.fit_images !== false) {
      const fitImagesHeader = `\makeatletter
\def\maxwidth{\ifdim\Gin@nat@width>\linewidth\linewidth\else\Gin@nat@width\fi}
\def\maxheight{\ifdim\Gin@nat@height>0.75\textheight 0.75\textheight\else\Gin@nat@height\fi}
\makeatother
\setkeys{Gin}{width=\maxwidth,height=\maxheight,keepaspectratio}`;
      args.push('-V', `header-includes=${fitImagesHeader}`);
    }
    // Slides need standalone
    args.push('-s');
  } else if (format === 'pptx') {
    // PowerPoint options - handled separately in preparePptxTemplate
    // Reference doc is set by caller after template generation
  }

  return args;
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

  // Map format to file extension
  const extMap = {
    tex: '.tex',
    pdf: '.pdf',
    docx: '.docx',
    beamer: '.pdf', // beamer outputs PDF
    pptx: '.pptx',
  };
  const ext = extMap[format] || '.pdf';

  // For beamer, use -slides suffix to distinguish from regular PDF
  const suffix = format === 'beamer' ? '-slides' : '';
  // Allow custom output path via options
  const outputPath = options.outputPath || path.join(directory, `${baseName}${suffix}${ext}`);

  // Ensure crossref.yaml exists
  ensureCrossrefConfig(directory, config);

  const args = buildPandocArgs(format, config, outputPath);

  // Handle PPTX reference template and themes
  let pptxMediaDir = null;
  if (format === 'pptx') {
    const pptx = config.pptx || {};

    // Determine media directory (default: pptx/media or slides/media)
    let mediaDir = pptx.media;
    if (!mediaDir) {
      if (fs.existsSync(path.join(directory, 'pptx', 'media'))) {
        mediaDir = path.join(directory, 'pptx', 'media');
      } else if (fs.existsSync(path.join(directory, 'slides', 'media'))) {
        mediaDir = path.join(directory, 'slides', 'media');
      }
    } else if (!path.isAbsolute(mediaDir)) {
      mediaDir = path.join(directory, mediaDir);
    }
    pptxMediaDir = mediaDir;

    // Determine reference doc: custom reference overrides theme
    let referenceDoc = null;
    if (pptx.reference && fs.existsSync(path.join(directory, pptx.reference))) {
      // Custom reference doc takes precedence
      referenceDoc = path.join(directory, pptx.reference);
    } else {
      // Use built-in theme (default: 'default')
      const themeName = pptx.theme || 'default';
      const themePath = getThemePath(themeName);
      if (themePath && fs.existsSync(themePath)) {
        referenceDoc = themePath;
      }
    }

    if (referenceDoc) {
      args.push('--reference-doc', referenceDoc);
    }

    // Add color filter for PPTX (handles [text]{color=#RRGGBB} syntax)
    const colorFilterPath = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), 'pptx-color-filter.lua');
    if (fs.existsSync(colorFilterPath)) {
      args.push('--lua-filter', colorFilterPath);
    }
  }

  // Add crossref metadata file if exists (skip for slides - they don't use crossref)
  if (format !== 'beamer' && format !== 'pptx') {
    const crossrefPath = path.join(directory, 'crossref.yaml');
    if (fs.existsSync(crossrefPath) && hasPandocCrossref()) {
      // Use basename since we set cwd to directory
      args.push('--metadata-file', 'crossref.yaml');
    }
  }

  // Input file (use basename since we set cwd to directory)
  args.push(path.basename(inputPath));

  return new Promise((resolve) => {
    const pandoc = spawn('pandoc', args, {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    pandoc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    pandoc.on('close', async (code) => {
      if (code === 0) {
        // For PPTX, post-process to add slide numbers, buildup colors, and logos
        if (format === 'pptx') {
          try {
            // Inject slide numbers into content slides only
            await injectSlideNumbers(outputPath);
          } catch (e) {
            // Slide number injection failed but output was created
          }
          try {
            // Apply colors (default text color, title color, buildup greying)
            const pptxConfig = config.pptx || {};
            const colorsConfig = pptxConfig.colors || {};
            const buildupConfig = pptxConfig.buildup || {};
            // Merge colors and buildup config for applyBuildupColors
            const colorConfig = {
              default: colorsConfig.default,
              title: colorsConfig.title,
              grey: buildupConfig.grey,
              accent: buildupConfig.accent,
              enabled: buildupConfig.enabled
            };
            await applyBuildupColors(outputPath, colorConfig);
          } catch (e) {
            // Color application failed but output was created
          }
          // Inject logos into cover slide (if media dir configured)
          if (pptxMediaDir) {
            try {
              await injectMediaIntoPptx(outputPath, pptxMediaDir);
            } catch (e) {
              // Logo injection failed but output was created
            }
          }
        }

        // Run user postprocess scripts
        const postResult = await runPostprocess(outputPath, format, config, options);
        if (!postResult.success && options.verbose) {
          console.error(`Postprocess warning: ${postResult.error}`);
        }

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

  // Build and save image registry when DOCX is being built
  // This allows import to restore proper image syntax from Word documents
  if (formats.includes('docx')) {
    const paperContent = fs.readFileSync(paperPath, 'utf-8');
    const crossrefReg = buildRegistry(directory, config.sections);
    const imageReg = buildImageRegistry(paperContent, crossrefReg);
    if (imageReg.figures.length > 0) {
      writeImageRegistry(directory, imageReg);
    }
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
