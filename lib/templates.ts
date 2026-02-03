/**
 * Built-in templates for project scaffolding
 *
 * Used by `rev new` command to create new paper projects
 */

interface TemplateDefinition {
  name: string;
  description: string;
  files: Record<string, string>;
  directories: string[];
}

export const TEMPLATES: Record<string, TemplateDefinition> = {
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
   * LaTeX-focused project with direct .tex output
   */
  latex: {
    name: 'LaTeX Project',
    description: 'LaTeX-native with journal template support',
    files: {
      'rev.yaml': `# LaTeX Paper Configuration
title: "Paper Title"
authors:
  - name: First Author
    affiliation: University
    email: author@example.edu
    orcid: 0000-0000-0000-0000

sections:
  - introduction.md
  - methods.md
  - results.md
  - discussion.md

bibliography: references.bib
csl: null

# LaTeX-specific settings
pdf:
  documentclass: article
  classoption: [11pt, a4paper]
  fontsize: 11pt
  geometry: "margin=2.5cm"
  linestretch: 1.5
  numbersections: true
  header-includes: |
    \\usepackage{amsmath}
    \\usepackage{graphicx}
    \\usepackage{booktabs}
    \\usepackage{hyperref}
    \\usepackage{natbib}

# TEX output settings
tex:
  standalone: true
  keep-tex: true
`,
      'introduction.md': `# Introduction

Background and motivation.

## Objectives

State your research questions.

`,
      'methods.md': `# Materials and Methods

## Study Area

Describe the study area or data sources.

## Statistical Analysis

All analyses were performed in R [@R2024].

`,
      'results.md': `# Results

Main findings presented here.

![Caption for figure](figures/fig1.pdf){#fig:main width=100%}

See @fig:main for the main results.

| Variable | Value | SE |
|----------|-------|------|
| A | 1.23 | 0.05 |
| B | 4.56 | 0.12 |

: Summary statistics {#tbl:summary}

`,
      'discussion.md': `# Discussion

Interpretation of findings.

## Limitations

Study limitations.

## Conclusions

Key takeaways.

`,
      'references.bib': `@Manual{R2024,
  title = {R: A Language and Environment for Statistical Computing},
  author = {{R Core Team}},
  organization = {R Foundation for Statistical Computing},
  address = {Vienna, Austria},
  year = {2024},
  url = {https://www.R-project.org/}
}
`,
      '.gitignore': `# Build outputs
*.pdf
*.docx
paper.md
.paper-*.md

# Keep .tex for version control
# *.tex

# LaTeX auxiliary files
*.aux
*.bbl
*.blg
*.log
*.out
*.toc
*.fdb_latexmk
*.fls
*.synctex.gz

# System
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
 */
export function getTemplate(name: string): TemplateDefinition | null {
  return TEMPLATES[name.toLowerCase()] || null;
}

/**
 * List available templates
 */
export function listTemplates(): Array<{ id: string; name: string; description: string }> {
  return Object.entries(TEMPLATES).map(([id, template]) => ({
    id,
    name: template.name,
    description: template.description,
  }));
}

/**
 * Convert string to title case for headers
 */
function titleCase(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Generate a custom template with specified sections
 */
export function generateCustomTemplate(
  sections: string[],
  baseTemplate?: TemplateDefinition
): TemplateDefinition {
  const base = baseTemplate || TEMPLATES.paper;
  const files: Record<string, string> = {};

  // Generate rev.yaml with custom sections
  const sectionsList = sections.map((s) => `  - ${s}.md`).join('\n');
  files['rev.yaml'] = `# Paper configuration
title: "Your Paper Title"
authors:
  - name: First Author
    affiliation: Institution
    email: author@example.com

# Section files in order
sections:
${sectionsList}

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
`;

  // Generate section files
  for (const section of sections) {
    const header = titleCase(section);
    files[`${section}.md`] = `# ${header}

`;
  }

  // Add common files
  files['references.bib'] = base.files['references.bib'] || '';
  files['.gitignore'] = base.files['.gitignore'] || `# Build outputs
*.pdf
*.docx
*.tex
paper.md
.paper-*.md

# System
.DS_Store
`;

  return {
    name: 'Custom',
    description: 'Custom sections',
    files,
    directories: base.directories || ['figures'],
  };
}
