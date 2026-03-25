/**
 * Text operation commands: spelling, batch
 *
 * Commands for spelling checks and batch operations on markdown files.
 */
import { chalk, fs, fmt, loadBuildConfig, countAnnotations, getComments, stripAnnotations, setCommentStatus, } from './context.js';
/**
 * Register text-ops commands with the program
 */
export function register(program) {
    // ==========================================================================
    // SPELLING command - Spellcheck with global dictionary
    // ==========================================================================
    program
        .command('spelling')
        .description('Check spelling in markdown files')
        .argument('[files...]', 'Files to check (default: section files)')
        .option('--learn <word>', 'Add word to global dictionary')
        .option('--learn-project <word>', 'Add word to project dictionary')
        .option('--forget <word>', 'Remove word from global dictionary')
        .option('--forget-project <word>', 'Remove word from project dictionary')
        .option('--list', 'List global dictionary words')
        .option('--list-project', 'List project dictionary words')
        .option('--list-all', 'List all custom words (global + project)')
        .option('--british', 'Use British English dictionary')
        .option('--add-names', 'Add detected names to global dictionary')
        .action(async (files, options) => {
        const spelling = await import('../spelling.js');
        // Handle dictionary management
        if (options.learn) {
            const added = spelling.addWord(options.learn, true);
            if (added) {
                console.log(fmt.status('success', `Added "${options.learn}" to global dictionary`));
            }
            else {
                console.log(chalk.yellow(`"${options.learn}" already in dictionary`));
            }
            return;
        }
        if (options.learnProject) {
            const added = spelling.addWord(options.learnProject, false);
            if (added) {
                console.log(fmt.status('success', `Added "${options.learnProject}" to project dictionary`));
            }
            else {
                console.log(chalk.yellow(`"${options.learnProject}" already in dictionary`));
            }
            return;
        }
        if (options.forget) {
            const removed = spelling.removeWord(options.forget, true);
            if (removed) {
                console.log(fmt.status('success', `Removed "${options.forget}" from global dictionary`));
            }
            else {
                console.log(chalk.yellow(`"${options.forget}" not in dictionary`));
            }
            return;
        }
        if (options.forgetProject) {
            const removed = spelling.removeWord(options.forgetProject, false);
            if (removed) {
                console.log(fmt.status('success', `Removed "${options.forgetProject}" from project dictionary`));
            }
            else {
                console.log(chalk.yellow(`"${options.forgetProject}" not in dictionary`));
            }
            return;
        }
        if (options.list) {
            const words = spelling.listWords(true);
            console.log(fmt.header('Global Dictionary'));
            if (words.length === 0) {
                console.log(chalk.dim('  No custom words'));
                console.log(chalk.dim('  Use --learn <word> to add words'));
            }
            else {
                for (const word of words) {
                    console.log(`  ${word}`);
                }
                console.log(chalk.dim(`\n${words.length} word(s)`));
            }
            return;
        }
        if (options.listProject) {
            const words = spelling.listWords(false);
            console.log(fmt.header('Project Dictionary'));
            if (words.length === 0) {
                console.log(chalk.dim('  No custom words'));
                console.log(chalk.dim('  Use --learn-project <word> to add words'));
            }
            else {
                for (const word of words) {
                    console.log(`  ${word}`);
                }
                console.log(chalk.dim(`\n${words.length} word(s)`));
            }
            return;
        }
        if (options.listAll) {
            const globalWords = spelling.listWords(true);
            const projectWords = spelling.listWords(false);
            console.log(fmt.header('Global Dictionary'));
            if (globalWords.length === 0) {
                console.log(chalk.dim('  No custom words'));
            }
            else {
                for (const word of globalWords) {
                    console.log(`  ${word}`);
                }
            }
            console.log(fmt.header('Project Dictionary'));
            if (projectWords.length === 0) {
                console.log(chalk.dim('  No custom words'));
            }
            else {
                for (const word of projectWords) {
                    console.log(`  ${word}`);
                }
            }
            console.log(chalk.dim(`\nTotal: ${globalWords.length + projectWords.length} word(s)`));
            return;
        }
        // Check spelling in files
        let filesToCheck = files || [];
        if (filesToCheck.length === 0) {
            if (fs.existsSync('rev.yaml')) {
                try {
                    const config = loadBuildConfig('.');
                    filesToCheck = config?.sections || [];
                }
                catch {
                    // Ignore errors
                }
                if (filesToCheck.length === 0) {
                    filesToCheck = fs.readdirSync('.')
                        .filter(f => f.endsWith('.md') && !f.startsWith('.'));
                }
            }
            else {
                filesToCheck = fs.readdirSync('.')
                    .filter(f => f.endsWith('.md') && !f.startsWith('.'));
            }
        }
        if (filesToCheck.length === 0) {
            console.log(chalk.yellow('No markdown files found'));
            return;
        }
        const lang = options.british ? 'en-gb' : 'en';
        console.log(fmt.header(`Spelling Check (${options.british ? 'British' : 'US'} English)`));
        let totalMisspelled = 0;
        const allNames = new Set();
        for (const file of filesToCheck) {
            if (!fs.existsSync(file)) {
                console.log(chalk.yellow(`File not found: ${file}`));
                continue;
            }
            const result = await spelling.checkFile(file, { projectDir: '.', lang });
            const { misspelled, possibleNames } = result;
            // Collect names
            for (const n of possibleNames) {
                allNames.add(n.word);
            }
            if (misspelled.length > 0) {
                console.log(chalk.cyan(`\n${file}:`));
                for (const issue of misspelled) {
                    const suggestions = issue.suggestions.length > 0
                        ? chalk.dim(` → ${issue.suggestions.join(', ')}`)
                        : '';
                    console.log(`  ${chalk.yellow(issue.word)} ${chalk.dim(`(line ${issue.line})`)}${suggestions}`);
                }
                totalMisspelled += misspelled.length;
            }
        }
        // Show possible names separately
        if (allNames.size > 0) {
            const nameList = [...allNames].sort();
            if (options.addNames) {
                console.log(fmt.header('Adding Names to Dictionary'));
                for (const name of nameList) {
                    spelling.addWord(name, true);
                    console.log(chalk.green(`  ✓ ${name}`));
                }
                console.log(chalk.dim(`\nAdded ${nameList.length} name(s) to global dictionary`));
            }
            else {
                console.log(fmt.header('Possible Names'));
                console.log(chalk.dim(`  ${nameList.join(', ')}`));
                console.log(chalk.dim(`\n  Run with --add-names to add all to dictionary`));
            }
        }
        if (totalMisspelled === 0 && allNames.size === 0) {
            console.log(fmt.status('success', 'No spelling errors found'));
        }
        else {
            if (totalMisspelled > 0) {
                console.log(chalk.yellow(`\n${totalMisspelled} spelling error(s)`));
            }
            if (allNames.size > 0) {
                console.log(chalk.blue(`${allNames.size} possible name(s)`));
            }
            console.log(chalk.dim('Use --learn <word> to add words to dictionary'));
        }
    });
    // ==========================================================================
    // BATCH command - Run operations on multiple documents
    // ==========================================================================
    program
        .command('batch')
        .description('Run operations on multiple documents')
        .argument('<command>', 'Command to run (status, strip, resolve)')
        .argument('[pattern]', 'File pattern (default: *.md)')
        .option('--parallel', 'Run operations in parallel')
        .option('--dry-run', 'Preview files without running')
        .option('-a, --all', 'Include all .md files (not just sections)')
        .action(async (command, pattern, options) => {
        const validCommands = ['status', 'strip', 'resolve', 'comments'];
        if (!validCommands.includes(command)) {
            console.error(fmt.status('error', `Unknown batch command: ${command}`));
            console.error(chalk.dim(`Available: ${validCommands.join(', ')}`));
            process.exit(1);
        }
        // Find files
        let files = [];
        if (pattern) {
            if (pattern.includes('*')) {
                files = fs.readdirSync('.').filter(f => f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f));
            }
            else {
                files = [pattern];
            }
        }
        else {
            files = fs.readdirSync('.').filter(f => f.endsWith('.md') &&
                (options.all || !['README.md', 'CLAUDE.md', 'paper.md'].includes(f)));
        }
        if (files.length === 0) {
            console.error(fmt.status('error', 'No files found'));
            process.exit(1);
        }
        console.log(fmt.header(`Batch ${command} on ${files.length} file(s)`));
        console.log();
        if (options.dryRun) {
            console.log(chalk.dim('Dry run - files that would be processed:'));
            for (const file of files) {
                console.log(chalk.dim(`  ${file}`));
            }
            return;
        }
        // Process files
        const results = [];
        const progressBar = fmt.progressBar(files.length, 'Processing');
        progressBar.update(0);
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            progressBar.update(i + 1);
            if (!fs.existsSync(file)) {
                results.push({ file, status: 'not found' });
                continue;
            }
            try {
                const text = fs.readFileSync(file, 'utf-8');
                let result = { file, status: 'ok' };
                switch (command) {
                    case 'status': {
                        const counts = countAnnotations(text);
                        const comments = getComments(text);
                        result.annotations = counts.total;
                        result.comments = comments.length;
                        result.pending = comments.filter(c => !c.resolved).length;
                        break;
                    }
                    case 'comments': {
                        const comments = getComments(text);
                        result.total = comments.length;
                        result.pending = comments.filter(c => !c.resolved).length;
                        result.resolved = comments.filter(c => c.resolved).length;
                        break;
                    }
                    case 'resolve': {
                        const comments = getComments(text);
                        const pending = comments.filter(c => !c.resolved);
                        if (pending.length > 0) {
                            let newText = text;
                            for (const c of pending) {
                                newText = setCommentStatus(newText, c, true);
                            }
                            fs.writeFileSync(file, newText, 'utf-8');
                            result.resolved = pending.length;
                        }
                        else {
                            result.resolved = 0;
                        }
                        break;
                    }
                    case 'strip': {
                        const clean = stripAnnotations(text, { keepComments: false });
                        const hasChanges = clean !== text;
                        if (hasChanges) {
                            fs.writeFileSync(file, clean, 'utf-8');
                            result.stripped = true;
                        }
                        else {
                            result.stripped = false;
                        }
                        break;
                    }
                }
                results.push(result);
            }
            catch (err) {
                results.push({ file, status: 'error', error: err.message });
            }
        }
        progressBar.done();
        console.log();
        // Show results
        console.log(fmt.header('Results'));
        console.log();
        for (const r of results) {
            const statusIcon = r.status === 'ok'
                ? chalk.green('✓')
                : r.status === 'error'
                    ? chalk.red('✗')
                    : chalk.yellow('?');
            let details = '';
            switch (command) {
                case 'status':
                    details = chalk.dim(`${r.annotations || 0} annotations, ${r.pending || 0} pending comments`);
                    break;
                case 'comments':
                    details = chalk.dim(`${r.total || 0} total, ${r.pending || 0} pending`);
                    break;
                case 'resolve':
                    details = r.resolved && r.resolved > 0
                        ? chalk.green(`${r.resolved} resolved`)
                        : chalk.dim('no pending');
                    break;
                case 'strip':
                    details = r.stripped
                        ? chalk.green('cleaned')
                        : chalk.dim('no changes');
                    break;
            }
            console.log(`  ${statusIcon} ${r.file} ${details}`);
            if (r.error) {
                console.log(chalk.red(`    ${r.error}`));
            }
        }
        // Summary
        console.log();
        const successful = results.filter(r => r.status === 'ok').length;
        const failed = results.filter(r => r.status === 'error').length;
        console.log(chalk.dim(`${successful} succeeded, ${failed} failed`));
    });
}
//# sourceMappingURL=text-ops.js.map