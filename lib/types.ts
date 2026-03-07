/**
 * Shared TypeScript type definitions for docrev
 * Extracted from types/index.d.ts for internal use
 */

// ============================================
// Annotations
// ============================================

export interface Annotation {
  type: 'insert' | 'delete' | 'substitute' | 'comment' | 'highlight';
  match: string;
  content: string;
  replacement?: string;
  author?: string;
  position: number;
  line: number;
  before?: string;
  after?: string;
  resolved?: boolean;
}

export interface Comment extends Annotation {
  type: 'comment';
  author: string;
  resolved: boolean;
}

export interface AnnotationCounts {
  inserts: number;
  deletes: number;
  substitutes: number;
  comments: number;
  total: number;
}

export interface StripOptions {
  keepComments?: boolean;
}

export interface CommentFilterOptions {
  pendingOnly?: boolean;
  resolvedOnly?: boolean;
}

// ============================================
// Build
// ============================================

export interface Author {
  name: string;
  affiliation?: string;
  affiliations?: string[];
  corresponding?: boolean;
  email?: string;
  orcid?: string;
}

export interface CrossrefConfig {
  figureTitle?: string;
  tableTitle?: string;
  figPrefix?: string | string[];
  tblPrefix?: string | string[];
}

export interface PdfConfig {
  documentclass?: string;
  fontsize?: string;
  geometry?: string;
  linestretch?: number;
  toc?: boolean;
}

export interface DocxConfig {
  reference?: string;
  keepComments?: boolean;
  toc?: boolean;
}

export interface BuildConfig {
  title?: string;
  authors?: Author[];
  sections?: string[];
  bibliography?: string;
  csl?: string;
  crossref?: CrossrefConfig;
  pdf?: PdfConfig;
  docx?: DocxConfig;
  postprocess?: { [key: string]: string };
  _configPath?: string;
  [key: string]: unknown;
}

export interface BuildResult {
  format: string;
  output: string;
  success: boolean;
  error?: string;
}

// ============================================
// Citations
// ============================================

export interface Citation {
  key: string;
  line: number;
  file: string;
}

export interface CitationValidation {
  valid: Citation[];
  missing: Citation[];
  unused: string[];
  duplicates: Array<{ key: string; count: number; locations: Citation[] }>;
}

export interface CitationStats {
  totalCitations: number;
  uniqueCited: number;
  valid: number;
  missing: number;
  missingKeys: string[];
  bibEntries: number;
  unused: number;
  unusedKeys: string[];
}

// ============================================
// Crossref
// ============================================

export interface RefNumber {
  num: number;
  isSupp: boolean;
  suffix: string | null;
}

export interface HardcodedRef {
  type: 'fig' | 'tbl' | 'eq';
  match: string;
  numbers: RefNumber[];
  position: number;
}

export interface DynamicRef {
  type: 'fig' | 'tbl' | 'eq';
  label: string;
  match: string;
  position: number;
}

export interface FigureInfo {
  label: string;
  num: number;
  isSupp: boolean;
  file: string;
}

export interface Registry {
  figures: Map<string, FigureInfo>;
  tables: Map<string, FigureInfo>;
  equations: Map<string, FigureInfo>;
  byNumber: {
    fig: Map<number, string>;
    figS: Map<number, string>;
    tbl: Map<number, string>;
    tblS: Map<number, string>;
    eq: Map<number, string>;
  };
}

export interface RefStatus {
  dynamic: DynamicRef[];
  hardcoded: HardcodedRef[];
  anchors: { figures: number; tables: number; equations: number };
}

export interface ConversionResult {
  converted: string;
  conversions: Array<{ from: string; to: string }>;
  warnings: string[];
}

// ============================================
// DOI
// ============================================

export interface BibEntry {
  key: string;
  type: string;
  doi: string | null;
  title: string;
  authorRaw: string;
  year: number | null;
  journal: string;
  skip: boolean;
  expectDoi: boolean;
  noDoi: boolean;
  line: number;
}

export interface DoiCheckResult {
  valid: boolean;
  source?: 'crossref' | 'datacite';
  metadata?: {
    title: string;
    authors: string[];
    year: number;
    journal: string;
    type?: string;
  };
  error?: string;
}

export interface BibtexFetchResult {
  success: boolean;
  bibtex?: string;
  error?: string;
}

export interface DoiLookupResult {
  found: boolean;
  doi?: string;
  confidence?: 'low' | 'medium' | 'high';
  score?: number;
  metadata?: {
    title: string;
    authors: string[];
    year: number;
    journal: string;
  };
  alternatives?: Array<{
    doi: string;
    title: string;
    score: number;
  }>;
  error?: string;
}

export interface BibCheckResult {
  entries: Array<BibEntry & { status: string; message?: string; metadata?: object }>;
  valid: number;
  invalid: number;
  missing: number;
  skipped: number;
}

// ============================================
// Equations
// ============================================

export interface Equation {
  type: 'inline' | 'display';
  content: string;
  line: number;
  file: string;
}

export interface EquationStats {
  total: number;
  display: number;
  inline: number;
  byFile: Array<{ file: string; display: number; inline: number }>;
}

export interface WordEquationResult {
  success: boolean;
  equations: Array<{
    type: 'inline' | 'display' | 'unknown';
    latex: string | null;
    position: number;
    line?: number;
    raw?: string;
    error?: string;
  }>;
  error?: string;
}

// ============================================
// Git
// ============================================

export interface FileChange {
  added: number;
  removed: number;
  changes: Array<{ added?: boolean; removed?: boolean; value: string }>;
}

export interface CommitInfo {
  hash: string;
  date: string;
  author: string;
  message: string;
}

export interface ChangedFile {
  file: string;
  status: 'added' | 'deleted' | 'modified';
}

export interface BlameEntry {
  line: number;
  author: string;
  date: string;
  hash: string;
  content: string;
}

export interface AuthorStats {
  lines: number;
  percentage: number;
}

export interface ContributorStats {
  lines: number;
  files: number;
}

// ============================================
// Journals
// ============================================

export interface JournalRequirements {
  wordLimit?: { main?: number; abstract?: number };
  references?: { max?: number; doiRequired?: boolean };
  figures?: { max?: number };
  tables?: { max?: number };
  sections?: string[];
}

export interface JournalFormatting {
  csl?: string;
  pdf?: {
    documentclass?: string;
    fontsize?: string;
    geometry?: string;
    linestretch?: number;
    template?: string;
    numbersections?: boolean;
  };
  docx?: {
    reference?: string;
  };
  crossref?: {
    figPrefix?: string | string[];
    tblPrefix?: string | string[];
  };
}

export interface JournalProfile {
  name: string;
  url: string;
  requirements: JournalRequirements;
  formatting?: JournalFormatting;
}

export interface ValidationResult {
  journal: string;
  valid: boolean;
  wordCount: { main: number; abstract: number; limit: { main: number; abstract: number } };
  figures: { count: number; max: number };
  tables: { count: number; max: number };
  references: { count: number; max: number };
  sections: { found: string[]; missing: string[]; required: string[] };
  errors: string[];
  warnings: string[];
}

// ============================================
// Merge
// ============================================

export interface ReviewerChange {
  reviewer: string;
  type: 'insert' | 'delete' | 'replace';
  start: number;
  end: number;
  oldText: string;
  newText: string;
}

export interface Conflict {
  id: string;
  start: number;
  end: number;
  original: string;
  changes: ReviewerChange[];
  section?: string;
  line?: number;
  resolved: string | null;
}

export interface MergeResult {
  merged: string;
  conflicts: Conflict[];
  stats: {
    reviewers: number;
    totalChanges: number;
    nonConflicting: number;
    conflicts: number;
    comments: number;
  };
  originalText: string;
}

// ============================================
// Sections
// ============================================

export interface SectionConfig {
  header: string;
  aliases?: string[];
  order?: number;
}

export interface SectionsConfig {
  version: number;
  description?: string;
  sections: Record<string, SectionConfig>;
}

export interface ExtractedSection {
  file: string;
  header: string;
  content: string;
  matched: boolean;
}

// ============================================
// Word
// ============================================

export interface WordComment {
  id: string;
  author: string;
  date?: string;
  text: string;
}

export interface WordMetadata {
  title?: string;
  author?: string;
  created?: string;
  modified?: string;
}

export interface CommentAnchor {
  text: string;
  context: string;
}

export interface WordContent {
  text: string;
  html: string;
}

export interface TrackChangesResult {
  hasTrackChanges: boolean;
  content: string | null;
  stats: { insertions: number; deletions: number };
}

// ============================================
// TrackChanges
// ============================================

export interface TrackChangeMarker {
  id: number;
  type: 'insert' | 'delete' | 'substitute' | 'comment';
  content: string;
  author: string;
  replacement?: string;
}

// ============================================
// Spelling
// ============================================

export interface SpellingIssue {
  word: string;
  line: number;
  column: number;
  file?: string;
  suggestions?: string[];
}

export interface SpellingResult {
  misspelled: SpellingIssue[];
  possibleNames: SpellingIssue[];
}

// ============================================
// Config
// ============================================

export interface UserConfig {
  userName?: string;
  defaultSections?: string[];
}

// ============================================
// DOI Cache
// ============================================

export interface DoiCacheEntry {
  result: DoiCheckResult | DoiLookupResult;
  timestamp: number;
}

export interface DoiCache {
  entries: Record<string, DoiCacheEntry>;
  version: number;
}

export interface DoiCacheStats {
  size: number;
  path: string;
}

// ============================================
// Errors
// ============================================

export interface ErrorInfo {
  code: string;
  message: string;
  help?: string;
  cause?: Error;
}
