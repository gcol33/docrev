/**
 * Image registry utilities for tracking figures and tables in markdown documents
 *
 * The registry maps figure/table labels and display numbers to source paths,
 * enabling Word import to match rendered figures back to original sources.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Pattern to extract markdown images with optional pandoc-crossref anchors
 * Captures: ![caption](path){#fig:label} or ![caption](path)
 * Groups: [1] = caption, [2] = path, [3] = label type (fig/tbl), [4] = label
 */
export const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)(?:\{#(fig|tbl):([^}]+)\})?/g;

/**
 * Build image registry from markdown content
 * Maps figure labels and display numbers to source paths
 * @param {string} content - Markdown content
 * @param {object} crossrefRegistry - Registry from buildRegistry() for number mapping
 * @returns {object} Registry with figures array and lookup maps
 */
export function buildImageRegistry(content, crossrefRegistry = null) {
  const figures = [];
  const byLabel = new Map();
  const byNumber = new Map();
  const byCaption = new Map();

  IMAGE_PATTERN.lastIndex = 0;
  let match;

  while ((match = IMAGE_PATTERN.exec(content)) !== null) {
    const caption = match[1];
    const imagePath = match[2];
    const labelType = match[3]; // 'fig' or 'tbl' or undefined
    const label = match[4]; // label without prefix

    const entry = {
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
 * @param {string} directory - Project directory
 * @param {object} registry - Image registry from buildImageRegistry()
 * @returns {string} Path to registry file
 */
export function writeImageRegistry(directory, registry) {
  const revDir = path.join(directory, '.rev');
  if (!fs.existsSync(revDir)) {
    fs.mkdirSync(revDir, { recursive: true });
  }

  // Convert Maps to objects for JSON serialization
  const data = {
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
 * @param {string} directory - Project directory
 * @returns {object|null} Registry or null if not found
 */
export function readImageRegistry(directory) {
  const registryPath = path.join(directory, '.rev', 'image-registry.json');

  if (!fs.existsSync(registryPath)) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));

    // Rebuild lookup maps from figures array
    const byLabel = new Map();
    const byNumber = new Map();
    const byCaption = new Map();

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
