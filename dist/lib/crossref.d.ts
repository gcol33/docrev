/**
 * Cross-reference handling - dynamic figure/table references
 *
 * Enables:
 * - @fig:label syntax in source (auto-numbered)
 * - Conversion to "Figure 1" in Word output
 * - Auto-conversion back during import
 */
import type { DynamicRef, Registry, RefStatus, ConversionResult } from './types.js';
/**
 * Parsed reference number components
 */
interface ParsedRefNumber {
    isSupp: boolean;
    num: number;
    suffix: string | null;
}
/**
 * Detected reference with parsed numbers
 */
interface DetectedRef {
    type: 'fig' | 'tbl' | 'eq';
    match: string;
    numbers: ParsedRefNumber[];
    position: number;
}
/**
 * Normalize a reference type to standard form
 */
export declare function normalizeType(typeStr: string): 'fig' | 'tbl' | 'eq' | string;
/**
 * Parse a reference number, handling supplementary (S1, S2) and letter suffixes (1a, 1b)
 */
export declare function parseRefNumber(numStr: string, suffix?: string | null): ParsedRefNumber;
/**
 * Parse a reference list string like "1, 2, and 3" or "1a-c" or "1a-3b"
 * Returns an array of {num, isSupp, suffix} objects
 */
export declare function parseReferenceList(listStr: string): ParsedRefNumber[];
/**
 * Build a registry of figure/table labels from .md files
 * Scans for {#fig:label} and {#tbl:label} anchors
 *
 * IMPORTANT: This function requires either explicit sections or a rev.yaml/sections.yaml config.
 * It will NOT guess by scanning all .md files, as this leads to incorrect numbering
 * when temporary files (paper_clean.md, etc.) exist in the directory.
 */
export declare function buildRegistry(directory: string, sections?: string[]): Registry;
/**
 * Get the display string for a label (e.g., "Figure 1", "Table S2")
 */
export declare function labelToDisplay(type: 'fig' | 'tbl' | 'eq', label: string, registry: Registry): string | null;
/**
 * Get the label for a display number (e.g., "fig:heatmap" from Figure 1)
 */
export declare function numberToLabel(type: 'fig' | 'tbl' | 'eq', num: number, isSupp: boolean, registry: Registry): string | null;
/**
 * Detect all hardcoded references in text
 */
export declare function detectHardcodedRefs(text: string): DetectedRef[];
/**
 * Convert hardcoded references to @-style references
 */
export declare function convertHardcodedRefs(text: string, registry: Registry): ConversionResult;
/**
 * Detect @-style references in text
 */
export declare function detectDynamicRefs(text: string): DynamicRef[];
/**
 * Get reference status for a file/text
 */
export declare function getRefStatus(text: string, registry: Registry): RefStatus;
/**
 * Detect forward references in combined text
 * A forward reference is a @ref that appears before its {#anchor} definition
 */
export declare function detectForwardRefs(text: string): {
    forwardRefs: Array<{
        type: string;
        label: string;
        match: string;
        position: number;
    }>;
    anchorPositions: Map<string, number>;
};
/**
 * Resolve forward references to display format
 * Only resolves refs that appear before their anchor definition
 * Leaves other refs for pandoc-crossref to handle (preserves clickable links)
 */
export declare function resolveForwardRefs(text: string, registry: Registry): {
    text: string;
    resolved: Array<{
        from: string;
        to: string;
        position: number;
    }>;
    unresolved: Array<{
        ref: string;
        position: number;
    }>;
};
/**
 * Resolve ALL supplementary references and strip supplementary anchor labels.
 *
 * pandoc-crossref cannot produce "Figure S1" numbering — it numbers all figures
 * sequentially. This function resolves every @fig:label / @tbl:label that points
 * to a supplementary item to plain text ("Figure S1", "Table S1") and removes
 * the {#fig:label} / {#tbl:label} attributes so pandoc-crossref ignores them.
 */
export declare function resolveSupplementaryRefs(text: string, registry: Registry): {
    text: string;
    resolved: Array<{
        from: string;
        to: string;
    }>;
};
/**
 * Format registry for display
 */
export declare function formatRegistry(registry: Registry): string;
export {};
//# sourceMappingURL=crossref.d.ts.map