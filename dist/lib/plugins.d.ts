/**
 * Plugin system for custom journal profiles and export formats
 *
 * Users can add custom profiles in:
 * - Project: .rev/profiles/*.yaml
 * - User: ~/.rev/profiles/*.yaml
 */
/**
 * Journal profile requirements
 */
interface ProfileRequirements {
    wordLimit?: Record<string, number | null>;
    references?: Record<string, unknown>;
    figures?: Record<string, unknown>;
    sections?: Record<string, unknown>;
    authors?: Record<string, unknown>;
    keywords?: {
        min?: number;
        max?: number;
    } | null;
    dataAvailability?: boolean;
    [key: string]: unknown;
}
/**
 * Journal formatting defaults
 */
interface ProfileFormatting {
    csl?: string;
    pdf?: Record<string, unknown>;
    docx?: Record<string, unknown>;
    crossref?: Record<string, unknown>;
    [key: string]: unknown;
}
/**
 * Normalized profile
 */
interface NormalizedProfile {
    name: string;
    url: string | null;
    custom: boolean;
    requirements: ProfileRequirements;
    formatting?: ProfileFormatting;
}
/**
 * Profile list entry
 */
interface ProfileListEntry {
    id: string;
    name: string;
    source: 'user' | 'project';
    path: string;
}
/**
 * Plugin directories info
 */
interface PluginDirsInfo {
    user: string;
    project: string;
    userExists: boolean;
    projectExists: boolean;
}
/**
 * Load all custom journal profiles
 */
export declare function loadCustomProfiles(): Record<string, NormalizedProfile>;
/**
 * Initialize plugin directories
 */
export declare function initPluginDir(project?: boolean): string;
/**
 * Get plugin directories info
 */
export declare function getPluginDirs(): PluginDirsInfo;
/**
 * Create a sample profile template
 */
export declare function createProfileTemplate(journalName: string): string;
/**
 * Save a profile template
 */
export declare function saveProfileTemplate(journalName: string, project?: boolean): string;
/**
 * List all custom profiles
 */
export declare function listCustomProfiles(): ProfileListEntry[];
export {};
//# sourceMappingURL=plugins.d.ts.map