/**
 * Equation extraction and conversion utilities
 * Handle LaTeX math in Markdown ↔ Word workflows
 *
 * Supports:
 * - Extract LaTeX equations from Markdown
 * - Extract equations from Word documents (OMML → LaTeX via Pandoc)
 * - Convert Markdown with equations to Word (LaTeX → MathML)
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import AdmZip from 'adm-zip';
import { parseString } from 'xml2js';

const execAsync = promisify(exec);
const parseXml = promisify(parseString);

// Dynamic import for mathml-to-latex (ESM)
let MathMLToLaTeX = null;
async function getMathMLConverter() {
  if (!MathMLToLaTeX) {
    try {
      const module = await import('mathml-to-latex');
      MathMLToLaTeX = module.MathMLToLaTeX;
    } catch {
      return null;
    }
  }
  return MathMLToLaTeX;
}

/**
 * Extract all equations from markdown text
 * @param {string} text
 * @param {string} file - Source file name
 * @returns {Array<{type: 'inline'|'display', content: string, line: number, file: string}>}
 */
export function extractEquations(text, file = '') {
  const equations = [];
  const lines = text.split('\n');

  let inDisplayMath = false;
  let displayMathStart = 0;
  let displayMathContent = '';

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Skip code blocks
    if (line.trim().startsWith('```')) continue;

    // Handle inline math ($...$) in a segment of text
    // Careful not to match $$ or escaped \$
    const inlinePattern = /(?<![\$\\])\$(?!\$)([^$\n]+)\$(?!\$)/g;
    const extractInline = (segment) => {
      let match;
      inlinePattern.lastIndex = 0;
      while ((match = inlinePattern.exec(segment)) !== null) {
        equations.push({
          type: 'inline',
          content: match[1].trim(),
          line: lineNum + 1,
          file,
        });
      }
    };

    // Handle display math blocks ($$...$$)
    if (line.includes('$$')) {
      const parts = line.split('$$');

      if (!inDisplayMath && parts.length >= 3) {
        // Single-line display math: $$content$$
        // Also extract inline math from surrounding text
        extractInline(parts[0]); // Text before $$
        for (let i = 1; i < parts.length; i += 2) {
          if (parts[i].trim()) {
            equations.push({
              type: 'display',
              content: parts[i].trim(),
              line: lineNum + 1,
              file,
            });
          }
        }
        // Extract inline from text after the last $$
        if (parts.length % 2 === 1 && parts[parts.length - 1]) {
          extractInline(parts[parts.length - 1]);
        }
      } else if (!inDisplayMath) {
        // Start of multi-line display math
        extractInline(parts[0]); // Text before $$
        inDisplayMath = true;
        displayMathStart = lineNum + 1;
        displayMathContent = parts[1] || '';
      } else {
        // End of multi-line display math
        inDisplayMath = false;
        displayMathContent += '\n' + (parts[0] || '');
        if (displayMathContent.trim()) {
          equations.push({
            type: 'display',
            content: displayMathContent.trim(),
            line: displayMathStart,
            file,
          });
        }
        displayMathContent = '';
        // Text after $$ on closing line
        if (parts[1]) {
          extractInline(parts[1]);
        }
      }
      continue;
    }

    if (inDisplayMath) {
      displayMathContent += '\n' + line;
      continue;
    }

    // No display math on this line - extract inline math
    extractInline(line);
  }

  return equations;
}

/**
 * Generate a markdown document with numbered equations
 * Useful for creating an equation reference sheet
 * @param {Array} equations
 * @returns {string}
 */
export function generateEquationSheet(equations) {
  const lines = [];
  lines.push('# Equations');
  lines.push('');

  let displayNum = 0;
  let inlineNum = 0;

  // Group by file
  const byFile = new Map();
  for (const eq of equations) {
    if (!byFile.has(eq.file)) {
      byFile.set(eq.file, []);
    }
    byFile.get(eq.file).push(eq);
  }

  for (const [file, fileEqs] of byFile) {
    if (file) {
      lines.push(`## ${file}`);
      lines.push('');
    }

    for (const eq of fileEqs) {
      if (eq.type === 'display') {
        displayNum++;
        lines.push(`### Equation ${displayNum} (line ${eq.line})`);
        lines.push('');
        lines.push('```latex');
        lines.push(eq.content);
        lines.push('```');
        lines.push('');
        lines.push('$$' + eq.content + '$$');
        lines.push('');
      } else {
        inlineNum++;
        lines.push(`- **Inline ${inlineNum}** (line ${eq.line}): \`$${eq.content}$\` → $${eq.content}$`);
      }
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`Total: ${displayNum} display equations, ${inlineNum} inline equations`);

  return lines.join('\n');
}

/**
 * Convert markdown with equations to Word using pandoc
 * @param {string} inputPath - Input markdown file
 * @param {string} outputPath - Output docx file
 * @param {object} options
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function convertToWord(inputPath, outputPath, options = {}) {
  const { preserveLatex = false } = options;

  // Check pandoc is available
  try {
    await execAsync('pandoc --version');
  } catch {
    return { success: false, message: 'Pandoc not found. Install pandoc first.' };
  }

  // Build pandoc command
  // Use --mathml for better equation rendering in Word
  const args = [
    'pandoc',
    `"${inputPath}"`,
    '-o', `"${outputPath}"`,
    '--mathml',  // Better equation support in Word
  ];

  if (preserveLatex) {
    // Keep raw LaTeX (less compatible but preserves source)
    args.push('--wrap=preserve');
  }

  try {
    await execAsync(args.join(' '));
    return { success: true, message: `Created ${outputPath}` };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * Create a simple equations-only document
 * @param {string} inputPath - Source markdown
 * @param {string} outputPath - Output path (md or docx)
 * @returns {Promise<{success: boolean, message: string, stats: object}>}
 */
export async function createEquationsDoc(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) {
    return { success: false, message: `File not found: ${inputPath}`, stats: null };
  }

  const text = fs.readFileSync(inputPath, 'utf-8');
  const equations = extractEquations(text, path.basename(inputPath));

  if (equations.length === 0) {
    return { success: false, message: 'No equations found', stats: { display: 0, inline: 0 } };
  }

  const sheet = generateEquationSheet(equations);
  const stats = {
    display: equations.filter(e => e.type === 'display').length,
    inline: equations.filter(e => e.type === 'inline').length,
  };

  const ext = path.extname(outputPath).toLowerCase();

  if (ext === '.docx') {
    // Write temp md, convert to docx
    const tempMd = outputPath.replace('.docx', '.tmp.md');
    fs.writeFileSync(tempMd, sheet, 'utf-8');
    const result = await convertToWord(tempMd, outputPath);
    fs.unlinkSync(tempMd);
    return { ...result, stats };
  } else {
    // Write as markdown
    fs.writeFileSync(outputPath, sheet, 'utf-8');
    return { success: true, message: `Created ${outputPath}`, stats };
  }
}

/**
 * Get equation statistics for a file or directory
 * @param {string[]} files
 * @returns {object}
 */
export function getEquationStats(files) {
  let totalDisplay = 0;
  let totalInline = 0;
  const byFile = [];

  for (const file of files) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf-8');
    const equations = extractEquations(text, path.basename(file));

    const display = equations.filter(e => e.type === 'display').length;
    const inline = equations.filter(e => e.type === 'inline').length;

    totalDisplay += display;
    totalInline += inline;

    if (display > 0 || inline > 0) {
      byFile.push({ file: path.basename(file), display, inline });
    }
  }

  return {
    total: totalDisplay + totalInline,
    display: totalDisplay,
    inline: totalInline,
    byFile,
  };
}

/**
 * Extract equations from a Word document using Pandoc
 * Converts OMML (Office Math Markup) to LaTeX
 *
 * @param {string} docxPath - Path to Word document
 * @returns {Promise<{success: boolean, equations: Array<{type: string, latex: string, position: number}>, error?: string}>}
 */
export async function extractEquationsFromWord(docxPath) {
  if (!fs.existsSync(docxPath)) {
    return { success: false, equations: [], error: `File not found: ${docxPath}` };
  }

  // Method 1: Use Pandoc to convert docx to markdown with LaTeX math
  try {
    const { stdout } = await execAsync(
      `pandoc "${docxPath}" -t markdown --wrap=none`,
      { maxBuffer: 50 * 1024 * 1024 }
    );

    // Extract equations from the markdown output
    const equations = extractEquations(stdout, path.basename(docxPath));

    return {
      success: true,
      equations: equations.map((eq, i) => ({
        type: eq.type,
        latex: eq.content,
        position: i,
        line: eq.line,
      })),
    };
  } catch (err) {
    // Pandoc failed, try fallback method
    return extractEquationsFromWordDirect(docxPath);
  }
}

/**
 * Direct OMML extraction from Word document (fallback if Pandoc fails)
 * Parses document.xml for <m:oMath> elements and attempts conversion
 *
 * @param {string} docxPath
 * @returns {Promise<{success: boolean, equations: Array, error?: string}>}
 */
async function extractEquationsFromWordDirect(docxPath) {
  try {
    const zip = new AdmZip(docxPath);
    const documentEntry = zip.getEntry('word/document.xml');

    if (!documentEntry) {
      return { success: false, equations: [], error: 'Invalid docx: no document.xml' };
    }

    const documentXml = zip.readAsText(documentEntry);

    // Find all OMML equations (<m:oMath> or <m:oMathPara>)
    const ommlPattern = /<m:oMath[^>]*>[\s\S]*?<\/m:oMath>/gi;
    const matches = documentXml.match(ommlPattern) || [];

    if (matches.length === 0) {
      return { success: true, equations: [], message: 'No equations found' };
    }

    // Try to convert OMML to LaTeX via MathML intermediate
    const Converter = await getMathMLConverter();
    const equations = [];

    for (let i = 0; i < matches.length; i++) {
      const omml = matches[i];

      // Attempt OMML → MathML → LaTeX conversion
      // Note: This is a simplified approach; full OMML→MathML requires XSLT
      try {
        const latex = await ommlToLatex(omml, Converter);
        if (latex) {
          equations.push({
            type: isDisplayMath(omml) ? 'display' : 'inline',
            latex,
            position: i,
            raw: omml.substring(0, 100) + '...',
          });
        }
      } catch {
        // Keep raw OMML reference if conversion fails
        equations.push({
          type: 'unknown',
          latex: null,
          position: i,
          raw: omml.substring(0, 100) + '...',
          error: 'Conversion failed',
        });
      }
    }

    return { success: true, equations };
  } catch (err) {
    return { success: false, equations: [], error: err.message };
  }
}

/**
 * Check if OMML represents display math (equation on its own line)
 */
function isDisplayMath(omml) {
  return omml.includes('<m:oMathPara') || omml.includes('m:jc');
}

/**
 * Convert OMML to LaTeX (simplified approach)
 * For complex equations, Pandoc method is more reliable
 *
 * @param {string} omml - OMML XML string
 * @param {Function} Converter - MathMLToLaTeX converter
 * @returns {Promise<string|null>}
 */
async function ommlToLatex(omml, Converter) {
  if (!Converter) return null;

  // Extract key elements from OMML and build approximate MathML
  // This is a simplified conversion - not all OMML features are supported
  try {
    // Build basic MathML from OMML structure
    const mathml = ommlToMathML(omml);
    if (!mathml) return null;

    // Convert MathML to LaTeX
    const latex = Converter.convert(mathml);
    return latex;
  } catch {
    return null;
  }
}

/**
 * Convert OMML to MathML (simplified)
 * Maps common OMML elements to MathML equivalents
 */
function ommlToMathML(omml) {
  // Remove namespace prefixes for easier parsing
  let xml = omml
    .replace(/<m:/g, '<')
    .replace(/<\/m:/g, '</')
    .replace(/<w:/g, '<w_')
    .replace(/<\/w:/g, '</w_');

  // Map OMML elements to MathML
  const mappings = [
    [/<oMath[^>]*>/gi, '<math xmlns="http://www.w3.org/1998/Math/MathML">'],
    [/<\/oMath>/gi, '</math>'],
    [/<r>/gi, '<mi>'],
    [/<\/r>/gi, '</mi>'],
    [/<t>/gi, ''],
    [/<\/t>/gi, ''],
    [/<f>/gi, '<mfrac>'],
    [/<\/f>/gi, '</mfrac>'],
    [/<num>/gi, '<mrow>'],
    [/<\/num>/gi, '</mrow>'],
    [/<den>/gi, '<mrow>'],
    [/<\/den>/gi, '</mrow>'],
    [/<sup>/gi, '<msup><mrow>'],
    [/<\/sup>/gi, '</mrow></msup>'],
    [/<sub>/gi, '<msub><mrow>'],
    [/<\/sub>/gi, '</mrow></msub>'],
    [/<rad>/gi, '<msqrt>'],
    [/<\/rad>/gi, '</msqrt>'],
    [/<e>/gi, '<mrow>'],
    [/<\/e>/gi, '</mrow>'],
    // Remove elements we don't map
    [/<rPr>[\s\S]*?<\/rPr>/gi, ''],
    [/<ctrlPr>[\s\S]*?<\/ctrlPr>/gi, ''],
    [/<w_[^>]*>[\s\S]*?<\/w_[^>]*>/gi, ''],
    [/<[^>]*\/>/gi, ''], // Self-closing tags
  ];

  for (const [pattern, replacement] of mappings) {
    xml = xml.replace(pattern, replacement);
  }

  // Clean up any remaining unrecognized tags
  xml = xml.replace(/<[a-zA-Z][^>]*>/g, '').replace(/<\/[a-zA-Z]+>/g, '');

  // Wrap in math if not already
  if (!xml.includes('<math')) {
    xml = `<math xmlns="http://www.w3.org/1998/Math/MathML">${xml}</math>`;
  }

  return xml;
}

/**
 * Get equation summary from Word document
 * @param {string} docxPath
 * @returns {Promise<{count: number, display: number, inline: number, converted: number}>}
 */
export async function getWordEquationStats(docxPath) {
  const result = await extractEquationsFromWord(docxPath);

  if (!result.success) {
    return { count: 0, display: 0, inline: 0, converted: 0, error: result.error };
  }

  const display = result.equations.filter(e => e.type === 'display').length;
  const inline = result.equations.filter(e => e.type === 'inline').length;
  const converted = result.equations.filter(e => e.latex).length;

  return {
    count: result.equations.length,
    display,
    inline,
    converted,
  };
}
