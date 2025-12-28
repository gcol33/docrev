/**
 * User configuration management
 * Stores user preferences in ~/.revrc
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_PATH = path.join(os.homedir(), '.revrc');

/**
 * Load user config
 * @returns {object}
 */
export function loadUserConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
  } catch {
    // Ignore parse errors
  }
  return {};
}

/**
 * Save user config
 * @param {object} config
 */
export function saveUserConfig(config) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get user name
 * @returns {string|null}
 */
export function getUserName() {
  const config = loadUserConfig();
  return config.userName || null;
}

/**
 * Set user name
 * @param {string} name
 */
export function setUserName(name) {
  const config = loadUserConfig();
  config.userName = name;
  saveUserConfig(config);
}

/**
 * Get config file path
 * @returns {string}
 */
export function getConfigPath() {
  return CONFIG_PATH;
}
