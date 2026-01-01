/**
 * Init commands: init, new, config
 *
 * Project initialization and configuration commands.
 */

import {
  chalk,
  fs,
  path,
  fmt,
  generateConfig,
  loadConfig,
  saveConfig,
  getTemplate,
  listTemplates,
  generateCustomTemplate,
  getUserName,
  setUserName,
  getConfigPath,
  getDefaultSections,
  setDefaultSections,
} from './context.js';

/**
 * Register init commands with the program
 * @param {import('commander').Command} program
 */
export function register(program) {
  // ==========================================================================
  // INIT command - Generate sections.yaml config
  // ==========================================================================

  program
    .command('init')
    .description('Generate sections.yaml from existing .md files')
    .option('-d, --dir <directory>', 'Directory to scan', '.')
    .option('-o, --output <file>', 'Output config file', 'sections.yaml')
    .option('--force', 'Overwrite existing config')
    .action((options) => {
      const dir = path.resolve(options.dir);

      if (!fs.existsSync(dir)) {
        console.error(chalk.red(`Directory not found: ${dir}`));
        process.exit(1);
      }

      const outputPath = path.resolve(options.dir, options.output);

      if (fs.existsSync(outputPath) && !options.force) {
        console.error(chalk.yellow(`Config already exists: ${outputPath}`));
        console.error(chalk.dim('Use --force to overwrite'));
        process.exit(1);
      }

      console.log(chalk.cyan(`Scanning ${dir} for .md files...`));

      const config = generateConfig(dir);
      const sectionCount = Object.keys(config.sections).length;

      if (sectionCount === 0) {
        console.error(chalk.yellow('No .md files found (excluding paper.md, README.md)'));
        process.exit(1);
      }

      saveConfig(outputPath, config);

      console.log(chalk.green(`\nCreated ${outputPath} with ${sectionCount} sections:\n`));

      for (const [file, section] of Object.entries(config.sections)) {
        console.log(`  ${chalk.bold(file)}`);
        console.log(chalk.dim(`    header: "${section.header}"`));
        if (section.aliases?.length > 0) {
          console.log(chalk.dim(`    aliases: ${JSON.stringify(section.aliases)}`));
        }
      }

      console.log(chalk.cyan('\nEdit this file to:'));
      console.log(chalk.dim('  • Add aliases for header variations'));
      console.log(chalk.dim('  • Adjust order if needed'));
      console.log(chalk.dim('  • Update headers if they change'));
    });

  // ==========================================================================
  // NEW command - Create new paper project
  // ==========================================================================

  program
    .command('new')
    .description('Create a new paper project from template')
    .argument('[name]', 'Project directory name')
    .option('-t, --template <name>', 'Template: paper, minimal, thesis, review', 'paper')
    .option('-s, --sections <sections>', 'Comma-separated section names (e.g., intro,methods,results)')
    .option('--list', 'List available templates')
    .action(async (name, options) => {
      if (options.list) {
        console.log(chalk.cyan('Available templates:\n'));
        for (const t of listTemplates()) {
          console.log(`  ${chalk.bold(t.id)} - ${t.description}`);
        }
        return;
      }

      if (!name) {
        console.error(chalk.red('Error: project name is required'));
        console.error(chalk.dim('Usage: rev new <name>'));
        process.exit(1);
      }

      const projectDir = path.resolve(name);

      if (fs.existsSync(projectDir)) {
        console.error(chalk.red(`Directory already exists: ${name}`));
        process.exit(1);
      }

      let template;
      let sections = null;

      // Determine sections: CLI option > user config > prompt
      if (options.sections) {
        // Parse CLI sections
        sections = options.sections.split(',').map((s) => s.trim().toLowerCase().replace(/\.md$/, ''));
      } else {
        // Check user config for default sections
        const defaultSections = getDefaultSections();
        if (defaultSections && defaultSections.length > 0) {
          sections = defaultSections;
        }
      }

      // If no sections from CLI or config, and not using a named template with --template, prompt
      // Only prompt if stdin is a TTY (interactive terminal)
      if (!sections && options.template === 'paper') {
        if (process.stdin.isTTY) {
          const rl = (await import('readline')).createInterface({
            input: process.stdin,
            output: process.stdout,
          });

          const ask = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));

          console.log(chalk.cyan('Enter your document sections (comma-separated):'));
          console.log(chalk.dim('  Example: introduction,methods,results,discussion'));
          console.log(chalk.dim('  Press Enter to use default: introduction,methods,results,discussion\n'));

          const answer = await ask(chalk.cyan('Sections: '));
          rl.close();

          if (answer.trim()) {
            sections = answer.split(',').map((s) => s.trim().toLowerCase().replace(/\.md$/, ''));
          } else {
            // Use default paper template sections
            sections = ['introduction', 'methods', 'results', 'discussion'];
          }
        } else {
          // Non-interactive: use default sections
          sections = ['introduction', 'methods', 'results', 'discussion'];
        }
      }

      // Generate template based on sections
      if (sections) {
        template = generateCustomTemplate(sections);
        console.log(chalk.cyan(`Creating project with sections: ${sections.join(', ')}\n`));
      } else {
        template = getTemplate(options.template);
        if (!template) {
          console.error(chalk.red(`Unknown template: ${options.template}`));
          console.error(chalk.dim('Use --list to see available templates.'));
          process.exit(1);
        }
        console.log(chalk.cyan(`Creating ${template.name} project in ${name}/...\n`));
      }

      // Create directory
      fs.mkdirSync(projectDir, { recursive: true });

      // Create subdirectories
      for (const subdir of template.directories || []) {
        fs.mkdirSync(path.join(projectDir, subdir), { recursive: true });
        console.log(chalk.dim(`  Created ${subdir}/`));
      }

      // Create files
      for (const [filename, content] of Object.entries(template.files)) {
        const filePath = path.join(projectDir, filename);
        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(chalk.dim(`  Created ${filename}`));
      }

      console.log(chalk.green(`\nProject created!`));
      console.log(chalk.cyan('\nNext steps:'));
      console.log(chalk.dim(`  cd ${name}`));
      console.log(chalk.dim('  # Edit rev.yaml with your paper details'));
      console.log(chalk.dim('  # Write your sections'));
      console.log(chalk.dim('  rev build          # Build PDF and DOCX'));
      console.log(chalk.dim('  rev build pdf      # Build PDF only'));
    });

  // ==========================================================================
  // CONFIG command - Set user preferences
  // ==========================================================================

  program
    .command('config')
    .description('Set user preferences')
    .argument('<key>', 'Config key: user, sections')
    .argument('[value]', 'Value to set')
    .action((key, value) => {
      if (key === 'user') {
        if (value) {
          setUserName(value);
          console.log(chalk.green(`User name set to: ${value}`));
          console.log(chalk.dim(`Saved to ${getConfigPath()}`));
        } else {
          const name = getUserName();
          if (name) {
            console.log(`Current user: ${chalk.bold(name)}`);
          } else {
            console.log(chalk.yellow('No user name set.'));
            console.log(chalk.dim('Set with: rev config user "Your Name"'));
          }
        }
      } else if (key === 'sections') {
        if (value) {
          const sections = value.split(',').map((s) => s.trim().toLowerCase().replace(/\.md$/, ''));
          setDefaultSections(sections);
          console.log(chalk.green(`Default sections set to: ${sections.join(', ')}`));
          console.log(chalk.dim(`Saved to ${getConfigPath()}`));
        } else {
          const sections = getDefaultSections();
          if (sections && sections.length > 0) {
            console.log(`Default sections: ${chalk.bold(sections.join(', '))}`);
          } else {
            console.log(chalk.yellow('No default sections set.'));
            console.log(chalk.dim('Set with: rev config sections "intro,methods,results,discussion"'));
            console.log(chalk.dim('When not set, rev new will prompt for sections.'));
          }
        }
      } else {
        console.error(chalk.red(`Unknown config key: ${key}`));
        console.error(chalk.dim('Available keys: user, sections'));
        process.exit(1);
      }
    });
}
