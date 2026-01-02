# docrev

[![npm](https://img.shields.io/npm/v/docrev)](https://www.npmjs.com/package/docrev)
[![npm downloads](https://img.shields.io/npm/dm/docrev)](https://www.npmjs.com/package/docrev)
[![node](https://img.shields.io/node/v/docrev)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/gcol33/docrev/actions/workflows/ci.yml/badge.svg)](https://github.com/gcol33/docrev/actions/workflows/ci.yml)

A CLI for writing documents in Markdown while collaborating with Word users.

You write in Markdown under version control. Your collaborators use Word (or PDF). docrev converts between the two, preserving track changes, comments, equations, and cross-references.

## The Problem

You've been here before:

```
manuscript_v1.docx
manuscript_v2_john_comments.docx
manuscript_v2_jane_comments.docx
manuscript_v3_merged_final.docx
manuscript_v3_merged_final_REAL.docx
manuscript_v3_merged_final_REAL_submitted.docx
```

Three reviewers send back three Word files. You manually compare changes, copy-paste between documents, lose track of who said what. A week later, you can't remember which version has the figure updates.

**docrev fixes this.** You write in plain text. Reviewers use Word. Their feedback flows back into your files automatically. One source of truth, full version history, no more file chaos.

## Highlights

- **Markdown → Word/PDF** with citations, figures, equations, cross-references
- **Round-trip sync**: import Word track changes and comments back to Markdown
- **CLI review workflow**: reply to comments, accept/reject changes from terminal
- **DOI tools**: validate, lookup, and auto-add references from DOIs
- **21 journal styles**: Nature, Science, PNAS, and more
- **Version control friendly**: plain text source, full git history

## Install

```bash
npm install -g docrev
```

Requires [Node.js](https://nodejs.org) 18+, [Pandoc](https://pandoc.org) 2.11+, and [LaTeX](#installing-dependencies) for PDF output.

## Quick Example

Write in Markdown with citations and cross-references:

```markdown
Climate change poses significant challenges [@IPCC2021]. As shown in
@fig:temperature, global temperatures have risen steadily.

![Temperature anomalies](figures/temperature.png){#fig:temperature}

The relationship follows $\Delta T = \lambda \cdot \Delta F$ (@eq:forcing).
```

Build and share:

```bash
rev build docx    # → paper.docx (for collaborators)
rev build pdf     # → paper.pdf  (for journals)
```

When collaborators return the Word doc with track changes:

```bash
rev sync reviewed.docx    # their comments → your markdown
```

## How It Works

```
┌─────────────┐     rev build docx      ┌─────────────┐
│             │ ───────────────────────→│             │
│  Markdown   │                         │    Word     │  → collaborators
│   (you)     │     rev build pdf       │   / PDF     │  → journals
│             │ ───────────────────────→│             │
└─────────────┘                         └─────────────┘
       ↑                                       │
       │              rev sync                 │
       └───────────────────────────────────────┘
              their feedback → your files
```

You stay in Markdown. Collaborators use Word. Journals get PDF. Everyone works in their preferred format.

## The CLI Review Cycle

When reviewers send back a Word document with track changes and comments:

```bash
rev sync reviewed.docx            # import feedback into markdown
```

Track changes appear inline - accept or reject by editing:

```markdown
The sample size was {--100--}{++150++} participants.
```

Handle comments without opening Word:

```bash
rev comments                      # list all comments
rev reply methods.md -n 1 -m "Added clarification"
rev resolve methods.md -n 1       # mark as resolved
rev build docx --dual             # clean + annotated versions
```

Reviewers who annotate PDFs instead of Word? That works too:

```bash
rev sync annotated.pdf            # extract PDF comments
rev pdf-comments annotated.pdf --append methods.md
```

Your entire revision cycle stays in the terminal. `final_v3_REAL_final.docx` is over.

## Getting Started

### Starting a New Document

Create a new project:

```bash
rev new my-report
cd my-report
```

You'll be prompted to enter your section names, or press Enter to use the default structure. You can also specify sections directly:

```bash
rev new my-report -s intro,methods,results,discussion
```

Or set your preferred default sections once:

```bash
rev config sections "intro,methods,results,discussion"
```

This creates a folder with your chosen sections:

```
my-report/
├── intro.md
├── methods.md
├── results.md
├── discussion.md
├── references.bib
└── rev.yaml
```

Write your content in the markdown files. When ready to share:

```bash
rev build docx
```

This produces `my-report.docx` with citations resolved, equations rendered, and cross-references numbered. Use `rev build pdf` for PDF output instead.

### Starting from an Existing Word Document

If you have a Word document to convert:

```bash
rev import manuscript.docx
```

This creates a project folder and splits the document into section files. Images are extracted to `figures/`, equations are converted to LaTeX, and track changes/comments are preserved as markdown annotations.

### Configuration

Layout is controlled in `rev.yaml`:

```yaml
title: "My Document"
output:
  docx:
    reference-doc: template.docx   # your Word template
  pdf:
    documentclass: article
    fontsize: 12pt
```

Configure your name for comment replies:

```bash
rev config user "Your Name"
```

## Annotation Syntax

Track changes from Word appear as [CriticMarkup](http://criticmarkup.com/):

```markdown
The sample size was {--100--}{++150++} participants.   # deletion + insertion
Data was collected {~~monthly~>weekly~~}.              # substitution
{>>Reviewer 2: Please clarify.<<}                      # comment
```

## Writing Tips

Track word count changes between versions:

```bash
rev diff                    # compare against last commit
#  methods.md     +142 words  -38 words
#  results.md      +89 words  -12 words
```

Add references to `references.bib` (BibTeX format):

```bibtex
@article{Smith2020,
  author = {Smith, Jane},
  title = {Paper Title},
  journal = {Nature},
  year = {2020},
  doi = {10.1038/example}
}
```

Cite with `[@Smith2020]` or `[@Smith2020; @Jones2021]` for multiple sources.

Equations use LaTeX: inline `$E = mc^2$` or display `$$\sum_{i=1}^{n} x_i$$`.

Cross-references: `@fig:label`, `@tbl:label`, `@eq:label` → "Figure 1", "Table 2", "Equation 3".

## Command Reference

| Task | Command |
|------|---------|
| Create project | `rev new my-project` |
| Create LaTeX project | `rev new my-project --template latex` |
| Import Word document | `rev import manuscript.docx` |
| Extract Word equations | `rev equations from-word doc.docx` |
| Build DOCX | `rev build docx` |
| Build PDF | `rev build pdf` |
| Build clean + annotated | `rev build docx --dual` |
| Sync Word feedback | `rev sync reviewed.docx` |
| Sync PDF comments | `rev sync annotated.pdf` |
| Extract PDF comments | `rev pdf-comments annotated.pdf` |
| Extract with highlighted text | `rev pdf-comments file.pdf --with-text` |
| Project status | `rev status` |
| Next pending comment | `rev next` |
| List pending comments | `rev todo` |
| Filter by author | `rev comments file.md --author "Reviewer 2"` |
| Accept all changes | `rev accept file.md -a` |
| Reject change | `rev reject file.md -n 1` |
| Reply to comment | `rev reply file.md -n 1 -m "response"` |
| Reply to all pending | `rev reply file.md --all -m "Addressed"` |
| Resolve comment | `rev resolve file.md -n 1` |
| Show contributors | `rev contributors` |
| Lookup ORCID | `rev orcid 0000-0002-1825-0097` |
| Archive reviewer files | `rev archive` |
| Check DOIs | `rev doi check references.bib` |
| Find missing DOIs | `rev doi lookup references.bib` |
| Add citation from DOI | `rev doi add 10.1038/example` |
| Word count | `rev wc` |
| Pre-submission check | `rev check` |
| Check for updates | `rev upgrade --check` |

Run `rev help` to see all commands, or `rev help <command>` for details on a specific command.

Full command reference: [docs/commands.md](docs/commands.md)

## Claude Code Skill

Install the docrev skill for [Claude Code](https://claude.ai/code):

```bash
rev install-cli-skill      # install to ~/.claude/skills/docrev
rev uninstall-cli-skill    # remove
```

Once installed, Claude understands docrev commands and can help navigate comments, draft replies, and manage your revision cycle.

## Installing Dependencies

### Pandoc

[Pandoc](https://pandoc.org) handles document conversion.

| Platform | Command |
|----------|---------|
| macOS | `brew install pandoc` |
| Windows | `winget install JohnMacFarlane.Pandoc` |
| Debian/Ubuntu | `sudo apt install pandoc` |
| Fedora | `sudo dnf install pandoc` |

Other platforms: [pandoc.org/installing](https://pandoc.org/installing.html)

### LaTeX (for PDF output)

| Platform | Command |
|----------|---------|
| macOS | `brew install --cask mactex` |
| Windows | `winget install MiKTeX.MiKTeX` |
| Debian/Ubuntu | `sudo apt install texlive-full` |
| Fedora | `sudo dnf install texlive-scheme-full` |

Alternatively, [TinyTeX](https://yihui.org/tinytex/) provides a minimal distribution that downloads packages on demand.

## License

MIT
