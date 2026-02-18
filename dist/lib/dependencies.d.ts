/**
 * Dependency checking utilities for pandoc, LaTeX, and related tools
 */
/**
 * Check if pandoc-crossref is available
 */
export declare function hasPandocCrossref(): boolean;
/**
 * Check if pandoc is available
 */
export declare function hasPandoc(): boolean;
/**
 * Check if LaTeX is available (for PDF generation)
 */
export declare function hasLatex(): boolean;
/**
 * Get installation instructions for missing dependencies
 */
export declare function getInstallInstructions(dependency: string): string;
export interface DependencyStatus {
    pandoc: boolean;
    latex: boolean;
    crossref: boolean;
    messages: string[];
}
/**
 * Check dependencies and return status
 */
export declare function checkDependencies(): DependencyStatus;
//# sourceMappingURL=dependencies.d.ts.map