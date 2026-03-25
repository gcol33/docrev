/**
 * Post-extraction reference restoration and comment parsing
 */

import { readImageRegistry } from './image-registry.js';

// ============================================
// Type Definitions
// ============================================

export interface RestoreCrossrefResult {
  text: string;
  restored: number;
  messages: string[];
  restoredLabels: Set<string>;
}

export interface RestoreImagesResult {
  text: string;
  restored: number;
  messages: string[];
}

// ============================================
// Functions
// ============================================

/**
 * Parse visible comment markers from Word text
 */
export function parseVisibleComments(text: string): Array<{ author: string; text: string; position: number }> {
  const comments: Array<{ author: string; text: string; position: number }> = [];
  const pattern = /\[([^\]:]+):\s*([^\]]+)\]/g;

  let match;
  while ((match = pattern.exec(text)) !== null) {
    comments.push({
      author: match[1].trim(),
      text: match[2].trim(),
      position: match.index,
    });
  }

  return comments;
}

/**
 * Convert visible comments to CriticMarkup format
 */
export function convertVisibleComments(text: string): string {
  return text.replace(/\[([^\]:]+):\s*([^\]]+)\]/g, '{>>$1: $2<<}');
}

/**
 * Restore pandoc-crossref figure/table references from Word-rendered format
 */
export function restoreCrossrefFromWord(
  text: string,
  projectDir: string,
  restoredLabels: Set<string> | null = null
): RestoreCrossrefResult {
  const messages: string[] = [];
  let restored = 0;
  let result = text;

  const registry = readImageRegistry(projectDir);

  if (!restoredLabels) {
    restoredLabels = new Set<string>();
  }

  // Pattern 1: [Figure]{.mark} [N]{.mark}
  result = result.replace(/\[(Figure|Table|Fig\.?)\]\{\.mark\}\s*\[(\d+|S\d+)\]\{\.mark\}/gi, (match, type, num) => {
    const prefix = type.toLowerCase().startsWith('tab') ? 'tbl' : 'fig';
    if (registry) {
      const entry = registry.byNumber?.get(`${prefix}:${num}`);
      if (entry && entry.label) {
        restored++;
        return `@${prefix}:${entry.label}`;
      }
    }
    restored++;
    messages.push(`Restored ${type} ${num} (no label found, using placeholder)`);
    return `@${prefix}:fig${num}`;
  });

  // Pattern 2: Plain "Figure N" or "Fig. N"
  result = result.replace(/(?<!!)\b(Figure|Fig\.?|Table|Tbl\.?)\s+(\d+|S\d+)\b(?!\s*:)/gi, (match, type, num) => {
    const prefix = type.toLowerCase().startsWith('tab') ? 'tbl' : 'fig';
    if (registry) {
      const entry = registry.byNumber?.get(`${prefix}:${num}`);
      if (entry && entry.label) {
        restored++;
        return `@${prefix}:${entry.label}`;
      }
    }
    return match;
  });

  // Pattern 3: Remove duplicate plain-text captions
  result = result.replace(/(\!\[[^\]]+\]\([^)]+\)(?:\{[^}]*\})?)\s*\n+\s*(?:Figure|Fig\.?|Table|Tbl\.?)\s+\d+[:\.]?\s*[^\n]+/gi, '$1');

  // Pattern 4: Clean up image captions that start with "Figure N: "
  result = result.replace(/!\[(Figure|Fig\.?|Table|Tbl\.?)\s+(\d+|S\d+)[:\.]?\s*([^\]]*)\]\(([^)]+)\)(?:\{[^}]*\})?/gi,
    (match, type, num, caption, imgPath) => {
      const prefix = type.toLowerCase().startsWith('tab') ? 'tbl' : 'fig';
      const labelKey = `${prefix}:${num}`;

      if (registry) {
        const entry = registry.byNumber?.get(labelKey);
        if (entry) {
          if (restoredLabels!.has(labelKey)) {
            messages.push(`Skipped duplicate ${prefix}:${entry.label} (already restored)`);
            return `![${entry.caption}](${entry.path})`;
          }
          restoredLabels!.add(labelKey);
          restored++;
          messages.push(`Restored image ${prefix}:${entry.label} from Figure ${num}`);
          return `![${entry.caption}](${entry.path}){#${prefix}:${entry.label}}`;
        }
      }
      const cleanCaption = caption.trim();
      return `![${cleanCaption}](${imgPath})`;
    });

  return { text: result, restored, messages, restoredLabels };
}

/**
 * Restore proper markdown image syntax from Word-extracted text using image registry
 */
export function restoreImagesFromRegistry(
  text: string,
  projectDir: string,
  restoredLabels: Set<string> | null = null
): RestoreImagesResult {
  const messages: string[] = [];
  let restored = 0;

  const registry = readImageRegistry(projectDir);
  if (!registry || !registry.figures || registry.figures.length === 0) {
    return { text, restored: 0, messages: ['No image registry found'] };
  }

  if (!restoredLabels) {
    restoredLabels = new Set<string>();
  }

  let result = text;

  // Pattern 1: Caption-like text
  const captionPatterns = [
    /@(fig|tbl):([a-zA-Z0-9_-]+):\s*([^\n]+)/gi,
    /^(Figure|Fig\.?)\s+(\d+|S\d+)[.:]\s*([^\n]+)/gim,
    /\|\s*@(fig|tbl):([a-zA-Z0-9_-]+):\s*([^|]+)\s*\|/gi,
  ];

  // Fix @fig:label: caption patterns
  result = result.replace(captionPatterns[0], (match, type, label, caption) => {
    const key = `${type}:${label}`;
    const entry = registry.byLabel.get(key);
    if (entry) {
      if (restoredLabels!.has(key)) {
        messages.push(`Skipped duplicate ${key} (already restored)`);
        return `![${entry.caption}](${entry.path})`;
      }
      restoredLabels!.add(key);
      restored++;
      messages.push(`Restored ${type}:${label} from registry`);
      return `![${entry.caption}](${entry.path}){#${type}:${label}}`;
    }
    return match;
  });

  // Fix table-wrapped captions
  result = result.replace(captionPatterns[2], (match, type, label, caption) => {
    const key = `${type}:${label}`;
    const entry = registry.byLabel.get(key);
    if (entry) {
      if (restoredLabels!.has(key)) {
        messages.push(`Skipped duplicate ${key} from table wrapper`);
        return `![${entry.caption}](${entry.path})`;
      }
      restoredLabels!.add(key);
      restored++;
      messages.push(`Restored ${type}:${label} from table wrapper`);
      return `![${entry.caption}](${entry.path}){#${type}:${label}}`;
    }
    return match;
  });

  // Clean up empty table structures
  result = result.replace(/\|\s*\|\s*\n\|:--:\|\s*\n/g, '');

  // Fix "Figure N:" standalone lines
  result = result.replace(captionPatterns[1], (match, prefix, num, caption) => {
    const numKey = `fig:${num}`;
    const entry = registry.byNumber.get(numKey);
    if (entry) {
      const labelKey = `fig:${entry.label}`;
      if (restoredLabels!.has(labelKey)) {
        messages.push(`Skipped duplicate Figure ${num} (already restored)`);
        return `![${entry.caption}](${entry.path})`;
      }
      restoredLabels!.add(labelKey);
      restored++;
      messages.push(`Restored Figure ${num} by number lookup`);
      return `![${entry.caption}](${entry.path}){#fig:${entry.label}}`;
    }
    return match;
  });

  // Fix generic media paths by matching caption text
  const genericImagePattern = /!\[([^\]]*)\]\(media\/[^)]+\)/g;
  result = result.replace(genericImagePattern, (match, caption) => {
    if (!caption || caption.trim() === '') {
      return match;
    }

    const captionKey = caption.slice(0, 50).toLowerCase().trim();
    const entry = registry.byCaption.get(captionKey);
    if (entry) {
      const labelKey = entry.label ? `${entry.type}:${entry.label}` : null;
      if (labelKey && restoredLabels!.has(labelKey)) {
        messages.push(`Skipped duplicate by caption match: ${captionKey.slice(0, 30)}...`);
        return `![${entry.caption}](${entry.path})`;
      }
      if (labelKey) {
        restoredLabels!.add(labelKey);
      }
      restored++;
      messages.push(`Restored image by caption match: ${captionKey.slice(0, 30)}...`);
      const anchor = (entry.label && !restoredLabels!.has(labelKey!)) ? `{#${entry.type}:${entry.label}}` : '';
      return `![${entry.caption}](${entry.path})${anchor}`;
    }
    return match;
  });

  return { text: result, restored, messages };
}
