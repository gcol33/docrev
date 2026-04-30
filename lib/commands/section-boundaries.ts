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

export function computeSectionBoundaries(
  sections: Record<string, SectionConfig>,
  headings: DocxHeading[],
  docLength?: number,
): SectionBoundary[] {
  const matched: SectionBoundary[] = [];

  // Only consider top-level (Heading1-style) when level info is available;
  // when level==0 (unparseable style), fall back to all headings.
  const haveLevels = headings.some(h => h.level > 0);
  const candidates = haveLevels ? headings.filter(h => h.level === 1) : headings;

  for (const [file, cfg] of Object.entries(sections)) {
    const targets = [cfg.header, ...(cfg.aliases || [])]
      .filter(Boolean)
      .map(s => s.toLowerCase().trim());

    let firstMatch = -1;
    for (const h of candidates) {
      const text = h.text.toLowerCase().trim();
      if (targets.includes(text)) {
        firstMatch = h.docPosition;
        break;
      }
    }

    // Fallback: if no level-1 hit, allow any-level match (handles single-level docs)
    if (firstMatch < 0 && haveLevels) {
      for (const h of headings) {
        const text = h.text.toLowerCase().trim();
        if (targets.includes(text)) {
          firstMatch = h.docPosition;
          break;
        }
      }
    }

    if (firstMatch >= 0) {
      matched.push({ file, start: firstMatch, end: Number.MAX_SAFE_INTEGER });
    }
  }

  // Sort by start position and tighten each end to the next start.
  // The last section's end is capped at docLength when known, otherwise
  // left at MAX_SAFE_INTEGER. Without the cap, single-section configs
  // produce a sectionLength of ~9e15, collapsing proportional-position
  // math in insertCommentsIntoMarkdown to 0 and stacking every comment
  // at the document start.
  matched.sort((a, b) => a.start - b.start);
  for (let i = 0; i < matched.length - 1; i++) {
    matched[i].end = matched[i + 1].start;
  }
  if (matched.length > 0 && docLength !== undefined) {
    const last = matched[matched.length - 1];
    if (last.end > docLength) last.end = docLength;
  }

  return matched;
}
