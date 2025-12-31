# docrev

[![npm](https://img.shields.io/npm/v/docrev)](https://www.npmjs.com/package/docrev)
[![Node.js](https://img.shields.io/node/v/docrev)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

CLI tool for academic paper workflows with Word ↔ Markdown round-trips. Handle reviewer feedback, manage comments, validate DOIs, and build to PDF/DOCX/LaTeX.

## Install

```bash
npm install -g docrev
```

**Prerequisites:** [Pandoc](https://pandoc.org/installing.html) and optionally [pandoc-crossref](https://github.com/lierdakil/pandoc-crossref)

```bash
# macOS
brew install pandoc pandoc-crossref

# Verify
rev --version
rev install
```

## Quick Start

```bash
# Create new project
rev new my-paper

# Or import from Word
rev import manuscript.docx

# Edit sections: introduction.md, methods.md, results.md, discussion.md

# Build outputs
rev build pdf
rev build docx
rev build --dual    # Clean + comments DOCX with threaded comments
```

## Reviewer Workflow

```bash
# Import reviewed Word doc to section files
rev sections reviewed.docx

# Review track changes interactively
rev review methods.md

# See and reply to comments
rev comments methods.md
rev reply methods.md -n 1 -m "Added clarification"

# Rebuild
rev build docx --dual
```

## Key Features

- **Build system** - Sections → paper.md → PDF, DOCX, LaTeX
- **Word import** - Extracts text, comments, equations (OMML → LaTeX), and images
- **Interactive review** - Accept/reject track changes with TUI
- **Comment threading** - Guy→Gilles reply pairs become threaded Word comments
- **Cross-references** - `@fig:label` → "Figure 1" (auto-converted from Word)
- **DOI validation** - Check and lookup DOIs via Crossref/DataCite
- **Journal validation** - Check against 21 journal requirement profiles

## Commands

| Command | Description |
|---------|-------------|
| `rev build [pdf\|docx\|tex]` | Build outputs from sections |
| `rev build --dual` | Clean + comments DOCX |
| `rev import <docx>` | Bootstrap project from Word |
| `rev sections <docx>` | Import to existing section files |
| `rev review <file>` | Interactive accept/reject TUI |
| `rev comments <file>` | List comments with context |
| `rev reply <file> -n N -m "text"` | Reply to comment |
| `rev doi check [file.bib]` | Validate DOIs |
| `rev doi lookup [file.bib]` | Find missing DOIs |
| `rev validate -j <journal>` | Check journal requirements |

See [docs/commands.md](docs/commands.md) for full command reference.

## Annotation Syntax (CriticMarkup)

```markdown
{++inserted text++}      # Insertions
{--deleted text--}       # Deletions
{~~old~>new~~}           # Substitutions
{>>Author: comment<<}    # Comments
```

## Project Structure

```
my-paper/
├── rev.yaml           # Config (title, authors, build settings)
├── introduction.md    # Section files
├── methods.md
├── results.md
├── discussion.md
├── references.bib     # Bibliography
├── figures/           # Images
└── paper.docx         # Generated output
```

## Documentation

- [Commands Reference](docs/commands.md) - All commands with examples
- [Configuration](docs/configuration.md) - rev.yaml options
- [Workflow Guide](docs/workflow.md) - Step-by-step reviewer workflow
- [API Reference](docs/api.md) - Library usage

## License

MIT
