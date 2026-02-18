/**
 * PDF comment extraction for docrev
 *
 * Extracts annotations (comments, highlights, sticky notes) from PDF files
 * and converts them to CriticMarkup format for insertion into markdown.
 * Also extracts the actual text content under highlights using pdfjs-dist.
 */
/**
 * Raw PDF annotation extracted from pdf-lib
 */
export interface PdfAnnotation {
    type: string;
    page: number;
    contents: string;
    author: string;
    date: string;
    rect: number[];
    quadPoints: number[];
}
/**
 * PDF comment converted to CriticMarkup format
 */
export interface PdfComment {
    author: string;
    text: string;
    page: number;
    type: string;
    date?: string;
}
/**
 * PDF annotation with extracted highlighted text
 */
export interface PdfAnnotationWithText extends PdfAnnotation {
    highlightedText: string;
}
/**
 * Options for PDF extraction
 */
export interface ExtractOptions {
    timeout?: number;
}
/**
 * Options for markdown insertion
 */
export interface InsertOptions {
    sectionPerPage?: boolean;
}
/**
 * Statistics about PDF comments
 */
export interface PdfCommentStats {
    total: number;
    byType: Record<string, number>;
    byAuthor: Record<string, number>;
    byPage: Record<number, number>;
}
/**
 * Extract raw annotations from a PDF file
 * @param pdfPath - Path to PDF file
 * @param options - { timeout: number (ms) }
 * @returns Array of PDF annotations
 */
export declare function extractPdfAnnotations(pdfPath: string, options?: ExtractOptions): Promise<PdfAnnotation[]>;
/**
 * Convert PDF annotations to CriticMarkup comments
 * @param annotations - From extractPdfAnnotations
 * @returns Array of PDF comments
 */
export declare function annotationsToComments(annotations: PdfAnnotation[]): PdfComment[];
/**
 * Extract comments from PDF and format for display
 * @param pdfPath - Path to PDF file
 * @returns Array of PDF comments
 */
export declare function extractPdfComments(pdfPath: string): Promise<PdfComment[]>;
/**
 * Insert PDF comments into markdown based on page/position heuristics
 * Since PDFs don't have direct text anchors like Word, we use page numbers
 * and append comments to the end of corresponding sections
 *
 * @param markdown - The markdown content
 * @param comments - Comments from extractPdfComments
 * @param options - { sectionPerPage: boolean }
 * @returns Markdown with comments inserted
 */
export declare function insertPdfCommentsIntoMarkdown(markdown: string, comments: PdfComment[], options?: InsertOptions): string;
/**
 * Format PDF comments for CLI display
 * @param comments - Array of PDF comments
 * @returns Formatted string
 */
export declare function formatPdfComments(comments: PdfComment[]): string;
/**
 * Get statistics about PDF comments
 * @param comments - Array of PDF comments
 * @returns Statistics object
 */
export declare function getPdfCommentStats(comments: PdfComment[]): PdfCommentStats;
/**
 * Extract highlighted text from a PDF using QuadPoints
 * @param pdfPath - Path to PDF file
 * @param annotations - Annotations with quadPoints from extractPdfAnnotations
 * @returns Annotations with highlighted text extracted
 */
export declare function extractHighlightedText(pdfPath: string, annotations: PdfAnnotation[]): Promise<PdfAnnotationWithText[]>;
/**
 * Extract annotations with highlighted text in one call
 * @param pdfPath - Path to PDF file
 * @returns Annotations with highlighted text
 */
export declare function extractPdfAnnotationsWithText(pdfPath: string): Promise<PdfAnnotationWithText[]>;
/**
 * Format annotation with highlighted text for display
 * @param annot - Annotation with highlightedText
 * @returns Formatted string
 */
export declare function formatAnnotationWithText(annot: PdfAnnotationWithText): string;
//# sourceMappingURL=pdf-import.d.ts.map