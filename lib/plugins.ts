/**
 * Plugin system for custom journal profiles and export formats
 *
 * Users can add custom profiles in:
 * - Project: .rev/profiles/*.yaml
 * - User: ~/.rev/profiles/*.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'yaml';

/**
 * Journal profile requirements
 */
interface ProfileRequirements {
  wordLimit?: Record<string, number | null>;
  references?: Record<string, unknown>;
  figures?: Record<string, unknown>;
  sections?: Record<string, unknown>;
  authors?: Record<string, unknown>;
  keywords?: { min?: number; max?: number } | null;
  dataAvailability?: boolean;
  [key: string]: unknown;
}

/**
 * Journal profile
 */
interface Profile {
  id?: string;
  name: string;
  url?: string | null;
  custom?: boolean;
  requirements?: ProfileRequirements;
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

// Plugin directories
const USER_PLUGINS_DIR = path.join(os.homedir(), '.rev', 'profiles');
const PROJECT_PLUGINS_DIR = path.join(process.cwd(), '.rev', 'profiles');

/**
 * Load all custom journal profiles
 */
export function loadCustomProfiles(): Record<string, NormalizedProfile> {
  const profiles: Record<string, NormalizedProfile> = {};

  // Load user profiles first (lower priority)
  const userProfiles = loadProfilesFromDir(USER_PLUGINS_DIR);
  Object.assign(profiles, userProfiles);

  // Load project profiles (higher priority, can override)
  const projectProfiles = loadProfilesFromDir(PROJECT_PLUGINS_DIR);
  Object.assign(profiles, projectProfiles);

  return profiles;
}

/**
 * Load profiles from a directory
 */
function loadProfilesFromDir(dir: string): Record<string, NormalizedProfile> {
  const profiles: Record<string, NormalizedProfile> = {};

  if (!fs.existsSync(dir)) {
    return profiles;
  }

  try {
    const files = fs.readdirSync(dir).filter(f =>
      f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')
    );

    for (const file of files) {
      try {
        const filePath = path.join(dir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const profile = file.endsWith('.json')
          ? JSON.parse(content)
          : yaml.parse(content);

        if (validateProfile(profile)) {
          const id = profile.id || path.basename(file, path.extname(file));
          profiles[id] = normalizeProfile(profile);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Warning: Failed to load profile ${file}: ${message}`);
      }
    }
  } catch {
    // Directory not readable
  }

  return profiles;
}

/**
 * Validate a profile structure
 */
function validateProfile(profile: unknown): profile is Profile {
  if (!profile || typeof profile !== 'object') {
    return false;
  }

  const p = profile as Profile;

  // Must have a name
  if (!p.name || typeof p.name !== 'string') {
    return false;
  }

  // Requirements must be an object if present
  if (p.requirements && typeof p.requirements !== 'object') {
    return false;
  }

  return true;
}

/**
 * Normalize profile to standard structure
 */
function normalizeProfile(profile: Profile): NormalizedProfile {
  return {
    name: profile.name,
    url: profile.url || null,
    custom: true,
    requirements: {
      wordLimit: profile.requirements?.wordLimit || (profile as { wordLimit?: Record<string, number> }).wordLimit || {},
      references: profile.requirements?.references || (profile as { references?: Record<string, unknown> }).references || {},
      figures: profile.requirements?.figures || (profile as { figures?: Record<string, unknown> }).figures || {},
      sections: profile.requirements?.sections || (profile as { sections?: Record<string, unknown> }).sections || {},
      authors: profile.requirements?.authors || (profile as { authors?: Record<string, unknown> }).authors || {},
      keywords: profile.requirements?.keywords || (profile as { keywords?: { min?: number; max?: number } }).keywords || null,
      dataAvailability: profile.requirements?.dataAvailability || (profile as { dataAvailability?: boolean }).dataAvailability || false,
      ...profile.requirements,
    },
  };
}

/**
 * Initialize plugin directories
 */
export function initPluginDir(project = false): string {
  const dir = project ? PROJECT_PLUGINS_DIR : USER_PLUGINS_DIR;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

/**
 * Get plugin directories info
 */
export function getPluginDirs(): PluginDirsInfo {
  return {
    user: USER_PLUGINS_DIR,
    project: PROJECT_PLUGINS_DIR,
    userExists: fs.existsSync(USER_PLUGINS_DIR),
    projectExists: fs.existsSync(PROJECT_PLUGINS_DIR),
  };
}

/**
 * Create a sample profile template
 */
export function createProfileTemplate(journalName: string): string {
  const id = journalName.toLowerCase().replace(/\s+/g, '-');

  return `# Custom journal profile for ${journalName}
# Save as: ~/.rev/profiles/${id}.yaml (user-wide)
# Or: .rev/profiles/${id}.yaml (project-specific)

id: ${id}
name: "${journalName}"
url: "https://journal-website.com/author-guidelines"

# Word count limits
wordLimit:
  main: 8000      # null for no limit
  abstract: 300
  title: null     # characters

# Reference requirements
references:
  max: null       # null for no limit
  doiRequired: true

# Figure/table limits
figures:
  max: 8
  combinedWithTables: false

# Required sections
sections:
  required:
    - Abstract
    - Introduction
    - Methods
    - Results
    - Discussion
  methodsPosition: null  # 'end' or 'before-results'

# Keywords
keywords:
  min: 4
  max: 8

# Other requirements
dataAvailability: true
highlights: false
graphicalAbstract: false
`;
}

/**
 * Save a profile template
 */
export function saveProfileTemplate(journalName: string, project = false): string {
  const dir = initPluginDir(project);
  const id = journalName.toLowerCase().replace(/\s+/g, '-');
  const filePath = path.join(dir, `${id}.yaml`);

  if (fs.existsSync(filePath)) {
    throw new Error(`Profile already exists: ${filePath}`);
  }

  const content = createProfileTemplate(journalName);
  fs.writeFileSync(filePath, content, 'utf-8');

  return filePath;
}

/**
 * List all custom profiles
 */
export function listCustomProfiles(): ProfileListEntry[] {
  const result: ProfileListEntry[] = [];

  // User profiles
  if (fs.existsSync(USER_PLUGINS_DIR)) {
    const files = fs.readdirSync(USER_PLUGINS_DIR).filter(f =>
      f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')
    );

    for (const file of files) {
      try {
        const filePath = path.join(USER_PLUGINS_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const profile = file.endsWith('.json') ? JSON.parse(content) : yaml.parse(content);

        if (validateProfile(profile)) {
          result.push({
            id: profile.id || path.basename(file, path.extname(file)),
            name: profile.name,
            source: 'user',
            path: filePath,
          });
        }
      } catch {
        // Skip invalid profiles
      }
    }
  }

  // Project profiles
  if (fs.existsSync(PROJECT_PLUGINS_DIR)) {
    const files = fs.readdirSync(PROJECT_PLUGINS_DIR).filter(f =>
      f.endsWith('.yaml') || f.endsWith('.yml') || f.endsWith('.json')
    );

    for (const file of files) {
      try {
        const filePath = path.join(PROJECT_PLUGINS_DIR, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const profile = file.endsWith('.json') ? JSON.parse(content) : yaml.parse(content);

        if (validateProfile(profile)) {
          result.push({
            id: profile.id || path.basename(file, path.extname(file)),
            name: profile.name,
            source: 'project',
            path: filePath,
          });
        }
      } catch {
        // Skip invalid profiles
      }
    }
  }

  return result;
}
