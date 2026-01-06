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

export function setQuietMode(value) {
  quietMode = value;
}

export function setJsonMode(value) {
  jsonMode = value;
  if (value) {
    chalk.level = 0;
  }
}

// JSON output helper
export function jsonOutput(data) {
  console.log(JSON.stringify(data, null, 2));
}

// Find files by extension
export function findFiles(ext, cwd = process.cwd()) {
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
