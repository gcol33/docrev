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
 * @returns User configuration object
 */
export function loadUserConfig() {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
            return JSON.parse(content);
        }
    }
    catch (e) {
        if (process.env.DEBUG) {
            const error = e;
            console.warn('config: Failed to parse ~/.revrc:', error.message);
        }
    }
    return {};
}
/**
 * Save user config
 * @param config - User configuration to save
 */
export function saveUserConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}
/**
 * Get user name
 * @returns User name or null if not set
 */
export function getUserName() {
    const config = loadUserConfig();
    return config.userName || null;
}
/**
 * Set user name
 * @param name - User name to set
 */
export function setUserName(name) {
    const config = loadUserConfig();
    config.userName = name;
    saveUserConfig(config);
}
/**
 * Get config file path
 * @returns Absolute path to config file
 */
export function getConfigPath() {
    return CONFIG_PATH;
}
/**
 * Get default sections for new projects
 * @returns Array of section names or null if not set
 */
export function getDefaultSections() {
    const config = loadUserConfig();
    return config.defaultSections || null;
}
/**
 * Set default sections for new projects
 * @param sections - Array of section names (without .md extension)
 */
export function setDefaultSections(sections) {
    const config = loadUserConfig();
    config.defaultSections = sections;
    saveUserConfig(config);
}
//# sourceMappingURL=config.js.map