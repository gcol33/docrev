# docrev Command Reference

## Project Creation

### rev new
Create a new document project.
```bash
rev new my-document          # Creates my-document/ with section files
rev new my-document --template apa
```

## Document Import/Export

### rev import
Import a Word document with track changes and comments.
```bash
rev import manuscript.docx
rev import manuscript.docx --output ./project
```

### rev sync
Sync feedback from a reviewed Word document into existing markdown sections.
```bash
rev sync reviewed.docx       # Updates markdown with track changes/comments
rev sync                     # Auto-detect most recent .docx
rev sync reviewed.docx methods  # Sync only methods section
```

### rev build
Build output documents from markdown sections.
```bash
rev build                    # Build PDF and DOCX
rev build pdf                # PDF only
rev build docx               # DOCX only
rev build --toc              # Include table of contents
rev build docx --dual        # Clean + annotated versions
```

The `--dual` flag produces:
- `paper.docx` — clean, for submission
- `paper_comments.docx` — includes comment threads as Word comments

### rev preview
Build and open document in default app.
```bash
rev preview pdf              # Build and open PDF
rev preview docx             # Build and open Word
```

### rev export
Export project as distributable zip.
```bash
rev export                   # Creates project.zip (no node_modules)
```

### rev backup
Create timestamped project backup.
```bash
rev backup                   # Creates backup-2024-12-29.zip
rev backup --name v1-draft   # Creates v1-draft.zip
```

## Comments & Annotations

### rev comments
List all comments with context.
```bash
rev comments methods.md                    # Show comments
rev comments methods.md --export out.csv   # Export to CSV
```

### rev reply
Reply to a specific comment (non-interactive).
```bash
rev reply methods.md -n 1 -m "Added clarification"
rev reply results.md -n 3 -m "Updated figure"
```

### rev resolve
Mark a comment as resolved.
```bash
rev resolve methods.md -n 1
rev resolve methods.md -n 1,2,3   # Multiple comments
```

### rev status
Show project overview or annotation counts for a file.
```bash
rev status               # Project overview (words, comments, changes)
rev status methods.md    # Specific file annotations
```

### rev next / rev prev
Navigate pending comments.
```bash
rev next                 # Show next pending comment
rev next -n 3            # Show 3rd pending comment
rev prev                 # Show last pending comment
rev first methods        # First comment in methods section
rev last                 # Last comment overall
```

### rev todo
List all pending comments as a checklist.
```bash
rev todo                 # List all pending
rev todo --by-author     # Group by author
```

### rev accept / rev reject
Accept or reject track changes.
```bash
rev accept methods.md         # List all changes
rev accept methods.md -n 1    # Accept change #1
rev accept methods.md -a      # Accept all
rev reject methods.md -n 2    # Reject change #2
```

### rev archive
Archive reviewer .docx files.
```bash
rev archive              # Move all .docx to archive/
rev archive --by Smith   # Specify reviewer name
rev archive --dry-run    # Preview without moving
```

### rev strip
Remove all annotations from markdown.
```bash
rev strip methods.md --output clean.md
rev strip methods.md --accept          # Accept all changes
rev strip methods.md --reject          # Reject all changes
```

## Response Letter

### rev response
Generate point-by-point response letter from comments.
```bash
rev response                 # Generate response letter
```

## Validation & Checks

### rev check
Run all pre-submission checks (lint + grammar + citations).
```bash
rev check                    # Run all checks
rev check --fix              # Auto-fix where possible
```

### rev lint
Check for common issues.
```bash
rev lint                     # Run all checks
rev lint --fix               # Auto-fix where possible
```
Checks: broken cross-references, missing citations, orphaned figures, unresolved comments.

### rev grammar
Check grammar and style.
```bash
rev grammar                  # Check all sections
rev grammar --rules          # List available rules
rev grammar --learn word     # Add to custom dictionary
rev grammar --forget word    # Remove from dictionary
rev grammar --list           # Show custom dictionary
rev grammar -s warning       # Filter by severity
```

### rev spelling
Check spelling in all sections.
```bash
rev spelling                 # Check all sections
rev spelling --british       # Use British English dictionary
rev spelling --learn word    # Add to global dictionary (~/.rev-dictionary)
rev spelling --learn-project word  # Add to project dictionary
rev spelling --forget word   # Remove from global dictionary
rev spelling --list          # Show global dictionary
rev spelling --list-all      # Show global + project dictionaries
```
Built-in scientific vocabulary reduces false positives. Possible author names are shown separately for easy review.

### rev validate
Check against journal requirements.
```bash
rev validate --journal nature
rev validate --list          # List 21 available journals
```

### rev citations
Validate citations against bibliography.
```bash
rev citations
```

## DOI Management

### rev doi check
Validate DOIs in bibliography.
```bash
rev doi check references.bib
rev doi check references.bib --strict   # Fail if articles missing DOIs
```

### rev doi lookup
Find missing DOIs by title/author/year.
```bash
rev doi lookup references.bib
rev doi lookup references.bib --confidence high
```

### rev doi fetch
Get BibTeX from a DOI.
```bash
rev doi fetch 10.1234/example
```

### rev doi add
Add citation to .bib file from DOI.
```bash
rev doi add 10.1234/example
rev doi add 10.1234/example --file references.bib
```

## Content Analysis

### rev word-count
Show word counts per section.
```bash
rev word-count               # Per-section counts
rev word-count --limit 5000  # Warn if over limit
rev word-count -j nature     # Use journal word limit
```

### rev stats
Project dashboard showing overview.
```bash
rev stats                    # Words, figures, citations, comments
```

### rev search
Search across all section files.
```bash
rev search "climate change"
rev search -i "method"       # Case-insensitive
```

### rev figures
List figures with reference counts.
```bash
rev figures methods.md
```

### rev equations
Work with LaTeX equations.
```bash
rev equations list           # List all equations
rev equations from-word manuscript.docx  # Extract from Word
```

## Direct DOCX Editing (Layout Workflow)

### rev annotate
Add comments directly to Word document.
```bash
rev annotate paper.docx -m "Comment" -s "text to find"
```

### rev apply
Apply MD annotations as Word track changes.
```bash
rev apply paper.md output.docx
```

### rev comment
Interactive comment mode for Word documents.
```bash
rev comment paper.docx
```

## Project Management

### rev clean
Remove generated files.
```bash
rev clean                    # Remove paper.md, PDFs, DOCXs
rev clean --dry-run          # Show what would be deleted
rev clean --all              # Also remove backups and exports
```

### rev open
Open project folder or file.
```bash
rev open                     # Open project folder
rev open paper.pdf           # Open specific file
```

### rev watch
Auto-rebuild on file changes.
```bash
rev watch                    # Watch and rebuild
rev watch pdf                # Only rebuild PDF
rev watch --no-open          # Don't open after build
```

## Configuration

### rev config
Configure user settings.
```bash
rev config user "Your Name"  # Set author name for replies
rev config                   # Show current config
```

## Shell Completions

### rev completions
Output shell completions.
```bash
eval "$(rev completions bash)"  # Bash
eval "$(rev completions zsh)"   # Zsh
```

## AI Skill Installation

### rev install-cli-skill
Install the docrev skill for AI coding assistants.
```bash
rev install-cli-skill        # Install to ~/.claude/skills/docrev
```

### rev uninstall-cli-skill
Remove the installed skill.
```bash
rev uninstall-cli-skill
```
