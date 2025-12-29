# rev

![Stability: Experimental](https://img.shields.io/badge/stability-experimental-orange.svg)
![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)

CLI tool for Word ↔ Markdown round-trips. Handle reviewer feedback on academic papers: import track changes, review interactively, manage comments, auto-convert figure/table references, and build to PDF/DOCX/LaTeX.

## Features

- **Integrated build system** - Combine sections → paper.md → PDF, DOCX, or LaTeX
- **Import from Word** - Diff Word docs against your Markdown, generating CriticMarkup annotations
- **Section-aware import** - Import directly to modular section files (intro.md, methods.md, etc.)
- **Interactive review** - Accept/reject track changes with a TUI
- **Comment management** - List and filter reviewer comments
- **Cross-reference conversion** - Auto-convert hardcoded "Figure 1" to dynamic `@fig:label` syntax

## Install

### Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **Pandoc** - Document conversion engine
- **pandoc-crossref** - Cross-reference filter (optional but recommended)

### macOS

```bash
# Install prerequisites via Homebrew
brew install node pandoc pandoc-crossref

# Clone and install rev
git clone https://github.com/gcol33/rev.git
cd rev
npm install

# Add alias to ~/.zshrc
echo 'alias rev="node $HOME/path/to/rev/bin/rev.js"' >> ~/.zshrc
source ~/.zshrc

# Verify installation
rev --version
```

### Linux (Ubuntu/Debian)

```bash
# Install Node.js (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Pandoc
sudo apt-get install pandoc

# Install pandoc-crossref (download from GitHub releases)
# https://github.com/lierdakil/pandoc-crossref/releases
wget https://github.com/lierdakil/pandoc-crossref/releases/download/v0.3.17.0/pandoc-crossref-Linux.tar.xz
tar -xf pandoc-crossref-Linux.tar.xz
sudo mv pandoc-crossref /usr/local/bin/

# Clone and install rev
git clone https://github.com/gcol33/rev.git
cd rev
npm install

# Add alias to ~/.bashrc
echo 'alias rev="node $HOME/path/to/rev/bin/rev.js"' >> ~/.bashrc
source ~/.bashrc
```

### Windows

```powershell
# Install prerequisites via winget or Chocolatey
winget install OpenJS.NodeJS
winget install JohnMacFarlane.Pandoc

# Or with Chocolatey
choco install nodejs pandoc

# Install pandoc-crossref (download from GitHub releases)
# https://github.com/lierdakil/pandoc-crossref/releases
# Extract pandoc-crossref.exe to a directory in your PATH

# Clone and install rev
git clone https://github.com/gcol33/rev.git
cd rev
npm install

# Option 1: Add to PowerShell profile
Add-Content $PROFILE 'function rev { node "C:\path\to\rev\bin\rev.js" $args }'

# Option 2: Create batch file in PATH (e.g., C:\Users\<you>\bin\rev.cmd)
# Contents: @node "C:\path\to\rev\bin\rev.js" %*

# Verify installation
rev --version
```

### Global npm install (all platforms)

```bash
# After cloning
cd rev
npm install -g .

# Now 'rev' is available globally
rev --version
```

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

### Configuration

| Command | Description |
|---------|-------------|
| `rev init` | Generate sections.yaml from existing .md files |
| `rev split <file>` | Split annotated paper.md back to section files |
| `rev help [topic]` | Show help (topics: workflow, syntax, commands) |

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

docx:
  reference: template.docx   # Optional reference doc
  keepComments: true
```

## Annotation Syntax (CriticMarkup)

```markdown
{++inserted text++}      # Insertions
{--deleted text--}       # Deletions
{~~old~>new~~}           # Substitutions
{>>Author: comment<<}    # Comments
```

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
