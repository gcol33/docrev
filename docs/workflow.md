# Revision Workflow

The canonical version lives in your markdown files. Word is the exchange format — you build it when you need to share, and sync it when feedback comes back.

A revision cycle in brief:

1. Build a Word document and send it to reviewers.
2. They return it with track changes and comments.
3. `rev sync` pulls the feedback into your markdown sections.
4. Navigate comments with `rev next` and `rev todo`, reply with `rev reply`, accept or reject changes with `rev accept`.
5. Rebuild with `rev build docx --dual` — a clean document and an annotated one with your replies threaded into the original Word comments.
6. Archive the reviewer's file. Repeat.

---

## Starting a Project

From an existing Word document:

```bash
rev import manuscript.docx
```

docrev splits the document at top-level headings and creates one `.md` file per section. Images land in `figures/`, equations convert from OMML to LaTeX, and any existing comments or track changes are preserved as CriticMarkup annotations.

From scratch:

```bash
rev new my-paper -s intro,methods,results,discussion
cd my-paper
```

The `-s` flag sets section names and skips the interactive prompt. Set your preferred sections once and future `rev new` calls use them automatically:

```bash
rev config sections "intro,methods,results,discussion"
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

Cross-references resolve automatically at build time — `@fig:label`, `@tbl:label`, `@eq:label`, `@sec:label` become "Figure 1", "Table 2", "Equation 3", "Section 4". Use `rev migrate` to convert hardcoded references (Fig. 1, Table 2) to dynamic ones if you're importing an existing document.

---

## Building and Sharing

```bash
rev build docx        # → output/my-paper.docx
rev build pdf         # → output/my-paper.pdf
rev build docx pdf    # both at once
```

Set a journal profile to get the right citation style and PDF formatting automatically:

```bash
rev build pdf -j nature
```

Six profiles include formatting defaults — `nature`, `science`, `cell`, `pnas`, `plos-one`, `elife`. All 21 support validation. To see the full list:

```bash
rev validate --list
```

For a live preview while you write:

```bash
rev watch docx    # rebuilds on every save
```

---

## Syncing Reviewer Feedback

When a reviewer returns a Word document with track changes and comments:

```bash
rev sync reviewed.docx
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

If your markdown has changed since you sent the document out — new edits, reordered sections — run `rev verify-anchors` first to see which comments will land cleanly against the updated prose, then use `--comments-only` to import only comments (not track changes, which would overwrite your newer edits):

```bash
rev verify-anchors reviewed.docx
rev sync reviewed.docx --comments-only
```

For reviewers who annotate PDFs rather than Word files:

```bash
rev sync annotated.pdf
```

Supported annotation types: sticky notes, text boxes, highlights, underlines, strikethrough, squiggly underlines. Use `rev pdf-comments annotated.pdf --with-text` to extract the text that was highlighted or struck through.

---

## Track Changes

List what's pending:

```bash
rev accept methods.md
```

Accept or reject individually, or all at once:

```bash
rev accept methods.md -n 1    # accept change #1
rev reject methods.md -n 2    # reject change #2
rev accept methods.md -a      # accept all
```

For an interactive review with keyboard shortcuts (a/r/s/q):

```bash
rev review methods.md
```

---

## Comments

Navigate pending comments:

```bash
rev todo                         # list all pending as a checklist
rev next                         # show the next one
rev next -n 3                    # skip to the 3rd
rev comments methods.md          # all comments in one section, with context
rev comments methods.md --author "Reviewer 2"
```

Reply with your name set once in config:

```bash
rev config user "Your Name"
rev reply methods.md -n 1 -m "Added clarification in the revised text."
```

The reply appears adjacent to the original:

```markdown
{>>Reviewer 2: The confidence intervals seem too narrow.<<} {>>Your Name: Clarified; the intervals are bootstrap CIs at 95%.<<}
```

Adjacent comments from different authors thread in Word automatically. Comments must be adjacent — no text between them — for threading to work.

Mark addressed:

```bash
rev resolve methods.md -n 1
```

---

## Multiple Reviewers

When several reviewers return separate files, `rev merge` reconciles them against a shared baseline:

```bash
rev merge reviewer_A.docx reviewer_B.docx
```

docrev compares each file against `.rev/base.docx` (saved automatically on every build) to isolate each reviewer's changes. Conflicts on the same passage are flagged for interactive resolution.

---

## Rebuilding and Responding

Once you've handled the feedback, rebuild:

```bash
rev build docx --dual
```

This produces two files — `my-paper.docx` (clean, for submission or the next round) and `my-paper_comments.docx` (with your replies threaded under the original Word comments). The same flag works for PDF, rendering comments as LaTeX margin notes:

```bash
rev build pdf --dual
```

Generate a point-by-point response letter from the resolved comments:

```bash
rev response > response-letter.md
```

---

## Archiving and Repeating

Move reviewer files out of the project folder:

```bash
rev archive                    # → archive/20241215_143022_reviewed.docx
rev archive --by Smith         # → archive/20241215_143022_Smith_my-paper.docx
rev archive --dry-run          # preview without moving
```

Take a snapshot before a major revision round:

```bash
rev backup --name "before-round-2"
```

The cycle continues: receive feedback, sync, handle changes and comments, rebuild, archive.

---

## Pre-Submission Checks

```bash
rev check                       # full check: lint, citations, grammar
rev doi check references.bib    # validate all DOIs
rev validate -j nature          # journal-specific requirements
rev word-count -j nature        # check against word limit
```

For journals with strict requirements, running `rev validate --list` shows which profiles are available and which include formatting support (`[formatting]` tag).

---

## Quick Reference

| Task | Command |
|------|---------|
| Start from Word | `rev import manuscript.docx` |
| Start fresh | `rev new my-paper` |
| Build DOCX | `rev build docx` |
| Build clean + annotated | `rev build docx --dual` |
| Build PDF | `rev build pdf` |
| Sync feedback | `rev sync reviewed.docx` |
| Sync comments only (prose changed) | `rev sync reviewed.docx --comments-only` |
| Check anchor drift | `rev verify-anchors reviewed.docx` |
| Project status | `rev status` |
| List pending | `rev todo` |
| Next comment | `rev next` |
| Accept all changes | `rev accept file.md -a` |
| Reply to comment | `rev reply file.md -n 1 -m "..."` |
| Archive reviewer files | `rev archive` |
| Response letter | `rev response` |
| Pre-submit check | `rev check` |
