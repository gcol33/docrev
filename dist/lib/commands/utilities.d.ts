/**
 * Utility commands: help, completions, open, upgrade, install-cli-skill, uninstall-cli-skill
 *
 * Core utility commands that don't fit into a specific domain.
 */
import type { Command } from 'commander';
interface PackageJson {
    version?: string;
    name?: string;
    [key: string]: unknown;
}
/**
 * Register utility commands with the program
 */
export declare function register(program: Command, pkg?: PackageJson): void;
export {};
//# sourceMappingURL=utilities.d.ts.map