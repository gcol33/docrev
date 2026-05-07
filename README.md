# docrev

[![npm](https://img.shields.io/npm/v/docrev)](https://www.npmjs.com/package/docrev)
[![npm downloads](https://img.shields.io/npm/dm/docrev)](https://www.npmjs.com/package/docrev)
[![node](https://img.shields.io/node/v/docrev)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/gcol33/docrev/actions/workflows/ci.yml/badge.svg)](https://github.com/gcol33/docrev/actions/workflows/ci.yml)

A CLI for writing documents in Markdown while collaborating with Word users.

You keep your prose in `.md` files under version control. Builds produce Word or PDF for collaborators and journals; `rev sync` imports their tracked changes and comments back into the markdown, where you reply, resolve, and rebuild. Equations, figures, citations, and cross-references survive both directions of the round-trip.

## The Problem

After a few rounds of feedback, the project directory looks like this:

```
manuscript_v1.docx
manuscript_v2_john_comments.docx
manuscript_v2_jane_comments.docx
manuscript_v3_merged_final.docx
manuscript_v3_merged_final_REAL.docx
manuscript_v3_merged_final_REAL_submitted.docx
```

By the third filename, the document has split. One file has Jane's comments, another has John's track changes, a third has your reconciliation, and which one is current depends on what you remember. Reconciliation takes an afternoon and goes wrong every time the Word formatting drifts.

docrev keeps the markdown as the canonical version, under git. The DOCX is rebuilt each time you share with a reviewer; their comments and track changes flow back into your section files when you sync, where you reply to or accept them in the terminal.

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

Requires [Node.js](https://nodejs.org) 18+. Building DOCX or PDF needs [Pandoc](https://pandoc.org). For complex PDFs (math, cross-references, journal styles), [LaTeX](#installing-dependencies) is also needed; simpler documents can build through pandoc alone with a non-LaTeX engine (e.g. `pdf.engine: typst` in `rev.yaml`).

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
rev build docx    # → output/paper.docx
rev build pdf     # → output/paper.pdf
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

## What's in a Project

`rev new my-paper` creates the project. It prompts for the section names (default: `introduction, methods, results, discussion`) or accepts them up front via `-s intro,methods,results,discussion`. Each name becomes its own `.md` file. (`rev import some.docx` is the other entry point — it splits an existing Word document into one section per top-level heading.)

```
my-paper/
├── rev.yaml          ← config: title, authors, section order, journal profile
├── intro.md          ← section files; named at creation, one per section
├── methods.md
├── results.md
├── discussion.md
├── references.bib    ← BibTeX bibliography
├── figures/          ← images referenced from sections
├── paper.md          ← auto-combined source, regenerated each build
└── output/           ← built artefacts (docx, pdf, tex)
    ├── my-paper.docx
    └── my-paper.pdf
```

You edit the section files and the config; everything else is generated. `paper.md` is rebuilt from the section files in the order set by `rev.yaml`, and `output/` holds whatever the last build produced. After `rev sync`, comments and track changes from the reviewer's Word file appear inline in the section files as CriticMarkup annotations. Set `outputDir: null` in `rev.yaml` if you'd rather have outputs land alongside `paper.md`.

To set your own per-user default sections so future `rev new` calls skip the prompt:

```bash
rev config sections "intro,methods,results,discussion"
```

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

PDF annotations work the same way:

```bash
rev sync annotated.pdf
rev pdf-comments annotated.pdf --append methods.md
```

When several reviewers return separate files, `rev merge` reconciles them:

```bash
rev merge reviewer_A.docx reviewer_B.docx
```

Each reviewer's file is compared against `.rev/base.docx` (auto-saved on every build) to isolate that reviewer's changes; conflicts on the same passage are flagged for interactive resolution.

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

This creates the project folder with the section files. Write content in the section files, then build:

```bash
rev build docx pdf
```

The output filename is derived from your project title in `rev.yaml`. Citations are resolved, equations rendered, and cross-references numbered. The directory layout is described above in [What's in a Project](#whats-in-a-project).

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
authors: []
sections:
  - intro.md
  - methods.md
  - results.md
  - discussion.md

# Where built artefacts land (default: output/). Set to null for the
# legacy "outputs alongside paper.md" layout.
outputDir: output

docx:
  reference: template.docx       # your Word template

pdf:
  documentclass: article
  fontsize: 12pt
  engine: pdflatex               # or xelatex/lualatex for Latin-Extended
  # Fonts apply only under xelatex/lualatex (fontspec):
  # mainfont: "TeX Gyre Termes"
  # sansfont: "TeX Gyre Heros"
  # monofont: "TeX Gyre Cursor"
```

Switch to `engine: xelatex` (or `lualatex`) when the manuscript has Czech/Polish/Croatian/Spanish names or species epithets that `pdflatex` mangles. Under those engines, `mainfont`/`sansfont`/`monofont` are forwarded to pandoc.

Configure your name for comment replies:

```bash
rev config user "Your Name"
```

### Table Formatting

For PDF output, configure columns that should not wrap:

```yaml
tables:
  nowrap:
    - Prior              # column headers to keep on one line
    - "$\\widehat{R}$"
```

Distribution notation in nowrap columns is auto-converted to LaTeX math:
`Normal(0, 0.5)` → `$\mathcal{N}(0, 0.5)$`

### Postprocess Scripts

Run custom scripts after output generation:

```yaml
postprocess:
  pdf: ./scripts/fix-tables.py    # runs after PDF
  docx: ./scripts/add-meta.js     # runs after DOCX
  all: ./scripts/notify.sh        # runs after any format
```

Scripts receive environment variables: `OUTPUT_FILE`, `OUTPUT_FORMAT`, `PROJECT_DIR`, `CONFIG_PATH`.

Use `--verbose` to see script output:

```bash
rev build pdf --verbose
```

### Journal Profiles

Journal profiles provide both validation rules and build formatting defaults. Set in `rev.yaml`:

```yaml
journal: nature
```

Or pass on the command line:

```bash
rev build pdf -j nature     # applies Nature's CSL style + PDF settings
```

When a journal is set, its formatting defaults (CSL citation style, font size, margins, line spacing) are applied automatically. Your explicit `rev.yaml` settings always take priority.

Six profiles include formatting: `nature`, `science`, `cell`, `pnas`, `plos-one`, `elife`. All 21 profiles support validation. Custom profiles can include formatting too — see [docs/configuration.md](docs/configuration.md).

```bash
rev validate --list          # see all profiles ([formatting] tag = build support)
rev profiles --fetch-csl apa # download a CSL style to cache
rev profiles --list-csl      # list cached CSL styles
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
| Build with visible track changes | `rev build docx --show-changes` |
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
| Merge reviewer feedback | `rev merge reviewer_A.docx reviewer_B.docx` |
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

### LaTeX (for complex PDF builds)

| Platform | Command |
|----------|---------|
| macOS | `brew install --cask mactex` |
| Windows | `winget install MiKTeX.MiKTeX` |
| Debian/Ubuntu | `sudo apt install texlive-full` |
| Fedora | `sudo dnf install texlive-scheme-full` |

Alternatively, [TinyTeX](https://yihui.org/tinytex/) provides a minimal distribution that downloads packages on demand.

## License

MIT
