/**
 * Command module index
 *
 * Exports registration functions for all command modules.
 * Each module's register() function adds commands to the Commander program.
 */
import type { Command } from 'commander';
import { register as registerCoreCommands } from './core.js';
import { register as registerCommentCommands } from './comments.js';
import { register as registerInitCommands } from './init.js';
import { register as registerSectionCommands } from './sections.js';
import { register as registerBuildCommands } from './build.js';
import { register as registerResponseCommands } from './response.js';
import { register as registerCitationCommands } from './citations.js';
import { register as registerDoiCommands } from './doi.js';
import { register as registerHistoryCommands } from './history.js';
import { register as registerUtilityCommands } from './utilities.js';
export { registerCoreCommands, registerCommentCommands, registerInitCommands, registerSectionCommands, registerBuildCommands, registerResponseCommands, registerCitationCommands, registerDoiCommands, registerHistoryCommands, registerUtilityCommands, };
export { setQuietMode, setJsonMode, quietMode, jsonMode, } from './context.js';
interface PackageJson {
    version?: string;
    [key: string]: unknown;
}
/**
 * Register all command modules with the program.
 */
export declare function registerAllCommands(program: Command, pkg?: PackageJson): void;
//# sourceMappingURL=index.d.ts.map