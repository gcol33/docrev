/**
 * Cross-reference handling - dynamic figure/table references
 *
 * Enables:
 * - @fig:label syntax in source (auto-numbered)
 * - Conversion to "Figure 1" in Word output
 * - Auto-conversion back during import
 */
import * as fs from 'fs';
import * as path from 'path';
import YAML from 'yaml';
// =============================================================================
// Constants
// =============================================================================
/** Characters of context to check before a reference for deduplication */
const REF_CONTEXT_WINDOW = 100;
/** Minimum word length for similarity calculations */
const MIN_WORD_LENGTH = 2;
// =============================================================================
// Internal Helpers
// =============================================================================
/**
 * Discover section files from a directory by reading config files
 * Only returns files explicitly defined in rev.yaml or sections.yaml
 * Returns empty array if no config found (caller should handle this)
 */
function discoverSectionFiles(directory) {
    // Try rev.yaml first
    const revYamlPath = path.join(directory, 'rev.yaml');
    if (fs.existsSync(revYamlPath)) {
        try {
            const config = YAML.parse(fs.readFileSync(revYamlPath, 'utf-8'));
            if (config.sections && Array.isArray(config.sections) && config.sections.length > 0) {
                return config.sections.filter((f) => fs.existsSync(path.join(directory, f)));
            }
        }
        catch (e) {
            if (process.env.DEBUG) {
                console.warn('crossref: YAML parse error in rev.yaml:', e.message);
            }
        }
    }
    // Try sections.yaml
    const sectionsPath = path.join(directory, 'sections.yaml');
    if (fs.existsSync(sectionsPath)) {
        try {
            const config = YAML.parse(fs.readFileSync(sectionsPath, 'utf-8'));
            if (config.sections) {
                const sectionOrder = Object.entries(config.sections)
                    .sort((a, b) => (a[1].order ?? 999) - (b[1].order ?? 999))
                    .map(([file]) => file);
                return sectionOrder.filter((f) => fs.existsSync(path.join(directory, f)));
            }
        }
        catch (e) {
            if (process.env.DEBUG) {
                console.warn('crossref: YAML parse error in sections.yaml:', e.message);
            }
        }
    }
    // No config found - return empty array
    // Caller must handle this (either error or use explicit sections)
    return [];
}
// =============================================================================
// Detection Patterns
// =============================================================================
/**
 * Patterns for detecting hardcoded references
 * Matches complex patterns including:
 * - Simple: "Figure 1", "Fig. 2a", "Table S1"
 * - Ranges: "Figures 1-3", "Fig. 1a-c", "Figs. 1a-3b"
 * - Lists: "Figures 1, 2, and 3", "Fig. 1a, b, c", "Tables 1 & 2"
 * - Mixed: "Figs. 1, 3-5, and 7"
 *
 * Uses a simpler base pattern and parses the full match for lists
 */
const DETECTION_PATTERNS = {
    // Captures the full reference including lists with "and"
    // Group 1: type prefix (Figure, Fig., etc.)
    // Group 2: reference list (parsed by parseReferenceList())
    // Matches: "1", "1a", "1-3", "1a-c", "1, 2, 3", "1 and 2", "1, 2 and 3", "1, 2, and 3"
    // Separator: comma/dash/ampersand, optionally followed by "and"
    // Standalone letters must be followed by separator, punctuation, or word boundary
    // Also handles: "see Figure 1", "(Fig. 1)", "in Figures 1–3"
    // Note: 'gi' flag makes these case-insensitive, so "figure 1" is also matched
    figure: /\b(Figures?|Figs?\.?)\s+((?:\d+|S\d+)[a-z]?(?:(?:\s*[-–—,&]\s*(?:and\s+)?|\s+and\s+)(?:(?:\d+|S\d+)[a-z]?|[a-z]\b))*)/gi,
    table: /\b(Tables?|Tabs?\.?)\s+((?:\d+|S\d+)[a-z]?(?:(?:\s*[-–—,&]\s*(?:and\s+)?|\s+and\s+)(?:(?:\d+|S\d+)[a-z]?|[a-z]\b))*)/gi,
    equation: /\b(Equations?|Eqs?\.?)\s+((?:\d+)[a-z]?(?:(?:\s*[-–—,&]\s*(?:and\s+)?|\s+and\s+)(?:(?:\d+)[a-z]?|[a-z]\b))*)/gi,
};
/**
 * Patterns to EXCLUDE from detection (false positives)
 * These look like references but aren't (e.g., "Table of Contents", "Figure skating")
 */
const EXCLUSION_PATTERNS = [
    /\bTable\s+of\s+Contents?\b/gi,
    /\bFigure\s+skating\b/gi,
    /\bFigure\s+out\b/gi,
    /\bFigure\s+it\b/gi,
    /\bTable\s+setting/gi,
    /\bEquation\s+editor\b/gi,
];
/**
 * Pattern for extracting anchors from markdown: {#fig:label}, {#tbl:label}
 */
const ANCHOR_PATTERN = /\{#(fig|tbl|eq):([a-zA-Z0-9_-]+)/gi;
/**
 * Pattern for @-style references: @fig:label, @tbl:label
 */
const REF_PATTERN = /@(fig|tbl|eq):([a-zA-Z0-9_-]+)/gi;
// =============================================================================
// Public API
// =============================================================================
/**
 * Normalize a reference type to standard form
 */
export function normalizeType(typeStr) {
    if (typeof typeStr !== 'string') {
        throw new TypeError(`typeStr must be a string, got ${typeof typeStr}`);
    }
    const lower = typeStr.toLowerCase().replace(/\.$/, '');
    if (lower.startsWith('fig'))
        return 'fig';
    if (lower.startsWith('tab'))
        return 'tbl';
    if (lower.startsWith('eq'))
        return 'eq';
    return lower;
}
/**
 * Parse a reference number, handling supplementary (S1, S2) and letter suffixes (1a, 1b)
 */
export function parseRefNumber(numStr, suffix = null) {
    if (!numStr || typeof numStr !== 'string') {
        return { isSupp: false, num: 0, suffix: suffix || null };
    }
    const isSupp = numStr.toUpperCase().startsWith('S');
    const numPart = isSupp ? numStr.slice(1) : numStr;
    // Extract suffix if embedded in numStr (e.g., "1a")
    const match = numPart.match(/^(\d+)([a-z])?$/i);
    const num = match && match[1] ? parseInt(match[1], 10) : parseInt(numPart, 10);
    const extractedSuffix = suffix || (match && match[2]) || null;
    return { isSupp, num, suffix: extractedSuffix ? extractedSuffix.toLowerCase() : null };
}
/**
 * Parse a reference list string like "1, 2, and 3" or "1a-c" or "1a-3b"
 * Returns an array of {num, isSupp, suffix} objects
 */
export function parseReferenceList(listStr) {
    const results = [];
    if (!listStr || typeof listStr !== 'string')
        return results;
    // Normalize: replace "and" with comma, normalize dashes
    let normalized = listStr
        .replace(/\s+and\s+/gi, ', ')
        .replace(/[–—]/g, '-') // en-dash, em-dash → hyphen
        .replace(/&/g, ', '); // & → comma
    // Split by comma (but not by dash, which indicates ranges)
    const parts = normalized.split(/\s*,\s*/).filter((p) => p.trim());
    let lastFullRef = null; // Track the last full reference for implicit prefixes
    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed)
            continue;
        // Check if this is a range (contains -)
        if (trimmed.includes('-')) {
            const parts = trimmed.split('-').map((s) => s.trim());
            const start = parts[0] || '';
            const end = parts[1] || '';
            // Check if end is just a letter (e.g., "1a-c" where end is "c")
            const endIsLetterOnly = /^[a-z]$/i.test(end);
            const startRef = parseRefNumber(start);
            // For letter-only end, don't parse as number
            const endRef = endIsLetterOnly
                ? { num: startRef.num, isSupp: startRef.isSupp, suffix: end.toLowerCase() }
                : parseRefNumber(end);
            // Handle different range types:
            // 1. Suffix-only range on same number: "1a-c" → 1a, 1b, 1c
            // 2. Number range: "1-3" → 1, 2, 3
            // 3. Cross-number suffix range: "1a-3b" → 1a...1z, 2a...2z, 3a, 3b (limited)
            if (startRef.suffix && endRef.suffix && startRef.num !== endRef.num) {
                // Cross-number suffix range: "1a-3b"
                // For academic papers, limit intermediate figures to same suffix range
                // e.g., "1a-3b" typically means 1a, 1b, 2a, 2b, 3a, 3b
                const maxSuffix = Math.max(startRef.suffix.charCodeAt(0), endRef.suffix.charCodeAt(0));
                for (let n = startRef.num; n <= endRef.num; n++) {
                    const suffixStart = n === startRef.num ? startRef.suffix.charCodeAt(0) : 'a'.charCodeAt(0);
                    const suffixEnd = n === endRef.num ? endRef.suffix.charCodeAt(0) : maxSuffix;
                    for (let s = suffixStart; s <= suffixEnd; s++) {
                        results.push({
                            num: n,
                            isSupp: startRef.isSupp,
                            suffix: String.fromCharCode(s),
                        });
                    }
                }
                lastFullRef = { num: endRef.num, isSupp: startRef.isSupp };
            }
            else if (startRef.suffix || endRef.suffix) {
                // Suffix range on same number: "1a-c"
                const num = startRef.num !== 0 ? startRef.num : (lastFullRef ? lastFullRef.num : 1);
                const isSupp = startRef.isSupp ? startRef.isSupp : (lastFullRef ? lastFullRef.isSupp : false);
                const startCode = (startRef.suffix || 'a').charCodeAt(0);
                const endCode = (endRef.suffix || 'a').charCodeAt(0);
                for (let code = startCode; code <= endCode; code++) {
                    results.push({
                        num,
                        isSupp,
                        suffix: String.fromCharCode(code),
                    });
                }
                lastFullRef = { num, isSupp };
            }
            else {
                // Pure number range: "1-3"
                for (let n = startRef.num; n <= endRef.num; n++) {
                    results.push({
                        num: n,
                        isSupp: startRef.isSupp,
                        suffix: null,
                    });
                }
                lastFullRef = { num: endRef.num, isSupp: startRef.isSupp };
            }
        }
        else {
            // Single reference or implicit suffix
            // Check if it's just a letter (implicit prefix from previous number)
            if (/^[a-z]$/i.test(trimmed) && lastFullRef) {
                // Implicit prefix: "b" after "1a" means "1b"
                results.push({
                    num: lastFullRef.num,
                    isSupp: lastFullRef.isSupp,
                    suffix: trimmed.toLowerCase(),
                });
            }
            else {
                // Full reference: "1", "1a", "S1", "S1a"
                const ref = parseRefNumber(trimmed);
                results.push(ref);
                lastFullRef = { num: ref.num, isSupp: ref.isSupp };
            }
        }
    }
    return results;
}
/**
 * Build a registry of figure/table labels from .md files
 * Scans for {#fig:label} and {#tbl:label} anchors
 *
 * IMPORTANT: This function requires either explicit sections or a rev.yaml/sections.yaml config.
 * It will NOT guess by scanning all .md files, as this leads to incorrect numbering
 * when temporary files (paper_clean.md, etc.) exist in the directory.
 */
export function buildRegistry(directory, sections) {
    if (typeof directory !== 'string') {
        throw new TypeError(`directory must be a string, got ${typeof directory}`);
    }
    const figures = new Map();
    const tables = new Map();
    const equations = new Map();
    // Counters for numbering (separate for main and supplementary)
    let figNum = 0;
    let figSuppNum = 0;
    let tblNum = 0;
    let tblSuppNum = 0;
    let eqNum = 0;
    let orderedFiles;
    if (Array.isArray(sections) && sections.length > 0) {
        // Use explicitly provided section files - most reliable
        orderedFiles = sections.filter((f) => fs.existsSync(path.join(directory, f)));
    }
    else {
        // Try to determine sections from config files (rev.yaml or sections.yaml)
        orderedFiles = discoverSectionFiles(directory);
        // If no config found, return empty registry rather than guessing
        // This prevents bugs from scanning wrong files
    }
    // Determine if a file is supplementary
    const isSupplementary = (filename) => filename.toLowerCase().includes('supp') || filename.toLowerCase().includes('appendix');
    // Process each file in order
    for (const file of orderedFiles) {
        const filePath = path.join(directory, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const isSupp = isSupplementary(file);
        // Find all anchors
        let match;
        ANCHOR_PATTERN.lastIndex = 0;
        while ((match = ANCHOR_PATTERN.exec(content)) !== null) {
            const typeRaw = match[1];
            const labelRaw = match[2];
            if (!typeRaw || !labelRaw)
                continue;
            const type = typeRaw.toLowerCase();
            const label = labelRaw;
            if (type === 'fig') {
                if (isSupp) {
                    figSuppNum++;
                    figures.set(label, { label, num: figSuppNum, isSupp: true, file });
                }
                else {
                    figNum++;
                    figures.set(label, { label, num: figNum, isSupp: false, file });
                }
            }
            else if (type === 'tbl') {
                if (isSupp) {
                    tblSuppNum++;
                    tables.set(label, { label, num: tblSuppNum, isSupp: true, file });
                }
                else {
                    tblNum++;
                    tables.set(label, { label, num: tblNum, isSupp: false, file });
                }
            }
            else if (type === 'eq') {
                eqNum++;
                equations.set(label, { label, num: eqNum, isSupp: false, file });
            }
        }
    }
    // Build reverse lookup: number → label
    const byNumber = {
        fig: new Map(),
        figS: new Map(),
        tbl: new Map(),
        tblS: new Map(),
        eq: new Map(),
    };
    for (const [label, info] of figures) {
        const key = info.isSupp ? 'figS' : 'fig';
        byNumber[key].set(info.num, label);
    }
    for (const [label, info] of tables) {
        const key = info.isSupp ? 'tblS' : 'tbl';
        byNumber[key].set(info.num, label);
    }
    for (const [label, info] of equations) {
        byNumber.eq.set(info.num, label);
    }
    return { figures, tables, equations, byNumber };
}
/**
 * Get the display string for a label (e.g., "Figure 1", "Table S2")
 */
export function labelToDisplay(type, label, registry) {
    if (!registry || !registry.figures)
        return null;
    const collection = type === 'fig' ? registry.figures : type === 'tbl' ? registry.tables : registry.equations;
    const info = collection.get(label);
    if (!info)
        return null;
    const prefix = type === 'fig' ? 'Figure' : type === 'tbl' ? 'Table' : 'Equation';
    const numStr = info.isSupp ? `S${info.num}` : `${info.num}`;
    return `${prefix} ${numStr}`;
}
/**
 * Get the label for a display number (e.g., "fig:heatmap" from Figure 1)
 */
export function numberToLabel(type, num, isSupp, registry) {
    if (!registry || !registry.byNumber)
        return null;
    const key = isSupp ? `${type}S` : type;
    return registry.byNumber[key]?.get(num) || null;
}
/**
 * Detect all hardcoded references in text
 */
export function detectHardcodedRefs(text) {
    if (typeof text !== 'string') {
        throw new TypeError(`text must be a string, got ${typeof text}`);
    }
    const refs = [];
    for (const [type, pattern] of Object.entries(DETECTION_PATTERNS)) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            // Pattern groups:
            // [1] = type prefix (Figure, Fig., etc.)
            // [2] = reference list string (e.g., "1, 2, and 3" or "1a-3b")
            const listStr = match[2];
            if (!listStr)
                continue;
            const numbers = parseReferenceList(listStr);
            // Skip if no valid numbers were parsed
            if (numbers.length === 0)
                continue;
            refs.push({
                type: normalizeType(type),
                match: match[0],
                numbers,
                position: match.index,
            });
        }
    }
    // Sort by position
    refs.sort((a, b) => a.position - b.position);
    return refs;
}
/**
 * Convert hardcoded references to @-style references
 */
export function convertHardcodedRefs(text, registry) {
    // Input validation delegated to detectHardcodedRefs
    const refs = detectHardcodedRefs(text);
    const conversions = [];
    const warnings = [];
    // Process in reverse order to preserve positions
    let result = text;
    for (let i = refs.length - 1; i >= 0; i--) {
        const ref = refs[i];
        if (!ref)
            continue;
        // Build replacement
        const labels = [];
        for (const { num, isSupp } of ref.numbers) {
            const label = numberToLabel(ref.type, num, isSupp, registry);
            if (label) {
                labels.push(`@${ref.type}:${label}`);
            }
            else {
                const displayNum = isSupp ? `S${num}` : `${num}`;
                warnings.push(`Unknown reference: ${ref.type} ${displayNum} (no matching label)`);
                labels.push(ref.match); // Keep original if no match
            }
        }
        if (labels.length > 0 && !labels.includes(ref.match)) {
            const replacement = labels.join('; ');
            // Skip if the @-syntax already appears in the preceding text
            // This prevents duplication when import restores @fig:x and then we see "Fig. 1"
            // e.g., "@fig:map@fig:map{++@fig:map++}" or "@fig:mapFigure 1" patterns
            const textBefore = result.slice(Math.max(0, ref.position - REF_CONTEXT_WINDOW), ref.position);
            const alreadyHasRef = labels.some((label) => textBefore.includes(label));
            if (alreadyHasRef) {
                continue; // Skip - ref already present nearby
            }
            result =
                result.slice(0, ref.position) + replacement + result.slice(ref.position + ref.match.length);
            conversions.push({
                from: ref.match,
                to: replacement,
            });
        }
    }
    return { converted: result, conversions, warnings };
}
/**
 * Detect @-style references in text
 */
export function detectDynamicRefs(text) {
    if (typeof text !== 'string') {
        throw new TypeError(`text must be a string, got ${typeof text}`);
    }
    const refs = [];
    REF_PATTERN.lastIndex = 0;
    let match;
    while ((match = REF_PATTERN.exec(text)) !== null) {
        const type = match[1];
        const label = match[2];
        if (!type || !label)
            continue;
        refs.push({
            type: type,
            label: label,
            match: match[0],
            position: match.index,
        });
    }
    return refs;
}
/**
 * Get reference status for a file/text
 */
export function getRefStatus(text, registry) {
    const dynamic = detectDynamicRefs(text);
    const hardcoded = detectHardcodedRefs(text);
    // Count anchors in this text
    ANCHOR_PATTERN.lastIndex = 0;
    let figCount = 0, tblCount = 0, eqCount = 0;
    let match;
    while ((match = ANCHOR_PATTERN.exec(text)) !== null) {
        const type = match[1];
        if (!type)
            continue;
        if (type === 'fig')
            figCount++;
        else if (type === 'tbl')
            tblCount++;
        else if (type === 'eq')
            eqCount++;
    }
    return {
        dynamic,
        hardcoded,
        anchors: { figures: figCount, tables: tblCount, equations: eqCount },
    };
}
/**
 * Detect forward references in combined text
 * A forward reference is a @ref that appears before its {#anchor} definition
 */
export function detectForwardRefs(text) {
    // Build map of anchor positions: "fig:label" -> position
    const anchorPositions = new Map();
    ANCHOR_PATTERN.lastIndex = 0;
    let match;
    while ((match = ANCHOR_PATTERN.exec(text)) !== null) {
        const type = match[1];
        const label = match[2];
        if (!type || !label)
            continue;
        const key = `${type}:${label}`;
        // Only store first occurrence (in case of duplicates)
        if (!anchorPositions.has(key)) {
            anchorPositions.set(key, match.index);
        }
    }
    // Find all references
    const refs = detectDynamicRefs(text);
    // Filter to only forward references
    const forwardRefs = refs.filter((ref) => {
        const key = `${ref.type}:${ref.label}`;
        const anchorPos = anchorPositions.get(key);
        // Forward ref if anchor doesn't exist or appears after the reference
        return anchorPos === undefined || ref.position < anchorPos;
    });
    return { forwardRefs, anchorPositions };
}
/**
 * Resolve forward references to display format
 * Only resolves refs that appear before their anchor definition
 * Leaves other refs for pandoc-crossref to handle (preserves clickable links)
 */
export function resolveForwardRefs(text, registry) {
    const { forwardRefs } = detectForwardRefs(text);
    const resolved = [];
    const unresolved = [];
    // Process in reverse order to preserve positions
    let result = text;
    for (let i = forwardRefs.length - 1; i >= 0; i--) {
        const ref = forwardRefs[i];
        if (!ref)
            continue;
        const display = labelToDisplay(ref.type, ref.label, registry);
        if (display) {
            result =
                result.slice(0, ref.position) + display + result.slice(ref.position + ref.match.length);
            resolved.push({
                from: ref.match,
                to: display,
                position: ref.position,
            });
        }
        else {
            unresolved.push({
                ref: ref.match,
                position: ref.position,
            });
        }
    }
    return { text: result, resolved, unresolved };
}
/**
 * Resolve ALL supplementary references and strip supplementary anchor labels.
 *
 * pandoc-crossref cannot produce "Figure S1" numbering — it numbers all figures
 * sequentially. This function resolves every @fig:label / @tbl:label that points
 * to a supplementary item to plain text ("Figure S1", "Table S1") and removes
 * the {#fig:label} / {#tbl:label} attributes so pandoc-crossref ignores them.
 */
export function resolveSupplementaryRefs(text, registry) {
    const resolved = [];
    let result = text;
    // Collect supplementary labels
    const suppLabels = new Set();
    for (const [label, info] of registry.figures) {
        if (info.isSupp)
            suppLabels.add(`fig:${label}`);
    }
    for (const [label, info] of registry.tables) {
        if (info.isSupp)
            suppLabels.add(`tbl:${label}`);
    }
    if (suppLabels.size === 0)
        return { text: result, resolved };
    // 1. Replace all @fig:label / @tbl:label references to supplementary items
    const refs = detectDynamicRefs(result);
    // Process in reverse to preserve positions
    for (let i = refs.length - 1; i >= 0; i--) {
        const ref = refs[i];
        if (!ref)
            continue;
        const key = `${ref.type}:${ref.label}`;
        if (!suppLabels.has(key))
            continue;
        const display = labelToDisplay(ref.type, ref.label, registry);
        if (display) {
            result =
                result.slice(0, ref.position) + display + result.slice(ref.position + ref.match.length);
            resolved.push({ from: ref.match, to: display });
        }
    }
    // 2. Strip {#fig:label} and {#tbl:label} attributes from supplementary anchors
    //    so pandoc-crossref does not re-number them
    for (const key of suppLabels) {
        // Match {#fig:label ...} or just {#fig:label}
        const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`\\{#${escaped}(?:\\s[^}]*)?\\}`, 'g');
        result = result.replace(pattern, (match) => {
            resolved.push({ from: match, to: '(stripped)' });
            return '';
        });
    }
    return { text: result, resolved };
}
/**
 * Format registry for display
 */
export function formatRegistry(registry) {
    const lines = [];
    if (registry.figures.size > 0) {
        lines.push('Figures:');
        for (const [label, info] of registry.figures) {
            const num = info.isSupp ? `S${info.num}` : info.num;
            lines.push(`  Figure ${num}: @fig:${label} (${info.file})`);
        }
    }
    if (registry.tables.size > 0) {
        if (lines.length > 0)
            lines.push('');
        lines.push('Tables:');
        for (const [label, info] of registry.tables) {
            const num = info.isSupp ? `S${info.num}` : info.num;
            lines.push(`  Table ${num}: @tbl:${label} (${info.file})`);
        }
    }
    if (registry.equations.size > 0) {
        if (lines.length > 0)
            lines.push('');
        lines.push('Equations:');
        for (const [label, info] of registry.equations) {
            lines.push(`  Equation ${info.num}: @eq:${label} (${info.file})`);
        }
    }
    if (lines.length === 0) {
        lines.push('No figure/table anchors found.');
    }
    return lines.join('\n');
}
//# sourceMappingURL=crossref.js.map