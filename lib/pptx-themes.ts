/**
 * PPTX Theme System
 *
 * Provides 6 built-in themes for PPTX output, independent of Beamer themes.
 * Each theme is a reference PPTX file that defines colors, fonts, and slide layouts.
 *
 * Uses pandoc's default reference.pptx as the base template and modifies the theme.xml
 * to apply custom colors and fonts. This ensures all 11 required slide layouts are present.
 *
 * Themes:
 * - default: Clean white with blue accents (professional)
 * - dark: Dark background with light text (modern)
 * - academic: Classic serif fonts, muted colors (scholarly)
 * - minimal: High contrast black/white (clean)
 * - corporate: Navy/gold color scheme (business)
 * - plant: Nature-inspired green theme (ecology/biology)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Color scheme for a theme
 */
interface ThemeColors {
  dk1: string;
  lt1: string;
  dk2: string;
  lt2: string;
  accent1: string;
  accent2: string;
  accent3: string;
  accent4: string;
  accent5: string;
  accent6: string;
  hlink: string;
  folHlink: string;
}

/**
 * Font scheme for a theme
 */
interface ThemeFonts {
  major: string;
  minor: string;
}

/**
 * PPTX theme definition
 */
interface PptxTheme {
  name: string;
  description: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  background?: string;
}

/**
 * Theme definitions with colors and fonts
 */
export const PPTX_THEMES: Record<string, PptxTheme> = {
  default: {
    name: 'Default',
    description: 'Clean white with blue accents',
    colors: {
      dk1: '000000',      // Dark text
      lt1: 'FFFFFF',      // Light background
      dk2: '1F497D',      // Dark accent (navy)
      lt2: 'EEECE1',      // Light accent (cream)
      accent1: '4472C4',  // Blue
      accent2: 'ED7D31',  // Orange
      accent3: 'A5A5A5',  // Gray
      accent4: 'FFC000',  // Yellow
      accent5: '5B9BD5',  // Light blue
      accent6: '70AD47',  // Green
      hlink: '0563C1',    // Hyperlink blue
      folHlink: '954F72', // Followed hyperlink
    },
    fonts: {
      major: 'Calibri Light',
      minor: 'Calibri',
    },
  },
  dark: {
    name: 'Dark',
    description: 'Dark background with light text',
    colors: {
      dk1: 'FFFFFF',      // Light text (inverted)
      lt1: '1E1E1E',      // Dark background
      dk2: 'E0E0E0',      // Light gray
      lt2: '2D2D2D',      // Darker gray
      accent1: '00B4D8',  // Cyan
      accent2: 'FF6B6B',  // Coral
      accent3: '95E1D3',  // Mint
      accent4: 'F38181',  // Pink
      accent5: 'AA96DA',  // Lavender
      accent6: 'FCBAD3',  // Light pink
      hlink: '00B4D8',
      folHlink: 'AA96DA',
    },
    fonts: {
      major: 'Inter',
      minor: 'Inter',
    },
    background: '1E1E1E',
  },
  academic: {
    name: 'Academic',
    description: 'Classic serif fonts, muted colors',
    colors: {
      dk1: '2C3E50',      // Dark blue-gray
      lt1: 'FFFEF9',      // Warm white
      dk2: '34495E',      // Slate
      lt2: 'F5F5DC',      // Beige
      accent1: '8B4513',  // Saddle brown
      accent2: '2E8B57',  // Sea green
      accent3: '708090',  // Slate gray
      accent4: 'B8860B',  // Dark goldenrod
      accent5: '4682B4',  // Steel blue
      accent6: '6B8E23',  // Olive drab
      hlink: '8B4513',
      folHlink: '708090',
    },
    fonts: {
      major: 'Georgia',
      minor: 'Palatino Linotype',
    },
  },
  minimal: {
    name: 'Minimal',
    description: 'High contrast black and white',
    colors: {
      dk1: '000000',      // Pure black
      lt1: 'FFFFFF',      // Pure white
      dk2: '333333',      // Dark gray
      lt2: 'F0F0F0',      // Light gray
      accent1: '000000',  // Black accent
      accent2: '666666',  // Medium gray
      accent3: '999999',  // Light gray
      accent4: 'CCCCCC',  // Lighter gray
      accent5: '333333',  // Dark gray
      accent6: '4D4D4D',  // Charcoal
      hlink: '000000',
      folHlink: '666666',
    },
    fonts: {
      major: 'Roboto Light',
      minor: 'Roboto',
    },
  },
  corporate: {
    name: 'Corporate',
    description: 'Navy and gold professional theme',
    colors: {
      dk1: '0D1B2A',      // Very dark navy
      lt1: 'FFFFFF',      // White
      dk2: '1B263B',      // Dark navy
      lt2: 'E0E1DD',      // Light gray
      accent1: 'D4AF37',  // Gold
      accent2: '415A77',  // Steel blue
      accent3: '778DA9',  // Light steel
      accent4: 'C5A900',  // Darker gold
      accent5: '1B4965',  // Deep blue
      accent6: '5FA8D3',  // Sky blue
      hlink: 'D4AF37',
      folHlink: '778DA9',
    },
    fonts: {
      major: 'Garamond',
      minor: 'Garamond',
    },
  },
  plant: {
    name: 'Plant',
    description: 'Nature-inspired green theme for ecology/biology',
    colors: {
      dk1: '2D4A22',      // Dark forest green
      lt1: 'FFFFFF',      // White
      dk2: '3D5A2E',      // Medium forest
      lt2: 'F5F7F2',      // Light sage
      accent1: '608C32',  // Primary green (theme accent)
      accent2: '8B4513',  // Earth brown
      accent3: '888888',  // Gray (for buildup)
      accent4: '7CB342',  // Light green
      accent5: '4A6B3A',  // Olive green
      accent6: 'A5D6A7',  // Pale green
      hlink: '608C32',
      folHlink: '4A6B3A',
    },
    fonts: {
      major: 'Aptos Display',
      minor: 'Aptos',
    },
  },
};

/**
 * Get list of available theme names
 */
export function getThemeNames(): string[] {
  return Object.keys(PPTX_THEMES);
}

/**
 * Get theme definition by name
 */
export function getTheme(name: string): PptxTheme | null {
  return PPTX_THEMES[name] || null;
}

/**
 * Generate [Content_Types].xml
 */
function generateContentTypes(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
}

/**
 * Generate _rels/.rels
 */
function generateRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

/**
 * Generate ppt/_rels/presentation.xml.rels
 */
function generatePresentationRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;
}

/**
 * Generate ppt/presentation.xml
 */
function generatePresentation(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" saveSubsetFonts="1">
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rId1"/>
  </p:sldMasterIdLst>
  <p:sldSz cx="12192000" cy="6858000"/>
  <p:notesSz cx="6858000" cy="9144000"/>
  <p:defaultTextStyle>
    <a:defPPr>
      <a:defRPr lang="en-US"/>
    </a:defPPr>
  </p:defaultTextStyle>
</p:presentation>`;
}

/**
 * Generate ppt/theme/theme1.xml with theme colors and fonts
 */
function generateTheme(theme: PptxTheme): string {
  const c = theme.colors;
  const f = theme.fonts;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="${theme.name}">
  <a:themeElements>
    <a:clrScheme name="${theme.name}">
      <a:dk1><a:srgbClr val="${c.dk1}"/></a:dk1>
      <a:lt1><a:srgbClr val="${c.lt1}"/></a:lt1>
      <a:dk2><a:srgbClr val="${c.dk2}"/></a:dk2>
      <a:lt2><a:srgbClr val="${c.lt2}"/></a:lt2>
      <a:accent1><a:srgbClr val="${c.accent1}"/></a:accent1>
      <a:accent2><a:srgbClr val="${c.accent2}"/></a:accent2>
      <a:accent3><a:srgbClr val="${c.accent3}"/></a:accent3>
      <a:accent4><a:srgbClr val="${c.accent4}"/></a:accent4>
      <a:accent5><a:srgbClr val="${c.accent5}"/></a:accent5>
      <a:accent6><a:srgbClr val="${c.accent6}"/></a:accent6>
      <a:hlink><a:srgbClr val="${c.hlink}"/></a:hlink>
      <a:folHlink><a:srgbClr val="${c.folHlink}"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="${theme.name}">
      <a:majorFont>
        <a:latin typeface="${f.major}"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="${f.minor}"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="${theme.name}">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:gradFill rotWithShape="1">
          <a:gsLst>
            <a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="50000"/><a:satMod val="300000"/></a:schemeClr></a:gs>
            <a:gs pos="35000"><a:schemeClr val="phClr"><a:tint val="37000"/><a:satMod val="300000"/></a:schemeClr></a:gs>
            <a:gs pos="100000"><a:schemeClr val="phClr"><a:tint val="15000"/><a:satMod val="350000"/></a:schemeClr></a:gs>
          </a:gsLst>
          <a:lin ang="16200000" scaled="1"/>
        </a:gradFill>
        <a:gradFill rotWithShape="1">
          <a:gsLst>
            <a:gs pos="0"><a:schemeClr val="phClr"><a:shade val="51000"/><a:satMod val="130000"/></a:schemeClr></a:gs>
            <a:gs pos="80000"><a:schemeClr val="phClr"><a:shade val="93000"/><a:satMod val="130000"/></a:schemeClr></a:gs>
            <a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="94000"/><a:satMod val="135000"/></a:schemeClr></a:gs>
          </a:gsLst>
          <a:lin ang="16200000" scaled="0"/>
        </a:gradFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"><a:shade val="95000"/><a:satMod val="105000"/></a:schemeClr></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="25400" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
        <a:ln w="38100" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst><a:outerShdw blurRad="40000" dist="23000" dir="5400000" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:gradFill rotWithShape="1">
          <a:gsLst>
            <a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="40000"/><a:satMod val="350000"/></a:schemeClr></a:gs>
            <a:gs pos="40000"><a:schemeClr val="phClr"><a:tint val="45000"/><a:shade val="99000"/><a:satMod val="350000"/></a:schemeClr></a:gs>
            <a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="20000"/><a:satMod val="255000"/></a:schemeClr></a:gs>
          </a:gsLst>
          <a:path path="circle"><a:fillToRect l="50000" t="-80000" r="50000" b="180000"/></a:path>
        </a:gradFill>
        <a:gradFill rotWithShape="1">
          <a:gsLst>
            <a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="80000"/><a:satMod val="300000"/></a:schemeClr></a:gs>
            <a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="30000"/><a:satMod val="200000"/></a:schemeClr></a:gs>
          </a:gsLst>
          <a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path>
        </a:gradFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>`;
}

/**
 * Get pandoc's default reference.pptx as a base template
 */
function getPandocReferenceTemplate(): Buffer {
  try {
    // Use pandoc to extract the default reference template
    const result = execSync('pandoc --print-default-data-file reference.pptx', {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024, // 1MB should be plenty
    });
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to get pandoc reference template: ${message}`);
  }
}

/**
 * Generate a PPTX theme file by modifying pandoc's reference template
 */
export function generateThemeFile(themeName: string, outputPath: string): string {
  const theme = PPTX_THEMES[themeName];
  if (!theme) {
    throw new Error(`Unknown theme: ${themeName}`);
  }

  // Get pandoc's reference template as base
  const templateBuffer = getPandocReferenceTemplate();
  const zip = new AdmZip(templateBuffer);

  // Replace theme.xml with our custom theme
  zip.updateFile('ppt/theme/theme1.xml', Buffer.from(generateTheme(theme), 'utf-8'));

  // For dark themes, update slide masters and layouts with background color
  if (theme.background) {
    updateBackgroundColor(zip, theme.background);
  }

  // Ensure output directory exists
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  zip.writeZip(outputPath);
  return outputPath;
}

/**
 * Update background color in slide masters and layouts for dark themes
 */
function updateBackgroundColor(zip: AdmZip, bgColor: string): void {
  const entries = zip.getEntries();

  for (const entry of entries) {
    const name = entry.entryName;

    // Update slide masters and layouts
    if (name.includes('slideMasters/') || name.includes('slideLayouts/')) {
      if (name.endsWith('.xml') && !name.includes('_rels')) {
        let content = entry.getData().toString('utf-8');

        // Replace light background with dark background
        // Look for <a:schemeClr val="lt1"/> in bgPr and replace
        content = content.replace(
          /<p:bg>[\s\S]*?<\/p:bg>/g,
          `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${bgColor}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
        );

        zip.updateFile(name, Buffer.from(content, 'utf-8'));
      }
    }
  }
}

/**
 * Get path to bundled theme file, generating if needed
 */
export function getThemePath(themeName: string): string | null {
  if (!PPTX_THEMES[themeName]) {
    return null;
  }

  const themesDir = join(__dirname, 'pptx-themes');
  const themePath = join(themesDir, `${themeName}.pptx`);

  // Generate if doesn't exist
  if (!existsSync(themePath)) {
    if (!existsSync(themesDir)) {
      mkdirSync(themesDir, { recursive: true });
    }
    generateThemeFile(themeName, themePath);
  }

  return themePath;
}

/**
 * Generate all theme files
 */
export function generateAllThemes(outputDir: string): Array<{ theme: string; path: string }> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const results = [];
  for (const themeName of Object.keys(PPTX_THEMES)) {
    const outputPath = join(outputDir, `${themeName}.pptx`);
    generateThemeFile(themeName, outputPath);
    results.push({ theme: themeName, path: outputPath });
  }

  return results;
}
