/**
 * Build system - combines sections → paper.md → PDF/DOCX/TEX
 *
 * Features:
 * - Reads rev.yaml config
 * - Combines section files into paper.md (persisted)
 * - Strips annotations appropriately per output format
 * - Runs pandoc with crossref filter
 */
import type { Author, JournalFormatting } from './types.js';
export interface CrossrefConfig {
    figureTitle?: string;
    tableTitle?: string;
    figPrefix?: string | string[];
    tblPrefix?: string | string[];
    secPrefix?: string | string[];
    linkReferences?: boolean;
}
export interface PdfConfig {
    template?: string | null;
    headerIncludes?: string | null;
    documentclass?: string;
    fontsize?: string;
    geometry?: string;
    linestretch?: number;
    numbersections?: boolean;
    toc?: boolean;
}
export interface DocxConfig {
    reference?: string | null;
    keepComments?: boolean;
    toc?: boolean;
}
export interface TexConfig {
    standalone?: boolean;
}
export interface BeamerConfig {
    theme?: string;
    colortheme?: string | null;
    fonttheme?: string | null;
    aspectratio?: string | null;
    navigation?: string | null;
    section?: boolean;
    notes?: string | false;
    fit_images?: boolean;
}
export interface PptxConfig {
    theme?: string;
    reference?: string | null;
    media?: string | null;
    colors?: {
        default?: string;
        title?: string;
    };
    buildup?: {
        grey?: string;
        accent?: string;
        enabled?: boolean;
    };
}
export interface TablesConfig {
    nowrap?: string[];
}
export interface PostprocessConfig {
    pdf?: string | null;
    docx?: string | null;
    tex?: string | null;
    pptx?: string | null;
    beamer?: string | null;
    all?: string | null;
    [key: string]: string | null | undefined;
}
export interface BuildConfig {
    title: string;
    authors: (string | Author)[];
    sections: string[];
    bibliography: string | null;
    csl: string | null;
    crossref: CrossrefConfig;
    pdf: PdfConfig;
    docx: DocxConfig;
    tex: TexConfig;
    beamer: BeamerConfig;
    pptx: PptxConfig;
    tables: TablesConfig;
    postprocess: PostprocessConfig;
    _configPath?: string | null;
}
export interface BuildResult {
    format: string;
    success: boolean;
    outputPath?: string;
    error?: string;
}
interface BuildOptions {
    verbose?: boolean;
    config?: BuildConfig;
    outputPath?: string;
    crossref?: boolean;
    _refsAutoInjected?: boolean;
    _forwardRefsResolved?: number;
}
interface CombineOptions extends BuildOptions {
    _refsAutoInjected?: boolean;
}
interface PandocResult {
    outputPath: string;
    success: boolean;
    error?: string;
}
interface FullBuildResult {
    results: BuildResult[];
    paperPath: string;
    warnings: string[];
    forwardRefsResolved: number;
    refsAutoInjected?: boolean;
}
/**
 * Default rev.yaml configuration
 */
export declare const DEFAULT_CONFIG: BuildConfig;
/**
 * Merge journal formatting defaults into a config.
 * Priority: DEFAULT_CONFIG < journal formatting < rev.yaml explicit settings
 */
export declare function mergeJournalFormatting(config: BuildConfig, formatting: JournalFormatting, directory: string): BuildConfig;
/**
 * Load rev.yaml config from directory
 * @param directory - Project directory path
 * @returns Merged config with defaults
 * @throws {TypeError} If directory is not a string
 * @throws {Error} If rev.yaml exists but cannot be parsed
 */
export declare function loadConfig(directory: string): BuildConfig;
/**
 * Find section files in directory
 * @param directory - Project directory path
 * @param configSections - Sections from rev.yaml (optional)
 * @returns Ordered list of section file names
 * @throws {TypeError} If directory is not a string
 */
export declare function findSections(directory: string, configSections?: string[]): string[];
/**
 * Combine section files into paper.md
 */
export declare function combineSections(directory: string, config: BuildConfig, options?: CombineOptions): string;
/**
 * Process markdown tables to apply nowrap formatting to specified columns.
 * Converts distribution notation (Normal, Student-t, Gamma) to LaTeX math.
 * @param content - Markdown content
 * @param tablesConfig - tables config from rev.yaml
 * @param format - output format (pdf, docx, etc.)
 * @returns processed content
 */
export declare function processTablesForFormat(content: string, tablesConfig: TablesConfig, format: string): string;
/**
 * Prepare paper.md for specific output format
 */
export declare function prepareForFormat(paperPath: string, format: string, config: BuildConfig, options?: BuildOptions): string;
/**
 * Build pandoc arguments for format
 */
export declare function buildPandocArgs(format: string, config: BuildConfig, outputPath: string): string[];
/**
 * Run pandoc build
 */
export declare function runPandoc(inputPath: string, format: string, config: BuildConfig, options?: BuildOptions): Promise<PandocResult>;
/**
 * Full build pipeline
 */
export declare function build(directory: string, formats?: string[], options?: BuildOptions): Promise<FullBuildResult>;
/**
 * Get build status summary
 */
export declare function formatBuildResults(results: BuildResult[]): string;
export {};
//# sourceMappingURL=build.d.ts.map