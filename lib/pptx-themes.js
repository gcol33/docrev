/**
 * PPTX Theme System
 *
 * Provides 6 built-in themes for PPTX output, independent of Beamer themes.
 * Each theme is a reference PPTX file that defines colors, fonts, and slide layouts.
 *
 * Themes:
 * - default: Clean white with blue accents (professional)
 * - dark: Dark background with light text (modern)
 * - academic: Classic serif fonts, muted colors (scholarly)
 * - minimal: High contrast black/white (clean)
 * - corporate: Navy/gold color scheme (business)
 * - plant: Nature-inspired green theme (ecology/biology)
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Theme definitions with colors and fonts
 */
export const PPTX_THEMES = {
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
 * @returns {string[]}
 */
export function getThemeNames() {
  return Object.keys(PPTX_THEMES);
}

/**
 * Get theme definition by name
 * @param {string} name
 * @returns {object|null}
 */
export function getTheme(name) {
  return PPTX_THEMES[name] || null;
}

/**
 * Generate [Content_Types].xml
 */
function generateContentTypes() {
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
function generateRels() {
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
function generatePresentationRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>
</Relationships>`;
}

/**
 * Generate ppt/presentation.xml
 */
function generatePresentation() {
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
 * @param {object} theme - Theme definition
 */
function generateTheme(theme) {
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
 * Generate slide master with background
 * @param {object} theme - Theme definition
 */
function generateSlideMaster(theme) {
  // For dark themes, set explicit background
  let bgFill = '<a:solidFill><a:schemeClr val="lt1"/></a:solidFill>';
  if (theme.background) {
    bgFill = `<a:solidFill><a:srgbClr val="${theme.background}"/></a:solidFill>`;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgPr>
        ${bgFill}
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title Placeholder 1"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="838200" y="365125"/>
            <a:ext cx="10515600" cy="1325563"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/>
          <a:lstStyle>
            <a:lvl1pPr algn="l">
              <a:defRPr sz="4400" b="0">
                <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
                <a:latin typeface="+mj-lt"/>
                <a:ea typeface="+mj-ea"/>
                <a:cs typeface="+mj-cs"/>
              </a:defRPr>
            </a:lvl1pPr>
          </a:lstStyle>
          <a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Text Placeholder 2"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="body" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="838200" y="1825625"/>
            <a:ext cx="10515600" cy="4351338"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/>
          <a:lstStyle>
            <a:lvl1pPr marL="0" indent="0" algn="l">
              <a:buNone/>
              <a:defRPr sz="2800">
                <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
                <a:latin typeface="+mn-lt"/>
              </a:defRPr>
            </a:lvl1pPr>
            <a:lvl2pPr marL="457200" indent="0" algn="l">
              <a:buNone/>
              <a:defRPr sz="2400">
                <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
                <a:latin typeface="+mn-lt"/>
              </a:defRPr>
            </a:lvl2pPr>
            <a:lvl3pPr marL="914400" indent="0" algn="l">
              <a:buNone/>
              <a:defRPr sz="2000">
                <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
                <a:latin typeface="+mn-lt"/>
              </a:defRPr>
            </a:lvl3pPr>
            <a:lvl4pPr marL="1371600" indent="0" algn="l">
              <a:buNone/>
              <a:defRPr sz="1800">
                <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
                <a:latin typeface="+mn-lt"/>
              </a:defRPr>
            </a:lvl4pPr>
            <a:lvl5pPr marL="1828800" indent="0" algn="l">
              <a:buNone/>
              <a:defRPr sz="1800">
                <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
                <a:latin typeface="+mn-lt"/>
              </a:defRPr>
            </a:lvl5pPr>
          </a:lstStyle>
          <a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p>
          <a:p><a:pPr lvl="1"/><a:r><a:rPr lang="en-US"/><a:t>Second level</a:t></a:r></a:p>
          <a:p><a:pPr lvl="2"/><a:r><a:rPr lang="en-US"/><a:t>Third level</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="4" name="Slide Number Placeholder 3"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="sldNum" sz="quarter" idx="4"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="8610600" y="6356350"/>
            <a:ext cx="2743200" cy="365125"/>
          </a:xfrm>
          <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="ctr"/>
          <a:lstStyle>
            <a:lvl1pPr algn="r">
              <a:defRPr sz="1200">
                <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
              </a:defRPr>
            </a:lvl1pPr>
          </a:lstStyle>
          <a:p>
            <a:fld id="{B6F15528-21DE-4FAA-801F-C0D5B2D67AA7}" type="slidenum">
              <a:rPr lang="en-US" smtClean="0"/>
              <a:t>‹#›</a:t>
            </a:fld>
            <a:endParaRPr lang="en-US"/>
          </a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
    <p:sldLayoutId id="2147483650" r:id="rId2"/>
  </p:sldLayoutIdLst>
  <p:txStyles>
    <p:titleStyle>
      <a:lvl1pPr algn="l">
        <a:defRPr sz="4400" b="0" kern="1200">
          <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
          <a:latin typeface="+mj-lt"/>
          <a:ea typeface="+mj-ea"/>
          <a:cs typeface="+mj-cs"/>
        </a:defRPr>
      </a:lvl1pPr>
    </p:titleStyle>
    <p:bodyStyle>
      <a:lvl1pPr marL="0" indent="0" algn="l">
        <a:buNone/>
        <a:defRPr sz="2800" kern="1200">
          <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
          <a:latin typeface="+mn-lt"/>
          <a:ea typeface="+mn-ea"/>
          <a:cs typeface="+mn-cs"/>
        </a:defRPr>
      </a:lvl1pPr>
      <a:lvl2pPr marL="457200" indent="0" algn="l">
        <a:buNone/>
        <a:defRPr sz="2400" kern="1200">
          <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
          <a:latin typeface="+mn-lt"/>
        </a:defRPr>
      </a:lvl2pPr>
      <a:lvl3pPr marL="914400" indent="0" algn="l">
        <a:buNone/>
        <a:defRPr sz="2000" kern="1200">
          <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
          <a:latin typeface="+mn-lt"/>
        </a:defRPr>
      </a:lvl3pPr>
      <a:lvl4pPr marL="1371600" indent="0" algn="l">
        <a:buNone/>
        <a:defRPr sz="1800" kern="1200">
          <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
          <a:latin typeface="+mn-lt"/>
        </a:defRPr>
      </a:lvl4pPr>
      <a:lvl5pPr marL="1828800" indent="0" algn="l">
        <a:buNone/>
        <a:defRPr sz="1800" kern="1200">
          <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
          <a:latin typeface="+mn-lt"/>
        </a:defRPr>
      </a:lvl5pPr>
    </p:bodyStyle>
    <p:otherStyle>
      <a:defPPr><a:defRPr lang="en-US"/></a:defPPr>
    </p:otherStyle>
  </p:txStyles>
</p:sldMaster>`;
}

/**
 * Generate slide master relationships
 */
function generateSlideMasterRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;
}

/**
 * Generate title slide layout
 * @param {object} theme
 */
function generateTitleLayout(theme) {
  let bgFill = '<a:solidFill><a:schemeClr val="lt1"/></a:solidFill>';
  if (theme.background) {
    bgFill = `<a:solidFill><a:srgbClr val="${theme.background}"/></a:solidFill>`;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="title" preserve="1">
  <p:cSld name="Title Slide">
    <p:bg>
      <p:bgPr>
        ${bgFill}
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title 1"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="ctrTitle"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="1524000" y="1122363"/>
            <a:ext cx="9144000" cy="2387600"/>
          </a:xfrm>
        </p:spPr>
        <p:txBody>
          <a:bodyPr anchor="b"/>
          <a:lstStyle>
            <a:lvl1pPr algn="ctr">
              <a:defRPr sz="6000">
                <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
              </a:defRPr>
            </a:lvl1pPr>
          </a:lstStyle>
          <a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit title</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Subtitle 2"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="subTitle" idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="1524000" y="3602038"/>
            <a:ext cx="9144000" cy="1655762"/>
          </a:xfrm>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle>
            <a:lvl1pPr marL="0" indent="0" algn="ctr">
              <a:buNone/>
              <a:defRPr sz="2400">
                <a:solidFill><a:schemeClr val="dk1"/></a:solidFill>
              </a:defRPr>
            </a:lvl1pPr>
          </a:lstStyle>
          <a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit subtitle</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

/**
 * Generate content slide layout
 * @param {object} theme
 */
function generateContentLayout(theme) {
  let bgFill = '<a:solidFill><a:schemeClr val="lt1"/></a:solidFill>';
  if (theme.background) {
    bgFill = `<a:solidFill><a:srgbClr val="${theme.background}"/></a:solidFill>`;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="obj" preserve="1">
  <p:cSld name="Title and Content">
    <p:bg>
      <p:bgPr>
        ${bgFill}
        <a:effectLst/>
      </p:bgPr>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title 1"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph type="title"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:rPr lang="en-US"/><a:t>Click to edit title</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Content Placeholder 2"/>
          <p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>
          <p:nvPr><p:ph idx="1"/></p:nvPr>
        </p:nvSpPr>
        <p:spPr/>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit text</a:t></a:r></a:p>
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`;
}

/**
 * Generate slide layout relationships
 */
function generateSlideLayoutRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;
}

/**
 * Generate docProps/core.xml
 */
function generateCore(themeName) {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${themeName} Theme</dc:title>
  <dc:creator>docrev</dc:creator>
  <cp:lastModifiedBy>docrev</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

/**
 * Generate docProps/app.xml
 */
function generateApp() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>docrev</Application>
  <PresentationFormat>Widescreen</PresentationFormat>
  <Slides>0</Slides>
</Properties>`;
}

/**
 * Generate a PPTX theme file
 * @param {string} themeName - Theme name (key from PPTX_THEMES)
 * @param {string} outputPath - Output path for PPTX file
 */
export function generateThemeFile(themeName, outputPath) {
  const theme = PPTX_THEMES[themeName];
  if (!theme) {
    throw new Error(`Unknown theme: ${themeName}`);
  }

  const zip = new AdmZip();

  // Add files to zip
  zip.addFile('[Content_Types].xml', Buffer.from(generateContentTypes(), 'utf-8'));
  zip.addFile('_rels/.rels', Buffer.from(generateRels(), 'utf-8'));
  zip.addFile('ppt/_rels/presentation.xml.rels', Buffer.from(generatePresentationRels(), 'utf-8'));
  zip.addFile('ppt/presentation.xml', Buffer.from(generatePresentation(), 'utf-8'));
  zip.addFile('ppt/theme/theme1.xml', Buffer.from(generateTheme(theme), 'utf-8'));
  zip.addFile('ppt/slideMasters/slideMaster1.xml', Buffer.from(generateSlideMaster(theme), 'utf-8'));
  zip.addFile('ppt/slideMasters/_rels/slideMaster1.xml.rels', Buffer.from(generateSlideMasterRels(), 'utf-8'));
  zip.addFile('ppt/slideLayouts/slideLayout1.xml', Buffer.from(generateTitleLayout(theme), 'utf-8'));
  zip.addFile('ppt/slideLayouts/slideLayout2.xml', Buffer.from(generateContentLayout(theme), 'utf-8'));
  zip.addFile('ppt/slideLayouts/_rels/slideLayout1.xml.rels', Buffer.from(generateSlideLayoutRels(), 'utf-8'));
  zip.addFile('ppt/slideLayouts/_rels/slideLayout2.xml.rels', Buffer.from(generateSlideLayoutRels(), 'utf-8'));
  zip.addFile('docProps/core.xml', Buffer.from(generateCore(theme.name), 'utf-8'));
  zip.addFile('docProps/app.xml', Buffer.from(generateApp(), 'utf-8'));

  // Ensure output directory exists
  const dir = dirname(outputPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  zip.writeZip(outputPath);
  return outputPath;
}

/**
 * Get path to bundled theme file, generating if needed
 * @param {string} themeName - Theme name
 * @returns {string} Path to theme PPTX file
 */
export function getThemePath(themeName) {
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
 * @param {string} outputDir - Directory to write themes to
 */
export function generateAllThemes(outputDir) {
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
