/**
 * PPTX post-processing
 *
 * Pure TypeScript implementation using AdmZip for in-memory ZIP/PPTX manipulation.
 * No Python dependency required.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';

interface ThemeFonts {
  major?: string;
  minor?: string;
}

interface Theme {
  fonts?: ThemeFonts;
}

interface TemplateOptions {
  baseTemplate: string;
  outputPath: string;
}

interface BuildupConfig {
  default?: string;
  title?: string;
  grey?: string;
  accent?: string;
  enabled?: boolean;
}

// =============================================================================
// Shared Helpers
// =============================================================================

function getSlideEntries(zip: AdmZip) {
  return zip.getEntries()
    .filter(e => /^ppt\/slides\/slide\d+\.xml$/.test(e.entryName))
    .sort((a, b) => {
      const na = parseInt(a.entryName.match(/slide(\d+)/)?.[1] || '0');
      const nb = parseInt(b.entryName.match(/slide(\d+)/)?.[1] || '0');
      return na - nb;
    });
}

function readEntry(zip: AdmZip, name: string): string {
  return zip.getEntry(name)?.getData().toString('utf-8') ?? '';
}

function updateEntry(zip: AdmZip, name: string, content: string): void {
  zip.updateFile(name, Buffer.from(content, 'utf-8'));
}

function findMaxId(xml: string): number {
  const ids = [...xml.matchAll(/id="(\d+)"/g)].map(m => parseInt(m[1]));
  return ids.length ? Math.max(...ids) : 0;
}

function findMaxRId(xml: string): number {
  const rids = [...xml.matchAll(/Id="rId(\d+)"/g)].map(m => parseInt(m[1]));
  return rids.length ? Math.max(...rids) : 0;
}

// =============================================================================
// 1. Apply Theme Fonts
// =============================================================================

/**
 * Apply theme fonts to all text in a PPTX.
 * Pandoc generates slides with hardcoded fonts; this replaces them with theme font references.
 */
export async function applyThemeFonts(pptxPath: string, theme: Theme): Promise<void> {
  if (!existsSync(pptxPath) || !theme || !theme.fonts) return;

  const { major, minor } = theme.fonts;
  if (!major && !minor) return;

  const zip = new AdmZip(pptxPath);
  const defaultFonts = ['Calibri', 'Arial', 'Helvetica', 'Times New Roman', 'Cambria'];

  for (const entry of getSlideEntries(zip)) {
    let text = entry.getData().toString('utf-8');
    for (const font of defaultFonts) {
      text = text.replace(
        new RegExp(`(<a:latin\\s+typeface=")${font}(")`, 'g'),
        '$1+mn-lt$2'
      );
    }
    updateEntry(zip, entry.entryName, text);
  }

  zip.writeZip(pptxPath);
}

// =============================================================================
// 2. Apply Centering
// =============================================================================

/**
 * Apply horizontal centering to slides that have the .center class.
 */
export async function applyCentering(pptxPath: string, centeredSlideIndices: number[]): Promise<void> {
  if (!existsSync(pptxPath) || !centeredSlideIndices || centeredSlideIndices.length === 0) return;

  const zip = new AdmZip(pptxPath);
  const centeredFiles = new Set(centeredSlideIndices.map(i => `ppt/slides/slide${i}.xml`));

  for (const entry of getSlideEntries(zip)) {
    if (!centeredFiles.has(entry.entryName)) continue;

    let text = entry.getData().toString('utf-8');

    // Process each shape separately to skip footer and slide number
    text = text.replace(/<p:sp>.*?<\/p:sp>/gs, (shape) => {
      // Skip footer and slide number placeholders
      if (shape.includes('type="sldNum"') || shape.includes('type="ftr"')) {
        return shape;
      }

      // Add algn="ctr" to existing <a:pPr> elements
      shape = shape.replace(
        /(<a:pPr)((?:[^/>]|\/(?!>))*)(\s*\/?>)/g,
        (_match: string, before: string, attrs: string, closing: string) => {
          attrs = attrs.trimEnd();
          let isSelfClosing = closing.includes('/');

          if (attrs.endsWith('/')) {
            attrs = attrs.slice(0, -1).trimEnd();
            isSelfClosing = true;
          }

          if (!attrs.includes('algn=')) {
            attrs += ' algn="ctr"';
          } else {
            attrs = attrs.replace(/algn="[^"]*"/, 'algn="ctr"');
          }

          return before + attrs + (isSelfClosing ? ' />' : '>');
        }
      );

      // Add <a:pPr algn="ctr"/> to paragraphs without pPr
      shape = shape.replace(/(<a:p>)(<a:r>)/g, '$1<a:pPr algn="ctr"/>$2');

      return shape;
    });

    updateEntry(zip, entry.entryName, text);
  }

  zip.writeZip(pptxPath);
}

// =============================================================================
// 3. Inject Slide Numbers
// =============================================================================

function getSlideNumXml(maxId: number, num: number): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${maxId}" name="Slide Number Placeholder ${maxId}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="8610600" y="6581838"/><a:ext cx="2743200" cy="319024"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="1600"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle><a:p><a:r><a:rPr lang="en-GB" sz="1600" dirty="0"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${num}</a:t></a:r></a:p></p:txBody></p:sp>`;
}

function isContentSlide(text: string): boolean {
  const hasFooter = text.includes('type="ftr"');
  const hasBody = text.includes('idx="1"') || text.includes('type="body"');
  return hasFooter && hasBody;
}

/**
 * Inject slide numbers into content slides of a PPTX.
 * Only adds numbers to slides that have a footer and body placeholder.
 * Title, section, and cover slides are skipped.
 */
export async function injectSlideNumbers(pptxPath: string): Promise<void> {
  if (!existsSync(pptxPath)) return;

  const zip = new AdmZip(pptxPath);
  const slides = getSlideEntries(zip);

  // Pass 1: identify content slides and assign sequential numbers
  const slideNumbers = new Map<string, number>();
  let contentNum = 1;

  for (const entry of slides) {
    const text = entry.getData().toString('utf-8');
    if (isContentSlide(text) && !text.includes('type="sldNum"')) {
      slideNumbers.set(entry.entryName, contentNum);
      contentNum++;
    }
  }

  // Pass 2: inject numbers
  for (const entry of slides) {
    const num = slideNumbers.get(entry.entryName);
    if (num === undefined) continue;

    let text = entry.getData().toString('utf-8');
    const maxId = findMaxId(text) + 1;
    const slideNumXml = getSlideNumXml(maxId, num);
    text = text.replace('</p:spTree>', slideNumXml + '</p:spTree>');
    updateEntry(zip, entry.entryName, text);
  }

  zip.writeZip(pptxPath);
}

// =============================================================================
// 4. Inject Logos Into Slides
// =============================================================================

/**
 * Inject logos into cover slide of a PPTX (matching ref.pptx style).
 */
export async function injectLogosIntoSlides(pptxPath: string, mediaDir: string | null): Promise<void> {
  if (!mediaDir || !existsSync(mediaDir) || !existsSync(pptxPath)) return;

  const logoLeftPath = join(mediaDir, 'logo-left.png');
  const logoRightPath = join(mediaDir, 'logo-right.png');
  const hasLeft = existsSync(logoLeftPath);
  const hasRight = existsSync(logoRightPath);

  if (!hasLeft && !hasRight) return;

  const zip = new AdmZip(pptxPath);

  // Find next available image number
  let maxImgNum = 0;
  for (const entry of zip.getEntries()) {
    const m = entry.entryName.match(/^ppt\/media\/image(\d+)\./);
    if (m) maxImgNum = Math.max(maxImgNum, parseInt(m[1]));
  }
  const nextImg = maxImgNum + 1;

  const rightImgName = hasRight ? `ppt/media/image${nextImg}.png` : null;
  const leftImgName = hasLeft ? `ppt/media/image${nextImg + 1}.png` : null;

  // Update [Content_Types].xml to include png if needed
  const contentTypesXml = readEntry(zip, '[Content_Types].xml');
  if (contentTypesXml && !contentTypesXml.includes('Extension="png"')) {
    updateEntry(zip, '[Content_Types].xml',
      contentTypesXml.replace('</Types>', '<Default Extension="png" ContentType="image/png"/></Types>')
    );
  }

  // Update slide1.xml.rels to add image relationships
  let rightRid: string | null = null;
  let leftRid: string | null = null;
  const relsName = 'ppt/slides/_rels/slide1.xml.rels';
  let relsXml = readEntry(zip, relsName);

  if (relsXml) {
    let maxRid = findMaxRId(relsXml);
    const newRels: string[] = [];

    if (hasRight) {
      maxRid++;
      rightRid = `rId${maxRid}`;
      newRels.push(`<Relationship Id="${rightRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${nextImg}.png"/>`);
    }

    if (hasLeft) {
      maxRid++;
      leftRid = `rId${maxRid}`;
      newRels.push(`<Relationship Id="${leftRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${nextImg + 1}.png"/>`);
    }

    if (newRels.length > 0) {
      relsXml = relsXml.replace('</Relationships>', newRels.join('') + '</Relationships>');
      updateEntry(zip, relsName, relsXml);
    }
  }

  // Update slide1.xml to add picture elements
  let slide1Xml = readEntry(zip, 'ppt/slides/slide1.xml');
  if (slide1Xml) {
    let maxId = findMaxId(slide1Xml);
    const pics: string[] = [];

    if (hasRight && rightRid) {
      maxId++;
      pics.push(`<p:pic><p:nvPicPr><p:cNvPr id="${maxId}" name="Picture ${maxId}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rightRid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="9492000" y="5742001"/><a:ext cx="2700000" cy="1115999"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
    }

    if (hasLeft && leftRid) {
      maxId++;
      pics.push(`<p:pic><p:nvPicPr><p:cNvPr id="${maxId}" name="Picture ${maxId}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${leftRid}"/><a:srcRect t="22495" b="27262"/><a:stretch/></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="5904608"/><a:ext cx="3794408" cy="954349"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`);
    }

    if (pics.length > 0) {
      slide1Xml = slide1Xml.replace('</p:spTree>', pics.join('') + '</p:spTree>');
      updateEntry(zip, 'ppt/slides/slide1.xml', slide1Xml);
    }
  }

  // Add logo image files
  if (hasRight && rightImgName) {
    zip.addFile(rightImgName, readFileSync(logoRightPath));
  }
  if (hasLeft && leftImgName) {
    zip.addFile(leftImgName, readFileSync(logoLeftPath));
  }

  zip.writeZip(pptxPath);
}

// =============================================================================
// 5. Apply Buildup Colors
// =============================================================================

function applyColorToPara(para: string, color: string): string {
  const fill = `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`;

  // Replace bare <a:rPr/> with colored version
  let result = para.replace(/<a:rPr\s*\/>/g, `<a:rPr>${fill}</a:rPr>`);

  // Replace <a:rPr attrs/> (self-closing with attributes) with colored version
  result = result.replace(/<a:rPr\s+([^>]+?)\s*\/>/g, (_: string, attrs: string) => {
    return `<a:rPr ${attrs.trim()}>${fill}</a:rPr>`;
  });

  return result;
}

function isBuildupSlide(xml: string): boolean {
  return xml.includes('animEffect') || xml.includes('<a:bldLst>');
}

function getBulletParagraphs(body: string): {
  bulletIndices: number[];
  paras: { start: number; end: number; text: string }[];
} {
  const paraRegex = /<a:p>.*?<\/a:p>/gs;
  const paras: { start: number; end: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = paraRegex.exec(body)) !== null) {
    paras.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }

  const bulletIndices: number[] = [];
  for (let i = 0; i < paras.length; i++) {
    const paraText = paras[i].text;
    if (paraText.includes('lvl="0"') && !paraText.includes('<a:buNone')) {
      bulletIndices.push(i);
    }
  }

  return { bulletIndices, paras };
}

function colorContentPlaceholder(
  xml: string,
  defaultColor: string,
  greyColor: string,
  accentColor: string
): string {
  const pattern = /(<p:sp>.*?<p:ph idx="1"[^/]*\/?>.*?<p:txBody>)(.*?)(<\/p:txBody>.*?<\/p:sp>)/s;
  const match = pattern.exec(xml);

  if (!match) return xml;

  const beforeBody = match[1];
  const body = match[2];
  const afterBody = match[3];

  const { bulletIndices, paras } = getBulletParagraphs(body);
  const isBuildup = isBuildupSlide(xml);

  let newBody = body;
  let offset = 0;

  for (let i = 0; i < paras.length; i++) {
    const para = paras[i];
    const start = para.start + offset;
    const end = para.end + offset;
    const paraText = para.text;

    let color: string;
    if (bulletIndices.includes(i) && isBuildup) {
      color = (i === bulletIndices[bulletIndices.length - 1]) ? accentColor : greyColor;
    } else {
      color = defaultColor;
    }

    const newPara = applyColorToPara(paraText, color);
    newBody = newBody.slice(0, start) + newPara + newBody.slice(end);
    offset += newPara.length - paraText.length;
  }

  return xml.slice(0, match.index) + beforeBody + newBody + afterBody + xml.slice(match.index + match[0].length);
}

function colorTitlePlaceholder(xml: string, titleColor: string): string {
  const pattern = /(<p:sp>.*?<p:ph[^>]*type="(?:title|ctrTitle)"[^/]*\/?>.*?<p:txBody>)(.*?)(<\/p:txBody>.*?<\/p:sp>)/s;
  const match = pattern.exec(xml);

  if (!match) return xml;

  const beforeBody = match[1];
  const body = match[2];
  const afterBody = match[3];

  const paraRegex = /<a:p>.*?<\/a:p>/gs;
  const paras: { start: number; end: number; text: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = paraRegex.exec(body)) !== null) {
    paras.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
  }

  let newBody = body;
  let offset = 0;

  for (const para of paras) {
    const start = para.start + offset;
    const end = para.end + offset;
    const newPara = applyColorToPara(para.text, titleColor);
    newBody = newBody.slice(0, start) + newPara + newBody.slice(end);
    offset += newPara.length - para.text.length;
  }

  return xml.slice(0, match.index) + beforeBody + newBody + afterBody + xml.slice(match.index + match[0].length);
}

/**
 * Apply buildup greying to slides with buildup content.
 * Greys out all bullet items except the last one, which gets the accent color.
 * Only affects actual bullet items (not intro text with buNone).
 */
export async function applyBuildupColors(pptxPath: string, config: BuildupConfig = {}): Promise<void> {
  if (!existsSync(pptxPath)) return;
  if (config.enabled === false) return;

  const defaultColor = (config.default || '608C32').replace(/^#/, '');
  const titleColor = (config.title || defaultColor).replace(/^#/, '');
  const greyColor = (config.grey || '888888').replace(/^#/, '');
  const accentColor = (config.accent || defaultColor).replace(/^#/, '');

  const zip = new AdmZip(pptxPath);

  for (const entry of getSlideEntries(zip)) {
    let text = entry.getData().toString('utf-8');
    text = colorContentPlaceholder(text, defaultColor, greyColor, accentColor);
    text = colorTitlePlaceholder(text, titleColor);
    updateEntry(zip, entry.entryName, text);
  }

  zip.writeZip(pptxPath);
}

// =============================================================================
// Legacy Exports (signatures preserved for build.ts compatibility)
// =============================================================================

export async function generatePptxTemplate(options: TemplateOptions): Promise<string | null> {
  const { baseTemplate, outputPath } = options;
  if (baseTemplate && existsSync(baseTemplate)) {
    writeFileSync(outputPath, readFileSync(baseTemplate));
    return outputPath;
  }
  return null;
}

export function templateNeedsRegeneration(templatePath: string, mediaDir: string, baseTemplate: string): boolean {
  return false;
}

export async function injectMediaIntoPptx(pptxPath: string, mediaDir: string): Promise<void> {
  return injectLogosIntoSlides(pptxPath, mediaDir);
}
