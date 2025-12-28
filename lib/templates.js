/**
 * Built-in templates for project scaffolding
 *
 * Used by `rev new` command to create new paper projects
 */

export const TEMPLATES = {
  /**
   * Standard academic paper structure
   */
  paper: {
    name: 'Academic Paper',
    description: 'Standard paper with introduction, methods, results, discussion',
    files: {
      'rev.yaml': `# Paper configuration
title: "Your Paper Title"
authors:
  - name: First Author
    affiliation: Institution
    email: author@example.com

# Section files in order
sections:
  - introduction.md
  - methods.md
  - results.md
  - discussion.md

# Bibliography (optional)
bibliography: references.bib
csl: null  # uses default CSL

# Cross-reference settings
crossref:
  figureTitle: Figure
  tableTitle: Table
  figPrefix: [Fig., Figs.]
  tblPrefix: [Table, Tables]
  linkReferences: true

# PDF output settings
pdf:
  documentclass: article
  fontsize: 12pt
  geometry: margin=1in
  linestretch: 1.5
  numbersections: false

# Word output settings
docx:
  reference: null  # path to reference.docx template
  keepComments: true
`,
      'introduction.md': `# Introduction

Your introduction goes here. Use dynamic figure references like @fig:example.

`,
      'methods.md': `# Methods

## Study Design

Describe your methodology here.

## Data Analysis

Reference tables with @tbl:summary.

`,
      'results.md': `# Results

Present your findings. See @fig:results for the main analysis.

![Example figure caption](figures/placeholder.png){#fig:results}

`,
      'discussion.md': `# Discussion

Interpret your results here.

## Conclusions

Summarize key findings.

`,
      'references.bib': `@article{example2024,
  author = {Author, A. and Coauthor, B.},
  title = {An Example Paper Title},
  journal = {Journal Name},
  year = {2024},
  volume = {1},
  pages = {1--10}
}
`,
      '.gitignore': `# Build outputs
*.pdf
*.docx
*.tex
paper.md
.paper-*.md

# System
.DS_Store
`,
    },
    directories: ['figures'],
  },

  /**
   * Minimal single-section document
   */
  minimal: {
    name: 'Minimal',
    description: 'Single document with basic config',
    files: {
      'rev.yaml': `title: "Document Title"
authors: []
sections:
  - content.md
`,
      'content.md': `# Your Document

Write your content here.

`,
    },
    directories: [],
  },

  /**
   * Thesis chapter structure
   */
  thesis: {
    name: 'Thesis Chapter',
    description: 'Thesis-style with abstract, sections, appendix',
    files: {
      'rev.yaml': `title: "Chapter Title"
authors:
  - name: Your Name
    affiliation: University

sections:
  - abstract.md
  - introduction.md
  - literature.md
  - methods.md
  - results.md
  - discussion.md
  - conclusion.md
  - appendix.md

bibliography: references.bib

pdf:
  documentclass: report
  fontsize: 11pt
  geometry: "margin=1in"
  linestretch: 2
  numbersections: true
`,
      'abstract.md': `# Abstract

Brief summary of the chapter (150-300 words).

`,
      'introduction.md': `# Introduction

Background and research questions.

`,
      'literature.md': `# Literature Review

Review of relevant prior work.

`,
      'methods.md': `# Materials and Methods

Detailed methodology.

`,
      'results.md': `# Results

Findings and analysis.

`,
      'discussion.md': `# Discussion

Interpretation of results.

`,
      'conclusion.md': `# Conclusion

Summary and implications.

`,
      'appendix.md': `# Appendix

## Supplementary Materials

Additional details here.

`,
      'references.bib': ``,
      '.gitignore': `*.pdf
*.docx
*.tex
paper.md
.paper-*.md
.DS_Store
`,
    },
    directories: ['figures', 'tables'],
  },

  /**
   * Review article structure
   */
  review: {
    name: 'Review Article',
    description: 'Literature review or synthesis paper',
    files: {
      'rev.yaml': `title: "Review Title"
authors:
  - name: Author Name
    affiliation: Institution

sections:
  - introduction.md
  - section1.md
  - section2.md
  - section3.md
  - synthesis.md
  - conclusion.md

bibliography: references.bib

crossref:
  figureTitle: Figure
  tableTitle: Table
  figPrefix: [Fig., Figs.]
  tblPrefix: [Table, Tables]
`,
      'introduction.md': `# Introduction

Scope and objectives of the review.

`,
      'section1.md': `# Theme One

First major theme or topic.

`,
      'section2.md': `# Theme Two

Second major theme.

`,
      'section3.md': `# Theme Three

Third major theme.

`,
      'synthesis.md': `# Synthesis

Integration of themes and emerging patterns.

`,
      'conclusion.md': `# Conclusion and Future Directions

Key takeaways and research gaps.

`,
      'references.bib': ``,
      '.gitignore': `*.pdf
*.docx
*.tex
paper.md
.paper-*.md
.DS_Store
`,
    },
    directories: ['figures'],
  },
};

/**
 * Get template by name
 * @param {string} name
 * @returns {object|null}
 */
export function getTemplate(name) {
  return TEMPLATES[name.toLowerCase()] || null;
}

/**
 * List available templates
 * @returns {Array<{id: string, name: string, description: string}>}
 */
export function listTemplates() {
  return Object.entries(TEMPLATES).map(([id, template]) => ({
    id,
    name: template.name,
    description: template.description,
  }));
}
