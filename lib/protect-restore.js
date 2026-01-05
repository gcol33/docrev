/**
 * Protection and restoration utilities for markdown elements during Word import
 *
 * These functions protect special markdown syntax (anchors, cross-refs, math, citations,
 * images, tables) by replacing them with placeholders before diffing, then restore them after.
 */

/**
 * Extract markdown prefix (headers, list markers) from a line
 * @param {string} line
 * @returns {{prefix: string, content: string}}
 */
export function extractMarkdownPrefix(line) {
  // Headers
  const headerMatch = line.match(/^(#{1,6}\s+)/);
  if (headerMatch) {
    return { prefix: headerMatch[1], content: line.slice(headerMatch[1].length) };
  }

  // List items
  const listMatch = line.match(/^(\s*[-*+]\s+|\s*\d+\.\s+)/);
  if (listMatch) {
    return { prefix: listMatch[1], content: line.slice(listMatch[1].length) };
  }

  // Blockquotes
  const quoteMatch = line.match(/^(>\s*)/);
  if (quoteMatch) {
    return { prefix: quoteMatch[1], content: line.slice(quoteMatch[1].length) };
  }

  return { prefix: '', content: line };
}

/**
 * Protect figure/table anchors before diffing
 * Anchors like {#fig:heatmap} and {#tbl:results} should never be deleted
 * @param {string} md
 * @returns {{text: string, anchors: Array<{original: string, placeholder: string}>}}
 */
export function protectAnchors(md) {
  const anchors = [];

  // Match {#fig:label}, {#tbl:label}, {#eq:label}, {#sec:label} etc.
  // Also match with additional attributes like {#fig:label width=50%}
  const text = md.replace(/\{#(fig|tbl|eq|sec|lst):[^}]+\}/g, (match) => {
    const idx = anchors.length;
    const placeholder = `ANCHORBLOCK${idx}ENDANCHOR`;
    anchors.push({ original: match, placeholder });
    return placeholder;
  });

  return { text, anchors };
}

/**
 * Restore anchors from placeholders
 * @param {string} text
 * @param {Array} anchors
 * @returns {string}
 */
export function restoreAnchors(text, anchors) {
  for (const anchor of anchors) {
    // Handle case where anchor is inside a deletion annotation
    // {--...ANCHORBLOCK0ENDANCHOR--} should become {--...--}{#fig:label}
    const deletionPattern = new RegExp(`\\{--([^}]*?)${anchor.placeholder}([^}]*?)--\\}`, 'g');
    text = text.replace(deletionPattern, (match, before, after) => {
      const cleanBefore = before.trim();
      const cleanAfter = after.trim();
      let result = '';
      if (cleanBefore) result += `{--${cleanBefore}--}`;
      result += anchor.original;
      if (cleanAfter) result += `{--${cleanAfter}--}`;
      return result;
    });

    // Handle case where anchor is inside a substitution
    // {~~old ANCHORBLOCK0ENDANCHOR~>new~~} -> {~~old~>new~~}{#fig:label}
    const substitutionPattern = new RegExp(`\\{~~([^~]*?)${anchor.placeholder}([^~]*?)~>([^~]*)~~\\}`, 'g');
    text = text.replace(substitutionPattern, (match, oldBefore, oldAfter, newText) => {
      const cleanOldBefore = oldBefore.trim();
      const cleanOldAfter = oldAfter.trim();
      const cleanNew = newText.trim();
      const oldText = (cleanOldBefore + ' ' + cleanOldAfter).trim();
      let result = '';
      if (oldText !== cleanNew) {
        result += `{~~${oldText}~>${cleanNew}~~}`;
      } else {
        result += cleanNew;
      }
      result += anchor.original;
      return result;
    });

    // Normal replacement
    text = text.split(anchor.placeholder).join(anchor.original);
  }
  return text;
}

/**
 * Protect cross-references before diffing
 * References like @fig:label, @tbl:label should be preserved
 * @param {string} md
 * @returns {{text: string, crossrefs: Array<{original: string, placeholder: string}>}}
 */
export function protectCrossrefs(md) {
  const crossrefs = [];

  // Match @fig:label, @tbl:label, @eq:label, @sec:label
  // Can appear as @fig:label or (@fig:label) or [@fig:label]
  const text = md.replace(/@(fig|tbl|eq|sec|lst):[a-zA-Z0-9_-]+/g, (match) => {
    const idx = crossrefs.length;
    const placeholder = `XREFBLOCK${idx}ENDXREF`;
    crossrefs.push({ original: match, placeholder });
    return placeholder;
  });

  return { text, crossrefs };
}

/**
 * Restore cross-references from placeholders
 * @param {string} text
 * @param {Array} crossrefs
 * @returns {string}
 */
export function restoreCrossrefs(text, crossrefs) {
  for (const xref of crossrefs) {
    // Handle deletions - restore the reference even if marked deleted
    const deletionPattern = new RegExp(`\\{--([^}]*?)${xref.placeholder}([^}]*?)--\\}`, 'g');
    text = text.replace(deletionPattern, (match, before, after) => {
      const cleanBefore = before.trim();
      const cleanAfter = after.trim();
      let result = '';
      if (cleanBefore) result += `{--${cleanBefore}--}`;
      result += xref.original;
      if (cleanAfter) result += `{--${cleanAfter}--}`;
      return result;
    });

    // Handle substitutions where rendered form (Figure 1) replaced the reference
    // {~~XREFBLOCK0ENDXREF~>Figure 1~~} -> @fig:label
    const substitutionPattern = new RegExp(`\\{~~${xref.placeholder}~>[^~]+~~\\}`, 'g');
    text = text.replace(substitutionPattern, xref.original);

    // Normal replacement
    text = text.split(xref.placeholder).join(xref.original);
  }
  return text;
}

/**
 * Simplify LaTeX math for fuzzy matching against Word text
 * Word renders math as text, so we need to match the rendered form
 * @param {string} latex
 * @returns {string}
 */
export function simplifyMathForMatching(latex) {
  return latex
    // Remove common LaTeX commands
    .replace(/\\text\{([^}]+)\}/g, '$1')
    .replace(/\\hat\{([^}]+)\}/g, '$1')
    .replace(/\\bar\{([^}]+)\}/g, '$1')
    .replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1/$2')
    .replace(/\\sum_([a-z])/g, 'Σ')
    .replace(/\\sum/g, 'Σ')
    .replace(/\\cdot/g, '·')
    .replace(/\\quad/g, ' ')
    .replace(/\\,/g, ' ')
    .replace(/\\_/g, '_')
    .replace(/\\{/g, '{')
    .replace(/\\}/g, '}')
    .replace(/\\/g, '')  // Remove remaining backslashes
    .replace(/[{}]/g, '')  // Remove braces
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Protect mathematical notation before diffing by replacing with placeholders
 * Handles both inline $...$ and display $$...$$ math
 * @param {string} md
 * @returns {{text: string, mathBlocks: Array<{original: string, placeholder: string, type: string, simplified: string}>}}
 */
export function protectMath(md) {
  const mathBlocks = [];

  // First protect display math ($$...$$) - must be done before inline math
  let text = md.replace(/\$\$([^$]+)\$\$/g, (match, content) => {
    const idx = mathBlocks.length;
    const placeholder = `MATHBLOCK${idx}ENDMATH`;
    // Create simplified version for matching in Word text
    const simplified = simplifyMathForMatching(content);
    mathBlocks.push({ original: match, placeholder, type: 'display', simplified });
    return placeholder;
  });

  // Then protect inline math ($...$)
  text = text.replace(/\$([^$\n]+)\$/g, (match, content) => {
    const idx = mathBlocks.length;
    const placeholder = `MATHBLOCK${idx}ENDMATH`;
    const simplified = simplifyMathForMatching(content);
    mathBlocks.push({ original: match, placeholder, type: 'inline', simplified });
    return placeholder;
  });

  return { text, mathBlocks };
}

/**
 * Restore math from placeholders
 * @param {string} text
 * @param {Array} mathBlocks
 * @returns {string}
 */
export function restoreMath(text, mathBlocks) {
  for (const block of mathBlocks) {
    text = text.split(block.placeholder).join(block.original);
  }
  return text;
}

/**
 * Replace rendered math in Word text with matching placeholders
 * This is heuristic-based since Word can render math in various ways
 * @param {string} wordText
 * @param {Array} mathBlocks
 * @returns {string}
 */
export function replaceRenderedMath(wordText, mathBlocks) {
  let result = wordText;

  for (const block of mathBlocks) {
    // For inline math, try to find the simplified form in Word text
    if (block.simplified.length >= 2) {
      // Try exact match first
      if (result.includes(block.simplified)) {
        result = result.replace(block.simplified, block.placeholder);
      }
    }
  }

  return result;
}

/**
 * Protect citations before diffing by replacing with placeholders
 * @param {string} md
 * @returns {{text: string, citations: string[]}}
 */
export function protectCitations(md) {
  const citations = [];
  const text = md.replace(/\[@[^\]]+\]/g, (match) => {
    const idx = citations.length;
    citations.push(match);
    return `CITEREF${idx}ENDCITE`;
  });
  return { text, citations };
}

/**
 * Restore citations from placeholders
 * @param {string} text
 * @param {string[]} citations
 * @returns {string}
 */
export function restoreCitations(text, citations) {
  for (let i = 0; i < citations.length; i++) {
    // Handle cases where placeholder might be inside annotations
    const placeholder = `CITEREF${i}ENDCITE`;
    text = text.split(placeholder).join(citations[i]);
  }
  return text;
}

/**
 * Remove rendered citations from Word text (replace with matching placeholders)
 * @param {string} wordText
 * @param {number} count
 * @returns {string}
 */
export function replaceRenderedCitations(wordText, count) {
  // Match rendered citation patterns: (Author 2021), (Author et al. 2021), etc.
  const pattern = /\((?:[A-Z][a-zé]+(?:\s+et\s+al\.?)?(?:\s*[&,;]\s*[A-Z][a-zé]+(?:\s+et\s+al\.?)?)*\s+\d{4}(?:[a-z])?(?:\s*[,;]\s*(?:[A-Z][a-zé]+(?:\s+et\s+al\.?)?\s+)?\d{4}(?:[a-z])?)*)\)/g;

  let idx = 0;
  return wordText.replace(pattern, (match) => {
    if (idx < count) {
      const placeholder = `CITEREF${idx}ENDCITE`;
      idx++;
      return placeholder;
    }
    return match;
  });
}

/**
 * Protect markdown images before diffing by replacing with placeholders
 * Images are treated as atomic blocks to prevent corruption during diff
 *
 * Matches: ![caption](path){#fig:label} or ![caption](path)
 * Also matches Word-style: ![Figure N: caption](media/path)
 *
 * @param {string} md
 * @param {object} registry - Image registry from readImageRegistry() for matching
 * @returns {{text: string, images: Array<{original: string, placeholder: string, label: string|null, caption: string}>}}
 */
export function protectImages(md, registry = null) {
  const images = [];

  // Match markdown images: ![caption](path){#anchor} or ![caption](path)
  // The anchor is optional and can have additional attributes
  const imagePattern = /!\[([^\]]*)\]\(([^)]+)\)(?:\{([^}]+)\})?/g;

  const text = md.replace(imagePattern, (match, caption, path, anchor) => {
    const idx = images.length;
    const placeholder = `IMAGEBLOCK${idx}ENDIMAGE`;

    // Extract label from anchor if present (e.g., "#fig:map" -> "map")
    let label = null;
    if (anchor) {
      const labelMatch = anchor.match(/#(fig|tbl):([a-zA-Z0-9_-]+)/);
      if (labelMatch) {
        label = labelMatch[2];
      }
    }

    // Try to extract figure number from Word-style caption "Figure N: ..."
    let figureNumber = null;
    const figNumMatch = caption.match(/^(?:Figure|Fig\.?|Table|Tbl\.?)\s+(\d+|S\d+)[:\.]?\s*/i);
    if (figNumMatch) {
      figureNumber = figNumMatch[1];
    }

    images.push({
      original: match,
      placeholder,
      label,
      caption: caption.trim(),
      path,
      figureNumber,
    });

    return placeholder;
  });

  return { text, images };
}

/**
 * Restore images from placeholders
 * @param {string} text
 * @param {Array} images
 * @returns {string}
 */
export function restoreImages(text, images) {
  for (const img of images) {
    // Handle cases where placeholder might be inside annotations
    // {--IMAGEBLOCK0ENDIMAGE--} should restore the original image
    const deletionPattern = new RegExp(`\\{--[^}]*?${img.placeholder}[^}]*?--\\}`, 'g');
    text = text.replace(deletionPattern, img.original);

    const insertionPattern = new RegExp(`\\{\\+\\+[^}]*?${img.placeholder}[^}]*?\\+\\+\\}`, 'g');
    text = text.replace(insertionPattern, img.original);

    // Normal replacement
    text = text.split(img.placeholder).join(img.original);
  }
  return text;
}

/**
 * Match Word-extracted images to original images using registry
 * Returns a mapping of Word image placeholders to original image placeholders
 *
 * @param {Array} originalImages - Images from original markdown
 * @param {Array} wordImages - Images from Word-extracted text
 * @param {object} registry - Image registry for additional matching
 * @returns {Map<string, string>} Map of wordPlaceholder -> originalPlaceholder
 */
export function matchWordImagesToOriginal(originalImages, wordImages, registry = null) {
  const mapping = new Map();
  const usedOriginals = new Set();

  for (const wordImg of wordImages) {
    let bestMatch = null;
    let bestScore = 0;

    for (const origImg of originalImages) {
      if (usedOriginals.has(origImg.placeholder)) continue;

      let score = 0;

      // Match by label (most reliable)
      if (wordImg.label && origImg.label && wordImg.label === origImg.label) {
        score += 100;
      }

      // Match by figure number via registry
      if (wordImg.figureNumber && registry) {
        const entry = registry.byNumber?.get(`fig:${wordImg.figureNumber}`);
        if (entry && entry.label === origImg.label) {
          score += 90;
        }
      }

      // Match by caption similarity (first 50 chars, normalized)
      const wordCaption = wordImg.caption.replace(/^(?:Figure|Fig\.?|Table|Tbl\.?)\s+\d+[:\.]?\s*/i, '').toLowerCase().slice(0, 50);
      const origCaption = origImg.caption.toLowerCase().slice(0, 50);
      if (wordCaption && origCaption && wordCaption === origCaption) {
        score += 80;
      } else if (wordCaption && origCaption && (wordCaption.includes(origCaption.slice(0, 30)) || origCaption.includes(wordCaption.slice(0, 30)))) {
        score += 40;
      }

      // Match by path similarity (filename)
      const wordFile = wordImg.path.split('/').pop().toLowerCase();
      const origFile = origImg.path.split('/').pop().toLowerCase();
      if (wordFile === origFile) {
        score += 30;
      }

      if (score > bestScore) {
        bestScore = score;
        bestMatch = origImg;
      }
    }

    if (bestMatch && bestScore >= 40) {
      mapping.set(wordImg.placeholder, bestMatch.placeholder);
      usedOriginals.add(bestMatch.placeholder);
    }
  }

  return mapping;
}

/**
 * Protect markdown tables before diffing by replacing with placeholders
 * Tables are treated as atomic blocks to prevent corruption during diff
 * @param {string} md
 * @returns {{text: string, tables: Array<{original: string, placeholder: string, cellCount: number}>}}
 */
export function protectTables(md) {
  const tables = [];

  // Match markdown tables: lines starting with | and containing |
  // A table is: optional caption, header row, separator row (|---|), data rows
  const tablePattern = /(?:^(?:\*\*)?Table[^\n]*\n\n?)?(?:^\|[^\n]+\|\n)+/gm;

  const text = md.replace(tablePattern, (match) => {
    // Verify it's actually a table (has separator row with dashes)
    if (!match.includes('|---') && !match.includes('| ---') && !match.includes('|:--')) {
      return match; // Not a real table, just lines with pipes
    }

    const idx = tables.length;
    const placeholder = `\n\nTABLEBLOCK${idx}ENDTABLE\n\n`;

    // Count cells for matching in Word (approximate)
    const cellCount = (match.match(/\|/g) || []).length;

    tables.push({ original: match.trim(), placeholder: placeholder.trim(), cellCount });
    return placeholder;
  });

  return { text, tables };
}

/**
 * Restore tables from placeholders
 * @param {string} text
 * @param {Array} tables
 * @returns {string}
 */
export function restoreTables(text, tables) {
  for (const table of tables) {
    // Handle cases where placeholder might be inside annotations
    // For tables, we want to preserve the original if it wasn't changed
    const deletionPattern = new RegExp(`\\{--[^}]*?${table.placeholder}[^}]*?--\\}`, 'g');
    text = text.replace(deletionPattern, table.original);

    const insertionPattern = new RegExp(`\\{\\+\\+[^}]*?${table.placeholder}[^}]*?\\+\\+\\}`, 'g');
    text = text.replace(insertionPattern, table.original);

    // Normal replacement
    text = text.split(table.placeholder).join(table.original);
  }
  return text;
}
