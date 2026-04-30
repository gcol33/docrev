/**
 * Quality commands: lint, grammar, check
 *
 * Commands for checking project quality before submission.
 */
import { chalk, fs, fmt, loadBuildConfig, getComments, } from './context.js';
/**
 * Register quality commands with the program
 */
export function register(program) {
    // ==========================================================================
    // LINT command - Check for common issues
    // ==========================================================================
    program
        .command('lint')
        .description('Check for common issues in the project')
        .option('--fix', 'Auto-fix issues where possible')
        .action(async (_options) => {
        let config = {};
        try {
            config = loadBuildConfig('.') || {};
        }
        catch {
            // Not in a rev project, that's ok
        }
        let sections = config.sections || [];
        if (sections.length === 0) {
            sections = fs.readdirSync('.').filter(f => f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f));
        }
        const issues = [];
        const warnings = [];
        // Collect all content
        let allText = '';
        for (const section of sections) {
            if (fs.existsSync(section)) {
                allText += fs.readFileSync(section, 'utf-8') + '\n';
            }
        }
        // Check 1: Broken cross-references
        const figAnchors = new Set();
        const tblAnchors = new Set();
        const eqAnchors = new Set();
        const anchorPattern = /\{#(fig|tbl|eq):([^}]+)\}/g;
        let match;
        while ((match = anchorPattern.exec(allText)) !== null) {
            if (match[1] === 'fig')
                figAnchors.add(match[2]);
            else if (match[1] === 'tbl')
                tblAnchors.add(match[2]);
            else if (match[1] === 'eq')
                eqAnchors.add(match[2]);
        }
        const refPattern = /@(fig|tbl|eq):([a-zA-Z0-9_-]+)/g;
        while ((match = refPattern.exec(allText)) !== null) {
            const type = match[1];
            const label = match[2];
            const anchors = type === 'fig' ? figAnchors : type === 'tbl' ? tblAnchors : eqAnchors;
            if (!anchors.has(label)) {
                issues.push({
                    type: 'error',
                    message: `Broken reference: @${type}:${label}`,
                    fix: null
                });
            }
        }
        // Check 2: Orphaned figures
        for (const label of figAnchors) {
            if (!allText.includes(`@fig:${label}`)) {
                warnings.push({
                    type: 'warning',
                    message: `Unreferenced figure: {#fig:${label}}`,
                });
            }
        }
        // Check 3: Missing citations
        const bibPath = config.bibliography || 'references.bib';
        if (fs.existsSync(bibPath)) {
            const bibContent = fs.readFileSync(bibPath, 'utf-8');
            const bibKeys = new Set();
            const bibPattern = /@\w+\s*\{\s*([^,]+)/g;
            while ((match = bibPattern.exec(bibContent)) !== null) {
                bibKeys.add(match[1].trim());
            }
            const citePattern = /@([a-zA-Z][a-zA-Z0-9_-]*)(?![:\w])/g;
            while ((match = citePattern.exec(allText)) !== null) {
                const key = match[1];
                if (!bibKeys.has(key) && !['fig', 'tbl', 'eq'].includes(key)) {
                    issues.push({
                        type: 'error',
                        message: `Missing citation: @${key}`,
                    });
                }
            }
        }
        // Check 4: Unresolved comments
        const comments = getComments(allText);
        const pending = comments.filter(c => !c.resolved);
        if (pending.length > 0) {
            warnings.push({
                type: 'warning',
                message: `${pending.length} unresolved comment${pending.length === 1 ? '' : 's'}`,
            });
        }
        // Check 5: Empty sections
        for (const section of sections) {
            if (fs.existsSync(section)) {
                const content = fs.readFileSync(section, 'utf-8').trim();
                if (content.length < 50) {
                    warnings.push({
                        type: 'warning',
                        message: `Section appears empty: ${section}`,
                    });
                }
            }
        }
        // Output results
        console.log(fmt.header('Lint Results'));
        console.log();
        if (issues.length === 0 && warnings.length === 0) {
            console.log(chalk.green('✓ No issues found'));
            return;
        }
        for (const issue of issues) {
            console.log(chalk.red(`  ✗ ${issue.message}`));
        }
        for (const warning of warnings) {
            console.log(chalk.yellow(`  ⚠ ${warning.message}`));
        }
        console.log();
        console.log(chalk.dim(`${issues.length} error${issues.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`));
        if (issues.length > 0) {
            process.exit(1);
        }
    });
    // ==========================================================================
    // GRAMMAR command - Check grammar and style
    // ==========================================================================
    program
        .command('grammar')
        .description('Check grammar and style issues')
        .argument('[files...]', 'Markdown files to check')
        .option('--learn <word>', 'Add word to custom dictionary')
        .option('--forget <word>', 'Remove word from custom dictionary')
        .option('--list', 'List custom dictionary words')
        .option('--rules', 'List available grammar rules')
        .option('--no-scientific', 'Disable scientific writing rules')
        .option('-s, --severity <level>', 'Minimum severity: error, warning, info', 'info')
        .action(async (files, options) => {
        const { checkGrammar, getGrammarSummary, loadDictionary, addToDictionary, removeFromDictionary, listRules, } = await import('../grammar.js');
        // Handle dictionary management
        if (options.learn) {
            const added = addToDictionary(options.learn);
            if (added) {
                console.log(fmt.status('success', `Added "${options.learn}" to dictionary`));
            }
            else {
                console.log(chalk.dim(`"${options.learn}" already in dictionary`));
            }
            return;
        }
        if (options.forget) {
            const removed = removeFromDictionary(options.forget);
            if (removed) {
                console.log(fmt.status('success', `Removed "${options.forget}" from dictionary`));
            }
            else {
                console.log(chalk.yellow(`"${options.forget}" not in dictionary`));
            }
            return;
        }
        if (options.list) {
            const words = loadDictionary();
            console.log(fmt.header('Custom Dictionary'));
            console.log();
            if (words.size === 0) {
                console.log(chalk.dim('  No custom words defined'));
                console.log(chalk.dim('  Use --learn <word> to add words'));
            }
            else {
                const sorted = [...words].sort();
                for (const word of sorted) {
                    console.log(`  ${word}`);
                }
                console.log();
                console.log(chalk.dim(`${words.size} word(s)`));
            }
            return;
        }
        if (options.rules) {
            const rules = listRules(options.scientific);
            console.log(fmt.header('Grammar Rules'));
            console.log();
            for (const rule of rules) {
                const icon = rule.severity === 'error' ? chalk.red('●') :
                    rule.severity === 'warning' ? chalk.yellow('●') :
                        chalk.blue('●');
                console.log(`  ${icon} ${chalk.bold(rule.id)}`);
                console.log(chalk.dim(`     ${rule.message}`));
            }
            return;
        }
        // Get files to check
        let mdFiles = files;
        if (!mdFiles || mdFiles.length === 0) {
            let config = {};
            try {
                config = loadBuildConfig('.') || {};
            }
            catch {
                // Not in a rev project
            }
            mdFiles = config.sections || [];
            if (mdFiles.length === 0) {
                mdFiles = fs.readdirSync('.').filter(f => f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f));
            }
        }
        if (mdFiles.length === 0) {
            console.error(chalk.red('No markdown files found'));
            process.exit(1);
        }
        console.log(fmt.header('Grammar Check'));
        console.log();
        const severityLevels = { error: 3, warning: 2, info: 1 };
        const minSeverity = severityLevels[options.severity || 'info'] || 1;
        let allIssues = [];
        for (const file of mdFiles) {
            if (!fs.existsSync(file))
                continue;
            const text = fs.readFileSync(file, 'utf-8');
            const issues = checkGrammar(text, { scientific: options.scientific });
            // Filter by severity
            const filtered = issues.filter((i) => severityLevels[i.severity] >= minSeverity);
            if (filtered.length > 0) {
                console.log(chalk.cyan.bold(file));
                for (const issue of filtered) {
                    const icon = issue.severity === 'error' ? chalk.red('●') :
                        issue.severity === 'warning' ? chalk.yellow('●') :
                            chalk.blue('●');
                    console.log(`  ${chalk.dim(`L${issue.line}:`)} ${icon} ${issue.message}`);
                    console.log(chalk.dim(`      "${issue.match}" in: ${issue.context.slice(0, 60)}...`));
                }
                console.log();
                allIssues.push(...filtered.map(i => ({ ...i, file })));
            }
        }
        const summary = getGrammarSummary(allIssues);
        if (summary.total === 0) {
            console.log(chalk.green('✓ No issues found'));
        }
        else {
            console.log(chalk.dim(`Found ${summary.total} issue(s): ${summary.errors} errors, ${summary.warnings} warnings, ${summary.info} info`));
            console.log();
            console.log(chalk.dim('Tip: Use --learn <word> to add words to dictionary'));
        }
    });
    // ==========================================================================
    // CHECK command - Pre-submission check
    // ==========================================================================
    program
        .command('check')
        .description('Run all checks before submission (lint + grammar + citations)')
        .option('--fix', 'Auto-fix issues where possible')
        .option('-s, --severity <level>', 'Minimum grammar severity', 'warning')
        .action(async (options) => {
        const { validateCitations } = await import('../citations.js');
        const { checkGrammar, getGrammarSummary } = await import('../grammar.js');
        console.log(fmt.header('Pre-Submission Check'));
        console.log();
        let hasErrors = false;
        let totalIssues = 0;
        // 1. Run lint
        console.log(chalk.cyan.bold('1. Linting...'));
        let config = {};
        try {
            config = loadBuildConfig('.') || {};
        }
        catch {
            // Not in a rev project
        }
        let sections = config.sections || [];
        if (sections.length === 0) {
            sections = fs.readdirSync('.').filter(f => f.endsWith('.md') && !['README.md', 'CLAUDE.md', 'paper.md'].includes(f));
        }
        const lintIssues = [];
        const lintWarnings = [];
        for (const file of sections) {
            if (!fs.existsSync(file))
                continue;
            const content = fs.readFileSync(file, 'utf-8');
            // Check for broken cross-references
            const refs = content.match(/@(fig|tbl|eq|sec):\w+/g) || [];
            const anchors = content.match(/\{#(fig|tbl|eq|sec):[^}]+\}/g) || [];
            const anchorLabels = anchors.map(a => a.match(/#([^}]+)/)[1]);
            for (const ref of refs) {
                const label = ref.slice(1);
                if (!anchorLabels.includes(label)) {
                    lintIssues.push({ file, message: `Broken reference: ${ref}` });
                }
            }
            // Check for unresolved comments
            const unresolvedComments = (content.match(/\{>>[\s\S]*?<<\}/g) || [])
                .filter(c => !c.includes('[RESOLVED]'));
            if (unresolvedComments.length > 0) {
                lintWarnings.push({ file, message: `${unresolvedComments.length} unresolved comment(s)` });
            }
        }
        if (lintIssues.length > 0) {
            for (const issue of lintIssues) {
                console.log(chalk.red(`   ✗ ${issue.file}: ${issue.message}`));
            }
            hasErrors = true;
            totalIssues += lintIssues.length;
        }
        for (const warning of lintWarnings) {
            console.log(chalk.yellow(`   ⚠ ${warning.file}: ${warning.message}`));
            totalIssues++;
        }
        if (lintIssues.length === 0 && lintWarnings.length === 0) {
            console.log(chalk.green('   ✓ No lint issues'));
        }
        console.log();
        // 2. Run grammar check
        console.log(chalk.cyan.bold('2. Grammar check...'));
        const severityLevels = { error: 3, warning: 2, info: 1 };
        const minSeverity = severityLevels[options.severity || 'warning'] || 2;
        let grammarIssues = [];
        for (const file of sections) {
            if (!fs.existsSync(file))
                continue;
            const text = fs.readFileSync(file, 'utf-8');
            const issues = checkGrammar(text, { scientific: true });
            const filtered = issues.filter((i) => severityLevels[i.severity] >= minSeverity);
            grammarIssues.push(...filtered.map(i => ({ ...i, file })));
        }
        const grammarSummary = getGrammarSummary(grammarIssues);
        if (grammarSummary.errors > 0) {
            hasErrors = true;
        }
        totalIssues += grammarSummary.total;
        if (grammarSummary.total > 0) {
            console.log(chalk.yellow(`   ⚠ ${grammarSummary.total} grammar issue(s): ${grammarSummary.errors} errors, ${grammarSummary.warnings} warnings`));
        }
        else {
            console.log(chalk.green('   ✓ No grammar issues'));
        }
        console.log();
        // 3. Run citation check
        console.log(chalk.cyan.bold('3. Citation check...'));
        const bibFile = config.bibliography || 'references.bib';
        if (fs.existsSync(bibFile)) {
            const existingSections = sections.filter(f => fs.existsSync(f));
            const result = validateCitations(existingSections, bibFile);
            if (result.missing.length > 0) {
                console.log(chalk.red(`   ✗ ${result.missing.length} missing citation(s): ${result.missing.slice(0, 3).join(', ')}${result.missing.length > 3 ? '...' : ''}`));
                hasErrors = true;
                totalIssues += result.missing.length;
            }
            if (result.unused.length > 0) {
                console.log(chalk.yellow(`   ⚠ ${result.unused.length} unused citation(s)`));
                totalIssues += result.unused.length;
            }
            if (result.missing.length === 0 && result.unused.length === 0) {
                console.log(chalk.green('   ✓ All citations valid'));
            }
        }
        else {
            console.log(chalk.dim('   - No bibliography file found'));
        }
        console.log();
        // Summary
        console.log(chalk.bold('Summary'));
        if (hasErrors) {
            console.log(chalk.red(`   ${totalIssues} issue(s) found. Please fix before submission.`));
            process.exit(1);
        }
        else if (totalIssues > 0) {
            console.log(chalk.yellow(`   ${totalIssues} warning(s). Review before submission.`));
        }
        else {
            console.log(chalk.green('   ✓ All checks passed! Ready for submission.'));
        }
    });
}
//# sourceMappingURL=quality.js.map