/**
 * Section commands: import, extract, split
 *
 * Commands for importing Word documents and splitting section files.
 * Sync and merge commands are in sync.ts and merge-resolve.ts respectively.
 */
import { chalk, fs, path, countAnnotations, loadConfig, splitAnnotatedPaper, } from './context.js';
/**
 * Detect sections from Word document text
 * Looks for common academic paper section headers
 */
function detectSectionsFromWord(text) {
    const lines = text.split('\n');
    const sections = [];
    const headerPatterns = [
        /^(Abstract|Summary)$/i,
        /^(Introduction|Background)$/i,
        /^(Methods?|Materials?\s*(and|&)\s*Methods?|Methodology|Experimental\s*Methods?)$/i,
        /^(Results?)$/i,
        /^(Results?\s*(and|&)\s*Discussion)$/i,
        /^(Discussion)$/i,
        /^(Conclusions?|Summary\s*(and|&)?\s*Conclusions?)$/i,
        /^(Acknowledgements?|Acknowledgments?)$/i,
        /^(References|Bibliography|Literature\s*Cited|Works\s*Cited)$/i,
        /^(Appendix|Appendices|Supplementary\s*(Materials?|Information)?|Supporting\s*Information)$/i,
        /^(Literature\s*Review|Related\s*Work|Previous\s*Work)$/i,
        /^(Study\s*Area|Study\s*Site|Site\s*Description)$/i,
        /^(Data\s*Analysis|Statistical\s*Analysis|Data\s*Collection)$/i,
        /^(Theoretical\s*Framework|Conceptual\s*Framework)$/i,
        /^(Case\s*Study|Case\s*Studies)$/i,
        /^(Limitations?)$/i,
        /^(Future\s*Work|Future\s*Directions?)$/i,
        /^(Funding|Author\s*Contributions?|Conflict\s*of\s*Interest|Data\s*Availability)$/i,
    ];
    const numberedHeaderPattern = /^(\d+\.?\s+)(Abstract|Introduction|Background|Methods?|Materials|Results?|Discussion|Conclusions?|References|Acknowledgements?|Appendix)/i;
    let currentSection = null;
    let currentContent = [];
    let preambleContent = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
            if (currentSection) {
                currentContent.push(line);
            }
            else {
                preambleContent.push(line);
            }
            continue;
        }
        let isHeader = false;
        let headerText = trimmed;
        for (const pattern of headerPatterns) {
            if (pattern.test(trimmed)) {
                isHeader = true;
                break;
            }
        }
        if (!isHeader) {
            const match = trimmed.match(numberedHeaderPattern);
            if (match) {
                isHeader = true;
                headerText = trimmed.replace(/^\d+\.?\s+/, '');
            }
        }
        if (isHeader) {
            if (currentSection) {
                sections.push({
                    header: currentSection,
                    content: currentContent.join('\n'),
                    file: headerToFilename(currentSection),
                });
            }
            else if (preambleContent.some(l => l.trim())) {
                sections.push({
                    header: 'Preamble',
                    content: preambleContent.join('\n'),
                    file: 'preamble.md',
                });
            }
            currentSection = headerText;
            currentContent = [];
        }
        else if (currentSection) {
            currentContent.push(line);
        }
        else {
            preambleContent.push(line);
        }
    }
    if (currentSection) {
        sections.push({
            header: currentSection,
            content: currentContent.join('\n'),
            file: headerToFilename(currentSection),
        });
    }
    if (sections.length === 0) {
        const allContent = [...preambleContent, ...currentContent].join('\n');
        if (allContent.trim()) {
            sections.push({
                header: 'Content',
                content: allContent,
                file: 'content.md',
            });
        }
    }
    return sections;
}
/**
 * Convert a section header to a filename
 */
function headerToFilename(header) {
    return header
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 30) + '.md';
}
/**
 * Bootstrap a new project from a Word document
 */
async function bootstrapFromWord(docx, options) {
    const outputDir = path.resolve(options.output);
    console.log(chalk.cyan(`Bootstrapping project from ${path.basename(docx)}...\n`));
    try {
        const { extractTextFromWord } = await import('../word.js');
        const { default: YAML } = await import('yaml');
        const text = await extractTextFromWord(docx);
        const sections = detectSectionsFromWord(text);
        if (sections.length === 0) {
            console.error(chalk.yellow('No sections detected. Creating single content.md file.'));
            sections.push({ header: 'Content', content: text, file: 'content.md' });
        }
        console.log(chalk.green(`Detected ${sections.length} section(s):\n`));
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        const sectionFiles = [];
        for (const section of sections) {
            const filePath = path.join(outputDir, section.file);
            const content = `# ${section.header}\n\n${section.content.trim()}\n`;
            console.log(`  ${chalk.bold(section.file)} - "${section.header}" (${section.content.split('\n').length} lines)`);
            if (!options.dryRun) {
                fs.writeFileSync(filePath, content, 'utf-8');
            }
            sectionFiles.push(section.file);
        }
        const docxName = path.basename(docx, '.docx');
        const title = docxName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        const config = {
            title: title,
            authors: [],
            sections: sectionFiles,
            bibliography: null,
            crossref: {
                figureTitle: 'Figure',
                tableTitle: 'Table',
                figPrefix: ['Fig.', 'Figs.'],
                tblPrefix: ['Table', 'Tables'],
            },
            pdf: {
                documentclass: 'article',
                fontsize: '12pt',
                geometry: 'margin=1in',
                linestretch: 1.5,
            },
            docx: {
                keepComments: true,
            },
        };
        const configPath = path.join(outputDir, 'rev.yaml');
        console.log(`\n  ${chalk.bold('rev.yaml')} - project configuration`);
        if (!options.dryRun) {
            fs.writeFileSync(configPath, YAML.stringify(config), 'utf-8');
        }
        const figuresDir = path.join(outputDir, 'figures');
        if (!fs.existsSync(figuresDir) && !options.dryRun) {
            fs.mkdirSync(figuresDir, { recursive: true });
            console.log(`  ${chalk.dim('figures/')} - image directory`);
        }
        if (options.dryRun) {
            console.log(chalk.yellow('\n(Dry run - no files written)'));
        }
        else {
            console.log(chalk.green('\nProject created!'));
            console.log(chalk.cyan('\nNext steps:'));
            if (outputDir !== process.cwd()) {
                console.log(chalk.dim(`  cd ${path.relative(process.cwd(), outputDir) || '.'}`));
            }
            console.log(chalk.dim('  # Edit rev.yaml to add authors and adjust settings'));
            console.log(chalk.dim('  # Review and clean up section files'));
            console.log(chalk.dim('  rev build          # Build PDF and DOCX'));
        }
    }
    catch (err) {
        const error = err;
        console.error(chalk.red(`Error: ${error.message}`));
        if (process.env.DEBUG)
            console.error(error.stack);
        process.exit(1);
    }
}
/**
 * Register section commands with the program
 */
export function register(program) {
    // ==========================================================================
    // IMPORT command - Import from Word (bootstrap or diff mode)
    // ==========================================================================
    program
        .command('import')
        .description('Import from Word: creates sections from scratch, or diffs against existing MD')
        .argument('<docx>', 'Word document')
        .argument('[original]', 'Optional: original Markdown file to compare against')
        .option('-o, --output <dir>', 'Output directory for bootstrap mode', '.')
        .option('-a, --author <name>', 'Author name for changes (diff mode)', 'Reviewer')
        .option('--dry-run', 'Preview without saving')
        .action(async (docx, original, options) => {
        if (!fs.existsSync(docx)) {
            console.error(chalk.red(`Error: Word file not found: ${docx}`));
            process.exit(1);
        }
        if (!original) {
            await bootstrapFromWord(docx, options);
            return;
        }
        if (!fs.existsSync(original)) {
            console.error(chalk.red(`Error: Original MD not found: ${original}`));
            process.exit(1);
        }
        console.log(chalk.cyan(`Comparing ${path.basename(docx)} against ${path.basename(original)}...`));
        // Warn if pandoc is missing
        const { hasPandoc: hasPandocImport, getInstallInstructions: getInstallImport } = await import('../dependencies.js');
        if (!hasPandocImport()) {
            console.log(chalk.yellow(`\n  Warning: Pandoc not installed. Track changes extracted from XML (formatting may differ).`));
            console.log(chalk.dim(`  Install for best results: ${getInstallImport('pandoc')}\n`));
        }
        try {
            const { importFromWord } = await import('../import.js');
            const { annotated, stats } = await importFromWord(docx, original, {
                author: options.author,
            });
            console.log(chalk.cyan('\nChanges detected:'));
            if (stats.insertions > 0)
                console.log(chalk.green(`  + Insertions:    ${stats.insertions}`));
            if (stats.deletions > 0)
                console.log(chalk.red(`  - Deletions:     ${stats.deletions}`));
            if (stats.substitutions > 0)
                console.log(chalk.yellow(`  ~ Substitutions: ${stats.substitutions}`));
            if (stats.comments > 0)
                console.log(chalk.blue(`  # Comments:      ${stats.comments}`));
            if (stats.total === 0) {
                console.log(chalk.green('\nNo changes detected.'));
                return;
            }
            console.log(chalk.dim(`\n  Total: ${stats.total}`));
            if (options.dryRun) {
                console.log(chalk.cyan('\n--- Preview (first 1000 chars) ---\n'));
                console.log(annotated.slice(0, 1000));
                if (annotated.length > 1000)
                    console.log(chalk.dim('\n... (truncated)'));
                return;
            }
            const outputPath = options.output || original;
            fs.writeFileSync(outputPath, annotated, 'utf-8');
            console.log(chalk.green(`\nSaved annotated version to ${outputPath}`));
            console.log(chalk.cyan('\nNext steps:'));
            console.log(`  1. ${chalk.bold('rev review ' + outputPath)}  - Accept/reject track changes`);
            console.log(`  2. Work with Claude to address comments`);
            console.log(`  3. ${chalk.bold('rev build docx')}  - Rebuild Word doc`);
        }
        catch (err) {
            const error = err;
            console.error(chalk.red(`Error: ${error.message}`));
            if (process.env.DEBUG)
                console.error(error.stack);
            process.exit(1);
        }
    });
    // ==========================================================================
    // EXTRACT command - Just extract text from Word
    // ==========================================================================
    program
        .command('extract')
        .description('Extract plain text from Word document (no diff)')
        .argument('<docx>', 'Word document')
        .option('-o, --output <file>', 'Output file (default: stdout)')
        .action(async (docx, options) => {
        if (!fs.existsSync(docx)) {
            console.error(chalk.red(`Error: File not found: ${docx}`));
            process.exit(1);
        }
        try {
            const { extractTextFromWord } = await import('../word.js');
            const text = await extractTextFromWord(docx);
            if (options.output) {
                fs.writeFileSync(options.output, text, 'utf-8');
                console.error(chalk.green(`Extracted to ${options.output}`));
            }
            else {
                process.stdout.write(text);
            }
        }
        catch (err) {
            const error = err;
            console.error(chalk.red(`Error: ${error.message}`));
            process.exit(1);
        }
    });
    // ==========================================================================
    // SPLIT command - Split annotated paper.md back to section files
    // ==========================================================================
    program
        .command('split')
        .description('Split annotated paper.md back to section files')
        .argument('<file>', 'Annotated paper.md file')
        .option('-c, --config <file>', 'Sections config file', 'sections.yaml')
        .option('-d, --dir <directory>', 'Output directory for section files', '.')
        .option('--dry-run', 'Preview without writing files')
        .action((file, options) => {
        if (!fs.existsSync(file)) {
            console.error(chalk.red(`File not found: ${file}`));
            process.exit(1);
        }
        const configPath = path.resolve(options.dir, options.config);
        if (!fs.existsSync(configPath)) {
            console.error(chalk.red(`Config not found: ${configPath}`));
            console.error(chalk.dim('Run "rev init" first to generate sections.yaml'));
            process.exit(1);
        }
        console.log(chalk.cyan(`Splitting ${file} using ${options.config}...`));
        const config = loadConfig(configPath);
        const paperContent = fs.readFileSync(file, 'utf-8');
        const sections = splitAnnotatedPaper(paperContent, config.sections);
        if (sections.size === 0) {
            console.error(chalk.yellow('No sections detected.'));
            console.error(chalk.dim('Check that headers match sections.yaml'));
            process.exit(1);
        }
        console.log(chalk.green(`\nFound ${sections.size} sections:\n`));
        for (const [sectionFile, content] of sections) {
            const outputPath = path.join(options.dir, sectionFile);
            const lines = content.split('\n').length;
            const annotations = countAnnotations(content);
            console.log(`  ${chalk.bold(sectionFile)} (${lines} lines)`);
            if (annotations.total > 0) {
                const parts = [];
                if (annotations.inserts > 0)
                    parts.push(chalk.green(`+${annotations.inserts}`));
                if (annotations.deletes > 0)
                    parts.push(chalk.red(`-${annotations.deletes}`));
                if (annotations.substitutes > 0)
                    parts.push(chalk.yellow(`~${annotations.substitutes}`));
                if (annotations.comments > 0)
                    parts.push(chalk.blue(`#${annotations.comments}`));
                console.log(chalk.dim(`    Annotations: ${parts.join(' ')}`));
            }
            if (!options.dryRun) {
                fs.writeFileSync(outputPath, content, 'utf-8');
            }
        }
        if (options.dryRun) {
            console.log(chalk.yellow('\n(Dry run - no files written)'));
        }
        else {
            console.log(chalk.green('\nSection files updated.'));
            console.log(chalk.cyan('\nNext: rev review <section.md> for each section'));
        }
    });
}
//# sourceMappingURL=sections.js.map