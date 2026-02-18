/**
 * Journal validation profiles
 * Check manuscripts against journal-specific requirements
 */

import * as fs from 'fs';
import * as path from 'path';
import type { JournalProfile, JournalRequirements, JournalFormatting, ValidationResult } from './types.js';
import { loadCustomProfiles } from './plugins.js';
import { countWords } from './utils.js';

/**
 * Journal requirement profiles
 * Based on publicly available author guidelines
 */
export const JOURNAL_PROFILES: Record<string, JournalProfile> = {
  nature: {
    name: 'Nature',
    url: 'https://www.nature.com/nature/for-authors',
    requirements: {
      wordLimit: { main: 3000, abstract: 150 },
      references: { max: 50, doiRequired: true },
      figures: { max: 6 },
      sections: ['Abstract', 'Introduction', 'Results', 'Discussion', 'Methods'],
    },
    formatting: {
      csl: 'nature',
      pdf: { fontsize: '11pt', geometry: 'margin=2.5cm', linestretch: 2 },
    },
  },

  science: {
    name: 'Science',
    url: 'https://www.science.org/content/page/instructions-preparing-initial-manuscript',
    requirements: {
      wordLimit: { main: 2500, abstract: 125 },
      references: { max: 40, doiRequired: true },
      figures: { max: 4 },
      sections: ['Abstract', 'Introduction', 'Results', 'Discussion'],
    },
    formatting: {
      csl: 'science',
      pdf: { fontsize: '12pt', geometry: 'margin=1in', linestretch: 2 },
    },
  },

  'plos-one': {
    name: 'PLOS ONE',
    url: 'https://journals.plos.org/plosone/s/submission-guidelines',
    requirements: {
      wordLimit: { abstract: 300 },
      references: { doiRequired: false },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
    formatting: {
      csl: 'plos',
      pdf: { fontsize: '12pt', geometry: 'margin=1in', linestretch: 2 },
    },
  },

  'pnas': {
    name: 'PNAS',
    url: 'https://www.pnas.org/author-center/submitting-your-manuscript',
    requirements: {
      wordLimit: { main: 4500, abstract: 250 },
      references: { max: 50, doiRequired: true },
      figures: { max: 6 },
      sections: ['Abstract', 'Introduction', 'Results', 'Discussion'],
    },
    formatting: {
      csl: 'pnas',
      pdf: { documentclass: 'article', fontsize: '9pt', geometry: 'margin=2cm', linestretch: 1.2, numbersections: false },
    },
  },

  'ecology-letters': {
    name: 'Ecology Letters',
    url: 'https://onlinelibrary.wiley.com/page/journal/14610248/homepage/forauthors.html',
    requirements: {
      wordLimit: { main: 5000, abstract: 150 },
      references: { max: 50, doiRequired: true },
      figures: { max: 6 },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'ecological-applications': {
    name: 'Ecological Applications',
    url: 'https://esajournals.onlinelibrary.wiley.com/hub/journal/19395582/author-guidelines',
    requirements: {
      wordLimit: { main: 7000, abstract: 350 },
      references: { doiRequired: true },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'molecular-ecology': {
    name: 'Molecular Ecology',
    url: 'https://onlinelibrary.wiley.com/page/journal/1365294x/homepage/forauthors.html',
    requirements: {
      wordLimit: { main: 8000, abstract: 250 },
      references: { doiRequired: true },
      figures: { max: 8 },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'elife': {
    name: 'eLife',
    url: 'https://reviewer.elifesciences.org/author-guide/full',
    requirements: {
      wordLimit: { abstract: 150 },
      references: { doiRequired: true },
      sections: ['Abstract', 'Introduction', 'Results', 'Discussion', 'Methods'],
    },
    formatting: {
      csl: 'elife',
      pdf: { fontsize: '11pt', geometry: 'margin=2.5cm', linestretch: 1.5 },
    },
  },

  'cell': {
    name: 'Cell',
    url: 'https://www.cell.com/cell/authors',
    requirements: {
      wordLimit: { main: 7000, abstract: 150 },
      references: { max: 100, doiRequired: true },
      figures: { max: 7 },
      sections: ['Abstract', 'Introduction', 'Results', 'Discussion'],
    },
    formatting: {
      csl: 'cell',
      pdf: { fontsize: '12pt', geometry: 'margin=2.5cm', linestretch: 2 },
    },
  },

  'current-biology': {
    name: 'Current Biology',
    url: 'https://www.cell.com/current-biology/authors',
    requirements: {
      wordLimit: { main: 5000, abstract: 150 },
      references: { max: 60, doiRequired: true },
      figures: { max: 4 },
      sections: ['Summary', 'Results', 'Discussion'],
    },
  },

  'conservation-biology': {
    name: 'Conservation Biology',
    url: 'https://conbio.onlinelibrary.wiley.com/hub/journal/15231739/homepage/forauthors.html',
    requirements: {
      wordLimit: { main: 7000, abstract: 300 },
      references: { doiRequired: true },
      figures: { max: 6 },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'biological-conservation': {
    name: 'Biological Conservation',
    url: 'https://www.elsevier.com/journals/biological-conservation/0006-3207/guide-for-authors',
    requirements: {
      wordLimit: { main: 8000, abstract: 400 },
      references: { doiRequired: true },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'journal-of-ecology': {
    name: 'Journal of Ecology',
    url: 'https://besjournals.onlinelibrary.wiley.com/hub/journal/13652745/author-guidelines',
    requirements: {
      wordLimit: { main: 7000, abstract: 350 },
      references: { doiRequired: true },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'functional-ecology': {
    name: 'Functional Ecology',
    url: 'https://besjournals.onlinelibrary.wiley.com/hub/journal/13652435/author-guidelines',
    requirements: {
      wordLimit: { main: 7000, abstract: 350 },
      references: { doiRequired: true },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'global-change-biology': {
    name: 'Global Change Biology',
    url: 'https://onlinelibrary.wiley.com/page/journal/13652486/homepage/forauthors.html',
    requirements: {
      wordLimit: { main: 7000, abstract: 300 },
      references: { doiRequired: true },
      figures: { max: 8 },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'oikos': {
    name: 'Oikos',
    url: 'https://nsojournals.onlinelibrary.wiley.com/hub/journal/16000706/author-guidelines',
    requirements: {
      wordLimit: { main: 8000, abstract: 350 },
      references: { doiRequired: true },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'oecologia': {
    name: 'Oecologia',
    url: 'https://www.springer.com/journal/442/submission-guidelines',
    requirements: {
      wordLimit: { main: 8000, abstract: 250 },
      references: { doiRequired: true },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'biological-invasions': {
    name: 'Biological Invasions',
    url: 'https://www.springer.com/journal/10530/submission-guidelines',
    requirements: {
      wordLimit: { abstract: 250 },
      references: { doiRequired: true },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'diversity-distributions': {
    name: 'Diversity and Distributions',
    url: 'https://onlinelibrary.wiley.com/page/journal/14724642/homepage/forauthors.html',
    requirements: {
      wordLimit: { main: 6000, abstract: 300 },
      references: { doiRequired: true },
      figures: { max: 6 },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'neobiota': {
    name: 'NeoBiota',
    url: 'https://neobiota.pensoft.net/about#Author_Guidelines',
    requirements: {
      wordLimit: { abstract: 350 },
      references: { doiRequired: true },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },

  'peerj': {
    name: 'PeerJ',
    url: 'https://peerj.com/about/author-instructions/',
    requirements: {
      wordLimit: { abstract: 500 },
      references: { doiRequired: false },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
  },
};

/**
 * Get all profiles (built-in + custom)
 * Custom profiles override built-in ones with the same ID
 */
function getAllProfiles(): Record<string, JournalProfile> {
  const customProfiles = loadCustomProfiles() as Record<string, JournalProfile>;
  return { ...JOURNAL_PROFILES, ...customProfiles };
}

interface ListJournalsOptions {
  includeCustom?: boolean;
  customOnly?: boolean;
}

interface JournalListItem {
  id: string;
  name: string;
  url: string;
  custom?: boolean;
}

/**
 * List all available journal profiles
 */
export function listJournals(options: ListJournalsOptions = {}): JournalListItem[] {
  const { includeCustom = true, customOnly = false } = options;

  const profiles = customOnly
    ? (loadCustomProfiles() as Record<string, JournalProfile>)
    : includeCustom
      ? getAllProfiles()
      : JOURNAL_PROFILES;

  return Object.entries(profiles).map(([id, profile]) => ({
    id,
    name: profile.name,
    url: profile.url,
    custom: (profile as any).custom || false,
  }));
}

/**
 * Get a specific journal profile
 */
export function getJournalProfile(journalId: string): JournalProfile | null {
  const normalized = journalId.toLowerCase().replace(/\s+/g, '-');
  const profiles = getAllProfiles();
  return profiles[normalized] || null;
}


/**
 * Extract abstract from markdown
 */
function extractAbstract(text: string): string | null {
  // Try to find abstract section
  const patterns = [
    /^#+\s*Abstract\s*\n([\s\S]*?)(?=^#+|\Z)/mi,
    /^Abstract[:\s]*\n([\s\S]*?)(?=^#+|\n\n)/mi,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return match[1].trim();
    }
  }

  return null;
}

/**
 * Extract title from markdown
 */
function extractTitle(text: string): string | null {
  // Try YAML frontmatter
  const yamlMatch = text.match(/^---\n[\s\S]*?title:\s*["']?([^"'\n]+)["']?[\s\S]*?\n---/m);
  if (yamlMatch && yamlMatch[1]) {
    return yamlMatch[1].trim();
  }

  // Try first H1
  const h1Match = text.match(/^#\s+(.+)$/m);
  if (h1Match && h1Match[1]) {
    return h1Match[1].trim();
  }

  return null;
}

/**
 * Extract sections from markdown
 */
function extractSections(text: string): string[] {
  const sections: string[] = [];
  const headerPattern = /^#+\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = headerPattern.exec(text)) !== null) {
    if (match[1]) {
      sections.push(match[1].trim());
    }
  }

  return sections;
}

/**
 * Count figures in markdown
 */
function countFigures(text: string): number {
  // Count images with figure captions
  const figurePattern = /!\[.*?\]\(.*?\)(\{#fig:[^}]+\})?/g;
  const matches = text.match(figurePattern) || [];
  return matches.length;
}

/**
 * Count tables in markdown
 */
function countTables(text: string): number {
  // Count tables (lines starting with |)
  const tablePattern = /^\|[^|]+\|/gm;
  const matches = text.match(tablePattern) || [];
  // Divide by approximate rows per table
  return Math.ceil(matches.length / 5);
}

/**
 * Count references/citations in markdown
 */
function countReferences(text: string): number {
  // Count unique citation keys
  const citationPattern = /@(\w+)/g;
  const citations = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = citationPattern.exec(text)) !== null) {
    // Exclude cross-refs like @fig:label
    if (match[1] && !match[0].includes(':')) {
      citations.add(match[1]);
    }
  }

  return citations.size;
}

interface ManuscriptStats {
  wordCount: number;
  abstractWords: number;
  titleChars: number;
  figures: number;
  tables: number;
  references: number;
  sections: number;
}

interface ManuscriptValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: ManuscriptStats | null;
  journal?: string;
  url?: string;
}

/**
 * Validate manuscript against journal requirements
 */
export function validateManuscript(text: string, journalId: string): ManuscriptValidationResult {
  const profile = getJournalProfile(journalId);

  if (!profile) {
    return {
      valid: false,
      errors: [`Unknown journal: ${journalId}`],
      warnings: [],
      stats: null,
    };
  }

  const req = profile.requirements;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Extract content
  const abstract = extractAbstract(text);
  const title = extractTitle(text);
  const sections = extractSections(text);
  const mainWordCount = countWords(text);
  const figureCount = countFigures(text);
  const tableCount = countTables(text);
  const refCount = countReferences(text);

  const stats: ManuscriptStats = {
    wordCount: mainWordCount,
    abstractWords: abstract ? countWords(abstract) : 0,
    titleChars: title ? title.length : 0,
    figures: figureCount,
    tables: tableCount,
    references: refCount,
    sections: sections.length,
  };

  // Word limits
  if (req.wordLimit) {
    if (req.wordLimit.main && mainWordCount > req.wordLimit.main) {
      errors.push(`Main text exceeds ${req.wordLimit.main} words (current: ${mainWordCount})`);
    }
    if (req.wordLimit.abstract && abstract) {
      const absWords = countWords(abstract);
      if (absWords > req.wordLimit.abstract) {
        errors.push(`Abstract exceeds ${req.wordLimit.abstract} words (current: ${absWords})`);
      }
    }
  }

  // References
  if (req.references) {
    if (req.references.max && refCount > req.references.max) {
      errors.push(`References exceed ${req.references.max} (current: ${refCount})`);
    }
    if (req.references.doiRequired) {
      warnings.push('DOI required for all references - run "rev doi check" to verify');
    }
  }

  // Figures/tables
  if (req.figures) {
    if (req.figures.max && figureCount > req.figures.max) {
      errors.push(`Figures exceed ${req.figures.max} (current: ${figureCount})`);
    }
  }

  // Required sections
  if (req.sections) {
    for (const reqSection of req.sections) {
      const found = sections.some(s =>
        s.toLowerCase().includes(reqSection.toLowerCase())
      );
      if (!found) {
        warnings.push(`Missing required section: ${reqSection}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats,
    journal: profile.name,
    url: profile.url,
  };
}

/**
 * Validate multiple files against journal requirements
 */
export function validateProject(files: string[], journalId: string): ManuscriptValidationResult {
  // Combine all file contents
  const combined = files
    .filter(f => fs.existsSync(f))
    .map(f => fs.readFileSync(f, 'utf-8'))
    .join('\n\n');

  return validateManuscript(combined, journalId);
}
