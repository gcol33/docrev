# Claude Instructions for docrev

This is `docrev` (command: `rev`), a CLI tool for academic paper workflows with Word ↔ Markdown round-trips.

## Project Overview

- **Version**: 0.4.0
- **Node.js**: >=18.0.0
- **Test coverage**: 475 tests across 21 modules
- **TypeScript**: Full type definitions in `types/index.d.ts`

## Key Commands for Claude

### Replying to Comments
When helping the user address reviewer comments, use the non-interactive reply mode:

```bash
# Reply to a specific comment by number
rev reply <file> -n <number> -m "Your response"

# Example
rev reply methods.md -n 1 -m "Added clarification about sampling methodology in paragraph 2"
```

The user's name is already configured via `rev config user`. Replies appear as:
```markdown
{>>Reviewer: Original comment<<} {>>User Name: Your reply<<}
```

### Viewing Comments
```bash
rev comments <file>       # List all comments with context
rev status <file>         # Show annotation counts
rev resolve <file> -n 1   # Mark comment #1 as resolved
```

### Building Documents
```bash
rev build                 # Build PDF and DOCX
rev build pdf             # PDF only
rev build docx            # DOCX only
rev build --toc           # Include table of contents
```

### Validation & Analysis
```bash
rev citations             # Validate citations against bibliography
rev figures <file>        # List figures with reference counts
rev equations list        # List all LaTeX equations
rev equations from-word <docx>  # Extract equations from Word (OMML → LaTeX)
rev validate --journal nature   # Check against journal requirements
rev validate --list             # List 21 available journal profiles
```

### Export Comments
```bash
rev comments <file> --export comments.csv  # Export to CSV
```

### Response Letter
```bash
rev response              # Generate response letter from comments
```

### Convenience Commands
```bash
rev word-count            # Show word counts per section
rev word-count --limit 5000  # Warn if over limit
rev word-count -j nature  # Use journal word limit

rev stats                 # Project dashboard (words, figures, citations)

rev search "query"        # Search across all section files
rev search -i "query"     # Case-insensitive search

rev backup                # Create timestamped backup zip
rev backup --name v1      # Custom backup name

rev export                # Export project as zip (no node_modules)

rev preview pdf           # Build and open PDF
rev preview docx          # Build and open Word

rev watch                 # Auto-rebuild on file changes
rev watch pdf --no-open   # Watch without opening

rev lint                  # Check for broken refs, missing citations

rev clean                 # Remove generated files (paper.md, PDFs, DOCXs)
rev clean --all           # Also remove backups and exports

rev check                 # Pre-submission check (lint + grammar + citations)

rev open                  # Open project folder
rev open paper.pdf        # Open specific file
```

### Grammar & Style
```bash
rev grammar               # Check grammar/style issues in all sections
rev grammar --rules       # List available grammar rules
rev grammar --learn word  # Add word to custom dictionary
rev grammar --forget word # Remove from dictionary
rev grammar --list        # Show custom dictionary
rev grammar -s warning    # Filter by severity (error/warning/info)
```

### Direct DOCX Editing
```bash
rev annotate paper.docx -m "Comment" -s "text"  # Add comment to Word doc
rev apply paper.md output.docx                   # Annotations → track changes
rev comment paper.docx                           # Interactive comment mode
```

### Template Variables
Use in section files (processed during build):
- `{{date}}` - Current date (YYYY-MM-DD)
- `{{date:MMMM D, YYYY}}` - Custom format (December 29, 2025)
- `{{year}}` - Current year
- `{{version}}` - From rev.yaml
- `{{title}}` - Document title
- `{{author}}` - First author name
- `{{authors}}` - All authors (comma-separated)
- `{{word_count}}` - Total word count

## Annotation Syntax (CriticMarkup)

- `{++inserted text++}` - Additions
- `{--deleted text--}` - Deletions
- `{~~old~>new~~}` - Substitutions
- `{>>Author: comment<<}` - Comments
- `{>>Author: comment [RESOLVED]<<}` - Resolved comment

## Cross-References

Use dynamic references in markdown:
- `@fig:label` - Figure reference (becomes "Figure 1" in Word)
- `@tbl:label` - Table reference
- `@eq:label` - Equation reference
- `{#fig:label}` - Anchor for figures

## Project Structure

```
my-paper/
├── rev.yaml           # Project config (title, authors, build settings)
├── introduction.md    # Section files
├── methods.md
├── results.md
├── discussion.md
├── references.bib     # Bibliography
├── figures/           # Images
├── paper.md           # Combined output (generated)
└── my-paper.docx      # Word output (generated)
```

## DOI Management
```bash
rev doi check references.bib     # Validate DOIs (Crossref + DataCite)
rev doi lookup references.bib    # Find missing DOIs by title/author/year
rev doi fetch <doi>              # Get BibTeX from DOI
rev doi add <doi>                # Add citation to .bib file
```

Options:
- `--confidence low|medium|high` - Filter lookup results by confidence
- `--strict` - Fail if articles are missing DOIs
- Skip entries: add `nodoi = {true}` or `% no-doi` comment before entry

## Library Modules

The library can be imported programmatically:

```javascript
import { parseAnnotations, stripAnnotations } from 'docrev'
import { build } from 'docrev/build'
import { extractCitations } from 'docrev/citations'
import { checkDoi, lookupDoi } from 'docrev/doi'
import { extractEquations } from 'docrev/equations'
import { validateCitations } from 'docrev/citations'
```

Available subpath exports:
- `docrev/annotations` - CriticMarkup parsing
- `docrev/build` - Pandoc build pipeline
- `docrev/citations` - Citation validation
- `docrev/crossref` - Figure/table reference handling
- `docrev/doi` - DOI validation and lookup
- `docrev/equations` - LaTeX equation extraction
- `docrev/git` - Git integration
- `docrev/grammar` - Grammar/style checking with custom dictionary
- `docrev/journals` - Journal requirement profiles (21 journals)
- `docrev/merge` - Multi-reviewer merge
- `docrev/sections` - Section file management
- `docrev/trackchanges` - Word track changes generation
- `docrev/variables` - Template variable substitution
- `docrev/word` - Word document handling

## Development

```bash
npm test              # Run all 475 tests
npm run test:watch    # Watch mode
npm run test:coverage # Run with coverage report
```

Test files are in `test/*.test.js`. Key test patterns:
- Use temp directories for file operations
- Use AdmZip to create test .docx files programmatically
- DOI tests mock network calls by testing parsing functions

## Workflow Tips

1. When user imports a reviewed Word doc, help them go through comments
2. Use `rev reply` to respond to each comment as you address it
3. After addressing all comments, run `rev build docx` to generate updated Word doc
4. Use `rev doi check` to validate bibliography before submission
5. Use `rev response` to generate a point-by-point response letter

## Shell Completions

Enable tab completion:
```bash
eval "$(rev completions bash)"  # Bash
eval "$(rev completions zsh)"   # Zsh
```

## Claude Code Skill

Install the docrev skill for Claude Code:
```bash
rev install-cli-skill    # Install skill to ~/.claude/skills/docrev
rev uninstall-cli-skill  # Remove the skill
```

The skill teaches Claude Code how to use rev for academic paper workflows.

## Known Limitations

- `review.js` is interactive (TUI) and cannot be tested automatically
