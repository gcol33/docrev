# docrev

*writing papers in Markdown with co-authors who work in Word*

[![npm](https://img.shields.io/npm/v/docrev)](https://www.npmjs.com/package/docrev)
[![npm downloads](https://img.shields.io/npm/dm/docrev)](https://www.npmjs.com/package/docrev)
[![node](https://img.shields.io/node/v/docrev)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/gcol33/docrev/actions/workflows/ci.yml/badge.svg)](https://github.com/gcol33/docrev/actions/workflows/ci.yml)

docrev builds Word and PDF files from a manuscript written as Markdown section files, and reads the comments and tracked changes reviewers make in those files back into the Markdown.

docrev runs [Pandoc](https://pandoc.org) for the conversion to Word and PDF, and `docrev sync` handles the return: it takes the reviewed Word or PDF file and writes each comment and tracked change into the section file it belongs to, as an annotation beside the sentence it concerns. The Markdown files under git remain the only source of the manuscript, so you reply to comments, accept or reject changes, and decide when to rebuild and send the next version.

docrev supports:

- **Round trips with Word.** Equations, figures, citations and cross-references survive the build to DOCX and the sync back.
- **Replying in the terminal.** Comments and tracked changes are numbered per file, so you reply to, accept, reject or resolve each one by number without opening Word.
- **Several reviewers.** Each build saves the DOCX it sent, and `docrev merge` compares every returned file with it, flagging passages that two reviewers changed differently.
- **PDF annotations.** A PDF with reviewer comments syncs the same way as a Word file.
- **Journal profiles.** 22 profiles hold a journal's requirements, such as word limits and figure and reference counts, for `docrev validate`; seven of them also set the citation style and PDF layout of the build.
- **References from DOIs.** `docrev doi` checks the DOIs in a BibTeX file, finds missing ones and adds an entry from a DOI.

## Installation

```bash
npm install -g docrev
```

This installs the `docrev` command and a short alias `rev`. On Linux and macOS, `rev` is usually also the name of a system tool that reverses lines, and whichever comes first on your `PATH` wins, so this README uses `docrev`.

docrev needs [Node.js](https://nodejs.org) 20.16 or later. The other tools depend on what you build:

| Tool | Needed for |
|------|------------|
| [Pandoc](https://pandoc.org) | every DOCX and PDF build |
| [pandoc-crossref](https://github.com/lierdakil/pandoc-crossref) | numbered figures, tables and equations |
| LaTeX | PDF output with math, cross-references or a journal style |

Simpler documents can build a PDF without LaTeX through a non-LaTeX pandoc engine, such as `pdf.engine: typst` in `rev.yaml`. `docrev doctor` checks that Node.js, Pandoc and pandoc-crossref are found.

### Installing Pandoc

| Platform | Command |
|----------|---------|
| macOS | `brew install pandoc pandoc-crossref` |
| Windows | `winget install JohnMacFarlane.Pandoc` |
| Debian/Ubuntu | `sudo apt install pandoc` |
| Fedora | `sudo dnf install pandoc` |

Other platforms: [pandoc.org/installing](https://pandoc.org/installing.html). On Windows and Linux, pandoc-crossref comes from its [releases page](https://github.com/lierdakil/pandoc-crossref/releases); pick the build that matches your Pandoc version.

### Installing LaTeX

| Platform | Command |
|----------|---------|
| macOS | `brew install --cask mactex` |
| Windows | `winget install MiKTeX.MiKTeX` |
| Debian/Ubuntu | `sudo apt install texlive-full` |
| Fedora | `sudo dnf install texlive-scheme-full` |

[TinyTeX](https://yihui.org/tinytex/) is a smaller distribution that downloads LaTeX packages on demand.

## Usage

1. Create a project with `docrev new`, or convert an existing Word file with `docrev import`.
2. Write in the section files and build with `docrev build`.
3. Send the DOCX. When it comes back, read the feedback in with `docrev sync`.
4. Answer the comments and changes, then build again.

```bash
docrev new my-paper
cd my-paper
docrev build docx
```

`docrev new` asks for the section names; press Enter to use introduction, methods, results and discussion. The build writes the DOCX to `output/`, named after the `title` in `rev.yaml`.

```
┌─────────────┐   docrev build docx    ┌─────────────┐
│             │ ─────────────────────→ │             │
│  Markdown   │                        │    Word     │  → collaborators
│   (you)     │    docrev build pdf    │   / PDF     │  → journals
│             │ ─────────────────────→ │             │
└─────────────┘                        └─────────────┘
       ↑                                      │
       │             docrev sync              │
       └──────────────────────────────────────┘
             their feedback → your files
```

To start from a Word file instead, `docrev import manuscript.docx` creates the project, splits the document into one section file per top-level heading, extracts the images to `figures/` and converts the equations to LaTeX.

## Project layout

```
my-paper/
├── rev.yaml          ← title, authors, section order, journal profile
├── introduction.md   ← one file per section
├── methods.md
├── results.md
├── discussion.md
├── references.bib    ← BibTeX bibliography
├── figures/          ← images referenced from sections
├── paper.md          ← combined source, regenerated each build
└── output/           ← built DOCX and PDF files
```

You edit the section files and `rev.yaml`, and docrev writes the rest. Each build combines the sections into `paper.md` in the order `rev.yaml` lists them. `docrev config sections "intro,methods,results,discussion"` sets your own default sections for later projects.

## Answering reviewers

```bash
docrev sync reviewed.docx
```

Tracked changes and comments arrive in the section files as [CriticMarkup](https://criticmarkup.com/), a plain-text notation for edits. You accept or reject a change by editing it:

```markdown
The sample size was {--100--}{++150++} participants.   # deletion + insertion
Data was collected {~~monthly~>weekly~~}.              # substitution
{>>Reviewer 2: Please clarify.<<}                      # comment
```

The comments can be answered without opening Word:

```bash
docrev comments                      # list all comments
docrev reply methods.md -n 1 -m "Added clarification"
docrev resolve methods.md -n 1       # mark as resolved
docrev build docx --dual             # clean + annotated versions
```

`docrev sync annotated.pdf` does the same for the comments in a PDF. Set your name for replies once with `docrev config user "Your Name"`.

## Merging several reviewers

```bash
docrev merge reviewer_A.docx reviewer_B.docx
```

Each build saves the DOCX it produced to `.rev/base.docx`. `docrev merge` compares each reviewer's file with that copy to isolate their changes, and asks you to resolve passages that two reviewers changed differently.

## Citations, figures and equations

```markdown
Climate change poses significant challenges [@IPCC2021]. As shown in
@fig:temperature, global temperatures have risen steadily.

![Temperature anomalies](figures/temperature.png){#fig:temperature}

The relationship follows $\Delta T = \lambda \cdot \Delta F$ (@eq:forcing).
```

Citations use keys from `references.bib`, figures and tables take a label, and equations are LaTeX. The build numbers every `@fig:`, `@tbl:` and `@eq:` reference. Mark unfinished spots with `\tofill{N sites}`, which prints as a highlighted placeholder in every output format. The [Revision Workflow](docs/workflow.md#writing-in-markdown) shows tables, display equations and section references.

## Journal profiles

```yaml
journal: nature
```

With a journal set in `rev.yaml` (or `-j nature` on the command line), `docrev validate` checks the manuscript against the profile's requirements, and a profile with formatting defaults sets the build's citation style, font size, margins and line spacing. Your own `rev.yaml` settings take priority. `docrev validate --list` lists the profiles, marks those with formatting defaults and gives the URL of each journal's author guidelines, which the profile was transcribed from and which can change; check them before submitting.

## Using docrev from Claude Code

```bash
docrev install-cli-skill      # install to ~/.claude/skills/docrev
docrev uninstall-cli-skill    # remove
```

With the skill installed, [Claude Code](https://claude.ai/code) knows the docrev commands and can help you work through comments, draft replies and run the revision cycle.

## Documentation

Start with [Revision Workflow](docs/workflow.md): one manuscript from `docrev new` through the review rounds to the pre-submission checks.

- [Command Reference](docs/commands.md): every command, grouped by task.
- [Configuration](docs/configuration.md): the `rev.yaml` keys, journal profiles, placeholder macros, tables, postprocess scripts and the story and journey sidecars.
- [Troubleshooting](docs/troubleshooting.md): installation, build, import and PDF problems.
- [API Reference](docs/api.md): the library functions for use from Node.

`docrev help <command>` prints the options of a single command.

## Getting help

Questions and bug reports go to [GitHub issues](https://github.com/gcol33/docrev/issues). With a bug report, include the output of `docrev --version` and `docrev doctor`, and a small project that shows the problem.

## Support

> "Software is like sex: it's better when it's free." — Linus Torvalds

I'm a PhD student who builds R packages in my free time because I believe good tools should be free and open. I started these projects for my own work and figured others might find them useful too.

If this package saved you some time, buying me a coffee is a nice way to say thanks. It helps with my coffee addiction.

[![Buy Me A Coffee](https://img.shields.io/badge/-Buy%20me%20a%20coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/gcol33)

## License

MIT
