/**
 * Tests for PPTX post-processing (TypeScript/AdmZip implementation)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';

import {
  injectSlideNumbers,
  injectLogosIntoSlides,
  applyThemeFonts,
  applyCentering,
  applyBuildupColors,
} from '../lib/pptx-template.js';

// =============================================================================
// Test Helpers
// =============================================================================

/** Create a minimal valid PPTX from slide XMLs and optional extras */
function createTestPptx(
  slides: Record<string, string>,
  extras?: Record<string, string | Buffer>
): Buffer {
  const zip = new AdmZip();

  zip.addFile('[Content_Types].xml', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '</Types>'
  ));

  zip.addFile('ppt/presentation.xml', Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>'
  ));

  for (const [name, content] of Object.entries(slides)) {
    zip.addFile(name, Buffer.from(content, 'utf-8'));
  }

  if (extras) {
    for (const [name, content] of Object.entries(extras)) {
      zip.addFile(name, typeof content === 'string' ? Buffer.from(content, 'utf-8') : content);
    }
  }

  return zip.toBuffer();
}

/** Title slide XML (no footer, no body → should NOT get slide number) */
function titleSlideXml(): string {
  return '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
}

/** Content slide XML (has footer + body → should get slide number) */
function contentSlideXml(titleText = 'Slide Title', bodyText = 'Bullet item'): string {
  return '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>${titleText}</a:t></a:r></a:p></p:txBody></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr/><a:t>${bodyText}</a:t></a:r></a:p></p:txBody></p:sp>` +
    '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Footer"/><p:cNvSpPr/><p:nvPr><p:ph type="ftr"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Footer</a:t></a:r></a:p></p:txBody></p:sp>' +
    '</p:spTree></p:cSld></p:sld>';
}

/** Content slide with buildup animation markers */
function buildupSlideXml(): string {
  return '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Buildup Title</a:t></a:r></a:p></p:txBody></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>' +
    '<a:p><a:pPr lvl="0"/><a:r><a:rPr/><a:t>First bullet</a:t></a:r></a:p>' +
    '<a:p><a:pPr lvl="0"/><a:r><a:rPr/><a:t>Second bullet</a:t></a:r></a:p>' +
    '<a:p><a:pPr lvl="0"/><a:r><a:rPr/><a:t>Last bullet</a:t></a:r></a:p>' +
    '</p:txBody></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Footer"/><p:cNvSpPr/><p:nvPr><p:ph type="ftr"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>Footer</a:t></a:r></a:p></p:txBody></p:sp>' +
    '</p:spTree></p:cSld><p:transition><p:animEffect/></p:transition></p:sld>';
}

/** Content slide with font references for theme font test */
function fontSlideXml(): string {
  return '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr><a:latin typeface="Calibri"/></a:rPr><a:t>Hello</a:t></a:r></a:p><a:p><a:r><a:rPr><a:latin typeface="Arial"/></a:rPr><a:t>World</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';
}

/** Content slide with centering-testable elements */
function centerableSlideXml(): string {
  return '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>No pPr paragraph</a:t></a:r></a:p></p:txBody></p:sp>' +
    '<p:sp><p:nvSpPr><p:cNvPr id="4" name="Footer"/><p:cNvSpPr/><p:nvPr><p:ph type="ftr"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="l"/><a:r><a:rPr/><a:t>Footer</a:t></a:r></a:p></p:txBody></p:sp>' +
    '</p:spTree></p:cSld></p:sld>';
}

/** Read a slide entry back from a PPTX file */
function readSlideFromPptx(pptxPath: string, slideName: string): string {
  const zip = new AdmZip(pptxPath);
  const entry = zip.getEntry(slideName);
  return entry ? entry.getData().toString('utf-8') : '';
}

/** Read any entry from a PPTX file */
function readEntryFromPptx(pptxPath: string, entryName: string): string {
  const zip = new AdmZip(pptxPath);
  const entry = zip.getEntry(entryName);
  return entry ? entry.getData().toString('utf-8') : '';
}

// =============================================================================
// Tests
// =============================================================================

let tmpDir: string;
let pptxPath: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `docrev-pptx-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
  pptxPath = join(tmpDir, 'test.pptx');
});

afterEach(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// -----------------------------------------------------------------------------
// injectSlideNumbers
// -----------------------------------------------------------------------------

describe('injectSlideNumbers', () => {
  it('should inject sequential numbers into content slides', async () => {
    const buf = createTestPptx({
      'ppt/slides/slide1.xml': titleSlideXml(),
      'ppt/slides/slide2.xml': contentSlideXml('Slide A'),
      'ppt/slides/slide3.xml': contentSlideXml('Slide B'),
    });
    writeFileSync(pptxPath, buf);

    await injectSlideNumbers(pptxPath);

    const slide1 = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');
    const slide2 = readSlideFromPptx(pptxPath, 'ppt/slides/slide2.xml');
    const slide3 = readSlideFromPptx(pptxPath, 'ppt/slides/slide3.xml');

    // Title slide should NOT have slide number
    assert.ok(!slide1.includes('type="sldNum"'), 'Title slide should not get sldNum');

    // Content slides should have slide numbers
    assert.ok(slide2.includes('type="sldNum"'), 'Content slide 2 should have sldNum');
    assert.ok(slide3.includes('type="sldNum"'), 'Content slide 3 should have sldNum');

    // Verify sequential numbering
    assert.ok(slide2.includes('<a:t>1</a:t>'), 'Slide 2 should be numbered 1');
    assert.ok(slide3.includes('<a:t>2</a:t>'), 'Slide 3 should be numbered 2');
  });

  it('should skip slides that already have sldNum', async () => {
    const slideWithNum = contentSlideXml().replace(
      '</p:spTree>',
      '<p:sp><p:nvSpPr><p:cNvPr id="99" name="SN"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr/><a:t>X</a:t></a:r></a:p></p:txBody></p:sp></p:spTree>'
    );

    const buf = createTestPptx({
      'ppt/slides/slide1.xml': slideWithNum,
      'ppt/slides/slide2.xml': contentSlideXml(),
    });
    writeFileSync(pptxPath, buf);

    await injectSlideNumbers(pptxPath);

    const slide1 = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');
    const slide2 = readSlideFromPptx(pptxPath, 'ppt/slides/slide2.xml');

    // Slide 1 already had sldNum, should not get another
    const sldNumCount = (slide1.match(/type="sldNum"/g) || []).length;
    assert.strictEqual(sldNumCount, 1, 'Should not add duplicate sldNum');

    // Slide 2 should be numbered 1 (the only content slide that needed numbering)
    assert.ok(slide2.includes('<a:t>1</a:t>'), 'Slide 2 should be numbered 1');
  });

  it('should handle missing file gracefully', async () => {
    await injectSlideNumbers('/nonexistent/test.pptx');
    // Should not throw
  });
});

// -----------------------------------------------------------------------------
// applyThemeFonts
// -----------------------------------------------------------------------------

describe('applyThemeFonts', () => {
  it('should replace default fonts with theme minor font reference', async () => {
    const buf = createTestPptx({
      'ppt/slides/slide1.xml': fontSlideXml(),
    });
    writeFileSync(pptxPath, buf);

    await applyThemeFonts(pptxPath, { fonts: { major: 'Aptos Display', minor: 'Aptos' } });

    const slide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');
    assert.ok(slide.includes('typeface="+mn-lt"'), 'Should have theme font reference');
    assert.ok(!slide.includes('typeface="Calibri"'), 'Should not have Calibri');
    assert.ok(!slide.includes('typeface="Arial"'), 'Should not have Arial');
  });

  it('should not modify non-default fonts', async () => {
    const customFontSlide = '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name=""/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr><a:latin typeface="Comic Sans MS"/></a:rPr><a:t>Fun</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>';

    const buf = createTestPptx({ 'ppt/slides/slide1.xml': customFontSlide });
    writeFileSync(pptxPath, buf);

    await applyThemeFonts(pptxPath, { fonts: { major: 'Aptos', minor: 'Aptos' } });

    const slide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');
    assert.ok(slide.includes('typeface="Comic Sans MS"'), 'Custom font should be preserved');
  });

  it('should handle missing fonts config gracefully', async () => {
    const buf = createTestPptx({ 'ppt/slides/slide1.xml': fontSlideXml() });
    writeFileSync(pptxPath, buf);

    await applyThemeFonts(pptxPath, {});
    await applyThemeFonts(pptxPath, { fonts: {} });
    // Should not throw
  });
});

// -----------------------------------------------------------------------------
// applyCentering
// -----------------------------------------------------------------------------

describe('applyCentering', () => {
  it('should add algn="ctr" to existing pPr elements', async () => {
    const buf = createTestPptx({
      'ppt/slides/slide1.xml': centerableSlideXml(),
    });
    writeFileSync(pptxPath, buf);

    await applyCentering(pptxPath, [1]);

    const slide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');

    // Title shape should have centering (replaces algn="l")
    assert.ok(slide.includes('algn="ctr"'), 'Should have center alignment');

    // Extract the title shape and verify it was centered
    const titleMatch = slide.match(/<p:sp>.*?type="title".*?<\/p:sp>/s);
    assert.ok(titleMatch, 'Title shape should exist');
    assert.ok(titleMatch[0].includes('algn="ctr"'), 'Title should have center alignment');
    assert.ok(!titleMatch[0].includes('algn="l"'), 'Title should not have left alignment');
  });

  it('should add pPr to paragraphs without it', async () => {
    const buf = createTestPptx({
      'ppt/slides/slide1.xml': centerableSlideXml(),
    });
    writeFileSync(pptxPath, buf);

    await applyCentering(pptxPath, [1]);

    const slide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');

    // The "No pPr paragraph" content shape had <a:p><a:r> without pPr
    // Should now have <a:pPr algn="ctr"/> inserted
    assert.ok(slide.includes('<a:pPr algn="ctr"/>'), 'Should insert pPr with centering');
  });

  it('should skip footer and sldNum placeholders', async () => {
    const buf = createTestPptx({
      'ppt/slides/slide1.xml': centerableSlideXml(),
    });
    writeFileSync(pptxPath, buf);

    await applyCentering(pptxPath, [1]);

    const slide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');

    // Extract the footer shape — it should still have algn="l" (not changed to ctr)
    const footerMatch = slide.match(/<p:sp>.*?type="ftr".*?<\/p:sp>/s);
    assert.ok(footerMatch, 'Footer shape should exist');
    assert.ok(footerMatch[0].includes('algn="l"'), 'Footer should keep original alignment');
  });

  it('should not modify slides not in index list', async () => {
    const buf = createTestPptx({
      'ppt/slides/slide1.xml': centerableSlideXml(),
      'ppt/slides/slide2.xml': centerableSlideXml(),
    });
    writeFileSync(pptxPath, buf);

    await applyCentering(pptxPath, [1]); // Only center slide 1

    const slide2 = readSlideFromPptx(pptxPath, 'ppt/slides/slide2.xml');
    assert.ok(slide2.includes('algn="l"'), 'Non-centered slide should keep original alignment');
  });

  it('should handle empty indices gracefully', async () => {
    const buf = createTestPptx({ 'ppt/slides/slide1.xml': centerableSlideXml() });
    writeFileSync(pptxPath, buf);

    await applyCentering(pptxPath, []);
    // Should not throw
  });
});

// -----------------------------------------------------------------------------
// injectLogosIntoSlides
// -----------------------------------------------------------------------------

describe('injectLogosIntoSlides', () => {
  it('should inject logo images and update rels', async () => {
    const slide1Rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>';

    const buf = createTestPptx(
      { 'ppt/slides/slide1.xml': titleSlideXml() },
      { 'ppt/slides/_rels/slide1.xml.rels': slide1Rels }
    );
    writeFileSync(pptxPath, buf);

    // Create minimal logo files (1x1 transparent PNGs are not needed; any buffer works)
    const mediaDir = join(tmpDir, 'media');
    mkdirSync(mediaDir, { recursive: true });
    // Minimal valid PNG (1x1 red pixel)
    const pngHeader = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE
    ]);
    writeFileSync(join(mediaDir, 'logo-left.png'), pngHeader);
    writeFileSync(join(mediaDir, 'logo-right.png'), pngHeader);

    await injectLogosIntoSlides(pptxPath, mediaDir);

    // Verify [Content_Types].xml has png
    const contentTypes = readEntryFromPptx(pptxPath, '[Content_Types].xml');
    assert.ok(contentTypes.includes('Extension="png"'), 'Should have PNG content type');

    // Verify rels updated
    const rels = readEntryFromPptx(pptxPath, 'ppt/slides/_rels/slide1.xml.rels');
    assert.ok(rels.includes('rId2'), 'Should have rId2 for right logo');
    assert.ok(rels.includes('rId3'), 'Should have rId3 for left logo');
    assert.ok(rels.includes('relationships/image'), 'Should have image relationship type');

    // Verify slide1 has picture elements
    const slide1 = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');
    assert.ok(slide1.includes('<p:pic>'), 'Should have picture elements');
    assert.ok(slide1.includes('r:embed="rId2"'), 'Should reference right logo');
    assert.ok(slide1.includes('r:embed="rId3"'), 'Should reference left logo');

    // Verify image files added
    const zip = new AdmZip(pptxPath);
    const imageEntries = zip.getEntries().filter(e => e.entryName.startsWith('ppt/media/image'));
    assert.strictEqual(imageEntries.length, 2, 'Should have 2 image entries');
  });

  it('should handle only left logo', async () => {
    const slide1Rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>';
    const buf = createTestPptx(
      { 'ppt/slides/slide1.xml': titleSlideXml() },
      { 'ppt/slides/_rels/slide1.xml.rels': slide1Rels }
    );
    writeFileSync(pptxPath, buf);

    const mediaDir = join(tmpDir, 'media');
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(join(mediaDir, 'logo-left.png'), Buffer.from('fake-png'));

    await injectLogosIntoSlides(pptxPath, mediaDir);

    const rels = readEntryFromPptx(pptxPath, 'ppt/slides/_rels/slide1.xml.rels');
    assert.ok(rels.includes('rId2'), 'Should have rId2 for left logo');

    const zip = new AdmZip(pptxPath);
    const imageEntries = zip.getEntries().filter(e => e.entryName.startsWith('ppt/media/image'));
    assert.strictEqual(imageEntries.length, 1, 'Should have 1 image entry');
  });

  it('should not add png content type if already present', async () => {
    const contentTypesWithPng = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="png" ContentType="image/png"/><Default Extension="xml" ContentType="application/xml"/></Types>';
    const slide1Rels = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="test"/></Relationships>';

    // Build PPTX with custom [Content_Types].xml that already has PNG
    const zip = new AdmZip();
    zip.addFile('[Content_Types].xml', Buffer.from(contentTypesWithPng));
    zip.addFile('ppt/presentation.xml', Buffer.from('<p:presentation/>'));
    zip.addFile('ppt/slides/slide1.xml', Buffer.from(titleSlideXml()));
    zip.addFile('ppt/slides/_rels/slide1.xml.rels', Buffer.from(slide1Rels));
    writeFileSync(pptxPath, zip.toBuffer());

    const mediaDir = join(tmpDir, 'media');
    mkdirSync(mediaDir, { recursive: true });
    writeFileSync(join(mediaDir, 'logo-right.png'), Buffer.from('fake'));

    await injectLogosIntoSlides(pptxPath, mediaDir);

    const ct = readEntryFromPptx(pptxPath, '[Content_Types].xml');
    const count = (ct.match(/Extension="png"/g) || []).length;
    assert.strictEqual(count, 1, 'Should not duplicate PNG content type');
  });

  it('should handle null/missing media dir gracefully', async () => {
    const buf = createTestPptx({ 'ppt/slides/slide1.xml': titleSlideXml() });
    writeFileSync(pptxPath, buf);

    await injectLogosIntoSlides(pptxPath, null);
    await injectLogosIntoSlides(pptxPath, '/nonexistent/dir');
    // Should not throw
  });
});

// -----------------------------------------------------------------------------
// applyBuildupColors
// -----------------------------------------------------------------------------

describe('applyBuildupColors', () => {
  it('should apply grey to non-last bullets and accent to last on buildup slides', async () => {
    const buf = createTestPptx({
      'ppt/slides/slide1.xml': buildupSlideXml(),
    });
    writeFileSync(pptxPath, buf);

    await applyBuildupColors(pptxPath, {
      default: '608C32',
      grey: '888888',
      accent: 'FF0000',
    });

    const slide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');

    // Should have grey color (888888) for first two bullets
    assert.ok(slide.includes('val="888888"'), 'Should have grey color for non-last bullets');
    // Should have accent color (FF0000) for last bullet
    assert.ok(slide.includes('val="FF0000"'), 'Should have accent color for last bullet');
  });

  it('should apply title color to title placeholder', async () => {
    const buf = createTestPptx({
      'ppt/slides/slide1.xml': buildupSlideXml(),
    });
    writeFileSync(pptxPath, buf);

    await applyBuildupColors(pptxPath, {
      default: '608C32',
      title: 'AA0000',
    });

    const slide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');
    assert.ok(slide.includes('val="AA0000"'), 'Should have title color');
  });

  it('should apply default color on non-buildup slides', async () => {
    const buf = createTestPptx({
      'ppt/slides/slide1.xml': contentSlideXml(),
    });
    writeFileSync(pptxPath, buf);

    await applyBuildupColors(pptxPath, { default: '123456' });

    const slide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');
    assert.ok(slide.includes('val="123456"'), 'Should have default color');
  });

  it('should respect enabled=false', async () => {
    const buf = createTestPptx({
      'ppt/slides/slide1.xml': buildupSlideXml(),
    });
    writeFileSync(pptxPath, buf);
    const originalSlide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');

    await applyBuildupColors(pptxPath, { enabled: false });

    const slide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');
    assert.strictEqual(slide, originalSlide, 'Should not modify when disabled');
  });

  it('should strip # from color values', async () => {
    const buf = createTestPptx({
      'ppt/slides/slide1.xml': contentSlideXml(),
    });
    writeFileSync(pptxPath, buf);

    await applyBuildupColors(pptxPath, { default: '#AABBCC' });

    const slide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');
    assert.ok(slide.includes('val="AABBCC"'), 'Should strip # from color');
    assert.ok(!slide.includes('val="#AABBCC"'), 'Should not have # in color value');
  });

  it('should use fallback colors when not specified', async () => {
    const buf = createTestPptx({
      'ppt/slides/slide1.xml': buildupSlideXml(),
    });
    writeFileSync(pptxPath, buf);

    await applyBuildupColors(pptxPath, {}); // All defaults

    const slide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');
    // Default color is 608C32, grey is 888888
    assert.ok(slide.includes('val="608C32"'), 'Should use default color 608C32');
    assert.ok(slide.includes('val="888888"'), 'Should use default grey 888888');
  });

  it('should handle self-closing rPr with attributes', async () => {
    // Slide with <a:rPr lang="en-US"/> (self-closing with attrs)
    const slideWithAttrs = '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
      '<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>' +
      '<p:sp><p:nvSpPr><p:cNvPr id="3" name="Content"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US" dirty="0"/><a:t>Text</a:t></a:r></a:p></p:txBody></p:sp>' +
      '</p:spTree></p:cSld></p:sld>';

    const buf = createTestPptx({ 'ppt/slides/slide1.xml': slideWithAttrs });
    writeFileSync(pptxPath, buf);

    await applyBuildupColors(pptxPath, { default: 'ABCDEF' });

    const slide = readSlideFromPptx(pptxPath, 'ppt/slides/slide1.xml');
    // Should preserve attributes and add solidFill
    assert.ok(slide.includes('lang="en-US"'), 'Should preserve lang attribute');
    assert.ok(slide.includes('<a:solidFill>'), 'Should add solidFill');
    assert.ok(slide.includes('val="ABCDEF"'), 'Should have correct color');
    // rPr should no longer be self-closing
    assert.ok(!slide.includes('<a:rPr lang="en-US"/>'), 'Should convert self-closing to open/close');
  });
});
