/**
 * Equation extraction and conversion utilities
 * Handle LaTeX math in Markdown ↔ Word workflows
 *
 * Supports:
 * - Extract LaTeX equations from Markdown
 * - Extract equations from Word documents (OMML → LaTeX via Pandoc)
 * - Convert Markdown with equations to Word (LaTeX → MathML)
 */
import type { Equation, EquationStats, WordEquationResult } from './types.js';
/**
 * Extract all equations from markdown text
 */
export declare function extractEquations(text: string, file?: string): Equation[];
/**
 * Generate a markdown document with numbered equations
 * Useful for creating an equation reference sheet
 */
export declare function generateEquationSheet(equations: Equation[]): string;
interface ConvertToWordOptions {
    preserveLatex?: boolean;
}
/**
 * Convert markdown with equations to Word using pandoc
 */
export declare function convertToWord(inputPath: string, outputPath: string, options?: ConvertToWordOptions): Promise<{
    success: boolean;
    message: string;
}>;
/**
 * Create a simple equations-only document
 */
export declare function createEquationsDoc(inputPath: string, outputPath: string): Promise<{
    success: boolean;
    message: string;
    stats: {
        display: number;
        inline: number;
    } | null;
}>;
/**
 * Get equation statistics for a file or directory
 */
export declare function getEquationStats(files: string[]): EquationStats;
/**
 * Extract equations from a Word document using Pandoc
 * Converts OMML (Office Math Markup) to LaTeX
 */
export declare function extractEquationsFromWord(docxPath: string): Promise<WordEquationResult>;
/**
 * Get equation summary from Word document
 */
export declare function getWordEquationStats(docxPath: string): Promise<{
    count: number;
    display: number;
    inline: number;
    converted: number;
    error?: string;
}>;
export {};
//# sourceMappingURL=equations.d.ts.map