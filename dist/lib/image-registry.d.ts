/**
 * Image registry utilities for tracking figures and tables in markdown documents
 *
 * The registry maps figure/table labels and display numbers to source paths,
 * enabling Word import to match rendered figures back to original sources.
 */
/**
 * Image registry entry
 */
interface ImageEntry {
    caption: string;
    path: string;
    label: string | null;
    type: 'fig' | 'tbl';
    number?: string;
}
/**
 * Image registry
 */
interface ImageRegistry {
    figures: ImageEntry[];
    byLabel: Map<string, ImageEntry>;
    byNumber: Map<string, ImageEntry>;
    byCaption: Map<string, ImageEntry>;
}
/**
 * Crossref registry info
 */
interface CrossrefInfo {
    num: number;
    isSupp: boolean;
}
/**
 * Crossref registry
 */
interface CrossrefRegistry {
    figures: Map<string, CrossrefInfo>;
    tables: Map<string, CrossrefInfo>;
}
/**
 * Saved registry data
 */
interface RegistryData {
    version: number;
    created: string;
    figures: ImageEntry[];
}
/**
 * Pattern to extract markdown images with optional pandoc-crossref anchors
 * Captures: ![caption](path){#fig:label} or ![caption](path)
 * Groups: [1] = caption, [2] = path, [3] = label type (fig/tbl), [4] = label
 */
export declare const IMAGE_PATTERN: RegExp;
/**
 * Build image registry from markdown content
 * Maps figure labels and display numbers to source paths
 */
export declare function buildImageRegistry(content: string, crossrefRegistry?: CrossrefRegistry | null): ImageRegistry;
/**
 * Write image registry to .rev directory
 */
export declare function writeImageRegistry(directory: string, registry: ImageRegistry): string;
/**
 * Read image registry from .rev directory
 */
export declare function readImageRegistry(directory: string): (ImageRegistry & RegistryData) | null;
export {};
//# sourceMappingURL=image-registry.d.ts.map