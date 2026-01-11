#!/usr/bin/env node

/**
 * rev - Revision workflow for Word ↔ Markdown round-trips
 *
 * Handles track changes and comments when collaborating on academic papers.
 * Preserves reviewer feedback through the Markdown editing workflow.
 */

import { program } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';

// Import refactored command modules
import {
  registerAllCommands,
  setQuietMode,
  setJsonMode,
} from '../lib/commands/index.js';

// Global flags
let quietMode = false;
let jsonMode = false;

// Levenshtein distance for command suggestions
function levenshtein(a, b) {
  const matrix = Array(b.length + 1).fill(null).map(() => Array(a.length + 1).fill(null));
  for (let i = 0; i <= a.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= b.length; j++) matrix[j][0] = j;
  for (let j = 1; j <= b.length; j++) {
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,
        matrix[j - 1][i] + 1,
        matrix[j - 1][i - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}

// Find similar commands for typo suggestions
function suggestCommand(input, commands) {
  const suggestions = commands
    .map(cmd => ({ cmd, dist: levenshtein(input.toLowerCase(), cmd.toLowerCase()) }))
    .filter(({ dist }) => dist <= 3)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3)
    .map(({ cmd }) => cmd);
  return suggestions;
}

// Read version from package.json
const pkgPath = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

program
  .name('rev')
  .description('Revision workflow for Word ↔ Markdown round-trips')
  .version(`${pkg.version}\nNode ${process.version} | ${process.platform} ${process.arch}`, '-V, --version', 'Output version information')
  .configureOutput({
    outputError: (str, write) => write(chalk.red(str)),
  })
  .showHelpAfterError(chalk.dim('(use --help for usage information)'))
  .option('--no-color', 'Disable colored output')
  .option('-q, --quiet', 'Suppress non-essential output')
  .option('--json', 'Output in JSON format (for scripting)')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.color === false) {
      chalk.level = 0;
    }
    if (opts.quiet) {
      quietMode = true;
      setQuietMode(true);
    }
    if (opts.json) {
      jsonMode = true;
      setJsonMode(true);
      chalk.level = 0; // Disable colors in JSON mode
    }
  });

// Register all command modules
// Commands organized by module:
//   core.js: review, strip, status
//   comments.js: comments, resolve, next, prev, first, last, todo, accept, reject, reply
//   init.js: init, new, config
//   sections.js: import, extract, split, sync, merge
//   build.js: refs, migrate, install, doctor, build
//   response.js: response, validate, profiles, anonymize
//   citations.js: citations, figures, equations, pdf-comments
//   doi.js: doi, orcid
//   history.js: diff, history, contributors
//   utilities.js: help, completions, word-count, stats, search, backup, archive,
//                 export, preview, watch, lint, grammar, annotate, apply, comment,
//                 clean, check, open, spelling, upgrade, batch, install-cli-skill
registerAllCommands(program, pkg);

// Get all command names for typo suggestions
const allCommands = program.commands.map(cmd => cmd.name());
const allAliases = program.commands.flatMap(cmd => cmd.aliases());
const allCommandNames = [...allCommands, ...allAliases];

// Handle unknown commands with suggestions
program.on('command:*', (operands) => {
  const unknown = operands[0];
  console.error(chalk.red(`Unknown command: ${unknown}`));

  const suggestions = suggestCommand(unknown, allCommandNames);
  if (suggestions.length > 0) {
    console.error();
    console.error(chalk.yellow('Did you mean?'));
    for (const s of suggestions) {
      console.error(chalk.cyan(`  rev ${s}`));
    }
  }
  console.error();
  console.error(chalk.dim('Run "rev help" for available commands.'));
  process.exit(1);
});

// Default to status when no command given
const args = process.argv.slice(2);
const globalOpts = ['--no-color', '-q', '--quiet', '--json', '-V', '--version', '-h', '--help'];
const hasOnlyGlobalOpts = args.every(arg => globalOpts.includes(arg) || arg.startsWith('--no-') || arg.startsWith('-'));
const hasCommand = args.some(arg => !arg.startsWith('-') && !globalOpts.includes(arg));

if (args.length === 0 || (hasOnlyGlobalOpts && !hasCommand && !args.includes('-h') && !args.includes('--help') && !args.includes('-V') && !args.includes('--version'))) {
  // Insert 'status' after any global options
  const insertPos = process.argv.findIndex((arg, i) => i >= 2 && !arg.startsWith('-'));
  if (insertPos === -1) {
    process.argv.push('status');
  }
}

program.parse();
