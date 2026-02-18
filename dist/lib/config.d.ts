/**
 * User configuration management
 * Stores user preferences in ~/.revrc
 */
import type { UserConfig } from './types.js';
/**
 * Load user config
 * @returns User configuration object
 */
export declare function loadUserConfig(): UserConfig;
/**
 * Save user config
 * @param config - User configuration to save
 */
export declare function saveUserConfig(config: UserConfig): void;
/**
 * Get user name
 * @returns User name or null if not set
 */
export declare function getUserName(): string | null;
/**
 * Set user name
 * @param name - User name to set
 */
export declare function setUserName(name: string): void;
/**
 * Get config file path
 * @returns Absolute path to config file
 */
export declare function getConfigPath(): string;
/**
 * Get default sections for new projects
 * @returns Array of section names or null if not set
 */
export declare function getDefaultSections(): string[] | null;
/**
 * Set default sections for new projects
 * @param sections - Array of section names (without .md extension)
 */
export declare function setDefaultSections(sections: string[]): void;
//# sourceMappingURL=config.d.ts.map