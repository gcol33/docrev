# docrev

[![npm](https://img.shields.io/npm/v/docrev)](https://www.npmjs.com/package/docrev)
[![CI](https://github.com/gcol33/docrev/actions/workflows/ci.yml/badge.svg)](https://github.com/gcol33/docrev/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/node/v/docrev)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CLI tool for Word ↔ Markdown round-trips. Handle reviewer feedback on academic papers: import track changes, review interactively, manage comments, validate DOIs, and build to PDF/DOCX/LaTeX.

## Install

```bash
npm install -g docrev
```

The `rev` command is now available globally.

### Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **Pandoc** - For building PDF/DOCX ([pandoc.org](https://pandoc.org/installing.html))
- **pandoc-crossref** - For figure/table refs (optional, [install](https://github.com/lierdakil/pandoc-crossref/releases))

```bash
# macOS
brew install pandoc pandoc-crossref

# Ubuntu/Debian
sudo apt install pandoc

# Windows
winget install JohnMacFarlane.Pandoc
```

Verify installation:
```bash
rev --version
rev install    # Check for missing dependencies
```

### Shell Completions (Optional)

Enable tab completion for `rev` commands:

```bash
# Bash - add to ~/.bashrc
eval "$(rev completions bash)"

# Zsh - add to ~/.zshrc
eval "$(rev completions zsh)"
```

## Features

- **Integrated build system** - Combine sections → paper.md → PDF, DOCX, or LaTeX
- **Import from Word** - Diff Word docs against your Markdown, generating CriticMarkup annotations
- **Section-aware import** - Import directly to modular section files (intro.md, methods.md, etc.)
- **Interactive review** - Accept/reject track changes with a TUI
- **Comment management** - List, filter, resolve, and reply to reviewer comments
- **Response letter generation** - Auto-generate point-by-point response from comments
- **DOI validation** - Check and find DOIs via Crossref/DataCite APIs
- **Cross-reference conversion** - Auto-convert "Figures 1-3" to `@fig:label` syntax (handles complex patterns)
- **Equation extraction** - Extract LaTeX equations from Word documents (OMML → LaTeX)
- **Citation validation** - Check citations against bibliography

## Quick Start

### Start from Word Document

```bash
# Import existing Word doc → creates section files + rev.yaml
rev import manuscript.docx

# Import to specific directory
rev import manuscript.docx -o my-paper/

# Preview without creating files
rev import manuscript.docx --dry-run
```

### New Project from Template

```bash
# Create a new paper project
rev new my-paper

# or with a specific template
rev new my-thesis --template thesis

# List available templates
rev new --list
```

### Build Workflow

```bash
cd my-paper

# Edit your sections
# introduction.md, methods.md, results.md, discussion.md

# Build PDF and Word
rev build

# Build specific format
rev build pdf
rev build docx
rev build tex
rev build all    # PDF + DOCX + TEX
```

### Review Workflow

```bash
# Import reviewer's Word doc to section files
rev sections reviewed.docx

# Review track changes interactively
rev review methods.md

# See remaining comments
rev comments methods.md

# Rebuild
rev build docx
```

## Commands

### Build & Create

| Command | Description |
|---------|-------------|
| `rev build [formats...]` | Build PDF/DOCX/TEX from sections |
| `rev build --toc` | Build with table of contents |
| `rev build --show-changes` | Export DOCX with visible track changes |
| `rev new <name>` | Create new project from template |
| `rev new --list` | List available templates |
| `rev install` | Check/install dependencies (pandoc-crossref) |

### Import & Export

| Command | Description |
|---------|-------------|
| `rev import <docx>` | Bootstrap project from Word (creates sections + rev.yaml) |
| `rev import <docx> <md>` | Import changes by diffing Word against your MD |
| `rev sections <docx>` | Import Word doc to existing section files |
| `rev extract <docx>` | Extract plain text from Word |

### Review & Edit

| Command | Description |
|---------|-------------|
| `rev review <file>` | Interactive accept/reject TUI for track changes |
| `rev status <file>` | Show annotation counts |
| `rev comments <file>` | List all comments with context |
| `rev comments <file> --export comments.csv` | Export comments to CSV |
| `rev resolve <file> -n 1` | Mark comment #1 as resolved |
| `rev strip <file>` | Output clean Markdown (annotations applied) |

### Cross-References

| Command | Description |
|---------|-------------|
| `rev refs [file]` | Show figure/table registry and reference status |
| `rev migrate <file>` | Convert hardcoded refs (Fig. 1) to dynamic (@fig:label) |

### Comments & Replies

| Command | Description |
|---------|-------------|
| `rev config user "Name"` | Set your name for replies |
| `rev reply <file>` | Interactive reply to reviewer comments |
| `rev reply <file> -n 1 -m "text"` | Reply to specific comment (non-interactive) |

### Bibliography & DOIs

| Command | Description |
|---------|-------------|
| `rev doi check [file.bib]` | Validate DOIs in bibliography (Crossref + DataCite) |
| `rev doi lookup [file.bib]` | Search for missing DOIs by title/author/year |
| `rev doi fetch <doi>` | Fetch BibTeX entry from DOI |
| `rev doi add <doi>` | Fetch and add DOI entry to bibliography |

### Validation & Analysis

| Command | Description |
|---------|-------------|
| `rev citations [file.bib]` | Validate citations against bibliography |
| `rev figures [file]` | List figures/tables with reference counts |
| `rev equations list` | List all equations in section files |
| `rev equations from-word <docx>` | Extract equations from Word to LaTeX |
| `rev response [files]` | Generate response letter from comments |
| `rev anonymize <file>` | Prepare document for blind review |
| `rev validate --journal <name>` | Check manuscript against journal requirements |
| `rev validate --list` | List available journal profiles |

### Multi-Reviewer & Git

| Command | Description |
|---------|-------------|
| `rev merge <md> <docx...>` | Merge feedback from multiple Word documents |
| `rev diff [ref]` | Compare sections against git history |
| `rev history [file]` | Show revision history for sections |

### Configuration

| Command | Description |
|---------|-------------|
| `rev init` | Generate sections.yaml from existing .md files |
| `rev split <file>` | Split annotated paper.md back to section files |
| `rev help [topic]` | Show help (topics: workflow, syntax, commands) |

### Convenience Commands

| Command | Description |
|---------|-------------|
| `rev word-count` | Show word counts per section |
| `rev word-count -j <journal>` | Warn if over journal word limit |
| `rev stats` | Project dashboard (words, figures, citations) |
| `rev search <query>` | Search across all section files |
| `rev backup` | Create timestamped backup zip |
| `rev export` | Export project as distributable zip |
| `rev preview <format>` | Build and open document |
| `rev watch [format]` | Auto-rebuild on file changes |
| `rev lint` | Check for broken refs, missing citations |

### Grammar & Style

| Command | Description |
|---------|-------------|
| `rev grammar` | Check grammar/style issues |
| `rev grammar --rules` | List available grammar rules |
| `rev grammar --learn <word>` | Add word to custom dictionary |
| `rev grammar --list` | Show custom dictionary |

### Spelling

| Command | Description |
|---------|-------------|
| `rev spelling` | Check spelling in all sections |
| `rev spelling --british` | Use British English dictionary |
| `rev spelling --learn <word>` | Add word to global dictionary |
| `rev spelling --learn-project <word>` | Add word to project dictionary |
| `rev spelling --list` | Show global dictionary |
| `rev spelling --list-all` | Show global + project dictionaries |

### Direct DOCX Editing

| Command | Description |
|---------|-------------|
| `rev annotate <docx>` | Add comments to Word document |
| `rev apply <md> <docx>` | Apply annotations as track changes |
| `rev comment <docx>` | Interactive comment mode |

## Project Structure

A typical rev project:

```
my-paper/
├── rev.yaml           # Project config (title, authors, build settings)
├── introduction.md    # Section files
├── methods.md
├── results.md
├── discussion.md
├── references.bib     # Bibliography
├── figures/           # Images
├── paper.md           # Combined output (generated)
├── my-paper.pdf       # PDF output (generated)
└── my-paper.docx      # Word output (generated)
```

## Configuration (rev.yaml)

```yaml
title: "Your Paper Title"
authors:
  - name: First Author
    affiliation: Institution
    email: author@example.com

sections:
  - introduction.md
  - methods.md
  - results.md
  - discussion.md

bibliography: references.bib
csl: nature.csl           # Optional citation style

crossref:
  figureTitle: Figure
  tableTitle: Table
  figPrefix: [Fig., Figs.]
  tblPrefix: [Table, Tables]

pdf:
  documentclass: article
  fontsize: 12pt
  geometry: margin=1in
  linestretch: 1.5
  toc: false                 # Table of contents

docx:
  reference: template.docx   # Optional reference doc
  keepComments: true
  toc: false                 # Table of contents
```

## Annotation Syntax (CriticMarkup)

```markdown
{++inserted text++}      # Insertions
{--deleted text--}       # Deletions
{~~old~>new~~}           # Substitutions
{>>Author: comment<<}    # Comments
```

## Template Variables

Use template variables in section files (processed during build):

```markdown
Last updated: {{date}}
Version: {{version}}
Word count: {{word_count}}
```

| Variable | Description |
|----------|-------------|
| `{{date}}` | Current date (YYYY-MM-DD) |
| `{{date:MMMM D, YYYY}}` | Custom format (December 29, 2025) |
| `{{year}}` | Current year |
| `{{version}}` | Version from rev.yaml |
| `{{title}}` | Document title |
| `{{author}}` | First author name |
| `{{authors}}` | All authors (comma-separated) |
| `{{word_count}}` | Total word count |

## Comment Replies

Reply to reviewer comments with your name:

```bash
# Set your name (once)
rev config user "Gilles Colling"

# Interactive: go through each comment
rev reply methods.md

# Non-interactive: reply to specific comment
rev reply methods.md -n 1 -m "Done, added clarification"
```

Creates a conversation thread:
```markdown
{>>Reviewer: Please clarify this<<} {>>Gilles Colling: Added in next paragraph<<}
```

Claude can also reply programmatically using the non-interactive mode.

## Cross-Reference System

Use dynamic references in your source:

```markdown
![Caption](figures/img.png){#fig:heatmap}

See @fig:heatmap for the results.
```

When importing from Word, hardcoded refs are auto-converted:
- `Figure 1` → `@fig:heatmap`
- `Fig. 2a` → `@fig:model`
- `Figs. 1-3` → `@fig:heatmap; @fig:model; @fig:hierarchy`
- `Figures 1, 2, and 3` → `@fig:one; @fig:two; @fig:three`
- `Fig. 1a-c` → `@fig:one` (expands letter suffixes)
- `Figs. 1a-3b` → all panels from 1a to 3b

## Build Outputs

| Format | Annotations | Cross-refs |
|--------|-------------|------------|
| PDF | Stripped (clean) | `@fig:label` → "Figure 1" |
| DOCX | Comments kept | `@fig:label` → "Figure 1" |
| TEX | Stripped (clean) | LaTeX labels |

## DOI Management

Check and find DOIs for your bibliography:

```bash
# Validate all DOIs in references.bib
rev doi check references.bib

# Look up missing DOIs automatically
rev doi lookup references.bib --confidence medium

# Fetch BibTeX from a DOI
rev doi fetch 10.1038/nature12373

# Add a citation by DOI
rev doi add 10.1038/nature12373
```

**Features:**
- Validates DOIs via Crossref API (+ DataCite for Zenodo/Figshare)
- Smart lookup using title, author, year, and journal matching
- Filters out supplement/figure DOIs and F1000 reviews
- Confidence levels: `high`, `medium`, `low` (use `--confidence low` to see all matches)
- Skip entries with `nodoi = {true}` or `% no-doi` comment

## Dependencies

- Node.js 18+
- [Pandoc](https://pandoc.org/) - Document conversion
- [pandoc-crossref](https://github.com/lierdakil/pandoc-crossref) - Cross-references (optional but recommended)
- [mammoth](https://github.com/mwilliamson/mammoth.js) - Word document parsing
- [diff](https://github.com/kpdecker/jsdiff) - Text diffing

## License

MIT
