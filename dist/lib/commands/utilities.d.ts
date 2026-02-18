/**
 * Utility commands: help, completions, word-count, stats, search, backup, archive,
 * export, preview, watch, lint, grammar, annotate, apply, comment, clean, check,
 * open, spelling, upgrade, batch, install-cli-skill, uninstall-cli-skill
 *
 * Miscellaneous utility commands for project management.
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