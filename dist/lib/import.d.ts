/**
 * Import functionality - convert Word docs to annotated Markdown
 *
 * Orchestration workflows + re-exports from extraction/diff/restore modules
 */
import type { WordComment, CommentAnchorData, WordTable } from './word-extraction.js';
export { extractFromWord, extractWordComments, extractCommentAnchors, extractHeadings, extractWordTables, } from './word-extraction.js';
export type { WordComment, TextNode, CommentAnchorData, CommentAnchorsResult, DocxHeading, WordTable, ParsedRow, ExtractFromWordOptions, ExtractMessage, ExtractFromWordResult, } from './word-extraction.js';
export { generateSmartDiff, generateAnnotatedDiff, cleanupAnnotations, fixCitationAnnotations, } from './diff-engine.js';
export type { GenerateSmartDiffOptions, } from './diff-engine.js';
export { restoreCrossrefFromWord, restoreImagesFromRegistry, parseVisibleComments, convertVisibleComments, } from './restore-references.js';
export type { RestoreCrossrefResult, RestoreImagesResult, } from './restore-references.js';
export interface InsertCommentsOptions {
    quiet?: boolean;
    sectionBoundary?: {
        start: number;
        end: number;
    } | null;
    /**
     * When true (default), comments wrap their anchor text in `[anchor]{.mark}`
     * so the rebuilt docx restores the original Word comment range. When false,
     * comments are inserted as standalone `{>>...<<}` blocks adjacent to the
     * anchor — the prose stays byte-identical except for the inserted blocks.
     *
     * Set to false from `sync --comments-only` so a draft revised after the
     * docx was sent for review keeps its prose intact, and so multiple
     * comments sharing one anchor don't produce nested broken markup.
     */
    wrapAnchor?: boolean;
    /**
     * Mutable output: when provided, the function fills in counters so callers
     * can distinguish placement outcomes in their summary. `placed` counts new
     * insertions, `deduped` counts comments that were already present at their
     * anchor (skipped to avoid duplication on re-sync), `unmatched` counts
     * comments whose anchor couldn't be located.
     */
    outStats?: {
        placed: number;
        deduped: number;
        unmatched: number;
    };
}
export interface CommentWithPos {
    id: string;
    author: string;
    text: string;
    date: string;
    pos: number;
    anchorText: string | null;
    anchorEnd?: number;
    isEmpty?: boolean;
    strategy?: string;
}
export type { AnchorSearchResult } from './anchor-match.js';
export interface MarkdownPrefixResult {
    prefix: string;
    content: string;
}
export interface ImportWordWithTrackChangesOptions {
    mediaDir?: string;
    projectDir?: string;
}
export interface ImportWordWithTrackChangesResult {
    text: string;
    stats: {
        insertions: number;
        deletions: number;
        substitutions: number;
        comments: number;
        total: number;
        hasTrackChanges: boolean;
        trackChangeStats: {
            insertions: number;
            deletions: number;
        };
    };
    extractedMedia: string[];
    comments: WordComment[];
}
export interface ImportFromWordOptions {
    author?: string;
    sectionContent?: string;
    figuresDir?: string;
    wordTables?: WordTable[];
}
export interface ImportFromWordResult {
    annotated: string;
    stats: {
        insertions: number;
        deletions: number;
        substitutions: number;
        comments: number;
        total: number;
    };
    extractedMedia: string[];
}
export interface MovedFile {
    from: string;
    to: string;
    name: string;
}
export interface MoveExtractedMediaResult {
    moved: MovedFile[];
    errors: string[];
}
/**
 * Insert comments into markdown text based on anchor texts with context
 */
export declare function insertCommentsIntoMarkdown(markdown: string, comments: WordComment[], anchors: Map<string, CommentAnchorData | string>, options?: InsertCommentsOptions): string;
/**
 * Import Word document with track changes directly as CriticMarkup
 */
export declare function importWordWithTrackChanges(docxPath: string, options?: ImportWordWithTrackChangesOptions): Promise<ImportWordWithTrackChangesResult>;
/**
 * Legacy import function: Word doc → annotated MD via diff
 */
export declare function importFromWord(docxPath: string, originalMdPath: string, options?: ImportFromWordOptions): Promise<ImportFromWordResult>;
/**
 * Move extracted media files to a figures directory with better names
 */
export declare function moveExtractedMedia(mediaFiles: string[], figuresDir: string, prefix?: string): MoveExtractedMediaResult;
//# sourceMappingURL=import.d.ts.map