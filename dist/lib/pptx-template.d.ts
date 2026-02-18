/**
 * PPTX post-processing
 *
 * Pure TypeScript implementation using AdmZip for in-memory ZIP/PPTX manipulation.
 * No Python dependency required.
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
 * Apply theme fonts to all text in a PPTX.
 * Pandoc generates slides with hardcoded fonts; this replaces them with theme font references.
 */
export declare function applyThemeFonts(pptxPath: string, theme: Theme): Promise<void>;
/**
 * Apply horizontal centering to slides that have the .center class.
 */
export declare function applyCentering(pptxPath: string, centeredSlideIndices: number[]): Promise<void>;
/**
 * Inject slide numbers into content slides of a PPTX.
 * Only adds numbers to slides that have a footer and body placeholder.
 * Title, section, and cover slides are skipped.
 */
export declare function injectSlideNumbers(pptxPath: string): Promise<void>;
/**
 * Inject logos into cover slide of a PPTX (matching ref.pptx style).
 */
export declare function injectLogosIntoSlides(pptxPath: string, mediaDir: string | null): Promise<void>;
/**
 * Apply buildup greying to slides with buildup content.
 * Greys out all bullet items except the last one, which gets the accent color.
 * Only affects actual bullet items (not intro text with buNone).
 */
export declare function applyBuildupColors(pptxPath: string, config?: BuildupConfig): Promise<void>;
export declare function generatePptxTemplate(options: TemplateOptions): Promise<string | null>;
export declare function templateNeedsRegeneration(templatePath: string, mediaDir: string, baseTemplate: string): boolean;
export declare function injectMediaIntoPptx(pptxPath: string, mediaDir: string): Promise<void>;
export {};
//# sourceMappingURL=pptx-template.d.ts.map