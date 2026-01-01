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

// Plugin directories
const USER_PLUGINS_DIR = path.join(os.homedir(), '.rev', 'profiles');
const PROJECT_PLUGINS_DIR = path.join(process.cwd(), '.rev', 'profiles');

/**
 * Load all custom journal profiles
 * @returns {Object<string, Object>}
 */
export function loadCustomProfiles() {
  const profiles = {};

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
 * @param {string} dir
 * @returns {Object<string, Object>}
 */
function loadProfilesFromDir(dir) {
  const profiles = {};

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
      } catch (err) {
        console.error(`Warning: Failed to load profile ${file}: ${err.message}`);
      }
    }
  } catch {
    // Directory not readable
  }

  return profiles;
}

/**
 * Validate a profile structure
 * @param {Object} profile
 * @returns {boolean}
 */
function validateProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    return false;
  }

  // Must have a name
  if (!profile.name || typeof profile.name !== 'string') {
    return false;
  }

  // Requirements must be an object if present
  if (profile.requirements && typeof profile.requirements !== 'object') {
    return false;
  }

  return true;
}

/**
 * Normalize profile to standard structure
 * @param {Object} profile
 * @returns {Object}
 */
function normalizeProfile(profile) {
  return {
    name: profile.name,
    url: profile.url || null,
    custom: true,
    requirements: {
      wordLimit: profile.requirements?.wordLimit || profile.wordLimit || {},
      references: profile.requirements?.references || profile.references || {},
      figures: profile.requirements?.figures || profile.figures || {},
      sections: profile.requirements?.sections || profile.sections || {},
      authors: profile.requirements?.authors || profile.authors || {},
      keywords: profile.requirements?.keywords || profile.keywords || null,
      dataAvailability: profile.requirements?.dataAvailability || profile.dataAvailability || false,
      ...profile.requirements,
    },
  };
}

/**
 * Initialize plugin directories
 * @param {boolean} project - Create project directory instead of user
 * @returns {string} Created directory path
 */
export function initPluginDir(project = false) {
  const dir = project ? PROJECT_PLUGINS_DIR : USER_PLUGINS_DIR;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

/**
 * Get plugin directories info
 * @returns {{user: string, project: string, userExists: boolean, projectExists: boolean}}
 */
export function getPluginDirs() {
  return {
    user: USER_PLUGINS_DIR,
    project: PROJECT_PLUGINS_DIR,
    userExists: fs.existsSync(USER_PLUGINS_DIR),
    projectExists: fs.existsSync(PROJECT_PLUGINS_DIR),
  };
}

/**
 * Create a sample profile template
 * @param {string} journalName
 * @returns {string} YAML content
 */
export function createProfileTemplate(journalName) {
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
 * @param {string} journalName
 * @param {boolean} project - Save to project directory
 * @returns {string} Saved file path
 */
export function saveProfileTemplate(journalName, project = false) {
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
 * @returns {Array<{id: string, name: string, source: string, path: string}>}
 */
export function listCustomProfiles() {
  const result = [];

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
