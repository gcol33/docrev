/**
 * PDF comment rendering for dual export
 *
 * Converts CriticMarkup comments to LaTeX margin notes for PDF output
 */
/**
 * LaTeX preamble for margin comments
 * Uses todonotes package with custom styling
 */
export declare const MARGIN_NOTES_PREAMBLE = "\n% Margin notes for comments\n\\usepackage[colorinlistoftodos,textsize=scriptsize]{todonotes}\n\\usepackage{xcolor}\n\n% Define comment colors by author\n\\definecolor{commentblue}{RGB}{59, 130, 246}\n\\definecolor{commentgreen}{RGB}{34, 197, 94}\n\\definecolor{commentorange}{RGB}{249, 115, 22}\n\\definecolor{commentpurple}{RGB}{168, 85, 247}\n\\definecolor{commentgray}{RGB}{107, 114, 128}\n\n% Custom margin note command\n\\newcommand{\\margincomment}[2][]{%\n  \\todo[linecolor=commentblue,backgroundcolor=commentblue!10,bordercolor=commentblue,size=\\scriptsize,#1]{#2}%\n}\n\n% Author-specific commands\n\\newcommand{\\reviewercomment}[2]{%\n  \\todo[linecolor=commentgreen,backgroundcolor=commentgreen!10,bordercolor=commentgreen,size=\\scriptsize]{\\textbf{#1:} #2}%\n}\n\n% Increase margin for notes (if needed)\n% \\setlength{\\marginparwidth}{2.5cm}\n";
/**
 * Simpler preamble using marginpar (no extra packages needed)
 */
export declare const SIMPLE_MARGIN_PREAMBLE = "\n% Simple margin notes for comments\n\\usepackage{xcolor}\n\\definecolor{commentcolor}{RGB}{59, 130, 246}\n\n\\newcommand{\\margincomment}[1]{%\n  \\marginpar{\\raggedright\\scriptsize\\textcolor{commentcolor}{#1}}%\n}\n";
/**
 * Options for converting comments to margin notes
 */
export interface CommentConversionOptions {
    useTodonotes?: boolean;
    stripResolved?: boolean;
}
/**
 * Result of comment conversion
 */
export interface CommentConversionResult {
    markdown: string;
    commentCount: number;
    preamble: string;
}
/**
 * Convert CriticMarkup comments to LaTeX margin notes
 * {>>Author: comment text<<} -> \margincomment{Author: comment text}
 *
 * @param markdown - Markdown with CriticMarkup comments
 * @param options - { useTodonotes: boolean, stripResolved: boolean }
 * @returns Converted markdown with comment count and preamble
 */
export declare function convertCommentsToMarginNotes(markdown: string, options?: CommentConversionOptions): CommentConversionResult;
/**
 * Result of track changes conversion
 */
export interface TrackChangesResult {
    markdown: string;
    preamble: string;
}
/**
 * Convert track changes to visible LaTeX formatting
 * {++inserted++} -> \textcolor{green}{inserted}
 * {--deleted--} -> \textcolor{red}{\sout{deleted}}
 * {~~old~>new~~} -> \textcolor{red}{\sout{old}}\textcolor{green}{new}
 *
 * @param markdown - Markdown with track changes
 * @returns Converted markdown and preamble
 */
export declare function convertTrackChangesToLatex(markdown: string): TrackChangesResult;
/**
 * Options for combined preamble
 */
export interface PreambleOptions {
    comments?: boolean;
    trackChanges?: boolean;
    useTodonotes?: boolean;
}
/**
 * Get combined preamble for comments and track changes
 * @param options - { comments: boolean, trackChanges: boolean, useTodonotes: boolean }
 * @returns Combined LaTeX preamble
 */
export declare function getCombinedPreamble(options?: PreambleOptions): string;
/**
 * Options for preparing markdown for annotated PDF
 */
export interface AnnotatedPdfOptions {
    showTrackChanges?: boolean;
    useTodonotes?: boolean;
    stripResolved?: boolean;
}
/**
 * Result of preparing markdown for annotated PDF
 */
export interface AnnotatedPdfResult {
    markdown: string;
    preamble: string;
    commentCount: number;
}
/**
 * Prepare markdown for PDF with visible comments
 * Converts comments to margin notes and optionally shows track changes
 *
 * @param markdown - Markdown content
 * @param options - { showTrackChanges: boolean, useTodonotes: boolean }
 * @returns Converted markdown with preamble and comment count
 */
export declare function prepareMarkdownForAnnotatedPdf(markdown: string, options?: AnnotatedPdfOptions): AnnotatedPdfResult;
//# sourceMappingURL=pdf-comments.d.ts.map