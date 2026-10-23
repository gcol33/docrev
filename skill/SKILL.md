---
name: docrev
description: "Document revision workflow tool (CLI: `docrev`). Use when working with Word documents containing reviewer comments, importing track changes to markdown, replying to reviewer comments, building PDF/DOCX outputs, generating response letters, validating citations/DOIs, or any document revision task."
---

# docrev - Document Revision Tool

`docrev` is a CLI tool for document workflows with Word ↔ Markdown round-trips.

Always invoke it as `docrev`. The package also installs a short alias `rev`, but
on Linux and macOS `rev` is usually the system tool that reverses lines, so a
bare `rev` may run the wrong program. If `docrev` is not found, docrev is not
installed (`npm install -g docrev`); `rev` is never a substitute.

Works for any document that goes through Word-based review: scientific papers, contracts, reports, proposals, manuals.

## Content and Layout, Separated

In Markdown, you focus on content. Write text, add citations with `[@key]`, insert equations with `$...$`, reference figures with `@fig:label`. No fiddling with fonts or styles.

Layout is controlled in `rev.yaml`:

```yaml
title: "My Document"
docx:
  reference: template.docx
```

Change the template, rebuild, and every document gets the new formatting.

## Core Workflow

### 1. Create or import a project

```bash
docrev new my-document          # Start from scratch
docrev import manuscript.docx   # Start from existing Word doc
```

### 2. Build and share

```bash
docrev build docx               # Generate Word document
```

Send to reviewers. They add comments and track changes in Word.

### 3. Import feedback

```bash
docrev sync reviewed.docx              # Updates markdown with annotations
docrev sync                            # Auto-detect most recent .docx
docrev sync reviewed.docx --comments-only  # Insert comments only; never modify prose
docrev verify-anchors reviewed.docx    # Report which anchors still match current prose
```

Use `--comments-only` when the markdown has been revised between sending the
docx out and receiving it back. Without the flag, track changes from a stale
draft would clobber newer edits. With it, only comments are imported, placed
at fuzzy-matched anchors against the current prose. Run `docrev verify-anchors`
first to see which comments will land cleanly and which need manual placement.

### 4. View and address comments

```bash
docrev status                   # Project overview
docrev todo                     # List all pending comments
docrev next                     # Show next pending comment
docrev comments methods.md      # List all comments with context
```

### 5. Reply to reviewer comments

**Always use the non-interactive reply mode:**

```bash
docrev reply methods.md -n 1 -m "Added clarification about sampling methodology"
docrev reply results.md -n 3 -m "Updated figure to include 95% CI"
```

Replies appear as: `{>>Reviewer: Original<<} {>>User: Reply<<}`

### 6. Resolve addressed comments

```bash
docrev resolve methods.md -n 1  # Mark comment #1 as resolved
```

### 7. Rebuild with comment threads

```bash
docrev build docx --dual                 # Produces clean + annotated versions
docrev build docx --show-changes         # Single DOCX with visible track changes
docrev build docx --dual --show-changes  # One DOCX: tracked changes + threaded comments
```

`--dual` produces:
- `output/<title>.docx` — clean, for submission
- `output/<title>_comments.docx` — comment threads as Word comments

`--show-changes` produces a single audit DOCX (`<title>-changes.docx`) where
every accepted/rejected revision is rendered as a visible Word track change.
Useful when a co-author wants to see what changed since the last shared version.

`--dual --show-changes` combines both into one `<title>-changes.docx`: my
`{++..++}`/`{--..--}` edits as tracked changes *and* the reviewer's `{>>..<<}`
comments with my threaded replies. This is the file a supervisor opens,
reviews next to each other, and hands back. Add `--reference <docx>` to
realign comment anchors against a reviewer's copy first.

Outputs land in `output/` by default; set `outputDir: null` in `rev.yaml`
to keep them alongside `paper.md` (legacy layout). The basename is derived
from `title:` unless overridden — set `output: { docx: foo.docx, pdf: foo.pdf }`
in `rev.yaml` or pass `-o, --output <path>` on the CLI. See REFERENCE.md →
"Choosing output filenames".

For pandoc flags docrev doesn't surface directly (Lua filters, custom variables,
templates), use `--pandoc-arg` (repeatable) or `pandoc-args:` in `rev.yaml`
(both top-level and per-format). Run with `--verbose` to see the exact pandoc
invocation. See REFERENCE.md → "Passing custom pandoc args" for details.

### 8. Archive reviewer files

```bash
docrev archive                  # Move reviewer files to archive/
```

### 9. Generate response letter

```bash
docrev response                 # Generate point-by-point response letter
```

## Annotation Syntax (CriticMarkup)

- `{++inserted text++}` - Additions
- `{--deleted text--}` - Deletions
- `{~~old~>new~~}` - Substitutions
- `{>>Author: comment<<}` - Comments
- `{>>Author: comment [RESOLVED]<<}` - Resolved comment

## Quick Commands

| Task | Command |
|------|---------|
| Create project | `docrev new my-project` |
| Create LaTeX project | `docrev new my-project --template latex` |
| Import Word doc | `docrev import manuscript.docx` |
| Sync Word feedback | `docrev sync reviewed.docx` |
| Sync comments only (prose unchanged) | `docrev sync reviewed.docx --comments-only` |
| Verify anchors against current prose | `docrev verify-anchors reviewed.docx` |
| Sync PDF comments | `docrev sync annotated.pdf` |
| Extract PDF comments | `docrev pdf-comments annotated.pdf` |
| Extract with highlighted text | `docrev pdf-comments file.pdf --with-text` |
| Append PDF comments | `docrev pdf-comments annotated.pdf --append methods.md` |
| Project status | `docrev status` |
| Next pending | `docrev next` |
| List pending | `docrev todo` |
| Filter by author | `docrev comments file.md --author "Reviewer 2"` |
| Reply to all pending | `docrev reply file.md --all -m "Addressed"` |
| Accept all changes | `docrev accept file.md -a` |
| Build Word | `docrev build docx` |
| Build PDF | `docrev build pdf` |
| Build clean + annotated Word | `docrev build docx --dual` |
| Build clean + annotated PDF | `docrev build pdf --dual` |
| Build with visible track changes | `docrev build docx --show-changes` |
| Show contributors | `docrev contributors` |
| Lookup ORCID | `docrev orcid 0000-0002-1825-0097` |
| Archive reviewer files | `docrev archive` |
| Word count per section | `docrev word-count` |
| Project dashboard | `docrev stats` |
| Search all sections | `docrev search "query"` |
| Pre-submission check | `docrev check` |
| Validate citations | `docrev citations` |
| Check grammar/style | `docrev grammar` |
| Check spelling | `docrev spelling` |
| Open PDF preview | `docrev preview pdf` |
| Auto-rebuild on changes | `docrev watch` |
| Check for updates | `docrev upgrade --check` |
| Assign paragraph IDs, scaffold journey.md | `docrev journey init` |
| Check manuscript against story/journey | `docrev journey check` |
| Build story.md/journey.md to docx | `docrev build story` / `docrev build journey` |

## DOI Management

```bash
docrev doi check references.bib         # Validate DOIs
docrev doi lookup references.bib        # Find missing DOIs
docrev doi add 10.1234/example          # Add citation from DOI
```

## Validation

```bash
docrev validate --journal nature        # Check journal requirements
docrev validate --list                  # List 21 built-in journal profiles, plus custom ones
docrev lint                             # Check broken refs, missing citations
```

## Cross-References

Use in markdown files:
- `@fig:label` - Figure reference (becomes "Figure 1" in Word)
- `@tbl:label` - Table reference
- `@eq:label` - Equation reference
- `{#fig:label}` - Anchor for figures

Insert a figure with the format-portable syntax (renders in both PDF and Word):

```markdown
![Caption text.](figures/foo.pdf){#fig:foo width=80%}
```

Raw `\begin{figure}...\end{figure}` LaTeX blocks are PDF-only. For docx
builds, `docrev` auto-translates the common shape (single `\includegraphics`
with optional `\caption{...}` and `\label{...}`) to the markdown form above
so figures still render. Exotic blocks (`\subfloat`, `\rotatebox`, multiple
`\includegraphics`) are left alone and warned about — convert them by hand
or supply a custom Lua filter via `--pandoc-arg`. Opt out of auto-translate
with `docx.translateRawFigures: false` in `rev.yaml`.

## Story & Journey Sidecars

Up to three optional files sit beside a manuscript for its whole life and are
never part of a build:

- **`story.md`** — the argument: a claim, an audience, and a few arcs. Each
  arc has a `question`, `answer`, `evidence` (a `@fig:`/`@tbl:`/`@eq:` label
  or a source, never a restated number), its `limits`, and the arcs it
  `needs` before it.
- **`journey.md`** — one entry per paragraph (and per figure, table,
  equation, or code block, at its reading position): a stable ID, the arc(s)
  it serves, its `job` in one sentence, and what the reader `leaves`
  understanding. Front matter (before the first level-1 heading), back
  matter (acknowledgements, availability statements, references,
  supplementary material) and bold-label lines (`**Keywords:** ...`) need
  no entry unless given a marker.
- **`information.md`** — the terms and populations a reader must hold:
  `forms`, `as`, one `defined: @p:id` (or `known`, or `none`), `avoid`.
  Checked for undefined terms, avoided wordings, use before definition,
  form collisions and unused entries. A journey entry's
  `- negotiated: <who> <date> #<hash>: <decision>` pins a paragraph settled
  with a co-author; `docrev check` fails when it changes until
  `docrev journey ack <id>`, as it does on an undefined term or an avoided
  wording.
- **`supplement/journey.md`** — the supporting information's journey: one
  entry per table, figure, appendix or unnumbered section (`### tbl.key  [arcs]`),
  in print order, with its section `file` (under `supplement/sections/`),
  `tier` (evidence, reference, development, archive) and the `@p:`
  paragraphs it `supports`. SI text cites items by key
  (`Table [[tbl:key]]`); position sets the labels (S1, S2, ... per kind,
  A1, A2, ... for archive items).

A paragraph's ID lives in the section file as `<!-- @p:id -->` on the line
before it — a semantic slug (`intro.memory`), not a position, so moving the
paragraph keeps its ID. It survives `docrev sync`/`docrev import` and is dropped
from every build.

```bash
docrev journey init                     # assign IDs, scaffold journey.md
docrev journey check                    # check the manuscript against story/journey
docrev journey check --json             # same, as structured findings
docrev journey ack <ids...>             # reconfirm negotiated paragraphs after an edit
docrev build story                      # story.md → docx for co-authors
docrev build journey                    # journey.md → docx for co-authors
```

`docrev journey check` also runs as step 4 of `docrev check` when `journey.md`
exists. Findings (missing markers, orphan paragraphs, unclaimed arcs, arcs
introduced before what they `need`, unresolved evidence, near-duplicate
paragraphs, floats with no entry; for the supplement: section files missing
or not placed, keys or literal `Table S<n>` labels that resolve to no item,
the manuscript citing an archive item, evidence supporting no paragraph, a
stale `supplement/numbers.json` label lock) are structure decisions made
visible, not hard errors — the user decides which to act on. For drafting `story.md`/
`journey.md` with the user, or reading a manuscript into them, use the
`paper-sidecars` skill if available.

Config: `story:`/`journey:`/`supplementJourney:` keys in `rev.yaml` override
the default `story.md`/`journey.md`/`supplement/journey.md` filenames, and
`supplementSections:` the `supplement/sections` directory.

## Template Variables

Available in section files (processed during build):
- `{{date}}` - Current date (YYYY-MM-DD)
- `{{date:MMMM D, YYYY}}` - Custom format
- `{{title}}` - Document title
- `{{author}}` - First author
- `{{word_count}}` - Total word count

## Project Structure

```
my-document/
├── rev.yaml           # Project config
├── introduction.md    # Section files with annotations
├── methods.md
├── results.md
├── discussion.md
├── references.bib     # Bibliography
├── figures/           # Images
├── paper.md           # Combined sections (auto-generated)
└── output/            # Built artefacts
    ├── my-document.docx
    └── my-document.pdf
```

Set `outputDir: null` in `rev.yaml` to write outputs alongside `paper.md`
instead.

## PDF Comment Workflow

For reviewers who annotate PDFs instead of Word documents:

### 1. Extract comments from PDF

```bash
docrev pdf-comments annotated.pdf              # Display all comments
docrev pdf-comments annotated.pdf --by-author  # Group by reviewer
docrev pdf-comments annotated.pdf --json       # Output as JSON
```

### 2. Import into markdown

```bash
docrev sync annotated.pdf                      # Auto-import to sections
docrev pdf-comments annotated.pdf --append methods.md  # Append to specific file
```

### 3. Build PDF with margin notes

```bash
docrev build pdf --dual
```

Produces:
- `paper.pdf` — clean version for submission
- `paper_comments.pdf` — comments rendered as LaTeX margin notes

**Supported PDF Annotations:**
- Sticky notes, text boxes, highlights, underlines, strikethrough, squiggly

## When Helping Users

1. **Setup**: Ensure `docrev config user "Name"` is set for replies
2. **Sync phase**: Run `docrev sync` to get feedback (works with both Word and PDF)
3. **Review phase**: Use `docrev todo` and `docrev next` to navigate comments, `docrev reply` to respond
4. **Accept phase**: Use `docrev accept -a` or `docrev review` to handle track changes
5. **Build phase**: Run `docrev build docx --dual` or `docrev build pdf --dual` for annotated versions
6. **Archive phase**: Run `docrev archive` to move reviewer files
7. **Validation phase**: Run `docrev check` before submission
8. **Response letter**: Use `docrev response` to generate point-by-point responses

## Critical: Ask Questions When Unsure

When addressing reviewer comments or editing documents:

- **Never guess methods or numbers** - If a comment asks for clarification about methodology, sample sizes, statistical parameters, dates, or any quantitative information, ASK the user rather than inventing values
- **Placeholders are acceptable** - Use `[???]` or `[TODO: specify X]` when information is missing rather than fabricating data
- **Search online for references** - When comments request citations, use web search to find appropriate references rather than guessing
- **Clarify ambiguous requests** - If a reviewer comment could be interpreted multiple ways, ask the user which interpretation they prefer
- **Verify existing values** - When editing numbers that already exist in the document, confirm changes with the user if there's any doubt

Example scenarios requiring user input:
- "Add a reference for this claim" → Search online OR ask user for specific citation
- "Clarify the sample size" → Ask user for the correct number
- "Specify the statistical test used" → Ask user which test was actually used
- "Add the date of data collection" → Ask user for the actual date

For complete command reference, see [REFERENCE.md](REFERENCE.md).
