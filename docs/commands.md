# Command Reference

Complete list of `docrev` commands.

## Build & Create

| Command | Description |
|---------|-------------|
| `docrev build [formats...]` | Build PDF/DOCX/TEX from sections |
| `docrev build pdf` | Build PDF only |
| `docrev build docx` | Build DOCX only |
| `docrev build tex` | Build LaTeX only |
| `docrev build all` | Build PDF + DOCX + TEX |
| `docrev build --toc` | Include table of contents |
| `docrev build --dual` | Output clean + comments DOCX (with threaded comments) |
| `docrev build --show-changes` | Export DOCX with visible track changes |
| `docrev build docx --dual --show-changes` | One DOCX with tracked changes AND threaded comments |
| `docrev new <name>` | Create new project (prompts for sections) |
| `docrev new <name> -s intro,methods,results` | Create with specified sections |
| `docrev new --list` | List available templates |
| `docrev install` | Check/install dependencies (pandoc-crossref) |
| `docrev build story` | Build story.md to a standalone docx for co-authors |
| `docrev build journey` | Build journey.md to a standalone docx for co-authors |
| `docrev build story pdf` | Same, as PDF (also builds the main paper's PDF) |

## Import & Export

| Command | Description |
|---------|-------------|
| `docrev import <docx>` | Bootstrap project from Word (creates sections + rev.yaml) |
| `docrev import <docx> <md>` | Import changes by diffing Word against your MD |
| `docrev sync [docx] [sections...]` | Sync feedback from Word to section files |
| `docrev sync` | Auto-detect most recent .docx |
| `docrev sync reviewed.docx methods` | Sync only methods section |
| `docrev sync annotated.pdf` | Extract comments from PDF into markdown |
| `docrev sync reviewed.docx --comments-only` | Insert comments only; never modify prose |
| `docrev sync reviewed.docx -d sections/` | Section files live in `sections/` |
| `docrev verify-anchors reviewed.docx` | Report which comment anchors still match the current prose |
| `docrev verify-anchors reviewed.docx --json` | Same report as JSON |
| `docrev extract <docx>` | Extract plain text from Word |
| `docrev archive` | Move reviewer .docx files to archive folder |
| `docrev archive --by Smith` | Specify reviewer name |
| `docrev archive --dry-run` | Preview without moving |

`sync` and `verify-anchors` take two path options:

- `-d, --dir <directory>` is where the section markdown files are (default `.`).
- `-c, --config <file>` is the sections config (default `sections.yaml`). It is resolved against the working directory, or used as-is when absolute, and only then looked for inside `--dir`. Without one, the `sections:` list in `rev.yaml` is used. A `sections.yaml` at the project root therefore still applies when `--dir` points at a subdirectory.

**Word Import Features:**
- Extracts text preserving structure
- Extracts comments with author and anchor text
- Converts OMML equations to LaTeX
- Extracts embedded images to `media/` directory

## PDF Comments

| Command | Description |
|---------|-------------|
| `docrev pdf-comments <pdf>` | Extract and display comments from annotated PDF |
| `docrev pdf-comments <pdf> --with-text` | Also extract the highlighted text content |
| `docrev pdf-comments <pdf> --append <file.md>` | Append extracted comments to markdown file |
| `docrev pdf-comments <pdf> --json` | Output comments as JSON |
| `docrev pdf-comments <pdf> --by-page` | Group comments by page (default) |
| `docrev pdf-comments <pdf> --by-author` | Group comments by author |
| `docrev build pdf --dual` | Build clean PDF + annotated PDF with margin notes |

**Supported PDF Annotations:**
- Sticky notes (Text annotations)
- Text boxes (FreeText)
- Highlights with comments (text extraction supported)
- Underlines with comments (text extraction supported)
- Strikethrough/deletion suggestions (text extraction supported)
- Squiggly underlines (text extraction supported)

**Text Extraction:**
Use `--with-text` to extract the actual text that was highlighted, underlined, or struck through. This is slower but shows exactly what the reviewer marked.

**DOCX Export Modes:**

| Flags | Output |
|-------|--------|
| `docrev build docx` | Clean `paper.docx` (annotations applied) |
| `docrev build docx --dual` | `paper.docx` + `paper_comments.docx` (threaded comments) |
| `docrev build docx --show-changes` | `paper-changes.docx` with visible tracked changes |
| `docrev build docx --dual --show-changes` | `paper-changes.docx` with tracked changes **and** threaded comments in one file |

`--dual --show-changes` is the "return to senior author" artifact: your `{++..++}`/`{--..--}` edits as Word tracked changes alongside the reviewer's `{>>..<<}` comments with your threaded replies. Add `--reference <docx>` to realign comment anchors against a reviewer's copy first.

**PDF Dual Export:**
When building with `--dual`, produces:
- `paper.pdf` — clean version for submission
- `paper_comments.pdf` — CriticMarkup comments rendered as LaTeX margin notes

## Review & Edit

| Command | Description |
|---------|-------------|
| `docrev review <file>` | Interactive accept/reject TUI for track changes |
| `docrev status` | Show project overview (words, comments, changes) |
| `docrev status <file>` | Show annotation counts for specific file |
| `docrev comments <file>` | List all comments with context |
| `docrev comments <file> --export comments.csv` | Export comments to CSV |
| `docrev resolve <file> -n 1` | Mark comment #1 as resolved |
| `docrev strip <file>` | Output clean Markdown (annotations applied) |

## Comment Navigation

| Command | Description |
|---------|-------------|
| `docrev next` | Show next pending comment |
| `docrev next -n 3` | Show 3rd pending comment |
| `docrev prev` | Show last pending comment |
| `docrev prev -n 2` | Show 2nd from last pending |
| `docrev first` | Show first comment (all, not just pending) |
| `docrev first methods` | First comment in methods section |
| `docrev last` | Show last comment |
| `docrev todo` | List all pending comments as checklist |
| `docrev todo --by-author` | Group pending comments by author |

## Track Changes

| Command | Description |
|---------|-------------|
| `docrev accept <file>` | List track changes |
| `docrev accept <file> -n 1` | Accept change #1 |
| `docrev accept <file> -a` | Accept all changes |
| `docrev reject <file> -n 1` | Reject change #1 |
| `docrev reject <file> -a` | Reject all changes |

## Cross-References

| Command | Description |
|---------|-------------|
| `docrev refs [file]` | Show figure/table registry and reference status |
| `docrev migrate <file>` | Convert hardcoded refs (Fig. 1) to dynamic (@fig:label) |

**Supported patterns:**
- `Figure 1` → `@fig:label`
- `Fig. 2a` → `@fig:label`
- `Figs. 1-3` → `@fig:one; @fig:two; @fig:three`
- `Figures 1, 2, and 3` → multiple refs
- `Fig. 1a-c` → expands letter suffixes

## Comments & Replies

| Command | Description |
|---------|-------------|
| `docrev config user "Name"` | Set your name for replies |
| `docrev config sections "a,b,c"` | Set default sections for new projects |
| `docrev reply <file>` | Interactive reply to reviewer comments |
| `docrev reply <file> -n 1 -m "text"` | Reply to specific comment (non-interactive) |

**Comment Threading:**
Adjacent comments from different authors become threaded replies in Word:
```markdown
{>>Guy Colling: Question?<<} {>>Gilles Colling: Answer.<<}
```

## Bibliography & DOIs

| Command | Description |
|---------|-------------|
| `docrev doi check [file.bib]` | Validate DOIs in bibliography (Crossref + DataCite) |
| `docrev doi lookup [file.bib]` | Search for missing DOIs by title/author/year |
| `docrev doi fetch <doi>` | Fetch BibTeX entry from DOI |
| `docrev doi add <doi>` | Fetch and add DOI entry to bibliography |

**Options:**
- `--confidence low|medium|high` - Filter lookup results
- `--strict` - Fail if articles are missing DOIs
- Skip entries: add `nodoi = {true}` or `% no-doi` comment

## Validation & Analysis

| Command | Description |
|---------|-------------|
| `docrev citations [file.bib]` | Validate citations against bibliography |
| `docrev figures [file]` | List figures/tables with reference counts |
| `docrev equations list` | List all equations in section files |
| `docrev equations from-word <docx>` | Extract equations from Word to LaTeX |
| `docrev response [files]` | Generate response letter from comments |
| `docrev anonymize <file>` | Prepare document for blind review |
| `docrev validate --journal <name>` | Check manuscript against journal requirements |
| `docrev validate --list` | List 21 available journal profiles |

## Story & Journey Sidecars

`story.md` and `journey.md` sit beside a manuscript for its whole life: `story.md`
records the paper's argument as a handful of arcs, `journey.md` records how each
paragraph/float moves the reader through it. Neither file is ever part of a
build. See [Configuration](configuration.md#story--journey-sidecars) for the
file format and `rev.yaml` keys.

| Command | Description |
|---------|-------------|
| `docrev journey init` | Assign `<!-- @p:id -->` markers to unmarked paragraphs/floats and scaffold `journey.md` |
| `docrev journey check` | Check the manuscript against `story.md` and `journey.md` |
| `docrev journey check --json` | Same, as structured JSON (parse errors + findings) |
| `docrev journey ack <ids...>` | Pin the current text of paragraphs whose `- negotiated:` decision was reconfirmed |

`docrev journey init` is idempotent: re-running it only fills gaps (a paragraph
that lost its marker after a heavy Word edit gets a fresh one; existing
journey entries keep their hand-authored `arcs`/`support`/`leaves`). Assigned
IDs are a scaffold (`intro.p1`, `res.fig1`, ...), not a final name — rename
them to something semantic once you know what each paragraph does.

`docrev journey check` is also run as step 4 of `docrev check`, but only when
`journey.md` exists — projects that don't use the sidecars are unaffected.
`information.md`, when present, is checked in the same step. `docrev check`
fails on an undefined term, an avoided wording and a negotiated paragraph
changed since its decision; every other finding is a warning.

## Multi-Reviewer & Git

| Command | Description |
|---------|-------------|
| `docrev merge <md> <docx...>` | Merge feedback from multiple Word documents |
| `docrev diff [ref]` | Compare sections against git history |
| `docrev history [file]` | Show revision history for sections |

## Convenience Commands

| Command | Description |
|---------|-------------|
| `docrev word-count` | Show word counts per section |
| `docrev word-count --limit 5000` | Warn if over limit |
| `docrev word-count -j <journal>` | Check the journal's word limit, counted as `docrev validate` counts it |
| `docrev stats` | Project dashboard (words, figures, citations) |
| `docrev search <query>` | Search across all section files |
| `docrev search -i <query>` | Case-insensitive search |
| `docrev backup` | Create timestamped backup zip |
| `docrev backup --name v1` | Custom backup name |
| `docrev export` | Export project as distributable zip |
| `docrev preview <format>` | Build and open document |
| `docrev watch [format]` | Auto-rebuild on file changes |
| `docrev lint` | Check for broken refs, missing citations |
| `docrev clean` | Remove generated files |
| `docrev clean --all` | Also remove backups and exports |
| `docrev check` | Pre-submission check (lint + grammar + citations + journey) |
| `docrev open` | Open project folder |
| `docrev open paper.pdf` | Open specific file |

## Grammar & Spelling

| Command | Description |
|---------|-------------|
| `docrev grammar` | Check grammar/style issues |
| `docrev grammar --rules` | List available grammar rules |
| `docrev grammar --learn <word>` | Add word to custom dictionary |
| `docrev grammar --list` | Show custom dictionary |
| `docrev spelling` | Check spelling in all sections |
| `docrev spelling --british` | Use British English dictionary |
| `docrev spelling --learn <word>` | Add word to global dictionary |
| `docrev spelling --learn-project <word>` | Add word to project dictionary |

## Direct DOCX Editing

| Command | Description |
|---------|-------------|
| `docrev annotate <docx> -m "Comment" -s "text"` | Add comment to Word doc |
| `docrev apply <md> <docx>` | Apply annotations as track changes |
| `docrev comment <docx>` | Interactive comment mode |

## Shell Completions

```bash
# Bash - add to ~/.bashrc
eval "$(docrev completions bash)"

# Zsh - add to ~/.zshrc
eval "$(docrev completions zsh)"

# PowerShell - add to $PROFILE
Invoke-Expression (docrev completions powershell | Out-String)
```

## Collaboration & Git

| Command | Description |
|---------|-------------|
| `docrev contributors` | Show author contributions across all sections |
| `docrev contributors <file>` | Show who wrote what in a specific file |
| `docrev contributors <file> --blame` | Line-by-line blame output |
| `docrev history` | Show revision history |
| `docrev diff` | Compare sections against git history |

## ORCID Integration

| Command | Description |
|---------|-------------|
| `docrev orcid <id>` | Fetch author info from ORCID |
| `docrev orcid <id> --yaml` | Output as YAML for rev.yaml authors |
| `docrev orcid <id> --badge` | Generate markdown badge |

## Self-Update

| Command | Description |
|---------|-------------|
| `docrev upgrade` | Update docrev to latest version |
| `docrev upgrade --check` | Check for updates without installing |
