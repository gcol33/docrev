/**
 * Command module index
 *
 * Exports registration functions for all command modules.
 * Each module's register() function adds commands to the Commander program.
 */

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

export {
  registerCoreCommands,
  registerCommentCommands,
  registerInitCommands,
  registerSectionCommands,
  registerBuildCommands,
  registerResponseCommands,
  registerCitationCommands,
  registerDoiCommands,
  registerHistoryCommands,
  registerUtilityCommands,
};

// Re-export context utilities for use by the main CLI
export {
  setQuietMode,
  setJsonMode,
  quietMode,
  jsonMode,
} from './context.js';

/**
 * Register all command modules with the program.
 * @param {import('commander').Command} program
 * @param {object} [pkg] - Package.json object for version info (optional)
 */
export function registerAllCommands(program, pkg) {
  registerCoreCommands(program);
  registerCommentCommands(program);
  registerInitCommands(program);
  registerSectionCommands(program);
  registerBuildCommands(program, pkg);
  registerResponseCommands(program);
  registerCitationCommands(program);
  registerDoiCommands(program);
  registerHistoryCommands(program);
  registerUtilityCommands(program, pkg);
}
