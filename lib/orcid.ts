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
export function isValidOrcid(orcid: string): boolean {
  return /^(\d{4}-){3}\d{3}[\dX]$/i.test(orcid);
}

/**
 * Clean ORCID input (removes URLs, whitespace)
 */
export function cleanOrcid(input: string): string {
  if (!input) return '';

  // Remove URL prefix if present
  let clean = input.trim()
    .replace(/^https?:\/\/(www\.)?orcid\.org\//i, '')
    .replace(/^orcid\.org\//i, '')
    .trim();

  return clean;
}

/**
 * Fetch author info from ORCID public API
 */
export async function fetchOrcidProfile(orcid: string): Promise<OrcidProfile> {
  const cleanId = cleanOrcid(orcid);

  if (!isValidOrcid(cleanId)) {
    throw new Error(`Invalid ORCID format: ${orcid}`);
  }

  const url = `https://pub.orcid.org/v3.0/${cleanId}/person`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`ORCID not found: ${cleanId}`);
    }
    throw new Error(`ORCID API error: ${response.status}`);
  }

  const data = await response.json() as any;

  // Extract name
  const nameData = data.name;
  let name = '';
  if (nameData) {
    const given = nameData['given-names']?.value || '';
    const family = nameData['family-name']?.value || '';
    name = `${given} ${family}`.trim();
  }

  // Extract primary affiliation
  let affiliation = '';
  const affiliations = data.employments?.['affiliation-group'] || [];
  if (affiliations.length > 0) {
    const primary = affiliations[0]?.summaries?.[0]?.['employment-summary'];
    affiliation = primary?.organization?.name || '';
  }

  // Extract email (if public)
  let email = '';
  const emails = data.emails?.email || [];
  const primaryEmail = emails.find((e: any) => e.primary) || emails[0];
  if (primaryEmail?.email) {
    email = primaryEmail.email;
  }

  return {
    orcid: cleanId,
    name,
    affiliation,
    email,
  };
}

/**
 * Fetch work count from ORCID
 */
export async function fetchOrcidWorkCount(orcid: string): Promise<number> {
  const cleanId = cleanOrcid(orcid);

  if (!isValidOrcid(cleanId)) {
    throw new Error(`Invalid ORCID format: ${orcid}`);
  }

  const url = `https://pub.orcid.org/v3.0/${cleanId}/works`;

  const response = await fetch(url, {
    headers: {
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    return 0;
  }

  const data = await response.json() as any;
  return data.group?.length || 0;
}

/**
 * Format author for YAML
 */
export function formatAuthorYaml(profile: OrcidProfile): string {
  const lines: string[] = [];
  lines.push(`  - name: ${profile.name}`);
  if (profile.affiliation) {
    lines.push(`    affiliation: ${profile.affiliation}`);
  }
  if (profile.email) {
    lines.push(`    email: ${profile.email}`);
  }
  lines.push(`    orcid: ${profile.orcid}`);
  return lines.join('\n');
}

/**
 * Generate ORCID badge markdown
 */
export function getOrcidBadge(orcid: string): string {
  const cleanId = cleanOrcid(orcid);
  return `[![ORCID](https://img.shields.io/badge/ORCID-${cleanId}-a6ce39)](https://orcid.org/${cleanId})`;
}
