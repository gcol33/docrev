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
 * Only adds slide numbers to slides that have a footer (i.e., slides with the green banner).
 * Uses in-place ZIP modification to preserve file structure.
 * @param {string} pptxPath - Path to PPTX file
 * @returns {Promise<void>}
 */
export async function injectSlideNumbers(pptxPath) {
  if (!existsSync(pptxPath)) return;

  const scriptPath = join(dirname(pptxPath), '.inject-slidenum.py');
  const script = `import zipfile, sys, re, os

pptx_path = sys.argv[1]
temp_path = pptx_path + '.tmp'

# Slide number XML template with manual number (white text, 16pt)
def get_slidenum_xml(max_id, num):
    return f'<p:sp><p:nvSpPr><p:cNvPr id="{max_id}" name="Slide Number Placeholder {max_id}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="8610600" y="6581838"/><a:ext cx="2743200" cy="319024"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="1600"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="en-GB" sz="1600" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>{num}</a:t></a:r></a:p></p:txBody></p:sp>'

def is_content_slide(text):
    """Check if slide is a content slide (has footer AND body placeholder)"""
    has_footer = 'type="ftr"' in text
    has_body = 'idx="1"' in text or 'type="body"' in text
    return has_footer and has_body

# First pass: identify content slides and assign sequential numbers
with zipfile.ZipFile(pptx_path, 'r') as zin:
    slide_numbers = {}  # filename -> sequential number
    content_num = 1

    # Get all slide files sorted by number
    slide_files = sorted([f for f in zin.namelist()
                         if f.startswith('ppt/slides/slide') and f.endswith('.xml')],
                        key=lambda x: int(re.search(r'slide(\\d+)', x).group(1)))

    for fname in slide_files:
        text = zin.read(fname).decode('utf-8')
        if is_content_slide(text) and 'type="sldNum"' not in text:
            slide_numbers[fname] = content_num
            content_num += 1

# Second pass: inject numbers
with zipfile.ZipFile(pptx_path, 'r') as zin:
    with zipfile.ZipFile(temp_path, 'w') as zout:
        for item in zin.infolist():
            content = zin.read(item.filename)

            if item.filename in slide_numbers:
                text = content.decode('utf-8')
                # Find max id
                ids = [int(m) for m in re.findall(r'id="(\\d+)"', text)]
                max_id = max(ids) + 1 if ids else 100

                # Insert slide number with sequential count
                slidenum_xml = get_slidenum_xml(max_id, slide_numbers[item.filename])
                text = text.replace('</p:spTree>', slidenum_xml + '</p:spTree>')
                content = text.encode('utf-8')

            zout.writestr(item, content)

os.replace(temp_path, pptx_path)
`;

  writeFileSync(scriptPath, script);
  try {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    execSync(`${pythonCmd} "${scriptPath}" "${pptxPath}"`, { stdio: 'pipe' });
  } finally {
    try { unlinkSync(scriptPath); } catch { /* ignore */ }
  }
}

/**
 * Inject logos into cover slide of a PPTX (matching ref.pptx style)
 * Uses in-place ZIP modification to preserve file structure.
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

  // Read logo files as base64
  const logoLeftData = hasLeft ? readFileSync(logoLeft).toString('base64') : '';
  const logoRightData = hasRight ? readFileSync(logoRight).toString('base64') : '';

  const scriptPath = join(dirname(pptxPath), '.inject-logos.py');
  const script = `import zipfile, sys, re, os, base64

pptx_path = sys.argv[1]
has_left = ${hasLeft ? 'True' : 'False'}
has_right = ${hasRight ? 'True' : 'False'}
logo_left_b64 = """${logoLeftData}"""
logo_right_b64 = """${logoRightData}"""

temp_path = pptx_path + '.tmp'

# Find next available image number
def get_next_image_num(zf):
    max_num = 0
    for name in zf.namelist():
        m = re.match(r'ppt/media/image(\\d+)\\.', name)
        if m:
            max_num = max(max_num, int(m.group(1)))
    return max_num + 1

with zipfile.ZipFile(pptx_path, 'r') as zin:
    next_img = get_next_image_num(zin)
    right_img_name = f'ppt/media/image{next_img}.png' if has_right else None
    left_img_name = f'ppt/media/image{next_img + 1}.png' if has_left else None

    with zipfile.ZipFile(temp_path, 'w') as zout:
        for item in zin.infolist():
            content = zin.read(item.filename)

            # Update [Content_Types].xml to include png if needed
            if item.filename == '[Content_Types].xml':
                text = content.decode('utf-8')
                if 'Extension="png"' not in text:
                    text = text.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')
                    content = text.encode('utf-8')

            # Update slide1.xml.rels to add image relationships
            if item.filename == 'ppt/slides/_rels/slide1.xml.rels':
                text = content.decode('utf-8')
                # Find max rId
                rids = [int(m) for m in re.findall(r'Id="rId(\\d+)"', text)]
                max_rid = max(rids) if rids else 0

                new_rels = []
                right_rid = None
                left_rid = None

                if has_right:
                    max_rid += 1
                    right_rid = f'rId{max_rid}'
                    new_rels.append(f'<Relationship Id="{right_rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image{next_img}.png"/>')

                if has_left:
                    max_rid += 1
                    left_rid = f'rId{max_rid}'
                    new_rels.append(f'<Relationship Id="{left_rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image{next_img + 1}.png"/>')

                if new_rels:
                    text = text.replace('</Relationships>', ''.join(new_rels) + '</Relationships>')
                    content = text.encode('utf-8')

                # Store rIds for slide1 modification
                zout.right_rid = right_rid
                zout.left_rid = left_rid

            # Update slide1.xml to add picture elements
            if item.filename == 'ppt/slides/slide1.xml':
                text = content.decode('utf-8')
                # Find max id
                ids = [int(m) for m in re.findall(r'id="(\\d+)"', text)]
                max_id = max(ids) if ids else 0

                pics = []
                right_rid = getattr(zout, 'right_rid', None)
                left_rid = getattr(zout, 'left_rid', None)

                if has_right and right_rid:
                    max_id += 1
                    pics.append(f'<p:pic><p:nvPicPr><p:cNvPr id="{max_id}" name="Picture {max_id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{right_rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="9492000" y="5742001"/><a:ext cx="2700000" cy="1115999"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')

                if has_left and left_rid:
                    max_id += 1
                    pics.append(f'<p:pic><p:nvPicPr><p:cNvPr id="{max_id}" name="Picture {max_id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="{left_rid}"/><a:srcRect t="22495" b="27262"/><a:stretch/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="5904608"/><a:ext cx="3794408" cy="954349"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>')

                if pics:
                    text = text.replace('</p:spTree>', ''.join(pics) + '</p:spTree>')
                    content = text.encode('utf-8')

            zout.writestr(item, content)

        # Add logo image files
        if has_right:
            zout.writestr(right_img_name, base64.b64decode(logo_right_b64))
        if has_left:
            zout.writestr(left_img_name, base64.b64decode(logo_left_b64))

os.replace(temp_path, pptx_path)
`;

  writeFileSync(scriptPath, script);
  try {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    execSync(`${pythonCmd} "${scriptPath}" "${pptxPath}"`, { stdio: 'pipe' });
  } finally {
    try { unlinkSync(scriptPath); } catch { /* ignore */ }
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

/**
 * Apply buildup greying to slides with buildup content
 * Greys out all bullet items except the last one, which gets the accent color.
 * Only affects actual bullet items (not intro text with buNone).
 * Uses in-place ZIP modification to preserve file structure.
 * @param {string} pptxPath - Path to PPTX file
 * @param {object} config - Buildup configuration
 * @param {string} [config.default] - Hex color for all content text (default: 608C32)
 * @param {string} [config.title] - Hex color for slide titles (default: same as config.default)
 * @param {string} [config.grey] - Hex color for greyed items in buildup (default: 888888)
 * @param {string} [config.accent] - Hex color for current/last item (default: same as config.default)
 * @param {boolean} [config.enabled] - Enable/disable buildup colors (default: true)
 * @returns {Promise<void>}
 */
export async function applyBuildupColors(pptxPath, config = {}) {
  if (!existsSync(pptxPath)) return;

  // Check if buildup colors are disabled
  if (config.enabled === false) return;

  // Get colors from config with defaults
  const defaultColor = (config.default || '608C32').replace(/^#/, '');
  const titleColor = (config.title || defaultColor).replace(/^#/, '');
  const greyColor = (config.grey || '888888').replace(/^#/, '');
  const accentColor = (config.accent || defaultColor).replace(/^#/, '');

  const scriptPath = join(dirname(pptxPath), '.apply-buildup.py');
  const script = `import zipfile
import sys
import re
import os

pptx_path = sys.argv[1]
temp_path = pptx_path + '.tmp'

DEFAULT = '${defaultColor}'
TITLE = '${titleColor}'
GREY = '${greyColor}'
ACCENT = '${accentColor}'

def get_bullet_paragraphs(body):
    """Return indices of paragraphs that are actual bullet items (have lvl="0" but NOT buNone)"""
    paras = list(re.finditer(r'<a:p>.*?</a:p>', body, re.DOTALL))
    bullet_indices = []

    for i, p in enumerate(paras):
        para_text = p.group(0)
        if 'lvl="0"' in para_text and '<a:buNone' not in para_text:
            bullet_indices.append(i)

    return bullet_indices, paras


def apply_color_to_para(para, color):
    """Apply a color to all text runs in a paragraph"""
    new_para = re.sub(
        r'<a:rPr\\s*/>',
        f'<a:rPr><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></a:rPr>',
        para
    )

    def fix_rpr_with_attrs(m):
        attrs = m.group(1).strip()
        return f'<a:rPr {attrs}><a:solidFill><a:srgbClr val="{color}"/></a:solidFill></a:rPr>'

    new_para = re.sub(
        r'<a:rPr\\s+([^>]+?)\\s*/>',
        fix_rpr_with_attrs,
        new_para
    )

    return new_para


def is_buildup_slide(xml):
    """Check if slide has buildup marker (animEffect with filter=wipe)"""
    # Buildup slides have animation effects from pandoc's incremental lists
    return 'animEffect' in xml or '<a:bldLst>' in xml


def color_content_placeholder(xml):
    """Apply colors to all text in content placeholder.

    For buildup slides: grey previous bullet items, accent on last bullet item.
    For all text (bullets and non-bullets): apply default color unless overridden by buildup.
    """

    pattern = r'(<p:sp>.*?<p:ph idx="1"[^/]*/?>.*?<p:txBody>)(.*?)(</p:txBody>.*?</p:sp>)'
    match = re.search(pattern, xml, re.DOTALL)

    if not match:
        return xml

    before_body = match.group(1)
    body = match.group(2)
    after_body = match.group(3)

    bullet_indices, paras = get_bullet_paragraphs(body)
    is_buildup = is_buildup_slide(xml)

    new_body = body
    offset = 0

    for i, para_match in enumerate(paras):
        start = para_match.start() + offset
        end = para_match.end() + offset
        para = para_match.group(0)

        # Determine color for this paragraph
        if i in bullet_indices and is_buildup:
            # Buildup bullet: grey all but last, accent on last
            if i == bullet_indices[-1]:
                color = ACCENT
            else:
                color = GREY
        else:
            # Non-bullet text OR non-buildup slide: use default color
            color = DEFAULT

        new_para = apply_color_to_para(para, color)
        new_body = new_body[:start] + new_para + new_body[end:]
        offset += len(new_para) - len(para)

    return xml[:match.start()] + before_body + new_body + after_body + xml[match.end():]


def color_title_placeholder(xml):
    """Apply title color to title placeholder (type='title' or type='ctrTitle')."""

    # Match title placeholders: type="title" or type="ctrTitle"
    pattern = r'(<p:sp>.*?<p:ph[^>]*type="(?:title|ctrTitle)"[^/]*/?>.*?<p:txBody>)(.*?)(</p:txBody>.*?</p:sp>)'
    match = re.search(pattern, xml, re.DOTALL)

    if not match:
        return xml

    before_body = match.group(1)
    body = match.group(2)
    after_body = match.group(3)

    paras = list(re.finditer(r'<a:p>.*?</a:p>', body, re.DOTALL))

    new_body = body
    offset = 0

    for para_match in paras:
        start = para_match.start() + offset
        end = para_match.end() + offset
        para = para_match.group(0)

        new_para = apply_color_to_para(para, TITLE)
        new_body = new_body[:start] + new_para + new_body[end:]
        offset += len(new_para) - len(para)

    return xml[:match.start()] + before_body + new_body + after_body + xml[match.end():]


with zipfile.ZipFile(pptx_path, 'r') as zin:
    with zipfile.ZipFile(temp_path, 'w') as zout:
        for item in zin.infolist():
            content = zin.read(item.filename)

            if item.filename.startswith('ppt/slides/slide') and item.filename.endswith('.xml'):
                text = content.decode('utf-8')
                text = color_content_placeholder(text)
                text = color_title_placeholder(text)
                content = text.encode('utf-8')

            zout.writestr(item, content)

os.replace(temp_path, pptx_path)
`;

  writeFileSync(scriptPath, script);
  try {
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    execSync(`${pythonCmd} "${scriptPath}" "${pptxPath}"`, { stdio: 'pipe' });
  } finally {
    try { unlinkSync(scriptPath); } catch { /* ignore */ }
  }
}
