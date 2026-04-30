/**
 * Compute section boundaries in a DOCX from its real heading paragraphs.
 *
 * Given the configured `sections.yaml` and the headings extracted via
 * `extractHeadings()`, return one boundary per section file with text
 * positions in the same coordinate system as `CommentAnchorData.docPosition`.
 *
 * Matching is by heading text (primary header + aliases, case-insensitive).
 * This replaces the older keyword-search-in-body-text approach which would
 * pick up section names that happen to appear inside prose ("results across
 * countries") or in structured-abstract labels where paragraph boundaries
 * are lost in concatenation.
 */
import type { DocxHeading } from '../word-extraction.js';
import type { SectionConfig } from '../types.js';
export interface SectionBoundary {
    file: string;
    start: number;
    end: number;
}
export declare function computeSectionBoundaries(sections: Record<string, SectionConfig>, headings: DocxHeading[]): SectionBoundary[];
//# sourceMappingURL=section-boundaries.d.ts.map