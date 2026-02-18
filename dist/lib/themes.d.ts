/**
 * Slide Themes for Beamer and PPTX
 *
 * 20 professionally designed themes based on modern design principles:
 * - Bold, confident typography (2025-2026 trend)
 * - Curated color palettes (monochrome, earth tones, neo-mint, dark mode)
 * - Clean sans-serif fonts for readability
 * - Consistent visual hierarchy
 *
 * Each theme includes:
 * - Primary, secondary, accent colors
 * - Background and text colors
 * - Font recommendations
 * - Beamer configuration
 */
/**
 * Theme colors
 */
interface ThemeColors {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    backgroundDark: string;
    text: string;
    textLight: string;
}
/**
 * Theme fonts
 */
interface ThemeFonts {
    heading: string;
    body: string;
    mono: string;
}
/**
 * Beamer settings
 */
interface BeamerSettings {
    theme: string;
    colortheme: string | null;
    fonttheme: string | null;
}
/**
 * Complete theme definition
 */
interface Theme {
    name: string;
    displayName: string;
    description: string;
    colors: ThemeColors;
    fonts: ThemeFonts;
    beamer: BeamerSettings;
}
export declare const THEMES: Record<string, Theme>;
/**
 * Get theme by name
 */
export declare function getTheme(name: string): Theme | null;
/**
 * Get all theme names
 */
export declare function getThemeNames(): string[];
/**
 * Get themes by category
 */
export declare function getThemesByCategory(category: string): Theme[];
/**
 * Generate Beamer color definitions for a theme
 */
export declare function generateBeamerColors(theme: Theme): string;
/**
 * Generate CSS for PPTX reference doc
 */
export declare function generatePptxCSS(theme: Theme): string;
/**
 * Format theme info for display
 */
export declare function formatThemeInfo(theme: Theme): string;
/**
 * List all themes with descriptions
 */
export declare function listThemes(): string;
export {};
//# sourceMappingURL=themes.d.ts.map