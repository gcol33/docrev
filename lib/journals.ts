/**
 * Journal validation profiles
 * Check manuscripts against journal-specific requirements
 */

import * as fs from 'fs';
import * as path from 'path';
import type { JournalProfile, JournalRequirements, JournalFormatting, ValidationResult } from './types.js';
import { loadCustomProfiles } from './plugins.js';
import { countWords, countTableCellWords, countFigureCaptionWords } from './utils.js';
import { renderBibliography } from './bibliography.js';

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

  'methods-ecology-evolution': {
    name: 'Methods in Ecology and Evolution',
    url: 'https://besjournals.onlinelibrary.wiley.com/hub/journal/2041210x/author-guidelines',
    requirements: {
      wordLimit: { main: 7000, abstract: 350 },
      references: { doiRequired: true },
      sections: ['Abstract', 'Introduction', 'Methods', 'Results', 'Discussion'],
    },
    formatting: {
      csl: 'methods-in-ecology-and-evolution',
      pdf: { fontsize: '12pt', geometry: 'margin=2.5cm', linestretch: 2 },
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
  // `\Z` is not a JavaScript escape: written into a pattern it matches a
  // literal Z, and under /i a literal z, so the old lookahead ended the
  // abstract at its first z rather than at the next heading.
  const heading = /^#{1,6}[ \t]*Abstract[ \t]*:?[ \t]*$/im.exec(text);
  if (heading) {
    const body = text.slice(heading.index + heading[0].length);
    const next = /^#{1,6}[ \t]/m.exec(body);
    const abstract = (next ? body.slice(0, next.index) : body).trim();
    if (abstract) return stripKeywordLine(abstract);
  }

  const inline = /^Abstract[:\s]*$/im.exec(text);
  if (inline) {
    const body = text.slice(inline.index + inline[0].length).replace(/^\s*\n/, '');
    const end = body.search(/\n\s*\n|^#{1,6}[ \t]/m);
    const abstract = (end >= 0 ? body.slice(0, end) : body).trim();
    if (abstract) return stripKeywordLine(abstract);
  }

  return null;
}

/**
 * Drop a trailing keyword line from an abstract. Journals limit the two
 * separately, so counting the keywords as abstract words fails a manuscript
 * that is inside both.
 */
function stripKeywordLine(abstract: string): string {
  return abstract.replace(KEYWORD_LINE, '').trim();
}

const KEYWORD_LINE = /^[ \t]*(?:\*\*|__)?\s*Key[- ]?words?\s*:?(?:\*\*|__)?[ \t]*:?[\s\S]*$/im;

/**
 * Extract the keyword list, wherever it sits: a `Keywords:` line in the
 * abstract or a section of its own.
 */
function extractKeywords(text: string): string[] {
  const match = /^[ \t]*(?:\*\*|__)?\s*Key[- ]?words?\s*:?(?:\*\*|__)?\s*:?[ \t]*(.*(?:\n(?!\s*\n)(?!#).*)*)/im.exec(text);
  if (!match || !match[1]) return [];
  return match[1]
    .replace(/\*\*|__|[*_`]/g, '')
    .split(/[;,]/)
    .map(k => k.trim())
    .filter(k => k.length > 0);
}

/**
 * Extract title from markdown
 */
function extractTitle(text: string, declared?: string | null): string | null {
  // A rev project carries its title in rev.yaml, not in the sections, so the
  // caller passes it in. Without it the first H1 is a section heading
  // ("Abstract"), which is not the manuscript's title.
  if (declared && declared.trim()) return declared.trim();

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
  // One table is one run of consecutive pipe rows, so a wide table and a
  // narrow one count the same. Dividing the row total by an assumed rows-per-
  // table made the figure a function of table length.
  let tables = 0;
  let inTable = false;
  for (const line of text.split('\n')) {
    const isRow = /^[ \t]*\|/.test(line);
    if (isRow && !inTable) tables++;
    inTable = isRow;
  }
  return tables;
}

/**
 * Count references/citations in markdown
 */
/**
 * The pandoc-crossref label namespaces. `@fig:signal` is a cross-reference,
 * not a citation, and the key stops at the colon, so the key alone cannot
 * tell them apart.
 */
const CROSSREF_PREFIXES = new Set(['fig', 'tbl', 'eq', 'sec', 'lst']);

/**
 * Citation keys cited in the manuscript, deduplicated.
 *
 * Exported because the reference list is measured by rendering exactly these
 * keys; counting one set and rendering another would report a length for a
 * list nobody gets.
 */
export function extractCitationKeys(text: string): string[] {
  const citationPattern = /@([A-Za-z][\w.-]*)(:?)/g;
  const citations = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = citationPattern.exec(text)) !== null) {
    const key = match[1];
    if (!key) continue;
    // A colon after the key marks a cross-reference namespace, not a citation.
    if (match[2] === ':' && CROSSREF_PREFIXES.has(key)) continue;
    citations.add(key);
  }

  return [...citations];
}

function countReferences(text: string): number {
  return extractCitationKeys(text).length;
}

export interface WordLimitCount {
  /** The count checked against the limit: body plus whatever the profile counts. */
  wordCount: number;
  /** Prose in the sections, excluding table cells and the abstract. */
  bodyWords: number;
  /** Words inside table cells. */
  tableCellWords: number;
  /** Words in figure captions, which the body count removes with the image. */
  figureCaptionWords: number;
  /** Words in the rendered reference list, or null when it was not measured. */
  referenceWords: number | null;
  abstractWords: number;
  /** What wordCount is made of, for reporting. */
  counted: { abstract: boolean; tableCells: boolean; figureCaptions: boolean; references: boolean };
}

/**
 * Measure a manuscript the way a profile's word limit counts it.
 *
 * Each file is counted on its own and the parts summed, so frontmatter at the
 * top of a later section file is stripped like the first one's. The abstract
 * is located in the files joined, since its heading and its text may sit in
 * different files.
 *
 * @param texts - Contents of the manuscript's section files, in build order
 * @param wordLimit - The profile's `requirements.wordLimit`
 * @param referenceWords - Words in the rendered reference list, or null
 */
export function countForWordLimit(
  texts: string[],
  wordLimit: JournalRequirements['wordLimit'],
  referenceWords: number | null = null
): WordLimitCount {
  const abstract = extractAbstract(texts.join('\n\n'));
  const abstractWords = abstract ? countWords(abstract) : 0;
  const sum = (count: (text: string) => number) => texts.reduce((total, t) => total + count(t), 0);
  const tableCellWords = sum(countTableCellWords);
  const figureCaptionWords = sum(countFigureCaptionWords);

  // countWords already drops table cells, so the body is prose alone; the
  // abstract is subtracted so a profile can decide whether the limit that has
  // its own abstract ceiling also counts those words a second time.
  const bodyWords = Math.max(0, sum(countWords) - abstractWords);

  const counted = {
    abstract: wordLimit?.includeAbstract !== false,
    tableCells: wordLimit?.includeTableCells === true,
    figureCaptions: wordLimit?.includeFigureCaptions !== false,
    references: wordLimit?.includeReferences === true,
  };

  const wordCount =
    bodyWords +
    (counted.abstract ? abstractWords : 0) +
    (counted.tableCells ? tableCellWords : 0) +
    (counted.figureCaptions ? figureCaptionWords : 0) +
    (counted.references ? referenceWords ?? 0 : 0);

  return { wordCount, bodyWords, tableCellWords, figureCaptionWords, referenceWords, abstractWords, counted };
}

/**
 * Render the reference list and count its words, when the profile counts it.
 *
 * Returns null when the profile does not count the list or when it could not
 * be rendered; `referenceListWarning` tells the two apart for the report.
 */
export function measureReferenceWords(
  texts: string[],
  profile: JournalProfile,
  project: { directory: string; bibliography?: string | null; csl?: string | null }
): number | null {
  if (!profile.requirements.wordLimit?.includeReferences || !project.bibliography) return null;
  const rendered = renderBibliography({
    directory: project.directory,
    bibliography: project.bibliography,
    csl: project.csl ?? profile.formatting?.csl ?? null,
    keys: extractCitationKeys(texts.join('\n\n')),
  });
  return rendered.text === null ? null : rendered.words;
}

/** The warning for a limit that counts a reference list nobody could render. */
export function referenceListWarning(profile: JournalProfile, count: WordLimitCount): string | null {
  if (!count.counted.references || count.referenceWords !== null) return null;
  return (
    `${profile.name} counts the reference list toward its word limit, and it could not be rendered ` +
    '(needs `bibliography:` in rev.yaml and pandoc on PATH), so the count below is short by its length'
  );
}

/** Table rows breaking a word-limit count into its parts, for CLI output. */
export function wordLimitRows(count: WordLimitCount): string[][] {
  const part = (words: number, counted: boolean) => `${words} words${counted ? '' : ' (not counted)'}`;
  const rows: string[][] = [
    ['Word count', count.wordCount.toString()],
    ['  body', part(count.bodyWords, true)],
    ['  abstract', part(count.abstractWords, count.counted.abstract)],
    ['  figure captions', part(count.figureCaptionWords, count.counted.figureCaptions)],
    ['  table cells', part(count.tableCellWords, count.counted.tableCells)],
  ];
  if (count.counted.references) {
    rows.push(['  references', count.referenceWords === null ? 'not measured' : part(count.referenceWords, true)]);
  }
  return rows;
}

interface ManuscriptStats extends WordLimitCount {
  titleChars: number;
  figures: number;
  tables: number;
  references: number;
  keywords: number;
  sections: number;
}

export interface ValidationInput {
  /** Manuscript title, from rev.yaml; the sections do not carry one. */
  title?: string | null;
  /**
   * Words in the rendered reference list. The caller renders it, because
   * doing so needs the project's bibliography, its CSL and pandoc.
   */
  referenceWords?: number | null;
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
export function validateManuscript(
  text: string,
  journalId: string,
  input: ValidationInput = {}
): ManuscriptValidationResult {
  return validateTexts([text], journalId, input);
}

function validateTexts(
  texts: string[],
  journalId: string,
  input: ValidationInput
): ManuscriptValidationResult {
  const text = texts.join('\n\n');
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
  const title = extractTitle(text, input.title);
  const sections = extractSections(text);
  const keywords = extractKeywords(text);
  const figureCount = countFigures(text);
  const tableCount = countTables(text);
  const refCount = countReferences(text);

  const count = countForWordLimit(texts, req.wordLimit, input.referenceWords ?? null);
  const { wordCount: countedWords, abstractWords } = count;

  const stats: ManuscriptStats = {
    ...count,
    titleChars: title ? title.length : 0,
    figures: figureCount,
    tables: tableCount,
    references: refCount,
    keywords: keywords.length,
    sections: sections.length,
  };

  // Word limits
  if (req.wordLimit) {
    const referenceWarning = referenceListWarning(profile, count);
    if (referenceWarning) warnings.push(referenceWarning);
    if (req.wordLimit.main && countedWords > req.wordLimit.main) {
      errors.push(`Main text exceeds ${req.wordLimit.main} words (current: ${countedWords})`);
    }
    if (req.wordLimit.abstract && abstract && abstractWords > req.wordLimit.abstract) {
      errors.push(`Abstract exceeds ${req.wordLimit.abstract} words (current: ${abstractWords})`);
    }
  }

  // Keywords
  if (req.keywords?.max && keywords.length > req.keywords.max) {
    errors.push(`Keywords exceed ${req.keywords.max} (current: ${keywords.length})`);
  }

  // Data availability statement
  if (req.dataAvailability && !/^#{1,6}[ \t]*Data\s+(availability|accessibility)/im.test(text)) {
    warnings.push('Missing a data availability statement');
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
export function validateProject(
  files: string[],
  journalId: string,
  input: ValidationInput = {}
): ManuscriptValidationResult {
  const texts = files
    .filter(f => fs.existsSync(f))
    .map(f => fs.readFileSync(f, 'utf-8'));

  return validateTexts(texts, journalId, input);
}
