/**
 * Section handling - map between section .md files and combined documents
 */

import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
import type { SectionConfig, SectionsConfig, ExtractedSection } from './types.js';

/**
 * Default section order (common academic paper structure)
 */
const DEFAULT_ORDER = [
  'abstract',
  'introduction',
  'background',
  'literature',
  'theory',
  'methods',
  'materials',
  'data',
  'results',
  'analysis',
  'discussion',
  'conclusion',
  'references',
  'appendix',
  'supplementary',
];

/**
 * Extract header from a markdown file
 */
export function extractHeader(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const match = line.match(/^#\s+(.+)$/);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Generate sections.yaml from existing .md files
 */
export function generateConfig(
  directory: string,
  excludePatterns: string[] = ['paper.md', 'README.md', 'CLAUDE.md']
): SectionsConfig {
  const files = fs.readdirSync(directory).filter((f) => {
    if (!f.endsWith('.md')) return false;
    if (excludePatterns.some((p) => f.toLowerCase().includes(p.toLowerCase()))) return false;
    return true;
  });

  const sections: Record<string, SectionConfig> = {};

  for (const file of files) {
    const filePath = path.join(directory, file);
    const header = extractHeader(filePath);
    const baseName = path.basename(file, '.md').toLowerCase();

    // Determine order based on common patterns
    let order = DEFAULT_ORDER.findIndex((s) => baseName.includes(s));
    if (order === -1) order = 999;

    sections[file] = {
      header: header || titleCase(baseName),
      aliases: [],
      order: order,
    };
  }

  // Sort by order
  const sorted = Object.entries(sections)
    .sort((a, b) => (a[1].order ?? 999) - (b[1].order ?? 999))
    .reduce((acc, [k, v]) => {
      acc[k] = v;
      return acc;
    }, {} as Record<string, SectionConfig>);

  return {
    version: 1,
    description: 'Section configuration for rev import/split',
    sections: sorted,
  };
}

/**
 * Convert string to title case
 */
function titleCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Load sections config from yaml file
 */
export function loadConfig(configPath: string): SectionsConfig {
  const content = fs.readFileSync(configPath, 'utf-8');
  const config = YAML.parse(content);

  // Normalize: convert string values to full config objects
  const normalized: SectionsConfig = {
    version: config.version || 1,
    description: config.description,
    sections: {},
  };

  for (const [file, value] of Object.entries(config.sections || {})) {
    if (typeof value === 'string') {
      normalized.sections[file] = {
        header: value,
        aliases: [],
      };
    } else {
      const typedValue = value as SectionConfig;
      normalized.sections[file] = {
        header: typedValue.header,
        aliases: typedValue.aliases || [],
        order: typedValue.order,
      };
    }
  }

  return normalized;
}

/**
 * Save sections config to yaml file
 */
export function saveConfig(configPath: string, config: SectionsConfig): void {
  const yamlStr = YAML.stringify(config, { indent: 2, lineWidth: 100 });
  fs.writeFileSync(configPath, yamlStr, 'utf-8');
}

/**
 * Match a heading to a section file
 */
export function matchHeading(
  heading: string,
  sections: Record<string, SectionConfig>
): { file: string; config: SectionConfig } | null {
  // Strip markdown header prefix (# or ##, etc.) before matching
  const normalizedHeading = heading.replace(/^#{1,6}\s+/, '').toLowerCase().trim();

  for (const [file, config] of Object.entries(sections)) {
    // Check primary header
    if (config.header.toLowerCase().trim() === normalizedHeading) {
      return { file, config };
    }

    // Check aliases
    if (config.aliases) {
      for (const alias of config.aliases) {
        if (alias.toLowerCase().trim() === normalizedHeading) {
          return { file, config };
        }
      }
    }

    // Fuzzy match: check if heading contains the key words
    const headerWords = config.header.toLowerCase().split(/\s+/);
    const headingWords = normalizedHeading.split(/\s+/);
    const matchCount = headerWords.filter((w) => headingWords.includes(w)).length;
    if (matchCount >= headerWords.length * 0.7) {
      return { file, config };
    }
  }

  return null;
}

/**
 * Extract sections from Word document text
 */
export function extractSectionsFromText(
  text: string,
  sections: Record<string, SectionConfig>
): ExtractedSection[] {
  const result: ExtractedSection[] = [];

  // Process line by line to detect markdown headers
  const lines = text.split('\n');
  let currentSection: { file: string; header: string } | null = null;
  let currentContent: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const trimmed = line.trim();

    // Explicitly check for markdown headers (# Header)
    const headerMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);

    let matchedSection: { file: string; config: SectionConfig } | null = null;
    if (headerMatch) {
      // This is a markdown header - try to match it to a section
      matchedSection = matchHeading(trimmed, sections);
    } else if (trimmed.length > 0 && trimmed.length < 100 && !trimmed.includes('.')) {
      // Fallback: check if short text without periods matches a section (for plain text headings)
      matchedSection = matchHeading(trimmed, sections);
    }

    if (matchedSection) {
      // Save previous section
      if (currentSection) {
        // Include header in content for proper diffing
        const fullContent = currentSection.header + '\n\n' + currentContent.join('\n').trim();
        result.push({
          file: currentSection.file,
          header: currentSection.header,
          content: fullContent.trim(),
          matched: true,
        });
      }

      currentSection = {
        file: matchedSection.file,
        header: trimmed,
      };
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    // Include header in content for proper diffing
    const fullContent = currentSection.header + '\n\n' + currentContent.join('\n').trim();
    result.push({
      file: currentSection.file,
      header: currentSection.header,
      content: fullContent.trim(),
      matched: true,
    });
  }

  return result;
}

/**
 * Parse annotated paper.md and split back to section files
 */
export function splitAnnotatedPaper(
  paperContent: string,
  sections: Record<string, SectionConfig>
): Map<string, string> {
  const result = new Map<string, string>();

  // Look for section markers: <!-- @section:filename.md -->
  const markerPattern = /<!--\s*@section:(\S+\.md)\s*-->/g;
  const markers = [...paperContent.matchAll(markerPattern)];

  if (markers.length > 0) {
    // Use markers
    for (let i = 0; i < markers.length; i++) {
      const marker = markers[i];
      if (!marker || !marker[1]) continue;
      const file = marker[1];
      const start = (marker.index || 0) + marker[0].length;
      const end = markers[i + 1]?.index || paperContent.length;

      let content = paperContent.slice(start, end).trim();

      // Remove trailing marker if present
      content = content.replace(/<!--\s*@section:\S+\.md\s*-->$/, '').trim();

      result.set(file, content);
    }
  } else {
    // Fall back to header detection
    const lines = paperContent.split('\n');
    let currentFile: string | null = null;
    let currentContent: string[] = [];

    for (const line of lines) {
      const headerMatch = line.match(/^#\s+(.+)$/);

      if (headerMatch && headerMatch[1]) {
        // Save previous section
        if (currentFile) {
          result.set(currentFile, currentContent.join('\n').trim());
        }

        // Find matching section file
        const heading = headerMatch[1].trim();
        const match = matchHeading(heading, sections);

        if (match) {
          currentFile = match.file;
          currentContent = [line];
        } else {
          // Unknown section - keep accumulating to previous
          currentContent.push(line);
        }
      } else {
        currentContent.push(line);
      }
    }

    // Save last section
    if (currentFile) {
      result.set(currentFile, currentContent.join('\n').trim());
    }
  }

  return result;
}

/**
 * Get ordered list of section files from config
 */
export function getOrderedSections(config: SectionsConfig): string[] {
  const entries = Object.entries(config.sections || {});

  return entries
    .sort((a, b) => {
      const orderA = a[1].order ?? 999;
      const orderB = b[1].order ?? 999;
      return orderA - orderB;
    })
    .map(([file]) => file);
}
