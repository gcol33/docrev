/**
 * Slide processing for Beamer and PPTX output
 *
 * Handles:
 * - ::: step blocks for incremental reveals
 * - ::: buildup blocks for progressive bullet reveals with greying
 * - ::: notes blocks for speaker notes
 * - Slide boundaries (---)
 * - Slide styles: {.dark}, {.light}, {.accent}, {.inverse}
 * - Special slides: {.cover}, {.thanks}, {.section}, {.plain}
 *
 * Syntax examples:
 *   ## Title {.dark}           - Dark background slide
 *   ## Welcome {.cover}        - Cover slide (no numbering, centered)
 *   ## Thank You {.thanks}     - Thanks slide (no numbering)
 *   # Part 1 {.section}        - Section divider slide
 *   ## Image {.plain}          - No header/footer, full content
 *   ## Highlight {.accent .nonumber}  - Accent color, no slide number
 *
 * Buildup syntax:
 *   ::: buildup
 *   - First point
 *     - Sub A
 *     - Sub B
 *   - Second point
 *   :::
 *
 * Generates slides where current point is colored, previous are greyed out.
 * Subpoints appear sequentially within their parent.
 */
interface Step {
    index: number;
    content: string;
}
interface SlideStyle {
    background: string | null;
    type: string | null;
    nonumber: boolean;
    center: boolean;
    classes: string[];
}
interface Slide {
    title: string;
    titleLevel: number;
    steps: Step[];
    notes: string | null;
    preamble: string;
    style: SlideStyle;
    _frontmatter?: string;
}
/**
 * Parse slide style attributes from heading
 */
declare function parseSlideStyle(heading: string): {
    title: string;
    style: SlideStyle;
};
/**
 * Parse a single slide's content into steps and notes
 */
export declare function parseSlide(slideContent: string): Slide;
/**
 * Parse markdown document into slides
 */
export declare function parseSlides(markdown: string): Slide[];
/**
 * Generate Beamer markdown using pandoc's native slide structure
 * Works WITH pandoc, not against it - pandoc creates frames, we add overlays
 */
export declare function generateBeamerMarkdown(slides: Slide[]): string;
/**
 * Generate PPTX markdown with duplicated slides for steps
 * Each step becomes a separate physical slide
 * Handles ::: buildup blocks by expanding them into multiple slides
 */
export declare function generatePptxMarkdown(slides: Slide[]): string;
/**
 * Process markdown for slide output format
 */
export declare function processSlideMarkdown(markdown: string, format: 'beamer' | 'pptx'): string;
/**
 * Check if markdown contains slide syntax (steps, notes, buildup, or slide styles)
 */
export declare function hasSlideSyntax(markdown: string): boolean;
export { parseSlideStyle };
//# sourceMappingURL=slides.d.ts.map