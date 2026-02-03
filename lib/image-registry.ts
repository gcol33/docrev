/**
 * Image registry utilities for tracking figures and tables in markdown documents
 *
 * The registry maps figure/table labels and display numbers to source paths,
 * enabling Word import to match rendered figures back to original sources.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Image registry entry
 */
interface ImageEntry {
  caption: string;
  path: string;
  label: string | null;
  type: 'fig' | 'tbl';
  number?: string;
}

/**
 * Image registry
 */
interface ImageRegistry {
  figures: ImageEntry[];
  byLabel: Map<string, ImageEntry>;
  byNumber: Map<string, ImageEntry>;
  byCaption: Map<string, ImageEntry>;
}

/**
 * Crossref registry info
 */
interface CrossrefInfo {
  num: number;
  isSupp: boolean;
}

/**
 * Crossref registry
 */
interface CrossrefRegistry {
  figures: Map<string, CrossrefInfo>;
  tables: Map<string, CrossrefInfo>;
}

/**
 * Saved registry data
 */
interface RegistryData {
  version: number;
  created: string;
  figures: ImageEntry[];
}

/**
 * Pattern to extract markdown images with optional pandoc-crossref anchors
 * Captures: ![caption](path){#fig:label} or ![caption](path)
 * Groups: [1] = caption, [2] = path, [3] = label type (fig/tbl), [4] = label
 */
export const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)(?:\{#(fig|tbl):([^}]+)\})?/g;

/**
 * Build image registry from markdown content
 * Maps figure labels and display numbers to source paths
 */
export function buildImageRegistry(
  content: string,
  crossrefRegistry: CrossrefRegistry | null = null
): ImageRegistry {
  const figures: ImageEntry[] = [];
  const byLabel = new Map<string, ImageEntry>();
  const byNumber = new Map<string, ImageEntry>();
  const byCaption = new Map<string, ImageEntry>();

  IMAGE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = IMAGE_PATTERN.exec(content)) !== null) {
    const caption = match[1];
    const imagePath = match[2];
    const labelType = match[3] as 'fig' | 'tbl' | undefined; // 'fig' or 'tbl' or undefined
    const label = match[4]; // label without prefix

    const entry: ImageEntry = {
      caption,
      path: imagePath,
      label: label || null,
      type: labelType || 'fig',
    };

    // Add display number if we have a crossref registry
    if (label && crossrefRegistry) {
      const info = crossrefRegistry.figures.get(label) || crossrefRegistry.tables.get(label);
      if (info) {
        entry.number = info.isSupp ? `S${info.num}` : `${info.num}`;
        byNumber.set(`${entry.type}:${entry.number}`, entry);
      }
    }

    figures.push(entry);

    if (label) {
      byLabel.set(`${labelType || 'fig'}:${label}`, entry);
    }

    // Index by first 50 chars of caption for fuzzy matching
    if (caption) {
      const captionKey = caption.slice(0, 50).toLowerCase().trim();
      byCaption.set(captionKey, entry);
    }
  }

  return { figures, byLabel, byNumber, byCaption };
}

/**
 * Write image registry to .rev directory
 */
export function writeImageRegistry(directory: string, registry: ImageRegistry): string {
  const revDir = path.join(directory, '.rev');
  if (!fs.existsSync(revDir)) {
    fs.mkdirSync(revDir, { recursive: true });
  }

  // Convert Maps to objects for JSON serialization
  const data: RegistryData = {
    version: 1,
    created: new Date().toISOString(),
    figures: registry.figures,
  };

  const registryPath = path.join(revDir, 'image-registry.json');
  fs.writeFileSync(registryPath, JSON.stringify(data, null, 2), 'utf-8');

  return registryPath;
}

/**
 * Read image registry from .rev directory
 */
export function readImageRegistry(directory: string): (ImageRegistry & RegistryData) | null {
  const registryPath = path.join(directory, '.rev', 'image-registry.json');

  if (!fs.existsSync(registryPath)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as RegistryData;

    // Rebuild lookup maps from figures array
    const byLabel = new Map<string, ImageEntry>();
    const byNumber = new Map<string, ImageEntry>();
    const byCaption = new Map<string, ImageEntry>();

    for (const entry of data.figures || []) {
      if (entry.label) {
        byLabel.set(`${entry.type || 'fig'}:${entry.label}`, entry);
      }
      if (entry.number) {
        byNumber.set(`${entry.type || 'fig'}:${entry.number}`, entry);
      }
      if (entry.caption) {
        const captionKey = entry.caption.slice(0, 50).toLowerCase().trim();
        byCaption.set(captionKey, entry);
      }
    }

    return {
      ...data,
      byLabel,
      byNumber,
      byCaption,
    };
  } catch (err) {
    return null;
  }
}
