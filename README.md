# docrev

[![npm](https://img.shields.io/npm/v/docrev)](https://www.npmjs.com/package/docrev)
[![npm downloads](https://img.shields.io/npm/dm/docrev)](https://www.npmjs.com/package/docrev)
[![node](https://img.shields.io/node/v/docrev)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/gcol33/docrev/actions/workflows/ci.yml/badge.svg)](https://github.com/gcol33/docrev/actions/workflows/ci.yml)

Write in Markdown. Build to DOCX or PDF. Round-trip track changes and comments.

## Why Markdown

**Write once, output anywhere.** The same source file becomes a Word document for collaborators or a PDF for journal submission. Change citation styles with one line, not hours of reformatting.

**Automatic numbering.** Figures, tables, equations - all numbered for you. Move Figure 3 before Figure 1? References update automatically. No more "please renumber all figures."

**Citations that just work.** Write `[@Smith2020]` once. It renders correctly in every format, every citation style. Add a reference, delete a reference - the bibliography rebuilds itself.

**Real version control.** Your manuscript is plain text. Diff changes line by line, merge contributions from coauthors, roll back mistakes. See exactly what changed between drafts:

```bash
rev diff                          # compare against last commit
#  methods.md     +142 words  -38 words
#  results.md      +89 words  -12 words
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
rev build pdf --dual
```

Produces:
- `paper.docx` / `paper.pdf` - clean, for submission
- `paper_comments.docx` - threaded comments in Word's comment pane
- `paper_comments.pdf` - comments as margin notes

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
| Sync Word feedback | `rev sync reviewed.docx` |
| Sync PDF comments | `rev sync annotated.pdf` |
| Extract PDF comments | `rev pdf-comments annotated.pdf` |
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
