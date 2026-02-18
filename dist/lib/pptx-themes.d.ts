/**
 * PPTX Theme System
 *
 * Provides 6 built-in themes for PPTX output, independent of Beamer themes.
 * Each theme is a reference PPTX file that defines colors, fonts, and slide layouts.
 *
 * Uses pandoc's default reference.pptx as the base template and modifies the theme.xml
 * to apply custom colors and fonts. This ensures all 11 required slide layouts are present.
 *
 * Themes:
 * - default: Clean white with blue accents (professional)
 * - dark: Dark background with light text (modern)
 * - academic: Classic serif fonts, muted colors (scholarly)
 * - minimal: High contrast black/white (clean)
 * - corporate: Navy/gold color scheme (business)
 * - plant: Nature-inspired green theme (ecology/biology)
 */
/**
 * Color scheme for a theme
 */
interface ThemeColors {
    dk1: string;
    lt1: string;
    dk2: string;
    lt2: string;
    accent1: string;
    accent2: string;
    accent3: string;
    accent4: string;
    accent5: string;
    accent6: string;
    hlink: string;
    folHlink: string;
}
/**
 * Font scheme for a theme
 */
interface ThemeFonts {
    major: string;
    minor: string;
}
/**
 * PPTX theme definition
 */
interface PptxTheme {
    name: string;
    description: string;
    colors: ThemeColors;
    fonts: ThemeFonts;
    background?: string;
}
/**
 * Theme definitions with colors and fonts
 */
export declare const PPTX_THEMES: Record<string, PptxTheme>;
/**
 * Get list of available theme names
 */
export declare function getThemeNames(): string[];
/**
 * Get theme definition by name
 */
export declare function getTheme(name: string): PptxTheme | null;
/**
 * Generate a PPTX theme file by modifying pandoc's reference template
 */
export declare function generateThemeFile(themeName: string, outputPath: string): string;
/**
 * Get path to bundled theme file, generating if needed
 */
export declare function getThemePath(themeName: string): string | null;
/**
 * Generate all theme files
 */
export declare function generateAllThemes(outputDir: string): Array<{
    theme: string;
    path: string;
}>;
export {};
//# sourceMappingURL=pptx-themes.d.ts.map