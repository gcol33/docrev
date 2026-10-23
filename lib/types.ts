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
  /**
   * LaTeX engine to use for PDF output. One of `pdflatex` (default),
   * `xelatex`, `lualatex`, `tectonic`, etc. xelatex/lualatex are required
   * for native UTF-8 rendering of diacritics in author names, place
   * names, and species epithets.
   */
  engine?: string;
  /** Roman/serif main font (xelatex/lualatex only — uses fontspec). */
  mainfont?: string;
  /** Sans-serif font (xelatex/lualatex only). */
  sansfont?: string;
  /** Monospace font (xelatex/lualatex only). */
  monofont?: string;
  numbersections?: boolean;
  template?: string;
  headerIncludes?: string;
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
  source?: 'crossref' | 'datacite' | 'doi.org';
  /**
   * True when the registry could not be reached (network error, timeout, or
   * 5xx) — the DOI's validity is unknown, distinct from a definitive "not
   * found". Callers must not report an unreachable DOI as invalid.
   */
  unreachable?: boolean;
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
  /** DOIs whose registry could not be reached (network/timeout) — not invalid. */
  unreachable: number;
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
  wordLimit?: {
    main?: number;
    abstract?: number;
    /**
     * Count the rendered reference list toward `main`. Off by default, so a
     * profile that has not stated its rule keeps counting body text alone.
     * Rendering needs `bibliography:` in rev.yaml and pandoc on PATH.
     */
    includeReferences?: boolean;
    /** Count words inside table cells toward `main`. Off by default. */
    includeTableCells?: boolean;
    /** Count figure captions toward `main`. On by default. */
    includeFigureCaptions?: boolean;
    /** Count the abstract toward `main`. On by default. */
    includeAbstract?: boolean;
    /**
     * Count statements (Acknowledgements, Author Contributions, Conflict of
     * Interest/Competing Interests, Data/Code Availability, Funding, Ethics)
     * toward `main`. On by default, matching the count before this setting
     * existed; a `rev.yaml` `wordCount.includeStatements` overrides it.
     */
    includeStatements?: boolean;
    /**
     * Extra heading patterns (matched like the built-in statement headings:
     * whole heading text, case-insensitive, optional trailing "Statement" or
     * colon) treated as statements for this profile, in addition to the
     * built-in list.
     */
    statementHeadings?: string[];
  };
  references?: { max?: number; doiRequired?: boolean };
  figures?: { max?: number };
  tables?: { max?: number };
  keywords?: { max?: number; alphabetical?: boolean };
  /** Number of numbered points the abstract must have (e.g. MEE's 1-4). */
  abstractPoints?: number;
  /** Limits on the running headline, read from `running_title` in rev.yaml. */
  runningTitle?: { maxChars?: number };
  /** Require a data availability statement. */
  dataAvailability?: boolean;
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
    engine?: string;
    mainfont?: string;
    sansfont?: string;
    monofont?: string;
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

// ============================================
// Story / journey sidecars
// ============================================

/** A parse error pointing at the exact file:line that produced it. */
export interface SidecarParseError {
  file: string;
  line: number;
  message: string;
}

export interface StoryArc {
  id: string;
  title: string;
  question: string;
  answer: string;
  /** What the audience can do or knows once the answer holds. */
  payoff: string;
  evidence: string;
  limits: string;
  /** Arc IDs this arc's first journey entry must come after. */
  needs: string[];
  /** PNAS notation: this arc is one the Significance statement carries. */
  significance: boolean;
  line: number;
}

export interface StoryTerm {
  term: string;
  definition: string;
}

export interface StoryDoc {
  title: string;
  claim: string;
  audience: string;
  /** The larger problem the opening names, at the width the closer returns to. */
  problem: string;
  /** The paper's challenge in one sentence: "to learn X, we did Y". */
  question: string;
  /** Why the gap matters, in the reader's terms. */
  stakes: string;
  /** The idea that fills the gap, in plain words. */
  idea: string;
  /** Why the design answers the question: each choice and what it rules out. */
  designLogic: string;
  /** What each result means for the reader. */
  meaning: string;
  /** PNAS notation: the reader of the Significance statement, if narrower than `audience`. */
  significanceAudience: string;
  /** The paper-funnel spec, as written: claim sentence, headline and scope numbers, orders, recurrence. */
  funnel: string;
  /** The opening's moves as decided with the author (belief, question, explanation, A- and B-plot), with the `@p:` anchors that carry each. */
  spine: string;
  arcs: StoryArc[];
  terms: StoryTerm[];
  constraints: string[];
  open: string[];
}

/** A float/paragraph type tag, parenthesized after the arc list in journey.md. */
export type JourneyEntryType = 'paragraph' | 'figure' | 'table' | 'equation' | 'code';

export interface JourneyEntry {
  id: string;
  section: string;
  arcs: string[];
  entryType: JourneyEntryType;
  /** The paragraph's point in a few words. */
  idea: string;
  job: string;
  support: string;
  leaves: string;
  /** What the paragraph expects the reader to know already. */
  assumes: string;
  /** Open findings recorded on the entry, one per `- warning:` line. */
  warnings: string[];
  /** Findings overruled on the entry, one per `- accept:` line. */
  accepts: string[];
  /**
   * Wording settled with a co-author, one per `- negotiated: <who> <date> [#<hash>]: <decision>`
   * line. The hash pins the paragraph's text when the decision was taken (`docrev journey ack`).
   */
  negotiated?: string[];
  line: number;
}

export interface JourneyDoc {
  title: string;
  entries: JourneyEntry[];
}

/** One paragraph/float unit found in the manuscript source, in reading order. */
export interface ManuscriptBlock {
  file: string;
  section: string;
  blockType: JourneyEntryType;
  markerId: string | null;
  text: string;
  line: number;
  /** An item of a list whose items carry their own markers (`1. <!-- @p:id -->`). */
  listItem?: boolean;
  /** Where the block sits; anything but `body` needs a marker only if the author gives it one. */
  matter?: ManuscriptMatter;
}

/**
 * `front`: before the first level-1 heading. `back`: under a back-matter heading
 * (acknowledgements, data availability, references, ...). `metadata`: a block of
 * bold-label lines such as `**Keywords:** ...`. `body`: the argument.
 */
export type ManuscriptMatter = 'front' | 'body' | 'back' | 'metadata';

export type JourneyFindingKind =
  | 'missing-marker'
  | 'missing-entry'
  | 'orphan-marker'
  | 'order-mismatch'
  | 'multi-sentence-job'
  | 'orphan-entry'
  | 'unclaimed-arc'
  | 'needs-violation'
  | 'unresolved-evidence'
  | 'todo-evidence'
  | 'near-duplicate'
  | 'unlisted-float'
  | 'significance-drift'
  | 'si-only-evidence'
  | 'supplement-missing-file'
  | 'supplement-unplaced-file'
  | 'supplement-missing-key'
  | 'supplement-unknown-key'
  | 'supplement-unresolved-label'
  | 'supplement-archive-cited'
  | 'supplement-dangling-support'
  | 'supplement-no-support'
  | 'supplement-unknown-arc'
  | 'supplement-stale-lock'
  | 'negotiated-changed'
  | 'negotiated-unpinned'
  | 'undefined'
  | 'unresolved-anchor'
  | 'form-collision'
  | 'circular-definition'
  | 'gloss-order'
  | 'synonym-drift'
  | 'use-before-define'
  | 'unused-entry'
  | 'many-names'
  | 'unlisted-variant'
  | 'single-use-term'
  | 'unused-acronym';

/** Kind prefix of a supplement item: table, figure, appendix, or an unnumbered section. */
export type SupplementItemKind = 'tbl' | 'fig' | 'app' | 'sec';

/**
 * Why a supplement item is there. `evidence` backs a manuscript claim,
 * `reference` holds what a reader needs to reproduce the work, `development`
 * records model development the manuscript points to, `archive` goes to the
 * linked development archive (A labels).
 */
export type SupplementTier = 'evidence' | 'reference' | 'development' | 'archive';

/** One `### <kind>.<name>  [arcs]` entry of supplement/journey.md. */
export interface SupplementItem {
  /** As written in the heading: `tbl.transfer-paired`. */
  id: string;
  /** As cited in text: `tbl:transfer-paired`. */
  key: string;
  kind: SupplementItemKind;
  /** The `## ` part of the document the item sits in. */
  part: string;
  arcs: string[];
  title: string;
  /** The section file that prints the item, relative to the supplement sections directory. */
  file: string;
  tier: SupplementTier | null;
  /** Manuscript paragraph IDs (without `@p:`) whose claim the item backs. */
  supports: string[];
  configuration: string;
  status: string;
  source: string;
  accepts: string[];
  line: number;
}

export interface SupplementJourneyDoc {
  title: string;
  items: SupplementItem[];
}

export interface JourneyFinding {
  kind: JourneyFindingKind;
  message: string;
  file?: string;
  line?: number;
  entryIds?: string[];
  arcId?: string;
  /** Paragraph the finding sits in, when that is not the entry it is recorded on (information.md). */
  paragraph?: string;
  /** Reason from the matching `- accept:` line; set when the author has overruled the finding. */
  accepted?: string;
}
