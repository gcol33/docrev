# Command Reference

Complete list of `rev` commands.

## Build & Create

| Command | Description |
|---------|-------------|
| `rev build [formats...]` | Build PDF/DOCX/TEX from sections |
| `rev build pdf` | Build PDF only |
| `rev build docx` | Build DOCX only |
| `rev build tex` | Build LaTeX only |
| `rev build all` | Build PDF + DOCX + TEX |
| `rev build --toc` | Include table of contents |
| `rev build --dual` | Output clean + comments DOCX (with threaded comments) |
| `rev build --show-changes` | Export DOCX with visible track changes |
| `rev new <name>` | Create new project (prompts for sections) |
| `rev new <name> -s intro,methods,results` | Create with specified sections |
| `rev new --list` | List available templates |
| `rev install` | Check/install dependencies (pandoc-crossref) |

## Import & Export

| Command | Description |
|---------|-------------|
| `rev import <docx>` | Bootstrap project from Word (creates sections + rev.yaml) |
| `rev import <docx> <md>` | Import changes by diffing Word against your MD |
| `rev sync [docx] [sections...]` | Sync feedback from Word to section files |
| `rev sync` | Auto-detect most recent .docx |
| `rev sync reviewed.docx methods` | Sync only methods section |
| `rev sync annotated.pdf` | Extract comments from PDF into markdown |
| `rev extract <docx>` | Extract plain text from Word |
| `rev archive` | Move reviewer .docx files to archive folder |
| `rev archive --by Smith` | Specify reviewer name |
| `rev archive --dry-run` | Preview without moving |

**Word Import Features:**
- Extracts text preserving structure
- Extracts comments with author and anchor text
- Converts OMML equations to LaTeX
- Extracts embedded images to `media/` directory

## PDF Comments

| Command | Description |
|---------|-------------|
| `rev pdf-comments <pdf>` | Extract and display comments from annotated PDF |
| `rev pdf-comments <pdf> --with-text` | Also extract the highlighted text content |
| `rev pdf-comments <pdf> --append <file.md>` | Append extracted comments to markdown file |
| `rev pdf-comments <pdf> --json` | Output comments as JSON |
| `rev pdf-comments <pdf> --by-page` | Group comments by page (default) |
| `rev pdf-comments <pdf> --by-author` | Group comments by author |
| `rev build pdf --dual` | Build clean PDF + annotated PDF with margin notes |

**Supported PDF Annotations:**
- Sticky notes (Text annotations)
- Text boxes (FreeText)
- Highlights with comments (text extraction supported)
- Underlines with comments (text extraction supported)
- Strikethrough/deletion suggestions (text extraction supported)
- Squiggly underlines (text extraction supported)

**Text Extraction:**
Use `--with-text` to extract the actual text that was highlighted, underlined, or struck through. This is slower but shows exactly what the reviewer marked.

**PDF Dual Export:**
When building with `--dual`, produces:
- `paper.pdf` — clean version for submission
- `paper_comments.pdf` — CriticMarkup comments rendered as LaTeX margin notes

## Review & Edit

| Command | Description |
|---------|-------------|
| `rev review <file>` | Interactive accept/reject TUI for track changes |
| `rev status` | Show project overview (words, comments, changes) |
| `rev status <file>` | Show annotation counts for specific file |
| `rev comments <file>` | List all comments with context |
| `rev comments <file> --export comments.csv` | Export comments to CSV |
| `rev resolve <file> -n 1` | Mark comment #1 as resolved |
| `rev strip <file>` | Output clean Markdown (annotations applied) |

## Comment Navigation

| Command | Description |
|---------|-------------|
| `rev next` | Show next pending comment |
| `rev next -n 3` | Show 3rd pending comment |
| `rev prev` | Show last pending comment |
| `rev prev -n 2` | Show 2nd from last pending |
| `rev first` | Show first comment (all, not just pending) |
| `rev first methods` | First comment in methods section |
| `rev last` | Show last comment |
| `rev todo` | List all pending comments as checklist |
| `rev todo --by-author` | Group pending comments by author |

## Track Changes

| Command | Description |
|---------|-------------|
| `rev accept <file>` | List track changes |
| `rev accept <file> -n 1` | Accept change #1 |
| `rev accept <file> -a` | Accept all changes |
| `rev reject <file> -n 1` | Reject change #1 |
| `rev reject <file> -a` | Reject all changes |

## Cross-References

| Command | Description |
|---------|-------------|
| `rev refs [file]` | Show figure/table registry and reference status |
| `rev migrate <file>` | Convert hardcoded refs (Fig. 1) to dynamic (@fig:label) |

**Supported patterns:**
- `Figure 1` → `@fig:label`
- `Fig. 2a` → `@fig:label`
- `Figs. 1-3` → `@fig:one; @fig:two; @fig:three`
- `Figures 1, 2, and 3` → multiple refs
- `Fig. 1a-c` → expands letter suffixes

## Comments & Replies

| Command | Description |
|---------|-------------|
| `rev config user "Name"` | Set your name for replies |
| `rev config sections "a,b,c"` | Set default sections for new projects |
| `rev reply <file>` | Interactive reply to reviewer comments |
| `rev reply <file> -n 1 -m "text"` | Reply to specific comment (non-interactive) |

**Comment Threading:**
Adjacent comments from different authors become threaded replies in Word:
```markdown
{>>Guy Colling: Question?<<} {>>Gilles Colling: Answer.<<}
```

## Bibliography & DOIs

| Command | Description |
|---------|-------------|
| `rev doi check [file.bib]` | Validate DOIs in bibliography (Crossref + DataCite) |
| `rev doi lookup [file.bib]` | Search for missing DOIs by title/author/year |
| `rev doi fetch <doi>` | Fetch BibTeX entry from DOI |
| `rev doi add <doi>` | Fetch and add DOI entry to bibliography |

**Options:**
- `--confidence low|medium|high` - Filter lookup results
- `--strict` - Fail if articles are missing DOIs
- Skip entries: add `nodoi = {true}` or `% no-doi` comment

## Validation & Analysis

| Command | Description |
|---------|-------------|
| `rev citations [file.bib]` | Validate citations against bibliography |
| `rev figures [file]` | List figures/tables with reference counts |
| `rev equations list` | List all equations in section files |
| `rev equations from-word <docx>` | Extract equations from Word to LaTeX |
| `rev response [files]` | Generate response letter from comments |
| `rev anonymize <file>` | Prepare document for blind review |
| `rev validate --journal <name>` | Check manuscript against journal requirements |
| `rev validate --list` | List 21 available journal profiles |

## Multi-Reviewer & Git

| Command | Description |
|---------|-------------|
| `rev merge <md> <docx...>` | Merge feedback from multiple Word documents |
| `rev diff [ref]` | Compare sections against git history |
| `rev history [file]` | Show revision history for sections |

## Convenience Commands

| Command | Description |
|---------|-------------|
| `rev word-count` | Show word counts per section |
| `rev word-count --limit 5000` | Warn if over limit |
| `rev word-count -j <journal>` | Use journal word limit |
| `rev stats` | Project dashboard (words, figures, citations) |
| `rev search <query>` | Search across all section files |
| `rev search -i <query>` | Case-insensitive search |
| `rev backup` | Create timestamped backup zip |
| `rev backup --name v1` | Custom backup name |
| `rev export` | Export project as distributable zip |
| `rev preview <format>` | Build and open document |
| `rev watch [format]` | Auto-rebuild on file changes |
| `rev lint` | Check for broken refs, missing citations |
| `rev clean` | Remove generated files |
| `rev clean --all` | Also remove backups and exports |
| `rev check` | Pre-submission check (lint + grammar + citations) |
| `rev open` | Open project folder |
| `rev open paper.pdf` | Open specific file |

## Grammar & Spelling

| Command | Description |
|---------|-------------|
| `rev grammar` | Check grammar/style issues |
| `rev grammar --rules` | List available grammar rules |
| `rev grammar --learn <word>` | Add word to custom dictionary |
| `rev grammar --list` | Show custom dictionary |
| `rev spelling` | Check spelling in all sections |
| `rev spelling --british` | Use British English dictionary |
| `rev spelling --learn <word>` | Add word to global dictionary |
| `rev spelling --learn-project <word>` | Add word to project dictionary |

## Direct DOCX Editing

| Command | Description |
|---------|-------------|
| `rev annotate <docx> -m "Comment" -s "text"` | Add comment to Word doc |
| `rev apply <md> <docx>` | Apply annotations as track changes |
| `rev comment <docx>` | Interactive comment mode |

## Shell Completions

```bash
# Bash - add to ~/.bashrc
eval "$(rev completions bash)"

# Zsh - add to ~/.zshrc
eval "$(rev completions zsh)"
```
