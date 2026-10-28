# docrev Command Reference

## Project Creation

### docrev new
Create a new document project.
```bash
docrev new my-document          # Creates my-document/ with section files
docrev new my-document --template apa
```

## Document Import/Export

### docrev import
Import a Word document with track changes and comments.
```bash
docrev import manuscript.docx
docrev import manuscript.docx --output ./project
```

### docrev sync
Sync feedback from a reviewed Word document into existing markdown sections.
```bash
docrev sync reviewed.docx          # Updates markdown with track changes/comments
docrev sync                        # Auto-detect most recent .docx
docrev sync reviewed.docx methods  # Sync only methods section
docrev sync reviewed.docx --comments-only  # Insert comments only; never modify prose
```

`--comments-only` skips the Word→Markdown diff entirely. Use it when the
markdown has been revised between sending the docx out for review and
receiving it back: applying track changes from a stale draft would clobber
newer edits, but comments still need to land. Comments are placed at
fuzzy-matched anchors against the current prose. Pair with
`docrev verify-anchors` to see which ones won't fit before you run sync.

### docrev verify-anchors
Report drift between Word comment anchors and the current markdown.
```bash
docrev verify-anchors reviewed.docx       # Print per-comment match quality
docrev verify-anchors reviewed.docx --json  # Machine-readable report
```

Each comment is classified by how well its anchor still matches the current
section prose:

- `clean` – exact or whitespace-normalized hit
- `drift` – anchor only matches via stripped-CriticMarkup or partial-prefix fallbacks
- `context-only` – anchor text is gone, only surrounding context survives
- `ambiguous` – multiple candidate positions; needs context to disambiguate
- `unmatched` – nothing maps; user must place the comment manually

Useful before `docrev sync --comments-only` to plan which comments will land
automatically and which need manual placement.

Both `sync` and `verify-anchors` take `-d, --dir` (where the section files
are) and `-c, --config` (the sections config, default `sections.yaml`).
`--config` resolves against the working directory, or as-is when absolute,
before it is looked for inside `--dir`; without one, `rev.yaml`'s `sections:`
list is used.
```bash
docrev verify-anchors reviewed.docx -d sections/   # sections.yaml at the project root still applies
```

### docrev build
Build output documents from markdown sections.
```bash
docrev build                    # Build PDF and DOCX
docrev build pdf                # PDF only
docrev build docx               # DOCX only
docrev build --toc              # Include table of contents
docrev build docx --dual        # Clean + annotated versions
docrev build docx --show-changes  # DOCX with visible track changes (audit)
docrev build docx --dual --show-changes  # One DOCX: tracked changes + threaded comments
docrev build docx --pandoc-arg=--lua-filter=tofill.lua   # Pass extra args to pandoc
docrev build -o Final_Report     # Override output filename (extension auto-added)
docrev build pdf --verbose      # Echo the pandoc invocation (useful for filter debugging)
```

By default, outputs land in `output/` next to `rev.yaml`. Override or
disable via the `outputDir` field in rev.yaml (see below).

#### Choosing output filenames

By default, the output basename is derived from `title:` (slugified — e.g.
"My Paper" → `my-paper.docx`). Long titles are truncated at word boundaries
(at the last `-` at-or-before 80 chars), so `communities` stays whole instead
of becoming `communitie`.

To pick your own filename, set per-format names in `rev.yaml`:

```yaml
output:
  docx: ADAPT_proposal_draft.docx
  pdf: ADAPT_proposal_draft.pdf
```

Extensions are optional — `ADAPT_proposal_draft` is fine, the right extension
is added per format. Relative paths resolve under `outputDir`; absolute paths
bypass `outputDir`.

Or override on the command line with `-o, --output <path>`:

```bash
docrev build docx -o Final_Report           # → output/Final_Report.docx
docrev build pdf docx -o Final_Report       # Applies to both formats
docrev build -o /tmp/draft.docx docx        # Absolute path bypasses outputDir
```

CLI `-o` wins over `output:` in `rev.yaml`. When `--dual` is on, the
`_comments` variant piggybacks on the chosen name (e.g.
`Final_Report_comments.docx`). When `--show-changes` is on, the audit DOCX
uses the chosen name with a `-changes` suffix
(e.g. `Final_Report-changes.docx`).

#### Passing custom pandoc args

For pandoc flags docrev doesn't surface directly (Lua/JSON filters, custom
templates, variables, etc.), use the repeatable `--pandoc-arg` flag or the
`pandoc-args` field in `rev.yaml`:

```yaml
# rev.yaml — applies to every format
pandoc-args:
  - --lua-filter=tofill.lua
  - --shift-heading-level-by=1

# Format-specific (concatenated after the top-level list)
docx:
  pandoc-args:
    - --lua-filter=docx_only.lua
pdf:
  pandoc-args:
    - --variable=papersize:a4
```

```bash
# CLI overrides — appended last, so pandoc's last-wins rule lets CLI flags
# beat repeated config flags
docrev build docx --pandoc-arg=--lua-filter=cli.lua --pandoc-arg=--metadata=draft:true
```

Run with `--verbose` to print the full pandoc command line (one per format).
Copy-paste it into a terminal to reproduce a build manually.

The `--dual` flag produces:
- `output/<title>.docx` — clean, for submission
- `output/<title>_comments.docx` — includes comment threads as Word comments

The `--show-changes` flag (DOCX only) produces a single audit document
(`output/<title>-changes.docx`) where every insertion/deletion/substitution is
exported as a visible Word track change, attributed to the configured user.
Useful when a co-author wants to see what changed since the last shared
version. The revisions are emitted by pandoc as native run-level `w:ins`/`w:del`
elements through the full filter chain (crossref, citeproc, reference-doc,
macros) — not post-processed markers.

Combine `--dual --show-changes` to get one `output/<title>-changes.docx` with
tracked changes AND threaded comments: your `{++..++}`/`{--..--}` edits as
track changes alongside the reviewer's `{>>..<<}` comments and your threaded
replies. This is the standard "return to senior author" artifact. Add
`--reference <docx>` to realign comment anchors against a reviewer's copy
before injecting.

### docrev preview
Build and open document in default app.
```bash
docrev preview pdf              # Build and open PDF
docrev preview docx             # Build and open Word
```

### docrev export
Export project as distributable zip.
```bash
docrev export                   # Creates project.zip (no node_modules)
```

### docrev backup
Create timestamped project backup.
```bash
docrev backup                   # Creates backup-2024-12-29.zip
docrev backup --name v1-draft   # Creates v1-draft.zip
```

## Comments & Annotations

### docrev comments
List all comments with context.
```bash
docrev comments methods.md                    # Show comments
docrev comments methods.md --export out.csv   # Export to CSV
```

### docrev reply
Reply to a specific comment (non-interactive).
```bash
docrev reply methods.md -n 1 -m "Added clarification"
docrev reply results.md -n 3 -m "Updated figure"
```

### docrev resolve
Mark a comment as resolved.
```bash
docrev resolve methods.md -n 1
docrev resolve methods.md -n 1,2,3   # Multiple comments
```

### docrev status
Show project overview or annotation counts for a file.
```bash
docrev status               # Project overview (words, comments, changes)
docrev status methods.md    # Specific file annotations
```

### docrev next / docrev prev
Navigate pending comments.
```bash
docrev next                 # Show next pending comment
docrev next -n 3            # Show 3rd pending comment
docrev prev                 # Show last pending comment
docrev first methods        # First comment in methods section
docrev last                 # Last comment overall
```

### docrev todo
List all pending comments as a checklist.
```bash
docrev todo                 # List all pending
docrev todo --by-author     # Group by author
```

### docrev accept / docrev reject
Accept or reject track changes.
```bash
docrev accept methods.md         # List all changes
docrev accept methods.md -n 1    # Accept change #1
docrev accept methods.md -a      # Accept all
docrev reject methods.md -n 2    # Reject change #2
```

### docrev archive
Archive reviewer .docx files.
```bash
docrev archive              # Move all .docx to archive/
docrev archive --by Smith   # Specify reviewer name
docrev archive --dry-run    # Preview without moving
```

### docrev strip
Remove all annotations from markdown.
```bash
docrev strip methods.md --output clean.md
docrev strip methods.md --accept          # Accept all changes
docrev strip methods.md --reject          # Reject all changes
```

## Response Letter

### docrev response
Generate point-by-point response letter from comments.
```bash
docrev response                 # Generate response letter
```

## Validation & Checks

### docrev check
Run all pre-submission checks (lint + grammar + citations).
```bash
docrev check                    # Run all checks
docrev check --fix              # Auto-fix where possible
```

### docrev lint
Check for common issues.
```bash
docrev lint                     # Run all checks
docrev lint --fix               # Auto-fix where possible
```
Checks: broken cross-references, missing citations, orphaned figures, unresolved comments.

### docrev grammar
Check grammar and style.
```bash
docrev grammar                  # Check all sections
docrev grammar --rules          # List available rules
docrev grammar --learn word     # Add to custom dictionary
docrev grammar --forget word    # Remove from dictionary
docrev grammar --list           # Show custom dictionary
docrev grammar -s warning       # Filter by severity
```

### docrev spelling
Check spelling in all sections.
```bash
docrev spelling                 # Check all sections
docrev spelling --british       # Use British English dictionary
docrev spelling --learn word    # Add to global dictionary (~/.rev-dictionary)
docrev spelling --learn-project word  # Add to project dictionary
docrev spelling --forget word   # Remove from global dictionary
docrev spelling --list          # Show global dictionary
docrev spelling --list-all      # Show global + project dictionaries
```
Built-in scientific vocabulary reduces false positives. Possible author names are shown separately for easy review.

### docrev validate
Check against journal requirements.
```bash
docrev validate --journal nature
docrev validate --list          # List 22 built-in journal profiles, plus custom ones
```

### docrev citations
Validate citations against bibliography.
```bash
docrev citations
```

## DOI Management

### docrev doi check
Validate DOIs in bibliography.
```bash
docrev doi check references.bib
docrev doi check references.bib --strict   # Fail if articles missing DOIs
```

### docrev doi lookup
Find missing DOIs by title/author/year.
```bash
docrev doi lookup references.bib
docrev doi lookup references.bib --confidence high
```

### docrev doi fetch
Get BibTeX from a DOI.
```bash
docrev doi fetch 10.1234/example
```

### docrev doi add
Add citation to .bib file from DOI.
```bash
docrev doi add 10.1234/example
docrev doi add 10.1234/example --file references.bib
```

## Content Analysis

### docrev word-count
Show word counts per section.
```bash
docrev word-count               # Per-section counts
docrev word-count --limit 5000  # Warn if over limit
docrev word-count -j nature     # Journal word limit, counted as docrev validate counts it
docrev word-count -c rev-el.yaml  # Count under another config; section paths relative to the cwd
```

With `-j`, the total checked against the limit is body prose plus whatever the profile's `wordLimit` includes (abstract, figure captions, table cells, rendered reference list), and the parts are listed.

### docrev stats
Project dashboard showing overview.
```bash
docrev stats                    # Words, figures, citations, comments
```

### docrev search
Search across all section files.
```bash
docrev search "climate change"
docrev search -i "method"       # Case-insensitive
```

### docrev figures
List figures with reference counts.
```bash
docrev figures methods.md
```

### docrev equations
Work with LaTeX equations.
```bash
docrev equations list           # List all equations
docrev equations from-word manuscript.docx  # Extract from Word
```

## Direct DOCX Editing (Layout Workflow)

### docrev annotate
Add comments directly to Word document.
```bash
docrev annotate paper.docx -m "Comment" -s "text to find"
```

### docrev apply
Apply MD annotations as Word track changes.
```bash
docrev apply paper.md output.docx
```

### docrev comment
Interactive comment mode for Word documents.
```bash
docrev comment paper.docx
```

## Project Management

### docrev clean
Remove generated files.
```bash
docrev clean                    # Remove paper.md, PDFs, DOCXs
docrev clean --dry-run          # Show what would be deleted
docrev clean --all              # Also remove backups and exports
```

### docrev open
Open project folder or file.
```bash
docrev open                     # Open project folder
docrev open paper.pdf           # Open specific file
```

### docrev watch
Auto-rebuild on file changes.
```bash
docrev watch                    # Watch and rebuild
docrev watch pdf                # Only rebuild PDF
docrev watch --no-open          # Don't open after build
```

## Configuration

### docrev config
Configure user settings.
```bash
docrev config user "Your Name"  # Set author name for replies
docrev config                   # Show current config
```

## rev.yaml Settings

### Output Directory

By default, built artefacts land in `output/` next to `rev.yaml`. Both the
clean output and `--dual` companion (`*_comments.docx` / `*_comments.pdf`)
follow the configured location. Override or disable:

```yaml
outputDir: output       # default — outputs land in ./output/
outputDir: dist         # custom subdirectory
outputDir: null         # legacy layout — outputs alongside paper.md
```

Explicit caller-supplied output paths (e.g. internal temp files in the
dual flow) bypass `outputDir`.

### PDF Engine and Fonts

The default PDF engine is `pdflatex`. Switch to xelatex/lualatex when the
manuscript needs native UTF-8 rendering of Latin-Extended diacritics
(Czech/Polish/Croatian/Spanish author names, species epithets):

```yaml
pdf:
  engine: xelatex          # or lualatex, tectonic, etc.
  mainfont: "TeX Gyre Termes"   # serif (xelatex/lualatex only — uses fontspec)
  sansfont: "TeX Gyre Heros"    # sans (optional)
  monofont: "TeX Gyre Cursor"   # monospace (optional)
```

`mainfont`/`sansfont`/`monofont` are forwarded as pandoc `-V` flags and
require an engine that loads `fontspec` (xelatex or lualatex). They are
ignored under `pdflatex`.

### Tables

Configure table formatting for PDF output:

```yaml
tables:
  nowrap:
    - Prior           # Column headers to keep on one line
    - "$\\widehat{R}$"
```

In `nowrap` columns, distribution notation is auto-converted to LaTeX math:
- `Normal(0, 0.5)` → `$\mathcal{N}(0, 0.5)$`
- `Student-t(3, 0, 1)` → `$t_3(0, 1)$`
- `Gamma(2, 0.5)` → `$\text{Gamma}(2, 0.5)$`
- `Half-Normal(0, 1)` → `$\text{Half-Normal}(0, 1)$`
- `Exponential(1)` → `$\text{Exp}(1)$`

**Tip:** For complex tables, use simple tables (space-aligned with dashes) instead of pipe tables to avoid column width issues:

```markdown
  Parameter    Prior                       Description
  ----------   -------------------------   ------------------
  alpha        $\mathcal{N}(0, 0.5)$       Intercept prior
  beta         $t_3(0, 2.5)$               Slope prior
```

### Postprocess Scripts

Run custom scripts after output generation:

```yaml
postprocess:
  pdf: ./scripts/fix-pdf.py      # Runs after PDF
  docx: ./scripts/add-meta.js    # Runs after DOCX
  tex: ./scripts/tweak-latex.sh  # Runs after TEX
  pptx: ./scripts/fix-slides.ps1 # Runs after PPTX
  all: ./scripts/notify.js       # Runs after ANY format
```

**Environment variables** available to scripts:

| Variable | Description |
|----------|-------------|
| `OUTPUT_FILE` | Full path to generated file |
| `OUTPUT_FORMAT` | Format: `pdf`, `docx`, `tex`, `pptx`, `beamer` |
| `PROJECT_DIR` | Directory containing rev.yaml |
| `CONFIG_PATH` | Full path to rev.yaml |

**Supported script types:** `.js`, `.mjs` (Node), `.py` (Python), `.ps1` (PowerShell), `.sh` (Bash)

**Example Python script** (add DOCX metadata):
```python
import os
from docx import Document
doc = Document(os.environ['OUTPUT_FILE'])
doc.core_properties.author = "Research Team"
doc.save(os.environ['OUTPUT_FILE'])
```

Use `--verbose` flag to see script output:
```bash
docrev build pdf --verbose
```

## Shell Completions

### docrev completions
Output shell completions.
```bash
eval "$(docrev completions bash)"  # Bash
eval "$(docrev completions zsh)"   # Zsh
```

## AI Skill Installation

### docrev install-cli-skill
Install the docrev skill for AI coding assistants.
```bash
docrev install-cli-skill        # Install to ~/.claude/skills/docrev
```

### docrev uninstall-cli-skill
Remove the installed skill.
```bash
docrev uninstall-cli-skill
```
