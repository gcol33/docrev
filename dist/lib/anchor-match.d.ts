/**
 * Anchor matching primitives shared between sync (insertion) and
 * verify-anchors (drift reporting). The functions are pure: given an
 * anchor string and surrounding context, locate candidate positions in
 * a target text using progressively looser strategies.
 */
export type AnchorStrategy = 'direct' | 'normalized' | 'stripped' | 'partial-start' | 'partial-start-stripped' | 'context-both' | 'context-before' | 'context-after' | 'split-match' | 'empty-anchor' | 'failed';
export interface AnchorSearchResult {
    occurrences: number[];
    matchedAnchor: string | null;
    strategy: AnchorStrategy;
    stripped?: boolean;
}
/**
 * Strip CriticMarkup so the matcher sees plain prose instead of
 * `{++inserted++}`/`{--deleted--}`/etc. Used when an anchor lives
 * underneath previously imported track changes.
 */
export declare function stripCriticMarkup(text: string): string;
/**
 * Return every starting index where `needle` occurs in `haystack`.
 * Empty needles return no occurrences (empty matches are not useful
 * for anchor placement).
 */
/**
 * Score how well the docx-side `before` / `after` context matches the
 * surroundings of a candidate position in the target text. Used by
 * `verify-anchors` to tell apart "multiple hits but context picks one
 * cleanly" (sync will place it correctly) from "multiple hits, context
 * doesn't help" (truly ambiguous, needs human placement).
 *
 * Returns 0 if no context was provided.
 */
export declare function scoreContextAt(pos: number, text: string, before: string, after: string, anchorLen: number): number;
export declare function findAllOccurrences(haystack: string, needle: string): number[];
/**
 * Find candidate positions for `anchor` in `text`, falling back through
 * progressively looser strategies (whitespace normalization, stripped
 * CriticMarkup, partial-prefix, surrounding context, word splitting).
 *
 * The returned `strategy` lets callers distinguish a clean direct hit
 * from a fuzzy approximation — useful for drift reporting.
 */
export declare function findAnchorInText(anchor: string, text: string, before?: string, after?: string): AnchorSearchResult;
/**
 * Classify a strategy as a clean hit, a fuzzy/drifted hit, or no hit.
 * Used by `verify-anchors` to summarize per-comment match quality.
 */
export type AnchorMatchQuality = 'clean' | 'drift' | 'context-only' | 'unmatched';
export declare function classifyStrategy(strategy: AnchorStrategy, occurrences: number): AnchorMatchQuality;
//# sourceMappingURL=anchor-match.d.ts.map