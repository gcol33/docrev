---
name: docrev
description: "Academic paper revision workflow tool (CLI: `rev`). Use when working with Word documents containing reviewer comments, importing track changes to markdown, replying to reviewer comments, building PDF/DOCX outputs, generating response letters, validating citations/DOIs, or any academic paper revision task."
---

# docrev - Academic Paper Revision Tool

`rev` is a CLI tool for academic paper workflows with Word ↔ Markdown round-trips.

## Core Workflow

### 1. Import reviewed Word document

```bash
rev import --file manuscript-reviewed.docx
```

This extracts track changes and comments as CriticMarkup annotations in markdown files.

### 2. View and address comments

```bash
rev comments methods.md              # List all comments with context
rev status methods.md                # Show annotation counts
```

### 3. Reply to reviewer comments

**Always use the non-interactive reply mode:**

```bash
rev reply methods.md -n 1 -m "Added clarification about sampling methodology"
rev reply results.md -n 3 -m "Updated figure to include 95% CI"
```

Replies appear as: `{>>Reviewer: Original<<} {>>User: Reply<<}`

### 4. Resolve addressed comments

```bash
rev resolve methods.md -n 1          # Mark comment #1 as resolved
```

### 5. Build output documents

```bash
rev build                            # Build both PDF and DOCX
rev build docx                       # Word only
rev build pdf                        # PDF only
rev build --toc                      # Include table of contents
```

### 6. Generate response letter

```bash
rev response                         # Generate point-by-point response letter
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
| Word count per section | `rev word-count` |
| Word count with limit | `rev word-count --limit 5000` |
| Project dashboard | `rev stats` |
| Search all sections | `rev search "query"` |
| Pre-submission check | `rev check` |
| Validate citations | `rev citations` |
| Check grammar/style | `rev grammar` |
| Check spelling | `rev spelling` |
| Open PDF preview | `rev preview pdf` |
| Auto-rebuild on changes | `rev watch` |

## DOI Management

```bash
rev doi check references.bib         # Validate DOIs
rev doi lookup references.bib        # Find missing DOIs
rev doi add 10.1234/example          # Add citation from DOI
```

## Validation

```bash
rev validate --journal nature        # Check journal requirements
rev validate --list                  # List 21 available journal profiles
rev lint                             # Check broken refs, missing citations
```

## Cross-References

Use in markdown files:
- `@fig:label` - Figure reference (becomes "Figure 1" in Word)
- `@tbl:label` - Table reference
- `@eq:label` - Equation reference
- `{#fig:label}` - Anchor for figures

## Template Variables

Available in section files (processed during build):
- `{{date}}` - Current date (YYYY-MM-DD)
- `{{date:MMMM D, YYYY}}` - Custom format
- `{{title}}` - Document title
- `{{author}}` - First author
- `{{word_count}}` - Total word count

## Project Structure

```
my-paper/
├── rev.yaml           # Project config
├── introduction.md    # Section files with annotations
├── methods.md
├── results.md
├── discussion.md
├── references.bib     # Bibliography
├── figures/           # Images
└── paper.docx         # Built output
```

## When Helping Users

1. **Import phase**: Run `rev import` to get track changes as markdown
2. **Review phase**: Use `rev comments` to see all comments, then `rev reply` to respond
3. **Build phase**: Run `rev build docx` to generate the updated Word document
4. **Validation phase**: Run `rev check` before submission (lint + grammar + citations)
5. **Response letter**: Use `rev response` to generate point-by-point responses

For complete command reference, see [REFERENCE.md](REFERENCE.md).
