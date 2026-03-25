/**
 * Utility commands: help, completions, open, upgrade, install-cli-skill, uninstall-cli-skill
 *
 * Core utility commands that don't fit into a specific domain.
 */

import type { Command } from 'commander';
import {
  chalk,
  fs,
  path,
  fmt,
} from './context.js';

// Type definitions for package.json
interface PackageJson {
  version?: string;
  name?: string;
  [key: string]: unknown;
}

interface OpenOptions {
  // No options currently
}

interface UpgradeOptions {
  check?: boolean;
}

/**
 * Register utility commands with the program
 */
export function register(program: Command, pkg?: PackageJson): void {
  // ==========================================================================
  // HELP command - Comprehensive help
  // ==========================================================================

  program
    .command('help')
    .description('Show detailed help and workflow guide')
    .argument('[topic]', 'Help topic: workflow, syntax, commands')
    .action((topic?: string) => {
      if (!topic || topic === 'all') {
        showFullHelp(pkg);
      } else if (topic === 'workflow') {
        showWorkflowHelp();
      } else if (topic === 'syntax') {
        showSyntaxHelp();
      } else if (topic === 'commands') {
        showCommandsHelp();
      } else {
        console.log(chalk.yellow(`Unknown topic: ${topic}`));
        console.log(chalk.dim('Available topics: workflow, syntax, commands'));
      }
    });

  // ==========================================================================
  // COMPLETIONS command - Shell completions
  // ==========================================================================

  program
    .command('completions')
    .description('Output shell completions')
    .argument('<shell>', 'Shell type: bash, zsh, powershell')
    .action((shell: string) => {
      const completionsDir = path.join(import.meta.dirname, '..', '..', 'completions');

      if (shell === 'bash') {
        const bashFile = path.join(completionsDir, 'rev.bash');
        if (fs.existsSync(bashFile)) {
          console.log(fs.readFileSync(bashFile, 'utf-8'));
        } else {
          console.error(chalk.red('Bash completions not found'));
          process.exit(1);
        }
      } else if (shell === 'zsh') {
        const zshFile = path.join(completionsDir, 'rev.zsh');
        if (fs.existsSync(zshFile)) {
          console.log(fs.readFileSync(zshFile, 'utf-8'));
        } else {
          console.error(chalk.red('Zsh completions not found'));
          process.exit(1);
        }
      } else if (shell === 'powershell' || shell === 'pwsh') {
        const psFile = path.join(completionsDir, 'rev.ps1');
        if (fs.existsSync(psFile)) {
          console.log(fs.readFileSync(psFile, 'utf-8'));
        } else {
          console.error(chalk.red('PowerShell completions not found'));
          process.exit(1);
        }
      } else {
        console.error(chalk.red(`Unknown shell: ${shell}`));
        console.log(chalk.dim('Supported shells: bash, zsh, powershell'));
        process.exit(1);
      }
    });

  // ==========================================================================
  // OPEN command - Open project folder or file
  // ==========================================================================

  program
    .command('open')
    .description('Open project folder or file in default app')
    .argument('[file]', 'File to open (default: project folder)')
    .action(async (file?: string, _options?: OpenOptions) => {
      const { exec } = await import('child_process');
      const target = file || '.';

      if (!fs.existsSync(target)) {
        console.error(chalk.red(`File not found: ${target}`));
        process.exit(1);
      }

      const platform = process.platform;
      let command: string;

      if (platform === 'darwin') {
        command = `open "${target}"`;
      } else if (platform === 'win32') {
        command = `start "" "${target}"`;
      } else {
        command = `xdg-open "${target}"`;
      }

      exec(command, (err) => {
        if (err) {
          console.error(chalk.red(`Failed to open: ${err.message}`));
          process.exit(1);
        }
        console.log(fmt.status('success', `Opened ${target}`));
      });
    });

  // ==========================================================================
  // INSTALL-CLI-SKILL command - Install Claude Code skill
  // ==========================================================================

  program
    .command('install-cli-skill')
    .description('Install docrev skill for Claude Code')
    .action(() => {
      const homedir = process.env.HOME || process.env.USERPROFILE;
      if (!homedir) {
        console.error(chalk.red('Could not determine home directory'));
        process.exit(1);
      }
      const skillDir = path.join(homedir, '.claude', 'skills', 'docrev');
      const sourceDir = path.join(import.meta.dirname, '..', '..', 'skill');

      // Check if source skill files exist
      const skillFile = path.join(sourceDir, 'SKILL.md');
      if (!fs.existsSync(skillFile)) {
        console.error(chalk.red('Skill files not found in package'));
        process.exit(1);
      }

      // Create skill directory
      fs.mkdirSync(skillDir, { recursive: true });

      // Copy skill files
      const files = ['SKILL.md', 'REFERENCE.md'];
      for (const file of files) {
        const src = path.join(sourceDir, file);
        const dest = path.join(skillDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dest);
        }
      }

      console.log(fmt.status('success', 'Installed docrev skill for Claude Code'));
      console.log(chalk.dim(`  Location: ${skillDir}`));
      console.log(chalk.dim('  Restart Claude Code to activate'));
    });

  program
    .command('uninstall-cli-skill')
    .description('Remove docrev skill from Claude Code')
    .action(() => {
      const homedir = process.env.HOME || process.env.USERPROFILE;
      if (!homedir) {
        console.error(chalk.red('Could not determine home directory'));
        process.exit(1);
      }
      const skillDir = path.join(homedir, '.claude', 'skills', 'docrev');

      if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true });
        console.log(fmt.status('success', 'Removed docrev skill from Claude Code'));
      } else {
        console.log(chalk.yellow('Skill not installed'));
      }
    });

  // ==========================================================================
  // UPGRADE command - Self-update via npm
  // ==========================================================================

  program
    .command('upgrade')
    .description('Check for updates and upgrade docrev')
    .option('--check', 'Only check for updates, do not install')
    .action(async (options: UpgradeOptions) => {
      const { execSync, spawn } = await import('child_process');

      console.log(chalk.cyan('Checking for updates...'));

      try {
        // Get current version
        const currentVersion = pkg?.version || 'unknown';

        // Get latest version from npm
        let latestVersion: string;
        try {
          latestVersion = execSync('npm view docrev version', { encoding: 'utf-8' }).trim();
        } catch {
          console.error(chalk.red('Failed to check npm registry'));
          console.error(chalk.dim('Check your internet connection'));
          process.exit(1);
        }

        if (currentVersion === latestVersion) {
          console.log(fmt.status('success', `Already on latest version (${currentVersion})`));
          return;
        }

        console.log(`  Current: ${chalk.yellow(currentVersion)}`);
        console.log(`  Latest:  ${chalk.green(latestVersion)}`);
        console.log();

        if (options.check) {
          console.log(chalk.cyan('Run "rev upgrade" to install the update'));
          return;
        }

        console.log(chalk.cyan('Upgrading...'));

        // Run npm update
        const child = spawn('npm', ['install', '-g', 'docrev@latest'], {
          stdio: 'inherit',
          shell: true,
        });

        child.on('close', (code) => {
          if (code === 0) {
            console.log();
            console.log(fmt.status('success', `Upgraded to ${latestVersion}`));
          } else {
            console.error(chalk.red('Upgrade failed'));
            console.error(chalk.dim('Try running: npm install -g docrev@latest'));
            process.exit(1);
          }
        });

        child.on('error', (err) => {
          console.error(chalk.red(`Upgrade failed: ${err.message}`));
          console.error(chalk.dim('Try running: npm install -g docrev@latest'));
          process.exit(1);
        });
      } catch (err) {
        console.error(chalk.red(`Error: ${(err as Error).message}`));
        process.exit(1);
      }
    });
}

// Helper functions for help text

function showFullHelp(pkg?: PackageJson): void {
  console.log(`
${chalk.bold.cyan('rev')} ${chalk.dim(`v${pkg?.version || 'unknown'}`)} - Revision workflow for Word ↔ Markdown round-trips

${chalk.bold('DESCRIPTION')}
  Handle reviewer feedback when collaborating on academic papers.
  Import changes from Word, review them interactively, and preserve
  comments for discussion with Claude.

${chalk.bold('GLOBAL OPTIONS')}

  ${chalk.bold('--no-color')}               Disable colored output
  ${chalk.bold('-q, --quiet')}              Suppress non-essential output
  ${chalk.bold('--json')}                   Output in JSON format (for scripting)

${chalk.bold('TYPICAL WORKFLOW')}

  ${chalk.dim('1.')} Build and send: ${chalk.green('rev build docx')} ${chalk.dim('(or rev b docx)')}
  ${chalk.dim('2.')} Reviewers return ${chalk.yellow('reviewed.docx')} with edits and comments
  ${chalk.dim('3.')} Sync their feedback: ${chalk.green('rev sync reviewed.docx')}
  ${chalk.dim('4.')} Work through comments: ${chalk.green('rev next')} ${chalk.dim('(n)')} / ${chalk.green('rev todo')} ${chalk.dim('(t)')}
  ${chalk.dim('5.')} Accept/reject changes: ${chalk.green('rev accept -a')} ${chalk.dim('(a)')} or ${chalk.green('rev review')}
  ${chalk.dim('6.')} Rebuild: ${chalk.green('rev build docx')}
  ${chalk.dim('7.')} Archive old files: ${chalk.green('rev archive')}

${chalk.bold('MORE HELP')}

  rev help workflow    Detailed workflow guide
  rev help syntax      Annotation syntax reference
  rev help commands    All commands with options
`);
}

function showWorkflowHelp(): void {
  console.log(`
${chalk.bold.cyan('rev')} ${chalk.dim('- Workflow Guide')}

${chalk.bold('OVERVIEW')}

  The rev workflow solves a common problem: you write in Markdown,
  but collaborators review in Word. When they return edited documents,
  you need to merge their changes back into your source files.

${chalk.bold('STEP 1: BUILD & SEND')}

  ${chalk.green('rev build docx')}
  ${chalk.dim('# Send the .docx to reviewers')}

${chalk.bold('STEP 2: RECEIVE FEEDBACK')}

  Reviewers edit the document, adding:
  ${chalk.dim('•')} Track changes (insertions, deletions)
  ${chalk.dim('•')} Comments (questions, suggestions)

${chalk.bold('STEP 3: SYNC CHANGES')}

  ${chalk.green('rev sync reviewed.docx')}
  ${chalk.dim('# Or just: rev sync (auto-detects most recent .docx)')}

  Your markdown files now contain their feedback as annotations.

${chalk.bold('STEP 4: WORK THROUGH COMMENTS')}

  ${chalk.green('rev todo')}              ${chalk.dim('# See all pending comments')}
  ${chalk.green('rev next')}              ${chalk.dim('# Show next pending comment')}
  ${chalk.green('rev reply file.md -n 1 -m "Done"')}
  ${chalk.green('rev resolve file.md -n 1')}

${chalk.bold('STEP 5: ACCEPT/REJECT CHANGES')}

  ${chalk.green('rev accept file.md -a')} ${chalk.dim('# Accept all changes')}
  ${chalk.green('rev reject file.md -n 2')} ${chalk.dim('# Reject specific change')}
  ${chalk.dim('# Or use interactive mode:')}
  ${chalk.green('rev review file.md')}

${chalk.bold('STEP 6: REBUILD')}

  ${chalk.green('rev build docx')}
  ${chalk.green('rev build docx --dual')} ${chalk.dim('# Clean + comments version')}

${chalk.bold('STEP 7: ARCHIVE & REPEAT')}

  ${chalk.green('rev archive')}           ${chalk.dim('# Move reviewer files to archive/')}
  ${chalk.dim('# Send new .docx, repeat cycle')}
`);
}

function showSyntaxHelp(): void {
  console.log(`
${chalk.bold.cyan('rev')} ${chalk.dim('- Annotation Syntax (CriticMarkup)')}

${chalk.bold('INSERTIONS')}

  Syntax:  ${chalk.green('{++inserted text++}')}
  Meaning: This text was added by the reviewer

  Example:
    We ${chalk.green('{++specifically++}')} focused on neophytes.
    → Reviewer added the word "specifically"

${chalk.bold('DELETIONS')}

  Syntax:  ${chalk.red('{--deleted text--}')}
  Meaning: This text was removed by the reviewer

  Example:
    We focused on ${chalk.red('{--recent--}')} neophytes.
    → Reviewer removed the word "recent"

${chalk.bold('SUBSTITUTIONS')}

  Syntax:  ${chalk.yellow('{~~old text~>new text~~}')}
  Meaning: Text was changed from old to new

  Example:
    The effect was ${chalk.yellow('{~~significant~>substantial~~}')}.
    → Reviewer changed "significant" to "substantial"

${chalk.bold('COMMENTS')}

  Syntax:  ${chalk.blue('{>>Author: comment text<<}')}
  Meaning: Reviewer left a comment at this location

  Example:
    The results were significant. ${chalk.blue('{>>Dr. Smith: Add p-value<<}')}
    → Dr. Smith commented asking for a p-value

  Comments are placed ${chalk.bold('after')} the text they reference.
`);
}

function showCommandsHelp(): void {
  console.log(`
${chalk.bold.cyan('rev')} ${chalk.dim('- Command Reference')}

${chalk.bold('rev import')} <docx> <original-md>

  Import changes from a Word document by comparing against your
  original Markdown source.

  ${chalk.bold('Arguments:')}
    docx          Word document from reviewer
    original-md   Your original Markdown file

  ${chalk.bold('Options:')}
    -o, --output <file>   Write to different file (default: overwrites original)
    -a, --author <name>   Author name for changes (default: "Reviewer")
    --dry-run             Preview changes without saving

${chalk.bold('rev review')} <file>

  Interactively review and accept/reject track changes.
  Comments are preserved; only track changes are processed.

  ${chalk.bold('Keys:')}
    a   Accept this change
    r   Reject this change
    s   Skip (decide later)
    A   Accept all remaining changes
    L   Reject all remaining changes
    q   Quit without saving

${chalk.bold('rev strip')} <file>

  Remove annotations, outputting clean Markdown.
  Track changes are applied (insertions kept, deletions removed).

  ${chalk.bold('Options:')}
    -o, --output <file>   Write to file (default: stdout)
    -c, --keep-comments   Keep comment annotations

${chalk.bold('rev help')} [topic]

  Show help. Optional topics:
    workflow    Step-by-step workflow guide
    syntax      Annotation syntax reference
    commands    This command reference
`);
}
