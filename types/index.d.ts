/**
 * TypeScript type definitions for docrev
 */

// ============================================
// Annotations (lib/annotations.js)
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

export function parseAnnotations(text: string): Annotation[];
export function stripAnnotations(text: string, options?: StripOptions): string;
export function applyDecision(text: string, annotation: Annotation, accept: boolean): string;
export function getTrackChanges(text: string): Annotation[];
export function getComments(text: string, options?: CommentFilterOptions): Comment[];
export function setCommentStatus(text: string, comment: Comment, resolved: boolean): string;
export function countAnnotations(text: string): AnnotationCounts;

// ============================================
// Build (lib/build.js)
// ============================================

export interface BuildConfig {
  title?: string;
  authors?: Author[];
  sections?: string[];
  bibliography?: string;
  csl?: string;
  crossref?: CrossrefConfig;
  pdf?: PdfConfig;
  docx?: DocxConfig;
}

export interface Author {
  name: string;
  affiliation?: string;
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

export interface BuildResult {
  format: string;
  output: string;
  success: boolean;
  error?: string;
}

export function loadConfig(directory?: string): BuildConfig;
export function findSections(directory: string, config: BuildConfig): string[];
export function combineSections(files: string[], options?: object): string;
export function build(formats?: string[], options?: object): Promise<BuildResult[]>;
export function hasPandoc(): Promise<boolean>;
export function hasPandocCrossref(): Promise<boolean>;

// ============================================
// Citations (lib/citations.js)
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

export function extractCitations(text: string, file?: string): Citation[];
export function parseBibFile(bibPath: string): Set<string>;
export function validateCitations(mdFiles: string[], bibPath: string): CitationValidation;
export function getCitationStats(mdFiles: string[], bibPath: string): CitationStats;

// ============================================
// Crossref (lib/crossref.js)
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

export function normalizeType(typeStr: string): 'fig' | 'tbl' | 'eq' | string;
export function parseRefNumber(numStr: string, suffix?: string): RefNumber;
export function parseReferenceList(listStr: string): RefNumber[];
export function buildRegistry(directory: string, excludeFiles?: string[]): Registry;
export function labelToDisplay(type: string, label: string, registry: Registry): string | null;
export function numberToLabel(type: string, num: number, isSupp: boolean, registry: Registry): string | null;
export function detectHardcodedRefs(text: string): HardcodedRef[];
export function detectDynamicRefs(text: string): DynamicRef[];
export function convertHardcodedRefs(text: string, registry: Registry): { converted: string; conversions: Array<{ from: string; to: string }>; warnings: string[] };
export function getRefStatus(text: string, registry: Registry): RefStatus;

// ============================================
// DOI (lib/doi.js)
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

export function parseBibEntries(bibPath: string): BibEntry[];
export function isValidDoiFormat(doi: string): boolean;
export function checkDoi(doi: string): Promise<DoiCheckResult>;
export function fetchBibtex(doi: string): Promise<BibtexFetchResult>;
export function checkBibDois(bibPath: string, options?: { checkMissing?: boolean; parallel?: number }): Promise<BibCheckResult>;
export function lookupDoi(title: string, author?: string, year?: number, journal?: string): Promise<DoiLookupResult>;
export function lookupMissingDois(bibPath: string, options?: { parallel?: number; onProgress?: (current: number, total: number) => void }): Promise<Array<{ key: string; title: string; type: string; journal: string; result: DoiLookupResult }>>;
export function addToBib(bibPath: string, bibtex: string): { success: boolean; key?: string; error?: string };

// ============================================
// Equations (lib/equations.js)
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

export function extractEquations(text: string, file?: string): Equation[];
export function generateEquationSheet(equations: Equation[]): string;
export function convertToWord(inputPath: string, outputPath: string, options?: { preserveLatex?: boolean }): Promise<{ success: boolean; message: string }>;
export function createEquationsDoc(inputPath: string, outputPath: string): Promise<{ success: boolean; message: string; stats: { display: number; inline: number } | null }>;
export function getEquationStats(files: string[]): EquationStats;
export function extractEquationsFromWord(docxPath: string): Promise<WordEquationResult>;
export function getWordEquationStats(docxPath: string): Promise<{ count: number; display: number; inline: number; converted: number; error?: string }>;

// ============================================
// Git (lib/git.js)
// ============================================

export interface FileChange {
  added: number;
  removed: number;
  changes: Array<{ added: boolean; removed: boolean; value: string }>;
}

export interface CommitInfo {
  hash: string;
  date: string;
  author: string;
  message: string;
}

export function isGitRepo(directory?: string): boolean;
export function getCurrentBranch(directory?: string): string | null;
export function getDefaultBranch(directory?: string): string;
export function getFileAtRef(filePath: string, ref: string): string | null;
export function getChangedFiles(fromRef: string, toRef?: string): string[];
export function getFileHistory(filePath: string, limit?: number): CommitInfo[];
export function compareFileVersions(filePath: string, fromRef: string, toRef?: string): FileChange;
export function getWordCountDiff(filePath: string, fromRef: string, toRef?: string): { before: number; after: number; diff: number };
export function getRecentCommits(directory?: string, limit?: number): CommitInfo[];
export function hasUncommittedChanges(directory?: string): boolean;
export function getTags(directory?: string): string[];

// ============================================
// Journals (lib/journals.js)
// ============================================

export interface JournalProfile {
  name: string;
  url: string;
  requirements: {
    wordLimit?: { main: number; abstract?: number };
    references?: { max?: number; doiRequired?: boolean };
    figures?: { max?: number };
    tables?: { max?: number };
    sections?: string[];
    formatting?: object;
  };
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

export function listJournals(): Array<{ id: string; name: string; url: string }>;
export function getJournalProfile(journalId: string): JournalProfile | null;
export function validateManuscript(text: string, journalId: string, options?: { bibPath?: string }): ValidationResult;
export function validateProject(directory: string, journalId: string): Promise<ValidationResult>;

// ============================================
// Merge (lib/merge.js)
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
  start: number;
  end: number;
  original: string;
  changes: ReviewerChange[];
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

export function extractChanges(originalText: string, wordText: string, reviewer: string): ReviewerChange[];
export function detectConflicts(allChanges: ReviewerChange[][]): { conflicts: Conflict[]; nonConflicting: ReviewerChange[] };
export function applyChanges(originalText: string, changes: ReviewerChange[]): string;
export function applyChangesAsAnnotations(originalText: string, changes: ReviewerChange[]): string;
export function formatConflict(conflict: Conflict, originalText: string): string;
export function mergeReviewerDocs(originalPath: string, reviewerDocs: Array<{ path: string; name: string }>, options?: { autoResolve?: boolean }): Promise<MergeResult>;
export function resolveConflict(text: string, conflict: Conflict, choice: number, originalText: string): string;

// ============================================
// Sections (lib/sections.js)
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

export function extractHeader(filePath: string): string | null;
export function generateConfig(directory: string, excludePatterns?: string[]): SectionsConfig;
export function loadConfig(configPath: string): SectionsConfig;
export function saveConfig(configPath: string, config: SectionsConfig): void;
export function matchHeading(heading: string, sections: Record<string, SectionConfig>): { file: string; config: SectionConfig } | null;
export function extractSectionsFromText(text: string, sections: Record<string, SectionConfig>): ExtractedSection[];
export function splitAnnotatedPaper(paperContent: string, sections: Record<string, SectionConfig>): Map<string, string>;
export function getOrderedSections(config: SectionsConfig): string[];

// ============================================
// Word (lib/word.js)
// ============================================

export interface WordComment {
  id: string;
  author: string;
  date: string;
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

export function extractWordComments(docxPath: string): Promise<WordComment[]>;
export function extractCommentAnchors(docxPath: string): Promise<Map<string, CommentAnchor>>;
export function extractTextFromWord(docxPath: string): Promise<string>;
export function extractFromWord(docxPath: string): Promise<{ text: string; html: string }>;
export function getWordMetadata(docxPath: string): Promise<WordMetadata>;
export function isWordDocument(filePath: string): boolean;

// ============================================
// TrackChanges (lib/trackchanges.js)
// ============================================

export interface TrackChangeMarker {
  type: 'insert' | 'delete';
  start: number;
  end: number;
  content: string;
}

export function prepareForTrackChanges(text: string): { text: string; markers: TrackChangeMarker[] };
export function applyTrackChangesToDocx(docxPath: string, markers: TrackChangeMarker[], author?: string): Promise<void>;
export function buildWithTrackChanges(markdownPath: string, outputPath: string, options?: object): Promise<{ success: boolean; message: string }>;

// ============================================
// Spelling (lib/spelling.js)
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

export function getGlobalDictPath(): string;
export function getProjectDictPath(directory?: string): string;
export function loadDictionaryFile(dictPath: string): Set<string>;
export function saveDictionaryFile(words: Set<string>, dictPath: string): void;
export function loadAllCustomWords(projectDir?: string): Set<string>;
export function addWord(word: string, global?: boolean, projectDir?: string): boolean;
export function removeWord(word: string, global?: boolean, projectDir?: string): boolean;
export function listWords(global?: boolean, projectDir?: string): string[];
export function getSpellchecker(projectDir?: string, lang?: 'en' | 'en-gb'): Promise<object>;
export function clearCache(): void;
export function extractWords(text: string): Array<{ word: string; line: number; column: number }>;
export function checkSpelling(text: string, options?: { projectDir?: string; lang?: 'en' | 'en-gb' }): Promise<SpellingResult>;
export function checkFile(filePath: string, options?: { projectDir?: string; lang?: 'en' | 'en-gb' }): Promise<SpellingResult>;
