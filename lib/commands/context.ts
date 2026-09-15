/**
 * Shared context for command modules
 *
 * This module provides shared utilities and state that command modules need.
 */

import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as fmt from '../format.js';

// Global flags (set by main CLI)
export let quietMode = false;
export let jsonMode = false;

export function setQuietMode(value: boolean): void {
  quietMode = value;
}

export function setJsonMode(value: boolean): void {
  jsonMode = value;
  if (value) {
    chalk.level = 0;
  }
}

// JSON output helper
export function jsonOutput(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

// Find files by extension
export function findFiles(ext: string, cwd: string = process.cwd()): string[] {
  try {
    return fs.readdirSync(cwd)
      .filter(f => f.endsWith(ext) && !f.startsWith('.'));
  } catch {
    return [];
  }
}

// Re-export common dependencies
export { chalk, fs, path, fmt };

// Re-export from lib modules
export {
  parseAnnotations,
  stripAnnotations,
  countAnnotations,
  getComments,
  setCommentStatus,
  hasAnnotations,
  getTrackChanges,
  applyDecision,
  cleanupOrphanedMarkers,
} from '../annotations.js';

export {
  interactiveReview,
  listComments,
  interactiveCommentReview,
} from '../review.js';

export {
  generateConfig,
  loadConfig,
  saveConfig,
  deriveSectionsFromRev,
  resolveSectionsConfig,
  matchHeading,
  extractSectionsFromText,
  splitAnnotatedPaper,
  getOrderedSections,
} from '../sections.js';

export {
  buildRegistry,
  detectHardcodedRefs,
  convertHardcodedRefs,
  getRefStatus,
  formatRegistry,
} from '../crossref.js';

export {
  build,
  loadConfig as loadBuildConfig,
  findSections,
  formatBuildResults,
} from '../build.js';

export {
  hasPandoc,
  hasPandocCrossref,
  hasLatex,
  checkDependencies,
  getInstallInstructions,
} from '../dependencies.js';

export {
  getTemplate,
  listTemplates,
  generateCustomTemplate,
} from '../templates.js';

export {
  getUserName,
  setUserName,
  getConfigPath,
  getDefaultSections,
  setDefaultSections,
  loadUserConfig,
  saveUserConfig,
} from '../config.js';

export { inlineDiffPreview } from '../format.js';

export { countWords } from '../utils.js';

export {
  parseCommentsWithReplies,
  collectComments,
  generateResponseLetter,
  groupByReviewer,
} from '../response.js';

export {
  validateCitations,
  getCitationStats,
} from '../citations.js';

export {
  extractEquations,
  getEquationStats,
  createEquationsDoc,
  extractEquationsFromWord,
  getWordEquationStats,
} from '../equations.js';

export {
  parseBibEntries,
  checkBibDois,
  fetchBibtex,
  addToBib,
  isValidDoiFormat,
  lookupDoi,
  lookupMissingDois,
} from '../doi.js';

export {
  clearDoiCache,
  getDoiCacheStats,
} from '../doi-cache.js';

export {
  formatError,
  getFileNotFoundSuggestions,
  getDependencySuggestions,
  getAnnotationSuggestions,
  getBuildSuggestions,
  exitWithError,
  requireFile,
} from '../errors.js';

export {
  isWordDocument,
  readAnnotatedInput,
  assertEditableMarkdown,
  InputError,
} from '../input.js';

import { readAnnotatedInput, assertEditableMarkdown, InputError } from '../input.js';
import { exitWithError, requireFile } from '../errors.js';

/**
 * Command front door: verify the file exists, then read it as annotated
 * Markdown (converting a `.docx` on the way). On a bad input, print a friendly
 * error and exit — matching how the rest of the CLI reports failures.
 */
export async function loadAnnotated(file: string, fileType = 'Markdown file'): Promise<string> {
  requireFile(file, fileType);
  try {
    return await readAnnotatedInput(file);
  } catch (err) {
    if (err instanceof InputError) exitWithError(err.message, err.suggestions);
    throw err;
  }
}

/**
 * Command front door for editing commands: verify existence and refuse a Word
 * document (which cannot be edited in place), printing guidance and exiting.
 */
export function requireEditableMarkdown(file: string, fileType = 'Markdown file'): void {
  requireFile(file, fileType);
  try {
    assertEditableMarkdown(file);
  } catch (err) {
    if (err instanceof InputError) exitWithError(err.message, err.suggestions);
    throw err;
  }
}

export {
  listJournals,
  getJournalProfile,
  validateManuscript,
  validateProject,
} from '../journals.js';

export {
  listCustomProfiles,
  saveProfileTemplate,
  getPluginDirs,
} from '../plugins.js';

export { tuiCommentReview } from '../tui.js';
