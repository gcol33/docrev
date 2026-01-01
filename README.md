# docrev

[![npm](https://img.shields.io/npm/v/docrev)](https://www.npmjs.com/package/docrev)
[![npm downloads](https://img.shields.io/npm/dm/docrev)](https://www.npmjs.com/package/docrev)
[![node](https://img.shields.io/node/v/docrev)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/gcol33/docrev/actions/workflows/ci.yml/badge.svg)](https://github.com/gcol33/docrev/actions/workflows/ci.yml)

Write in Markdown. Build to DOCX or PDF. Round-trip track changes and comments.

## Why docrev

One source file. Any output format. Full version control.

Write in Markdown with citations, equations, and cross-references. Build to DOCX for collaborators who use Word, or PDF for journal submission. When reviewers send back track changes and comments, import them straight into your Markdown. No more `final_v3_REAL_final.docx`.

Your manuscript stays in plain text: diff changes line by line, merge contributions, grep your content, roll back mistakes. Collaborators never need to change their workflow - they edit Word documents as usual, and you stay in control.

```bash
# Build and send to reviewers
rev build docx                    # → manuscript.docx

# Import their feedback
rev sync reviewed.docx        # track changes and comments → markdown

# See all comments at a glance
rev comments
#  methods.md:12    Reviewer 2: "Please clarify the sampling method."
#  results.md:45    Reviewer 1: "Citation needed."
#  discussion.md:8  Editor: "Consider shortening this section."

# Reply and resolve without opening Word
rev reply methods.md -n 1 -m "Added clarification in paragraph 2"
rev resolve methods.md -n 1

# Pre-submission checks
rev word-count                    # 4,892 words (excluding references)
rev check                         # broken refs, missing citations
rev doi check                     # validate all DOIs resolve

# Rebuild clean + annotated versions
rev build docx --dual             # → manuscript.docx + manuscript_comments.docx
```

Track changes appear inline in your markdown - accept or reject by editing:

```markdown
The sample size was {--100--}{++150++} participants.
```

Git integration shows what changed between revisions:

```bash
rev diff                          # compare against last commit
#  methods.md     +142 words  -38 words
#  results.md      +89 words  -12 words

rev history methods.md            # see revision history
#  a1b2c3d  2024-03-15  Addressed reviewer 2 comments
#  e4f5g6h  2024-03-01  Initial draft
```

## Install

```bash
npm install -g docrev
```

Requires [Node.js](https://nodejs.org) 18+, [Pandoc](https://pandoc.org) 2.11+, and a [LaTeX distribution](#installing-dependencies) for PDF output.

Configure your name for comment replies:

```bash
rev config user "Your Name"
```

## Getting Started

### Starting a New Document

Create a new project:

```bash
rev new my-report
cd my-report
```

Replace `my-report` with any name. This creates a folder with that name containing:

```
my-report/
├── introduction.md
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

This creates a project folder and splits the document into section files. Any existing track changes and comments are preserved as markdown annotations.

## Content and Layout, Separated

In Markdown, you focus on content. Write your text, add citations with `[@key]`, insert equations with `$...$`, reference figures with `@fig:label`. No fiddling with fonts, margins, or styles.

Layout is controlled separately in `rev.yaml`:

```yaml
title: "My Document"
output:
  docx:
    reference-doc: template.docx   # your Word template
  pdf:
    documentclass: article
    fontsize: 12pt
```

Change the template, rebuild, and every document gets the new formatting. Built-in journal styles (Nature, Science, PNAS, and 18 others) handle formatting requirements automatically. Your content stays clean.

## The Revision Cycle

### 1. Build and Share

Generate a Word document:

```bash
rev build docx
```

Send this to reviewers. They add comments and track changes in Word as usual.

### 2. Import Feedback

When the reviewed document returns:

```bash
rev sync reviewed.docx
```

Your markdown files now contain their feedback as inline annotations.

### 3. Review Changes

Track changes appear as inline markup:

```markdown
The sample size was {--100--}{++150++} participants.
Data was collected {~~monthly~>weekly~~} from each site.
```

- `{++text++}` - inserted text
- `{--text--}` - deleted text
- `{~~old~>new~~}` - substitution

To accept a change, keep the new text and remove the markup. To reject, keep the old text.

### 4. Review Comments

Comments appear inline:

```markdown
We used a random sampling approach.
{>>Reviewer 2: Please clarify the sampling method.<<}
```

List all comments in a file:

```bash
rev comments methods.md
```

Example output:

```
methods.md: 3 comments

  #1 [line 12] Reviewer 2
     "Please clarify the sampling method."
     Context: "We used a random sampling approach."

  #2 [line 34] Reviewer 1
     "Citation needed here."
     Context: "Previous studies have shown this effect."

  #3 [line 45] Editor
     "Consider shortening this section."
     Context: "The methodology employed in this study..."
```

### 5. Reply to Comments

Reply directly from the command line:

```bash
rev reply methods.md -n 1 -m "Added clarification in paragraph 2"
```

Your reply threads beneath the original:

```markdown
We used a random sampling approach.
{>>Reviewer 2: Please clarify the sampling method.<<}
{>>Your Name: Added clarification in paragraph 2.<<}
```

Mark resolved comments:

```bash
rev resolve methods.md -n 1
```

### 6. Rebuild with Threads

Generate both a clean version and one showing comment threads:

```bash
rev build docx --dual
```

Produces:
- `paper.docx` - clean, for submission
- `paper_comments.docx` - includes threaded comments visible in Word's comment pane

### 7. Repeat

Send the updated document. Import new feedback. Continue until done.

## Before Submission

### Validate Your Bibliography

Check DOIs resolve correctly:

```bash
rev doi check references.bib
```

Find DOIs for entries missing them:

```bash
rev doi lookup references.bib
```

Add citations directly from a DOI:

```bash
rev doi add 10.1038/s41586-020-2649-2
```

### Run Pre-Submission Checks

Check for broken references, missing citations, and common issues:

```bash
rev check
```

## Writing in Markdown

### Citations

Add references to `references.bib`:

```bibtex
@article{Smith2020,
  author = {Smith, Jane},
  title = {Paper Title},
  journal = {Nature},
  year = {2020},
  doi = {10.1038/example}
}
```

Cite in text:

```markdown
Previous work [@Smith2020] established this relationship.
Multiple sources support this [@Smith2020; @Jones2021].
```

### Equations

Inline: `$E = mc^2$`

Display:

```markdown
$$
\bar{x} = \frac{1}{n} \sum_{i=1}^{n} x_i
$$
```

### Figures and Cross-References

```markdown
![Study site locations](figures/map.png){#fig:map}

Results are shown in @fig:map.
```

The reference `@fig:map` becomes "Figure 1" in output. Numbers update automatically when figures reorder. Tables and equations work the same: `@tbl:label`, `@eq:label`.

## Command Reference

| Task | Command |
|------|---------|
| Create project | `rev new my-project` |
| Import Word document | `rev import manuscript.docx` |
| Build DOCX | `rev build docx` |
| Build PDF | `rev build pdf` |
| Build clean + annotated | `rev build docx --dual` |
| Sync feedback | `rev sync reviewed.docx` |
| Project status | `rev status` |
| Next pending comment | `rev next` |
| List pending comments | `rev todo` |
| Accept all changes | `rev accept file.md -a` |
| Reject change | `rev reject file.md -n 1` |
| Reply to comment | `rev reply file.md -n 1 -m "response"` |
| Resolve comment | `rev resolve file.md -n 1` |
| Archive reviewer files | `rev archive` |
| Check DOIs | `rev doi check references.bib` |
| Word count | `rev wc` |
| Pre-submission check | `rev check` |

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
