/**
 * User configuration management
 * Stores user preferences in ~/.revrc
 */

import type { UserConfig } from './types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const CONFIG_PATH = path.join(os.homedir(), '.revrc');

/**
 * Load user config
 * @returns User configuration object
 */
export function loadUserConfig(): UserConfig {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
      return JSON.parse(content) as UserConfig;
    }
  } catch (e) {
    if (process.env.DEBUG) {
      const error = e as Error;
      console.warn('config: Failed to parse ~/.revrc:', error.message);
    }
  }
  return {};
}

/**
 * Save user config
 * @param config - User configuration to save
 */
export function saveUserConfig(config: UserConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Get user name
 * @returns User name or null if not set
 */
export function getUserName(): string | null {
  const config = loadUserConfig();
  return config.userName || null;
}

/**
 * Set user name
 * @param name - User name to set
 */
export function setUserName(name: string): void {
  const config = loadUserConfig();
  config.userName = name;
  saveUserConfig(config);
}

/**
 * Get config file path
 * @returns Absolute path to config file
 */
export function getConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Get default sections for new projects
 * @returns Array of section names or null if not set
 */
export function getDefaultSections(): string[] | null {
  const config = loadUserConfig();
  return config.defaultSections || null;
}

/**
 * Set default sections for new projects
 * @param sections - Array of section names (without .md extension)
 */
export function setDefaultSections(sections: string[]): void {
  const config = loadUserConfig();
  config.defaultSections = sections;
  saveUserConfig(config);
}
