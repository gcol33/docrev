/**
 * ORCID integration for author metadata
 *
 * Fetches author information from ORCID public API
 */
export interface OrcidProfile {
    orcid: string;
    name: string;
    affiliation: string;
    email: string;
}
/**
 * Validate ORCID format (0000-0000-0000-0000)
 */
export declare function isValidOrcid(orcid: string): boolean;
/**
 * Clean ORCID input (removes URLs, whitespace)
 */
export declare function cleanOrcid(input: string): string;
/**
 * Fetch author info from ORCID public API
 */
export declare function fetchOrcidProfile(orcid: string): Promise<OrcidProfile>;
/**
 * Fetch work count from ORCID
 */
export declare function fetchOrcidWorkCount(orcid: string): Promise<number>;
/**
 * Format author for YAML
 */
export declare function formatAuthorYaml(profile: OrcidProfile): string;
/**
 * Generate ORCID badge markdown
 */
export declare function getOrcidBadge(orcid: string): string;
//# sourceMappingURL=orcid.d.ts.map