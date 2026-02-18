/**
 * PPTX post-processing
 *
 * Injects logos into each slide of a generated PPTX to match ref.pptx styling.
 * Uses ref.pptx as-is for --reference-doc, then post-processes to add logos.
 */
interface ThemeFonts {
    major?: string;
    minor?: string;
}
interface Theme {
    fonts?: ThemeFonts;
}
interface TemplateOptions {
    baseTemplate: string;
    outputPath: string;
}
interface BuildupConfig {
    default?: string;
    title?: string;
    grey?: string;
    accent?: string;
    enabled?: boolean;
}
/**
 * Inject slide numbers into each slide of a PPTX
 * Only adds slide numbers to slides that have a footer (i.e., slides with the green banner).
 * Title slides, section slides, cover slides don't have the banner so they don't get numbers.
 * Uses in-place ZIP modification to preserve file structure.
 */
export declare function injectSlideNumbers(pptxPath: string): Promise<void>;
/**
 * Inject logos into cover slide of a PPTX (matching ref.pptx style)
 * Uses in-place ZIP modification to preserve file structure.
 */
export declare function injectLogosIntoSlides(pptxPath: string, mediaDir: string | null): Promise<void>;
export declare function generatePptxTemplate(options: TemplateOptions): Promise<string | null>;
export declare function templateNeedsRegeneration(templatePath: string, mediaDir: string, baseTemplate: string): boolean;
export declare function injectMediaIntoPptx(pptxPath: string, mediaDir: string): Promise<void>;
/**
 * Apply theme fonts to all text in a PPTX
 * Pandoc generates slides with hardcoded fonts; this replaces them with theme font references.
 * Uses in-place ZIP modification to preserve file structure.
 */
export declare function applyThemeFonts(pptxPath: string, theme: Theme): Promise<void>;
/**
 * Apply vertical centering to slides that have the .center class
 * Uses in-place ZIP modification to preserve file structure.
 */
export declare function applyCentering(pptxPath: string, centeredSlideIndices: number[]): Promise<void>;
/**
 * Apply buildup greying to slides with buildup content
 * Greys out all bullet items except the last one, which gets the accent color.
 * Only affects actual bullet items (not intro text with buNone).
 * Uses in-place ZIP modification to preserve file structure.
 */
export declare function applyBuildupColors(pptxPath: string, config?: BuildupConfig): Promise<void>;
export {};
//# sourceMappingURL=pptx-template.d.ts.map