/**
 * PDF comment rendering for dual export
 *
 * Converts CriticMarkup comments to LaTeX margin notes for PDF output
 */

/**
 * LaTeX preamble for margin comments
 * Uses todonotes package with custom styling
 */
export const MARGIN_NOTES_PREAMBLE = `
% Margin notes for comments
\\usepackage[colorinlistoftodos,textsize=scriptsize]{todonotes}
\\usepackage{xcolor}

% Define comment colors by author
\\definecolor{commentblue}{RGB}{59, 130, 246}
\\definecolor{commentgreen}{RGB}{34, 197, 94}
\\definecolor{commentorange}{RGB}{249, 115, 22}
\\definecolor{commentpurple}{RGB}{168, 85, 247}
\\definecolor{commentgray}{RGB}{107, 114, 128}

% Custom margin note command
\\newcommand{\\margincomment}[2][]{%
  \\todo[linecolor=commentblue,backgroundcolor=commentblue!10,bordercolor=commentblue,size=\\scriptsize,#1]{#2}%
}

% Author-specific commands
\\newcommand{\\reviewercomment}[2]{%
  \\todo[linecolor=commentgreen,backgroundcolor=commentgreen!10,bordercolor=commentgreen,size=\\scriptsize]{\\textbf{#1:} #2}%
}

% Increase margin for notes (if needed)
% \\setlength{\\marginparwidth}{2.5cm}
`;

/**
 * Simpler preamble using marginpar (no extra packages needed)
 */
export const SIMPLE_MARGIN_PREAMBLE = `
% Simple margin notes for comments
\\usepackage{xcolor}
\\definecolor{commentcolor}{RGB}{59, 130, 246}

\\newcommand{\\margincomment}[1]{%
  \\marginpar{\\raggedright\\scriptsize\\textcolor{commentcolor}{#1}}%
}
`;

/**
 * Convert CriticMarkup comments to LaTeX margin notes
 * {>>Author: comment text<<} -> \margincomment{Author: comment text}
 *
 * @param {string} markdown - Markdown with CriticMarkup comments
 * @param {object} options - { useTodonotes: boolean, stripResolved: boolean }
 * @returns {{markdown: string, commentCount: number, preamble: string}}
 */
export function convertCommentsToMarginNotes(markdown, options = {}) {
  const { useTodonotes = true, stripResolved = true } = options;

  let commentCount = 0;

  // Pattern for CriticMarkup comments: {>>author: text<<} or {>>text<<}
  // Also handle resolved comments: {>>✓ author: text<<}
  const commentPattern = /\{>>(✓\s*)?([^<]+)<<\}/g;

  const converted = markdown.replace(commentPattern, (match, resolved, content) => {
    // Skip resolved comments if requested
    if (resolved && stripResolved) {
      return '';
    }

    commentCount++;

    // Escape LaTeX special characters
    const escaped = escapeLatex(content.trim());

    if (useTodonotes) {
      // Check if content has author prefix (Author: text)
      const authorMatch = escaped.match(/^([^:]+):\s*(.+)$/s);
      if (authorMatch) {
        const [, author, text] = authorMatch;
        return `\\reviewercomment{${author}}{${text}}`;
      }
      return `\\margincomment{${escaped}}`;
    } else {
      return `\\margincomment{${escaped}}`;
    }
  });

  const preamble = useTodonotes ? MARGIN_NOTES_PREAMBLE : SIMPLE_MARGIN_PREAMBLE;

  return {
    markdown: converted,
    commentCount,
    preamble,
  };
}

/**
 * Escape LaTeX special characters
 * @param {string} text
 * @returns {string}
 */
function escapeLatex(text) {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([#$%&_{}])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\n/g, ' ');  // Replace newlines with spaces
}

/**
 * Convert track changes to visible LaTeX formatting
 * {++inserted++} -> \textcolor{green}{inserted}
 * {--deleted--} -> \textcolor{red}{\sout{deleted}}
 * {~~old~>new~~} -> \textcolor{red}{\sout{old}}\textcolor{green}{new}
 *
 * @param {string} markdown
 * @returns {{markdown: string, preamble: string}}
 */
export function convertTrackChangesToLatex(markdown) {
  let result = markdown;

  // Insertions: {++text++} -> green text
  result = result.replace(/\{\+\+([^+]+)\+\+\}/g, (match, text) => {
    return `\\textcolor{green}{${escapeLatex(text)}}`;
  });

  // Deletions: {--text--} -> red strikethrough
  result = result.replace(/\{--([^-]+)--\}/g, (match, text) => {
    return `\\textcolor{red}{\\sout{${escapeLatex(text)}}}`;
  });

  // Substitutions: {~~old~>new~~} -> red strikethrough + green new
  result = result.replace(/\{~~([^~]+)~>([^~]+)~~\}/g, (match, oldText, newText) => {
    return `\\textcolor{red}{\\sout{${escapeLatex(oldText)}}}\\textcolor{green}{${escapeLatex(newText)}}`;
  });

  const preamble = `
% Track changes visualization
\\usepackage{xcolor}
\\usepackage[normalem]{ulem}
\\definecolor{green}{RGB}{34, 197, 94}
\\definecolor{red}{RGB}{239, 68, 68}
`;

  return { markdown: result, preamble };
}

/**
 * Get combined preamble for comments and track changes
 * @param {object} options - { comments: boolean, trackChanges: boolean, useTodonotes: boolean }
 * @returns {string}
 */
export function getCombinedPreamble(options = {}) {
  const { comments = true, trackChanges = false, useTodonotes = true } = options;

  let preamble = '';

  if (comments) {
    preamble += useTodonotes ? MARGIN_NOTES_PREAMBLE : SIMPLE_MARGIN_PREAMBLE;
  }

  if (trackChanges) {
    preamble += `
% Track changes visualization
\\usepackage[normalem]{ulem}
`;
    if (!comments) {
      preamble += `\\usepackage{xcolor}\n`;
    }
    preamble += `
\\definecolor{insertgreen}{RGB}{34, 197, 94}
\\definecolor{deletered}{RGB}{239, 68, 68}
`;
  }

  return preamble;
}

/**
 * Prepare markdown for PDF with visible comments
 * Converts comments to margin notes and optionally shows track changes
 *
 * @param {string} markdown
 * @param {object} options - { showTrackChanges: boolean, useTodonotes: boolean }
 * @returns {{markdown: string, preamble: string, commentCount: number}}
 */
export function prepareMarkdownForAnnotatedPdf(markdown, options = {}) {
  const { showTrackChanges = false, useTodonotes = true, stripResolved = true } = options;

  let result = markdown;
  let preamble = '';
  let commentCount = 0;

  // Convert comments to margin notes
  const commentResult = convertCommentsToMarginNotes(result, { useTodonotes, stripResolved });
  result = commentResult.markdown;
  commentCount = commentResult.commentCount;
  preamble += commentResult.preamble;

  // Optionally show track changes
  if (showTrackChanges) {
    const trackResult = convertTrackChangesToLatex(result);
    result = trackResult.markdown;
    // Add ulem package if not already in todonotes preamble
    if (!useTodonotes) {
      preamble += trackResult.preamble;
    } else {
      preamble += `\\usepackage[normalem]{ulem}\n`;
    }
  }

  return { markdown: result, preamble, commentCount };
}
