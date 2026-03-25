/**
 * Word document tool commands: annotate, apply, comment
 *
 * Commands for working with Word documents directly (comments, track changes).
 */
import { chalk, fs, fmt, getUserName, parseAnnotations, } from './context.js';
/**
 * Register word-tools commands with the program
 */
export function register(program) {
    // ==========================================================================
    // ANNOTATE command - Add comments to Word document
    // ==========================================================================
    program
        .command('annotate')
        .description('Add comment to Word document')
        .argument('<docx>', 'Word document')
        .option('-m, --message <text>', 'Comment text')
        .option('-s, --search <text>', 'Text to attach comment to')
        .option('-a, --author <name>', 'Comment author')
        .action(async (docxPath, options) => {
        if (!fs.existsSync(docxPath)) {
            console.error(chalk.red(`File not found: ${docxPath}`));
            process.exit(1);
        }
        if (!options.message) {
            console.error(chalk.red('Comment message required (-m)'));
            process.exit(1);
        }
        const { default: AdmZip } = await import('adm-zip');
        const zip = new AdmZip(docxPath);
        // Read document.xml
        const docEntry = zip.getEntry('word/document.xml');
        if (!docEntry) {
            console.error(chalk.red('Invalid Word document'));
            process.exit(1);
        }
        let docXml = zip.readAsText(docEntry);
        // Read or create comments.xml
        let commentsEntry = zip.getEntry('word/comments.xml');
        let commentsXml;
        let nextCommentId = 1;
        if (commentsEntry) {
            commentsXml = zip.readAsText(commentsEntry);
            const idMatches = commentsXml.match(/w:id="(\d+)"/g) || [];
            for (const m of idMatches) {
                const id = parseInt(m.match(/\d+/)[0]);
                if (id >= nextCommentId)
                    nextCommentId = id + 1;
            }
        }
        else {
            commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
</w:comments>`;
        }
        const author = options.author || getUserName() || 'Claude';
        const date = new Date().toISOString();
        const commentId = nextCommentId;
        // Add comment to comments.xml
        const newComment = `<w:comment w:id="${commentId}" w:author="${author}" w:date="${date}">
  <w:p><w:r><w:t>${options.message}</w:t></w:r></w:p>
</w:comment>`;
        commentsXml = commentsXml.replace('</w:comments>', `${newComment}\n</w:comments>`);
        // Find text and add comment markers
        if (options.search) {
            const searchText = options.search;
            const textPattern = new RegExp(`(<w:t[^>]*>)([^<]*${searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^<]*)(<\/w:t>)`, 'i');
            if (textPattern.test(docXml)) {
                docXml = docXml.replace(textPattern, (_match, start, text, end) => {
                    return `<w:commentRangeStart w:id="${commentId}"/>${start}${text}${end}<w:commentRangeEnd w:id="${commentId}"/><w:r><w:commentReference w:id="${commentId}"/></w:r>`;
                });
            }
            else {
                console.log(chalk.yellow(`Text "${searchText}" not found in document. Comment added without anchor.`));
            }
        }
        // Update zip
        zip.updateFile('word/document.xml', Buffer.from(docXml));
        if (commentsEntry) {
            zip.updateFile('word/comments.xml', Buffer.from(commentsXml));
        }
        else {
            zip.addFile('word/comments.xml', Buffer.from(commentsXml));
            // Update [Content_Types].xml
            const ctEntry = zip.getEntry('[Content_Types].xml');
            if (ctEntry) {
                let ctXml = zip.readAsText(ctEntry);
                if (!ctXml.includes('comments.xml')) {
                    ctXml = ctXml.replace('</Types>', '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>\n</Types>');
                    zip.updateFile('[Content_Types].xml', Buffer.from(ctXml));
                }
            }
            // Update document.xml.rels
            const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
            if (relsEntry) {
                let relsXml = zip.readAsText(relsEntry);
                if (!relsXml.includes('comments.xml')) {
                    const newRelId = `rId${Date.now()}`;
                    relsXml = relsXml.replace('</Relationships>', `<Relationship Id="${newRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>\n</Relationships>`);
                    zip.updateFile('word/_rels/document.xml.rels', Buffer.from(relsXml));
                }
            }
        }
        // Write back
        zip.writeZip(docxPath);
        console.log(fmt.status('success', `Added comment to ${docxPath}`));
    });
    // ==========================================================================
    // APPLY command - Apply MD annotations as Word track changes
    // ==========================================================================
    program
        .command('apply')
        .description('Apply markdown annotations to Word document as track changes')
        .argument('<md>', 'Markdown file with annotations')
        .argument('<docx>', 'Output Word document')
        .option('-a, --author <name>', 'Author name for track changes')
        .action(async (mdPath, docxPath, options) => {
        if (!fs.existsSync(mdPath)) {
            console.error(chalk.red(`File not found: ${mdPath}`));
            process.exit(1);
        }
        const mdContent = fs.readFileSync(mdPath, 'utf-8');
        const annotations = parseAnnotations(mdContent);
        if (annotations.length === 0) {
            console.log(chalk.yellow('No annotations found in markdown file'));
        }
        const author = options.author || getUserName() || 'Author';
        // Build document with track changes
        const { buildWithTrackChanges } = await import('../trackchanges.js');
        try {
            const result = await buildWithTrackChanges(mdPath, docxPath, { author });
            if (result.success) {
                console.log(fmt.status('success', result.message));
                console.log(chalk.dim(`  ${annotations.length} annotations applied as track changes`));
            }
            else {
                console.error(chalk.red(result.message));
                process.exit(1);
            }
        }
        catch (err) {
            console.error(chalk.red(`Error: ${err.message}`));
            process.exit(1);
        }
    });
    // ==========================================================================
    // COMMENT command - Interactive comment addition to DOCX
    // ==========================================================================
    program
        .command('comment')
        .description('Add comments to Word document interactively')
        .argument('<docx>', 'Word document')
        .option('-a, --author <name>', 'Comment author')
        .action(async (docxPath, options) => {
        if (!fs.existsSync(docxPath)) {
            console.error(chalk.red(`File not found: ${docxPath}`));
            process.exit(1);
        }
        const { default: AdmZip } = await import('adm-zip');
        const readline = await import('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
        const ask = (prompt) => new Promise((resolve) => rl.question(prompt, resolve));
        const author = options.author || getUserName() || 'Reviewer';
        console.log(fmt.header('Interactive Comment Mode'));
        console.log(chalk.dim(`  Document: ${docxPath}`));
        console.log(chalk.dim(`  Author: ${author}`));
        console.log(chalk.dim('  Type your comment, then the text to attach it to.'));
        console.log(chalk.dim('  Enter empty comment to quit.\n'));
        let commentsAdded = 0;
        while (true) {
            const message = await ask(chalk.cyan('Comment: '));
            if (!message.trim()) {
                break;
            }
            const searchText = await ask(chalk.cyan('Attach to text: '));
            // Load document fresh each time
            const zip = new AdmZip(docxPath);
            const docEntry = zip.getEntry('word/document.xml');
            if (!docEntry) {
                console.error(chalk.red('Invalid Word document'));
                rl.close();
                process.exit(1);
            }
            let docXml = zip.readAsText(docEntry);
            // Read or create comments.xml
            let commentsEntry = zip.getEntry('word/comments.xml');
            let commentsXml;
            let nextCommentId = 1;
            if (commentsEntry) {
                commentsXml = zip.readAsText(commentsEntry);
                const idMatches = commentsXml.match(/w:id="(\d+)"/g) || [];
                for (const m of idMatches) {
                    const id = parseInt(m.match(/\d+/)[0]);
                    if (id >= nextCommentId)
                        nextCommentId = id + 1;
                }
            }
            else {
                commentsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
</w:comments>`;
            }
            const date = new Date().toISOString();
            const commentId = nextCommentId;
            // Add comment to comments.xml
            const newComment = `<w:comment w:id="${commentId}" w:author="${author}" w:date="${date}">
  <w:p><w:r><w:t>${message}</w:t></w:r></w:p>
</w:comment>`;
            commentsXml = commentsXml.replace('</w:comments>', `${newComment}\n</w:comments>`);
            // Find text and add comment markers
            if (searchText.trim()) {
                const escapedSearch = searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const textPattern = new RegExp(`(<w:t[^>]*>)([^<]*${escapedSearch}[^<]*)(<\/w:t>)`, 'i');
                if (textPattern.test(docXml)) {
                    docXml = docXml.replace(textPattern, (_match, start, text, end) => {
                        return `<w:commentRangeStart w:id="${commentId}"/>${start}${text}${end}<w:commentRangeEnd w:id="${commentId}"/><w:r><w:commentReference w:id="${commentId}"/></w:r>`;
                    });
                    console.log(chalk.green(`  ✓ Comment added at "${searchText}"`));
                }
                else {
                    console.log(chalk.yellow(`  Text not found. Comment added without anchor.`));
                }
            }
            else {
                console.log(chalk.dim(`  Comment added without anchor.`));
            }
            // Update zip
            zip.updateFile('word/document.xml', Buffer.from(docXml));
            if (commentsEntry) {
                zip.updateFile('word/comments.xml', Buffer.from(commentsXml));
            }
            else {
                zip.addFile('word/comments.xml', Buffer.from(commentsXml));
                // Update [Content_Types].xml
                const ctEntry = zip.getEntry('[Content_Types].xml');
                if (ctEntry) {
                    let ctXml = zip.readAsText(ctEntry);
                    if (!ctXml.includes('comments.xml')) {
                        ctXml = ctXml.replace('</Types>', '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>\n</Types>');
                        zip.updateFile('[Content_Types].xml', Buffer.from(ctXml));
                    }
                }
                // Update document.xml.rels
                const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
                if (relsEntry) {
                    let relsXml = zip.readAsText(relsEntry);
                    if (!relsXml.includes('comments.xml')) {
                        const newRelId = `rId${Date.now()}`;
                        relsXml = relsXml.replace('</Relationships>', `<Relationship Id="${newRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>\n</Relationships>`);
                        zip.updateFile('word/_rels/document.xml.rels', Buffer.from(relsXml));
                    }
                }
            }
            zip.writeZip(docxPath);
            commentsAdded++;
            console.log();
        }
        rl.close();
        console.log();
        if (commentsAdded > 0) {
            console.log(fmt.status('success', `Added ${commentsAdded} comment(s) to ${docxPath}`));
        }
        else {
            console.log(chalk.dim('No comments added.'));
        }
    });
}
//# sourceMappingURL=word-tools.js.map