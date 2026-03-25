/**
 * Import functionality - convert Word docs to annotated Markdown
 *
 * Orchestration workflows + re-exports from extraction/diff/restore modules
 */
import type { WordComment, CommentAnchorData, WordTable } from './word-extraction.js';
export { extractFromWord, extractWordComments, extractCommentAnchors, extractWordTables, } from './word-extraction.js';
export type { WordComment, TextNode, CommentAnchorData, CommentAnchorsResult, WordTable, ParsedRow, ExtractFromWordOptions, ExtractMessage, ExtractFromWordResult, } from './word-extraction.js';
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
export interface AnchorSearchResult {
    occurrences: number[];
    matchedAnchor: string | null;
    strategy: string;
    stripped?: boolean;
}
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