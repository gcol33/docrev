/**
 * Track changes module - Apply markdown annotations as Word track changes
 *
 * Converts CriticMarkup annotations to Word OOXML track changes format.
 */
import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import AdmZip from 'adm-zip';
import { escapeXml } from './utils.js';
/**
 * Prepare text with CriticMarkup annotations for track changes
 * Replaces annotations with markers that can be processed in DOCX
 *
 * @param text - Text with CriticMarkup annotations
 * @param options - Options
 * @returns Processed text and marker info
 */
export function prepareForTrackChanges(text, options = {}) {
    const { author = 'Reviewer' } = options;
    const markers = [];
    let markerId = 0;
    let result = text;
    // Process insertions: {++text++}
    result = result.replace(/\{\+\+(.+?)\+\+\}/gs, (match, content) => {
        const id = markerId++;
        markers.push({
            id,
            type: 'insert',
            content,
            author,
        });
        return `{{TC_${id}}}`;
    });
    // Process deletions: {--text--}
    result = result.replace(/\{--(.+?)--\}/gs, (match, content) => {
        const id = markerId++;
        markers.push({
            id,
            type: 'delete',
            content,
            author,
        });
        return `{{TC_${id}}}`;
    });
    // Process substitutions: {~~old~>new~~}
    result = result.replace(/\{~~(.+?)~>(.+?)~~\}/gs, (match, old, replacement) => {
        const id = markerId++;
        markers.push({
            id,
            type: 'substitute',
            content: old,
            replacement,
            author,
        });
        return `{{TC_${id}}}`;
    });
    // Process comments: {>>Author: comment<<}
    result = result.replace(/\{>>(.+?)<<\}/gs, (match, content) => {
        const id = markerId++;
        // Extract author if present (format: "Author: comment")
        const colonIdx = content.indexOf(':');
        let commentAuthor = author;
        let commentText = content;
        if (colonIdx > 0 && colonIdx < 30) {
            commentAuthor = content.slice(0, colonIdx).trim();
            commentText = content.slice(colonIdx + 1).trim();
        }
        markers.push({
            id,
            type: 'comment',
            content: commentText,
            author: commentAuthor,
        });
        return `{{TC_${id}}}`;
    });
    return { text: result, markers };
}
/**
 * Apply track changes markers to a Word document
 *
 * @param docxPath - Path to input DOCX file
 * @param markers - Markers from prepareForTrackChanges
 * @param outputPath - Path for output DOCX file
 * @returns Result with success status and message
 */
export async function applyTrackChangesToDocx(docxPath, markers, outputPath) {
    if (!fs.existsSync(docxPath)) {
        return { success: false, message: `File not found: ${docxPath}` };
    }
    let zip;
    try {
        zip = new AdmZip(docxPath);
    }
    catch (err) {
        const error = err;
        return { success: false, message: `Invalid DOCX file: ${error.message}` };
    }
    // Read document.xml
    const docEntry = zip.getEntry('word/document.xml');
    if (!docEntry) {
        return { success: false, message: 'Invalid DOCX: no document.xml' };
    }
    let documentXml = zip.readAsText(docEntry);
    // Generate ISO date for track changes
    const now = new Date().toISOString();
    // Replace markers with track change XML
    for (const marker of markers) {
        const placeholder = `{{TC_${marker.id}}}`;
        let replacement = '';
        const escapedContent = escapeXml(marker.content);
        const escapedAuthor = escapeXml(marker.author);
        if (marker.type === 'insert') {
            replacement = `<w:ins w:id="${marker.id}" w:author="${escapedAuthor}" w:date="${now}"><w:r><w:t>${escapedContent}</w:t></w:r></w:ins>`;
        }
        else if (marker.type === 'delete') {
            replacement = `<w:del w:id="${marker.id}" w:author="${escapedAuthor}" w:date="${now}"><w:r><w:delText>${escapedContent}</w:delText></w:r></w:del>`;
        }
        else if (marker.type === 'substitute') {
            const escapedReplacement = escapeXml(marker.replacement || '');
            replacement = `<w:del w:id="${marker.id}" w:author="${escapedAuthor}" w:date="${now}"><w:r><w:delText>${escapedContent}</w:delText></w:r></w:del><w:ins w:id="${marker.id + 1000}" w:author="${escapedAuthor}" w:date="${now}"><w:r><w:t>${escapedReplacement}</w:t></w:r></w:ins>`;
        }
        documentXml = documentXml.replace(placeholder, replacement);
    }
    // Update document.xml
    zip.updateFile('word/document.xml', Buffer.from(documentXml));
    // Enable track revisions in settings.xml
    const settingsEntry = zip.getEntry('word/settings.xml');
    if (settingsEntry) {
        let settingsXml = zip.readAsText(settingsEntry);
        if (!settingsXml.includes('w:trackRevisions')) {
            settingsXml = settingsXml.replace('</w:settings>', '<w:trackRevisions/></w:settings>');
            zip.updateFile('word/settings.xml', Buffer.from(settingsXml));
        }
    }
    // Write output
    zip.writeZip(outputPath);
    return { success: true, message: `Created ${outputPath} with track changes` };
}
/**
 * Build a Word document with track changes from annotated markdown
 *
 * @param mdPath - Path to markdown file with CriticMarkup
 * @param docxPath - Output path for Word document
 * @param options - Options
 * @returns Result with success status and message
 */
export async function buildWithTrackChanges(mdPath, docxPath, options = {}) {
    const { author = 'Author' } = options;
    if (!fs.existsSync(mdPath)) {
        return { success: false, message: `File not found: ${mdPath}` };
    }
    const content = fs.readFileSync(mdPath, 'utf-8');
    // Prepare for track changes
    const { text: prepared, markers } = prepareForTrackChanges(content, { author });
    // If no annotations, just build normally
    if (markers.length === 0) {
        try {
            execSync(`pandoc "${mdPath}" -o "${docxPath}"`, { encoding: 'utf-8' });
            return { success: true, message: `Created ${docxPath}` };
        }
        catch (err) {
            const error = err;
            return { success: false, message: error.message };
        }
    }
    // Write prepared content to temp file
    const tempDir = path.dirname(mdPath);
    const tempMd = path.join(tempDir, `.temp-${Date.now()}.md`);
    const tempDocx = path.join(tempDir, `.temp-${Date.now()}.docx`);
    try {
        fs.writeFileSync(tempMd, prepared, 'utf-8');
        // Build with pandoc
        execSync(`pandoc "${tempMd}" -o "${tempDocx}"`, { encoding: 'utf-8' });
        // Apply track changes
        const result = await applyTrackChangesToDocx(tempDocx, markers, docxPath);
        // Clean up temp files
        fs.unlinkSync(tempMd);
        fs.unlinkSync(tempDocx);
        return result;
    }
    catch (err) {
        // Clean up on error
        if (fs.existsSync(tempMd))
            fs.unlinkSync(tempMd);
        if (fs.existsSync(tempDocx))
            fs.unlinkSync(tempDocx);
        const error = err;
        return { success: false, message: error.message };
    }
}
//# sourceMappingURL=trackchanges.js.map