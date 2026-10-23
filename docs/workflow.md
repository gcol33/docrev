# Revision Workflow

The canonical version lives in your markdown files. Word is the exchange format — you build it when you need to share, and sync it when feedback comes back.

A revision cycle in brief:

1. Build a Word document and send it to reviewers.
2. They return it with track changes and comments.
3. `docrev sync` pulls the feedback into your markdown sections.
4. Navigate comments with `docrev next` and `docrev todo`, reply with `docrev reply`, accept or reject changes with `docrev accept`.
5. Rebuild with `docrev build docx --dual` — a clean document and an annotated one with your replies threaded into the original Word comments.
6. Archive the reviewer's file. Repeat.

---

## Starting a Project

From an existing Word document:

```bash
docrev import manuscript.docx
```

docrev splits the document at top-level headings and creates one `.md` file per section; the text before the first heading (title, authors) goes to `preamble.md`. A document without Word heading styles is split at paragraphs that consist of a standard section name such as Introduction or Methods. Images land in `figures/media/`, equations convert from OMML to LaTeX, any existing comments and tracked changes are kept as CriticMarkup annotations, and the title and authors from the Title and Author paragraphs go into `rev.yaml`.

From scratch:

```bash
docrev new my-paper -s intro,methods,results,discussion
cd my-paper
```

The `-s` flag sets section names and skips the interactive prompt. Set your preferred sections once and future `docrev new` calls use them automatically:

```bash
docrev config sections "intro,methods,results,discussion"
```

Either way, the project has this shape:

```
my-paper/
├── rev.yaml          ← config: title, authors, section order, journal profile
├── intro.md          ← section files — edit these
├── methods.md
├── results.md
├── discussion.md
├── references.bib    ← BibTeX bibliography
├── figures/          ← images referenced from sections
├── paper.md          ← auto-combined on each build, not hand-edited
└── output/
    ├── my-paper.docx
    └── my-paper.pdf
```

`paper.md` is regenerated from the section files in the order set by `rev.yaml`; output files go to `output/` by default. Set `outputDir: null` in `rev.yaml` if you prefer them alongside `paper.md`.

---

## Writing in Markdown

Citations use pandoc-citeproc syntax — `[@key]` for one source, `[@key1; @key2]` for multiple:

```markdown
Global temperatures have risen by 1.1°C since pre-industrial levels [@IPCC2021].
```

Figures get a label so they can be referenced by number:

```markdown
![Temperature anomalies since 1880](figures/temperature.png){#fig:temperature}

As shown in @fig:temperature, the trend has accelerated since 1970.
```

Equations use standard LaTeX — inline with `$...$`, display with `$$...$$`:

```markdown
The forcing relationship follows $\Delta T = \lambda \cdot \Delta F$, where
$\lambda$ is the climate sensitivity parameter.

$$
\bar{x} = \frac{1}{n}\sum_{i=1}^{n} x_i
$$ {#eq:mean}

Reference with @eq:mean → "Equation 1"
```

Simple tables take pipe syntax:

```markdown
| Site | Lat  | Long   | n  |
|------|------|--------|----|
| A    | 45.2 | -120.5 | 48 |
| B    | 52.1 | -105.3 | 61 |

: Study sites {#tbl:sites}
```

For merged cells or multi-line cell content, use grid table syntax:

```markdown
+----------+----------+----------+
| Results                        |
+==========+==========+==========+
| Site     | 2023     | 2024     |
+----------+----------+----------+
| A        | 100      | 150      |
+----------+----------+----------+

: Annual measurements {#tbl:results}
```

Cross-references resolve automatically at build time — `@fig:label`, `@tbl:label`, `@eq:label`, `@sec:label` become "Figure 1", "Table 2", "Equation 3", "Section 4". Use `docrev migrate` to convert hardcoded references (Fig. 1, Table 2) to dynamic ones if you're importing an existing document.

---

## Building and Sharing

```bash
docrev build docx        # → output/my-paper.docx
docrev build pdf         # → output/my-paper.pdf
docrev build docx pdf    # both at once
```

Set a journal profile to get the right citation style and PDF formatting automatically:

```bash
docrev build pdf -j nature
```

Seven profiles include formatting defaults: `nature`, `science`, `cell`, `pnas`, `plos-one`, `elife`, `methods-ecology-evolution`. All 22 support validation. To see the full list:

```bash
docrev validate --list
```

For a live preview while you write:

```bash
docrev watch docx    # rebuilds on every save
```

---

## Syncing Reviewer Feedback

When a reviewer returns a Word document with track changes and comments:

```bash
docrev sync reviewed.docx
```

Track changes become CriticMarkup annotations inline in your section files:

```markdown
The sample size was {--100--}{++150++} participants.
Data was collected {~~monthly~>weekly~~}.
```

Comments land with the reviewer's name:

```markdown
{>>Reviewer 2: The confidence intervals here seem too narrow. Please clarify.<<}
```

If your markdown has changed since you sent the document out — new edits, reordered sections — run `docrev verify-anchors` first to see which comments will land cleanly against the updated prose, then use `--comments-only` to import only comments (not track changes, which would overwrite your newer edits):

```bash
docrev verify-anchors reviewed.docx
docrev sync reviewed.docx --comments-only
```

For reviewers who annotate PDFs rather than Word files:

```bash
docrev sync annotated.pdf
```

Supported annotation types: sticky notes, text boxes, highlights, underlines, strikethrough, squiggly underlines. Use `docrev pdf-comments annotated.pdf --with-text` to extract the text that was highlighted or struck through.

---

## Track Changes

List what's pending:

```bash
docrev accept methods.md
```

Accept or reject individually, or all at once:

```bash
docrev accept methods.md -n 1    # accept change #1
docrev reject methods.md -n 2    # reject change #2
docrev accept methods.md -a      # accept all
```

For an interactive review with keyboard shortcuts (a/r/s/q):

```bash
docrev review methods.md
```

---

## Comments

Navigate pending comments:

```bash
docrev todo                         # list all pending as a checklist
docrev next                         # show the next one
docrev next -n 3                    # skip to the 3rd
docrev comments methods.md          # all comments in one section, with context
docrev comments methods.md --author "Reviewer 2"
```

Reply with your name set once in config:

```bash
docrev config user "Your Name"
docrev reply methods.md -n 1 -m "Added clarification in the revised text."
```

The reply appears adjacent to the original:

```markdown
{>>Reviewer 2: The confidence intervals seem too narrow.<<} {>>Your Name: Clarified; the intervals are bootstrap CIs at 95%.<<}
```

Adjacent comments from different authors thread in Word automatically. Comments must be adjacent — no text between them — for threading to work.

Mark addressed:

```bash
docrev resolve methods.md -n 1
```

---

## Multiple Reviewers

When several reviewers return separate files, `docrev merge` reconciles them against a shared baseline:

```bash
docrev merge reviewer_A.docx reviewer_B.docx
```

docrev compares each file against `.rev/base.docx` (saved automatically on every build) to isolate each reviewer's changes. Conflicts on the same passage are flagged for interactive resolution.

---

## Rebuilding and Responding

Once you've handled the feedback, rebuild:

```bash
docrev build docx --dual
```

This produces two files — `my-paper.docx` (clean, for submission or the next round) and `my-paper_comments.docx` (with your replies threaded under the original Word comments). The same flag works for PDF, rendering comments as LaTeX margin notes:

```bash
docrev build pdf --dual
```

Generate a point-by-point response letter from the resolved comments:

```bash
docrev response > response-letter.md
```

---

## Archiving and Repeating

Move reviewer files out of the project folder:

```bash
docrev archive                    # → archive/20241215_143022_reviewed.docx
docrev archive --by Smith         # → archive/20241215_143022_Smith_my-paper.docx
docrev archive --dry-run          # preview without moving
```

Take a snapshot before a major revision round:

```bash
docrev backup --name "before-round-2"
```

The cycle continues: receive feedback, sync, handle changes and comments, rebuild, archive.

---

## Pre-Submission Checks

```bash
docrev check                       # full check: lint, citations, grammar
docrev doi check references.bib    # validate all DOIs
docrev validate -j nature          # journal-specific requirements
docrev word-count -j nature        # word limit, counted as the journal counts it
```

For journals with strict requirements, running `docrev validate --list` shows which profiles are available and which include formatting support (`[formatting]` tag).

---

## Quick Reference

| Task | Command |
|------|---------|
| Start from Word | `docrev import manuscript.docx` |
| Start fresh | `docrev new my-paper` |
| Build DOCX | `docrev build docx` |
| Build clean + annotated | `docrev build docx --dual` |
| Build PDF | `docrev build pdf` |
| Sync feedback | `docrev sync reviewed.docx` |
| Sync comments only (prose changed) | `docrev sync reviewed.docx --comments-only` |
| Check anchor drift | `docrev verify-anchors reviewed.docx` |
| Project status | `docrev status` |
| List pending | `docrev todo` |
| Next comment | `docrev next` |
| Accept all changes | `docrev accept file.md -a` |
| Reply to comment | `docrev reply file.md -n 1 -m "..."` |
| Archive reviewer files | `docrev archive` |
| Response letter | `docrev response` |
| Pre-submit check | `docrev check` |
