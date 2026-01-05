/**
 * PPTX post-processing
 *
 * Injects logos into each slide of a generated PPTX to match ref.pptx styling.
 * Uses ref.pptx as-is for --reference-doc, then post-processes to add logos.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from 'node:fs';
import { join, basename, extname, dirname } from 'node:path';
import { execSync } from 'node:child_process';

/**
 * Extract PPTX to directory
 */
async function extractPptx(pptxPath, destDir) {
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
  const scriptPath = join(dirname(pptxPath), '.zip-create.py');
  const script = `import zipfile, os, sys
src, dst = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zf:
    for root, dirs, files in os.walk(src):
        for f in files:
            fp = os.path.join(root, f)
            zf.write(fp, os.path.relpath(fp, src))
`;

  writeFileSync(scriptPath, script);
  try {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    execSync(`${pythonCmd} "${scriptPath}" "${srcDir}" "${pptxPath}"`, { stdio: 'pipe' });
  } finally {
    try { unlinkSync(scriptPath); } catch { /* ignore */ }
  }
}

/**
 * Recursively remove directory
 */
function rmSync(path, options) {
  const fs = require('node:fs');
  if (fs.rmSync) {
    fs.rmSync(path, options);
  } else {
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
 * Inject slide numbers into each slide of a PPTX
 * @param {string} pptxPath - Path to PPTX file
 * @returns {Promise<void>}
 */
export async function injectSlideNumbers(pptxPath) {
  if (!existsSync(pptxPath)) return;

  // Extract PPTX
  const tempDir = join(dirname(pptxPath), '.pptx-slidenum-' + Date.now());
  mkdirSync(tempDir, { recursive: true });

  try {
    await extractPptx(pptxPath, tempDir);

    // Process each slide
    const slidesDir = join(tempDir, 'ppt', 'slides');

    if (!existsSync(slidesDir)) {
      throw new Error('No slides directory found');
    }

    const slides = readdirSync(slidesDir).filter(f => f.match(/^slide\d+\.xml$/));

    for (const slideFile of slides) {
      const slidePath = join(slidesDir, slideFile);
      let slideContent = readFileSync(slidePath, 'utf-8');

      // Skip if slide already has slide number placeholder
      if (slideContent.includes('type="sldNum"')) continue;

      // Find max id in slide
      const idMatches = [...slideContent.matchAll(/id="(\d+)"/g)];
      let maxId = 0;
      for (const m of idMatches) {
        maxId = Math.max(maxId, parseInt(m[1]));
      }

      maxId++;

      // Generate slide number placeholder XML (matching ref.pptx layout positions)
      // Position: x=8610600, y=6581838, cx=2743200, cy=319024 (right side of bottom bar)
      const slideNumXml = `<p:sp><p:nvSpPr><p:cNvPr id="${maxId}" name="Slide Number Placeholder ${maxId}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="8610600" y="6581838"/><a:ext cx="2743200" cy="319024"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{4292B3C6-D7D0-D947-9E02-B512895D259A}" type="slidenum"><a:rPr lang="en-GB" smtClean="0"/><a:t>0</a:t></a:fld><a:endParaRPr lang="en-GB"/></a:p></p:txBody></p:sp>`;

      // Insert before </p:spTree>
      const insertPoint = slideContent.indexOf('</p:spTree>');
      if (insertPoint !== -1) {
        slideContent = slideContent.slice(0, insertPoint) + slideNumXml + slideContent.slice(insertPoint);
        writeFileSync(slidePath, slideContent);
      }
    }

    // Repackage PPTX
    await createPptx(tempDir, pptxPath);
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Inject logos into each slide of a PPTX (matching ref.pptx style)
 * @param {string} pptxPath - Path to PPTX file
 * @param {string} mediaDir - Directory with logo-left.png and logo-right.png
 * @returns {Promise<void>}
 */
export async function injectLogosIntoSlides(pptxPath, mediaDir) {
  if (!mediaDir || !existsSync(mediaDir) || !existsSync(pptxPath)) return;

  // Check for logo files
  const logoLeft = join(mediaDir, 'logo-left.png');
  const logoRight = join(mediaDir, 'logo-right.png');

  const hasLeft = existsSync(logoLeft);
  const hasRight = existsSync(logoRight);

  if (!hasLeft && !hasRight) return;

  // Extract PPTX
  const tempDir = join(dirname(pptxPath), '.pptx-logos-' + Date.now());
  mkdirSync(tempDir, { recursive: true });

  try {
    await extractPptx(pptxPath, tempDir);

    // Ensure ppt/media exists and copy logos
    const pptMediaDir = join(tempDir, 'ppt', 'media');
    mkdirSync(pptMediaDir, { recursive: true });

    // Use image1.png and image2.png naming to match ref.pptx
    if (hasRight) {
      writeFileSync(join(pptMediaDir, 'image1.png'), readFileSync(logoRight));
    }
    if (hasLeft) {
      writeFileSync(join(pptMediaDir, 'image2.png'), readFileSync(logoLeft));
    }

    // Update [Content_Types].xml
    const contentTypesPath = join(tempDir, '[Content_Types].xml');
    if (existsSync(contentTypesPath)) {
      let ct = readFileSync(contentTypesPath, 'utf-8');
      if (!ct.includes('Extension="png"')) {
        ct = ct.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>');
        writeFileSync(contentTypesPath, ct);
      }
    }

    // Process each slide
    const slidesDir = join(tempDir, 'ppt', 'slides');
    const relsDir = join(slidesDir, '_rels');

    if (!existsSync(slidesDir)) {
      throw new Error('No slides directory found');
    }

    mkdirSync(relsDir, { recursive: true });

    const slides = readdirSync(slidesDir).filter(f => f.match(/^slide\d+\.xml$/));

    // Only inject logos into slide1 (cover/title slide)
    const coverSlides = ['slide1.xml'];

    for (const slideFile of coverSlides) {
      if (!slides.includes(slideFile)) continue;
      const slidePath = join(slidesDir, slideFile);
      const relsPath = join(relsDir, slideFile + '.rels');

      // Read or create rels file
      let relsContent;
      if (existsSync(relsPath)) {
        relsContent = readFileSync(relsPath, 'utf-8');
      } else {
        relsContent = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
      }

      // Find max rId
      const rIdMatches = [...relsContent.matchAll(/Id="rId(\d+)"/g)];
      let maxRId = 0;
      for (const m of rIdMatches) {
        maxRId = Math.max(maxRId, parseInt(m[1]));
      }

      // Add image relationships
      const newRels = [];
      let rightRId = null;
      let leftRId = null;

      if (hasRight) {
        rightRId = `rId${maxRId + 1}`;
        newRels.push(`<Relationship Id="${rightRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>`);
        maxRId++;
      }
      if (hasLeft) {
        leftRId = `rId${maxRId + 1}`;
        newRels.push(`<Relationship Id="${leftRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/>`);
      }

      if (newRels.length > 0) {
        relsContent = relsContent.replace('</Relationships>', newRels.join('') + '</Relationships>');
        writeFileSync(relsPath, relsContent);
      }

      // Add picture elements to slide
      let slideContent = readFileSync(slidePath, 'utf-8');

      // Find max id in slide
      const idMatches = [...slideContent.matchAll(/id="(\d+)"/g)];
      let maxId = 0;
      for (const m of idMatches) {
        maxId = Math.max(maxId, parseInt(m[1]));
      }

      // Generate picture XML (matching ref.pptx positions exactly)
      const pics = [];

      if (hasRight && rightRId) {
        maxId++;
        // Right logo: x=9492000, y=5742001, cx=2700000, cy=1115999
        pics.push(`<p:pic><p:nvPicPr><p:cNvPr id="${maxId}" name="Picture ${maxId}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rightRId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="9492000" y="5742001"/><a:ext cx="2700000" cy="1115999"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
      }

      if (hasLeft && leftRId) {
        maxId++;
        // Left logo: x=0, y=5904608, cx=3794408, cy=954349 (with srcRect crop like ref.pptx)
        pics.push(`<p:pic><p:nvPicPr><p:cNvPr id="${maxId}" name="Picture ${maxId}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${leftRId}"/><a:srcRect t="22495" b="27262"/><a:stretch/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="5904608"/><a:ext cx="3794408" cy="954349"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
      }

      if (pics.length > 0) {
        // Insert after </p:spTree> opening or before first </p:spTree>
        // Find the end of </p:grpSpPr> which is right after the group properties
        const insertPoint = slideContent.indexOf('</p:spTree>');
        if (insertPoint !== -1) {
          slideContent = slideContent.slice(0, insertPoint) + pics.join('') + slideContent.slice(insertPoint);
          writeFileSync(slidePath, slideContent);
        }
      }
    }

    // Repackage PPTX
    await createPptx(tempDir, pptxPath);
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

// Legacy exports for compatibility
export async function generatePptxTemplate(options) {
  // No longer modifying template - just return the base template path
  const { baseTemplate, outputPath } = options;
  if (baseTemplate && existsSync(baseTemplate)) {
    // Copy base template to output
    writeFileSync(outputPath, readFileSync(baseTemplate));
    return outputPath;
  }
  return null;
}

export function templateNeedsRegeneration(templatePath, mediaDir, baseTemplate) {
  return false; // No template regeneration needed - we use ref.pptx as-is
}

export async function injectMediaIntoPptx(pptxPath, mediaDir) {
  // Redirect to the new function
  return injectLogosIntoSlides(pptxPath, mediaDir);
}
