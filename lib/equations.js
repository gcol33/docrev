/**
 * Equation extraction and conversion utilities
 * Handle LaTeX math in Markdown ↔ Word workflows
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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

    // Handle display math blocks ($$...$$)
    if (line.includes('$$')) {
      const parts = line.split('$$');

      if (!inDisplayMath && parts.length >= 3) {
        // Single-line display math: $$content$$
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
      } else if (!inDisplayMath) {
        // Start of multi-line display math
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
      }
      continue;
    }

    if (inDisplayMath) {
      displayMathContent += '\n' + line;
      continue;
    }

    // Handle inline math ($...$)
    // Careful not to match $$ or escaped \$
    const inlinePattern = /(?<!\$)\$(?!\$)([^$\n]+)\$(?!\$)/g;
    let match;
    while ((match = inlinePattern.exec(line)) !== null) {
      equations.push({
        type: 'inline',
        content: match[1].trim(),
        line: lineNum + 1,
        file,
      });
    }
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
