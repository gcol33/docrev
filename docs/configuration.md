# Configuration

## rev.yaml

The project configuration file.

```yaml
title: "Your Paper Title"
version: "1.0"

authors:
  - name: First Author
    affiliation: Institution
    email: author@example.com
  - name: Second Author
    affiliation: Another Institution

sections:
  - introduction.md
  - methods.md
  - results.md
  - discussion.md

bibliography: references.bib
csl: nature.csl           # Citation style (optional)

story: story.md           # Optional: the paper's argument as arcs (default shown)
journey: journey.md       # Optional: one entry per paragraph/float (default shown)

# Cross-reference settings (pandoc-crossref)
crossref:
  figureTitle: Figure
  tableTitle: Table
  figPrefix: [Fig., Figs.]
  tblPrefix: [Table, Tables]
  eqnPrefix: [Eq., Eqs.]
  secPrefix: [Section, Sections]

# PDF output settings
pdf:
  documentclass: article
  fontsize: 12pt
  geometry: margin=1in
  linestretch: 1.5
  toc: false
  numbersections: true
  header: header.tex         # Optional LaTeX preamble file (relative to project root)

# Word output settings
docx:
  reference: template.docx   # Optional reference doc for styling
  keepComments: true         # Preserve CriticMarkup comments
  toc: false
```

## Story & Journey Sidecars

Two optional files sit beside a manuscript for its whole life:

- **`story.md`** — the argument: a claim, an audience, and a few arcs. Each
  arc has a `question`, an `answer`, `evidence` (a `@fig:`/`@tbl:`/`@eq:`
  label or a source, never a restated number), its `limits`, and the arcs it
  `needs` before it.
- **`journey.md`** — one entry per paragraph (and per figure, table,
  equation, or code block, at its reading position): a stable ID, the arc(s)
  it serves, its `job` in one sentence, its `support`, and what the reader
  `leaves` understanding.

```markdown
# story.md
# Story: <title>

## Claim
One sentence: what the paper establishes.

## Audience
Who reads it and what they already know.

## Arcs

### S1 Checkable optimality
- question: The reader's question, in their words.
- answer: What the paper establishes.
- evidence: @fig:runtime
- limits: Where the answer stops.
- needs: S0
```

```markdown
# journey.md
# Journey: <title>

## Introduction

### intro.memory  [S1]
- job: One sentence: what this paragraph establishes.
- support: example, reasoning, citation, or result it rests on
- leaves: What the reader understands after it that they did not before.

### fig.headline  [S1]  (figure)
- job: ...
```

A paragraph's ID lives in its section file as an HTML comment on the line
before it — `<!-- @p:intro.memory -->` — in the same family as the
`<!-- @section:file.md -->` marker. It is a semantic slug, not a position, so
moving the paragraph keeps its ID; never dropped from a Word round-trip
(`rev sync`/`rev import`), and never included in a build output.

Both files default to `story.md`/`journey.md` at the project root; override
with the `story:`/`journey:` keys above. See
[Story & Journey Sidecars](commands.md#story--journey-sidecars) for
`rev journey init`/`rev journey check` and `rev build story`/`rev build journey`.

## Placeholder Macros

Highlight gaps and notes in your draft with one-argument LaTeX-style macros.
The built-in `\tofill{X}` renders as a bold orange `[X]` in DOCX, PDF, and HTML
so reviewers spot every unfinished spot:

```markdown
We collected data from \tofill{N sites} between \tofill{date range}.
```

In the DOCX, that becomes a real Word run with `<w:color w:val="C2410C"/>` and
bold — not a stripped span. Pandoc 3.x's docx writer ignores `Span` `style=`
attributes silently, so docrev emits raw OpenXML to make the color stick.

### Defining custom macros

Add to `rev.yaml` under `macros:`. Each entry maps a LaTeX command name to its
per-format style. Names without a leading backslash; the macro is invoked as
`\<name>{argument}` in markdown.

```yaml
macros:
  - name: note
    default:
      color: "1E40AF"      # 6-digit hex, no '#'
      bold: true
      prefix: "NOTE: "
  - name: cite-needed
    default:
      color: "B91C1C"
      bold: true
      italic: false
      bracket: true
      suffix: " (cite)"
    # Per-format overrides (optional) — replace the default entirely for
    # the named format. Keys: docx, pdf, latex, html, ...
    formats:
      html:
        color: "B91C1C"
        bold: true
        prefix: "[cite needed: "
        suffix: "]"
        bracket: false
```

Built-in macros (`\tofill`) merge automatically with your `macros:` entries.
Declare an entry with the same name to override.

### Per-format rendering

| Format       | How macros render                                                  |
|--------------|--------------------------------------------------------------------|
| DOCX         | Raw `<w:r>` with `<w:color>` + `<w:b>`/`<w:i>` (Word renders color) |
| PDF / TeX    | `\providecommand` injection → `\textcolor[HTML]{…}{\textbf{[X]}}`  |
| Beamer       | Same as PDF                                                        |
| HTML         | Inline-style `<span>`                                              |
| Plain markdown / GFM | Bold `[X]` fallback (never silently dropped)               |

### Backwards compatibility

Projects that already ship their own `tofill_filter.lua` and
`\providecommand{\tofill}` keep working: docrev's preamble uses
`\providecommand` (not `\renewcommand`), so user-defined commands win. The
docx lua filter only expands macros that pass the format check, so unrelated
project-local filters layered alongside it are unaffected.

## Template Variables

Use in section files (processed during build):

| Variable | Description | Example Output |
|----------|-------------|----------------|
| `{{date}}` | Current date | 2025-12-30 |
| `{{date:MMMM D, YYYY}}` | Custom format | December 30, 2025 |
| `{{year}}` | Current year | 2025 |
| `{{version}}` | From rev.yaml | 1.0 |
| `{{title}}` | Document title | Your Paper Title |
| `{{author}}` | First author | First Author |
| `{{authors}}` | All authors | First Author, Second Author |
| `{{word_count}}` | Total words | 5,432 |

**Example usage:**
```markdown
# Methods

Last updated: {{date:MMMM D, YYYY}}

Word count: {{word_count}}
```

## User Configuration

Set your name for comment replies:

```bash
rev config user "Your Name"
```

Set default sections for new projects:

```bash
rev config sections "intro,methods,results,discussion"
```

This creates `~/.revrc`:
```json
{
  "userName": "Your Name",
  "defaultSections": ["intro", "methods", "results", "discussion"]
}
```

When `defaultSections` is set, `rev new` uses these sections automatically. When not set, `rev new` prompts for sections interactively.

## Dictionaries

**Global dictionary** (`~/.rev-dictionary`):
```bash
rev spelling --learn myword      # Add word
rev spelling --forget myword     # Remove word
rev spelling --list              # Show dictionary
```

**Project dictionary** (`.rev-dictionary` in project root):
```bash
rev spelling --learn-project myterm
```

**Grammar dictionary** (same locations):
```bash
rev grammar --learn acronym
rev grammar --forget acronym
```

## LaTeX Preamble (PDF)

Inject a custom LaTeX preamble into the PDF build — custom fonts, `fancyhdr`
running headers, `lineno` continuous line numbers (a common journal
requirement), and so on.

Point `pdf.header` (and optionally `pdf.footer`) at a `.tex` file relative to
the project root:

```yaml
pdf:
  header: header.tex
```

```latex
% header.tex
\usepackage{lineno}
\linenumbers
```

Both files are passed to pandoc with `-H`, in order (`header` then `footer`).
A file named here that does not exist is reported as a warning rather than
silently dropped.

For a short inline preamble, use pandoc's native `header-includes` block
instead of a file (accepted at the top level or under `pdf:`):

```yaml
header-includes: |
  \usepackage{lineno}
  \linenumbers
```

The preamble also applies to `tex` and `beamer` builds, and to the annotated
`_comments.pdf`.

## Journal Profiles

21 built-in journal profiles for validation. Six also provide **build formatting defaults** (CSL citation style, PDF settings):

```bash
rev validate --list              # List all profiles ([formatting] = build support)
rev validate -j nature           # Check against Nature requirements
rev word-count -j ecology-letters  # Check the journal's word limit
```

`validate` and `word-count -j` read the same files (the sections the build uses) and count the limit the same way: body prose, plus whatever the profile's `wordLimit` includes (see [Custom Profiles with Formatting](#custom-profiles-with-formatting)). Both print the parts, so a total that counts figure captions or the reference list shows where the words came from. Over-limit errors state the same breakdown inline (`current: 8098 = body 7357 + abstract 343 + captions 398`), so a wrong number is visible without reading the table.

Body prose excludes a manuscript's back matter: Acknowledgements, Author Contributions, Competing/Conflict of Interest, Data/Code Availability, Funding and Ethics ("statements"), plus Supporting Information/Supplementary Material and the References heading, wherever they fall — starting their own file, trailing the discussion in a shared one, or nested as a subsection. Each spans from its heading to the next heading of the same or higher level, so `## Reference plots` or `### Funding of the survey` mid-Methods stays body text.

Supporting Information/Supplementary Material and References are never counted (the reference list is measured by rendering it, via `includeReferences`). Statements are counted by default — matching a plain word count with no journal in play — since a profile that has not stated its rule should err toward counting too much, not pass a manuscript that then fails at the journal. MEE, for one, is explicit that statements count. A profile turns it off with `wordLimit.includeStatements: false`; a project overrides that with `wordCount.includeStatements` in `rev.yaml`:

```yaml
wordCount:
  includeStatements: false
  statementHeadings:
    - "Author Note"
```

`statementHeadings` adds to the built-in list (matched as the whole heading text, case-insensitive, with an optional trailing "Statement" or colon) — for a heading a profile doesn't already recognize. A profile can extend the same list with `wordLimit.statementHeadings`; both add to it, they don't replace it.

A section that should never be counted at all — a reviewer-only note kept only so it lands in the anonymized build, say — is dropped with `wordCount.exclude` in `rev.yaml`:

```yaml
wordCount:
  exclude:
    - peer_review.md
```

Entries match by exact section path or by basename. Excluded files are left out of `validate` and `word-count` entirely (word counts, section/figure/reference checks), not just the `main` total.

Profiles include: nature, science, pnas, elife, cell, plos-one, ecology-letters, global-change-biology, etc.

### Setting a Journal

In `rev.yaml`:

```yaml
journal: nature
```

Or via CLI flag (overrides rev.yaml):

```bash
rev build pdf docx -j nature
```

### Config Cascade

When a journal with formatting is set, settings are applied in three layers:

1. **Defaults** — docrev built-in defaults (12pt, margin=1in, linestretch=1.5, etc.)
2. **Journal formatting** — from the journal profile (e.g., Nature uses 11pt, 2.5cm margins, double spacing)
3. **Your rev.yaml** — explicit settings always win

This means you can set `journal: nature` and still override individual settings:

```yaml
journal: nature
pdf:
  linestretch: 1.5    # override Nature's double spacing
```

### CSL Citation Styles

Journal profiles specify a CSL style name. docrev resolves CSL files in this order:

1. File path in project directory (e.g., `nature.csl`)
2. Cached file in `~/.rev/csl/`
3. Bare name passed to pandoc --citeproc (works for some built-in styles)

Download and cache a style:

```bash
rev profiles --fetch-csl nature    # downloads to ~/.rev/csl/nature.csl
rev profiles --fetch-csl apa       # works with short names
rev profiles --list-csl            # list cached files
```

Known short names: apa, chicago, vancouver, ieee, nature, science, cell, pnas, plos, elife, ecology-letters, ama, acs, harvard, mla, elsevier, springer, biomed-central.

### Custom Profiles with Formatting

Custom profiles (YAML files in `~/.rev/profiles/` or `.rev/profiles/`) can include a `formatting` section:

```yaml
id: my-journal
name: "My Journal"
url: "https://journal.example.com/guidelines"

# Validation requirements
wordLimit:
  main: 6000
  abstract: 250
  # What the main limit counts, beyond body prose and captions
  includeAbstract: true
  includeFigureCaptions: true
  includeTableCells: false
  includeStatements: true    # false excludes acknowledgements/funding/etc from main
  includeReferences: false   # true renders the reference list and counts it
  statementHeadings:         # extra headings treated as statements
    - "Author Note"
references:
  max: 50
  doiRequired: true
keywords:
  max: 8
dataAvailability: true
sections:
  - Abstract
  - Introduction
  - Methods
  - Results
  - Discussion

# Build formatting defaults
formatting:
  csl: "vancouver"
  pdf:
    fontsize: 11pt
    geometry: margin=2cm
    linestretch: 2
    numbersections: false
  docx:
    reference: null
  crossref:
    figPrefix: [Fig., Figs.]
    tblPrefix: [Table, Tables]
```

Create a new profile template (includes formatting section):

```bash
rev profiles --new "My Journal"
```

### CLI Reference

| Command | Description |
|---------|-------------|
| `rev validate --list` | List all profiles with formatting tags |
| `rev validate -j nature` | Validate against journal requirements |
| `rev build -j nature` | Build with journal formatting defaults |
| `rev profiles --new "Name"` | Create custom profile template |
| `rev profiles --fetch-csl name` | Download CSL style to cache |
| `rev profiles --list-csl` | List cached CSL styles |
| `rev profiles --dirs` | Show profile directory locations |
