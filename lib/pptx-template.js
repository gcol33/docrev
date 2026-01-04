/**
 * PPTX template generation
 *
 * Creates a pandoc-compatible reference PPTX with:
 * - Dynamic author/footer from config
 * - Media loaded from pptx/media/ folder
 * - Theme colors and styles
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Generate a PPTX reference template
 * @param {Object} options
 * @param {string} options.outputPath - Where to save the template
 * @param {string} options.author - Author name for footer
 * @param {string} options.mediaDir - Directory containing media files (logos, backgrounds)
 * @param {string} [options.baseTemplate] - Optional base template to extend
 * @returns {Promise<string>} Path to generated template
 */
export async function generatePptxTemplate(options) {
  const { outputPath, author = '', mediaDir = null, baseTemplate = null } = options;

  // Create temp directory
  const tempDir = join(dirname(outputPath), '.pptx-temp-' + Date.now());
  mkdirSync(tempDir, { recursive: true });

  try {
    // If we have a base template, extract it
    if (baseTemplate && existsSync(baseTemplate)) {
      await extractPptx(baseTemplate, tempDir);
    } else {
      // Get pandoc's default template
      const defaultTemplate = join(tempDir, 'default.pptx');
      execSync(`pandoc --print-default-data-file reference.pptx > "${defaultTemplate}"`, { stdio: 'pipe' });
      await extractPptx(defaultTemplate, tempDir);
      unlinkSync(defaultTemplate);
    }

    // Update footer placeholder with author name
    if (author) {
      updateFooterAuthor(tempDir, author);
    }

    // Inject media files from mediaDir
    if (mediaDir && existsSync(mediaDir)) {
      await injectMedia(tempDir, mediaDir);
    }

    // Repackage as PPTX
    await createPptx(tempDir, outputPath);

    return outputPath;
  } finally {
    // Cleanup temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Extract PPTX to directory
 */
async function extractPptx(pptxPath, destDir) {
  // Use PowerShell on Windows, unzip on Unix
  // PowerShell requires .zip extension, so copy with rename
  if (process.platform === 'win32') {
    const zipPath = pptxPath.replace(/\.pptx$/i, '.zip');
    const content = readFileSync(pptxPath);
    writeFileSync(zipPath, content);
    try {
      execSync(`powershell -Command "Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'pipe' });
    } finally {
      try { unlinkSync(zipPath); } catch { /* ignore */ }
    }
  } else {
    execSync(`unzip -q "${pptxPath}" -d "${destDir}"`, { stdio: 'pipe' });
  }
}

/**
 * Create PPTX from directory
 */
async function createPptx(srcDir, pptxPath) {
  // Use Python for proper ZIP creation (PowerShell's Compress-Archive doesn't work well for OOXML)
  const script = `
import zipfile
import os
import sys

src = sys.argv[1]
dst = sys.argv[2]

with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src):
        for f in files:
            filepath = os.path.join(root, f)
            arcname = os.path.relpath(filepath, src)
            zf.write(filepath, arcname)
`;

  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
  execSync(`${pythonCmd} -c "${script.replace(/"/g, '\\"').replace(/\n/g, ';')}" "${srcDir}" "${pptxPath}"`, { stdio: 'pipe' });
}

/**
 * Recursively remove directory
 */
function rmSync(path, options) {
  const fs = require('node:fs');
  if (fs.rmSync) {
    fs.rmSync(path, options);
  } else {
    // Fallback for older Node
    const items = fs.readdirSync(path);
    for (const item of items) {
      const itemPath = join(path, item);
      if (fs.statSync(itemPath).isDirectory()) {
        rmSync(itemPath, options);
      } else {
        fs.unlinkSync(itemPath);
      }
    }
    fs.rmdirSync(path);
  }
}

/**
 * Update footer text in all slide layouts
 */
function updateFooterAuthor(tempDir, author) {
  const layoutsDir = join(tempDir, 'ppt', 'slideLayouts');
  if (!existsSync(layoutsDir)) return;

  const layouts = readdirSync(layoutsDir).filter(f => f.endsWith('.xml'));

  for (const layout of layouts) {
    const layoutPath = join(layoutsDir, layout);
    let content = readFileSync(layoutPath, 'utf-8');

    // Replace footer placeholder text
    // Pattern: <a:t>...</a:t> inside Footer Placeholder
    content = content.replace(
      /(<p:sp[^>]*>(?:[^<]|<(?!\/p:sp>))*?name="Footer Placeholder[^"]*"[^>]*>(?:[^<]|<(?!\/p:sp>))*?<a:t>)[^<]*(<\/a:t>)/g,
      `$1${escapeXml(author)}$2`
    );

    writeFileSync(layoutPath, content);
  }

  // Also update slide master
  const masterPath = join(tempDir, 'ppt', 'slideMasters', 'slideMaster1.xml');
  if (existsSync(masterPath)) {
    let content = readFileSync(masterPath, 'utf-8');
    content = content.replace(
      /(<p:sp[^>]*>(?:[^<]|<(?!\/p:sp>))*?name="Footer Placeholder[^"]*"[^>]*>(?:[^<]|<(?!\/p:sp>))*?<a:t>)[^<]*(<\/a:t>)/g,
      `$1${escapeXml(author)}$2`
    );
    writeFileSync(masterPath, content);
  }
}

/**
 * Inject media files into layouts
 */
async function injectMedia(tempDir, mediaDir) {
  const mediaFiles = readdirSync(mediaDir).filter(f => {
    const ext = extname(f).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.emf'].includes(ext);
  });

  if (mediaFiles.length === 0) return;

  // Ensure ppt/media exists
  const pptMediaDir = join(tempDir, 'ppt', 'media');
  mkdirSync(pptMediaDir, { recursive: true });

  // Copy media files and track them
  const mediaRefs = [];
  for (const file of mediaFiles) {
    const srcPath = join(mediaDir, file);
    const destPath = join(pptMediaDir, file);

    // Copy file
    const content = readFileSync(srcPath);
    writeFileSync(destPath, content);

    // Determine position from filename or metadata
    // Convention: logo-left.png, logo-right.png, background.png
    const name = basename(file, extname(file)).toLowerCase();
    const position = parseMediaPosition(name, srcPath);

    mediaRefs.push({
      file,
      position,
    });
  }

  // Add media to layouts
  addMediaToLayouts(tempDir, mediaRefs);
}

/**
 * Parse media position from filename
 * Convention:
 *   logo-left.png, left-logo.png -> bottom left
 *   logo-right.png, right-logo.png -> bottom right
 *   background.png -> fullscreen background
 */
function parseMediaPosition(name, filePath) {
  // Check filename for hints
  if (name.includes('left')) {
    return { type: 'logo', position: 'left', x: 0, y: 5904608, cx: 3794408, cy: 954349 };
  }
  if (name.includes('right')) {
    return { type: 'logo', position: 'right', x: 9492000, y: 5742001, cx: 2700000, cy: 1115999 };
  }
  if (name.includes('background') || name.includes('bg')) {
    return { type: 'background', position: 'fill' };
  }

  // Default: bottom right corner
  return { type: 'logo', position: 'right', x: 9492000, y: 5742001, cx: 2700000, cy: 1115999 };
}

/**
 * Add media references to slide layouts
 */
function addMediaToLayouts(tempDir, mediaRefs) {
  const layoutsDir = join(tempDir, 'ppt', 'slideLayouts');
  const relsDir = join(layoutsDir, '_rels');

  if (!existsSync(layoutsDir)) return;

  // Process key layouts: 1 (Title), 2 (Title and Content), 3 (Section Header)
  const layoutsToUpdate = ['slideLayout1.xml', 'slideLayout2.xml', 'slideLayout3.xml'];

  for (const layoutFile of layoutsToUpdate) {
    const layoutPath = join(layoutsDir, layoutFile);
    const relsPath = join(relsDir, layoutFile + '.rels');

    if (!existsSync(layoutPath)) continue;

    // Read existing relationships
    let relsContent = existsSync(relsPath)
      ? readFileSync(relsPath, 'utf-8')
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';

    // Find next rId
    const rIdMatches = relsContent.matchAll(/Id="rId(\d+)"/g);
    let maxRId = 0;
    for (const m of rIdMatches) {
      maxRId = Math.max(maxRId, parseInt(m[1]));
    }

    // Add media relationships
    const newRels = [];
    for (let i = 0; i < mediaRefs.length; i++) {
      const ref = mediaRefs[i];
      const rId = `rId${maxRId + i + 1}`;
      ref.rId = rId;
      newRels.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${ref.file}"/>`);
    }

    // Insert new relationships
    relsContent = relsContent.replace('</Relationships>', newRels.join('') + '</Relationships>');

    // Ensure _rels directory exists
    mkdirSync(relsDir, { recursive: true });
    writeFileSync(relsPath, relsContent);

    // Add picture elements to layout
    let layoutContent = readFileSync(layoutPath, 'utf-8');

    // Find insertion point (after </p:grpSpPr>)
    const insertPoint = layoutContent.indexOf('</p:grpSpPr>');
    if (insertPoint === -1) continue;

    // Generate picture XML for each media
    const picXml = [];
    let picId = 100; // Start high to avoid conflicts

    for (const ref of mediaRefs) {
      if (ref.position.type === 'logo') {
        picXml.push(generatePictureXml(ref, picId++));
      }
    }

    // Insert pictures
    layoutContent = layoutContent.slice(0, insertPoint + 12) + picXml.join('') + layoutContent.slice(insertPoint + 12);

    writeFileSync(layoutPath, layoutContent);
  }
}

/**
 * Generate p:pic XML for a media reference
 */
function generatePictureXml(ref, id) {
  const pos = ref.position;
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${pos.position === 'left' ? 'Logo Left' : 'Logo Right'}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr userDrawn="1"/></p:nvPicPr><p:blipFill><a:blip r:embed="${ref.rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${pos.x}" y="${pos.y}"/><a:ext cx="${pos.cx}" cy="${pos.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

/**
 * Escape XML special characters
 */
function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Check if a PPTX reference template needs regeneration
 * @param {string} templatePath - Path to existing template
 * @param {string} mediaDir - Media directory
 * @param {string} baseTemplate - Base template path
 * @returns {boolean}
 */
export function templateNeedsRegeneration(templatePath, mediaDir, baseTemplate) {
  if (!existsSync(templatePath)) return true;

  const templateStat = statSync(templatePath);
  const templateMtime = templateStat.mtimeMs;

  // Check if base template is newer
  if (baseTemplate && existsSync(baseTemplate)) {
    const baseStat = statSync(baseTemplate);
    if (baseStat.mtimeMs > templateMtime) return true;
  }

  // Check if any media file is newer
  if (mediaDir && existsSync(mediaDir)) {
    const files = readdirSync(mediaDir);
    for (const file of files) {
      const fileStat = statSync(join(mediaDir, file));
      if (fileStat.mtimeMs > templateMtime) return true;
    }
  }

  return false;
}
