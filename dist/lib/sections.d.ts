/**
 * Section handling - map between section .md files and combined documents
 */
import type { SectionConfig, SectionsConfig, ExtractedSection } from './types.js';
/**
 * Extract header from a markdown file
 */
export declare function extractHeader(filePath: string): string | null;
/**
 * Generate sections.yaml from existing .md files
 */
export declare function generateConfig(directory: string, excludePatterns?: string[]): SectionsConfig;
/**
 * Load sections config from yaml file
 */
export declare function loadConfig(configPath: string): SectionsConfig;
/**
 * Save sections config to yaml file
 */
export declare function saveConfig(configPath: string, config: SectionsConfig): void;
/**
 * Match a heading to a section file
 */
export declare function matchHeading(heading: string, sections: Record<string, SectionConfig>): {
    file: string;
    config: SectionConfig;
} | null;
/**
 * Extract sections from Word document text
 */
export declare function extractSectionsFromText(text: string, sections: Record<string, SectionConfig>): ExtractedSection[];
/**
 * Parse annotated paper.md and split back to section files
 */
export declare function splitAnnotatedPaper(paperContent: string, sections: Record<string, SectionConfig>): Map<string, string>;
/**
 * Get ordered list of section files from config
 */
export declare function getOrderedSections(config: SectionsConfig): string[];
//# sourceMappingURL=sections.d.ts.map