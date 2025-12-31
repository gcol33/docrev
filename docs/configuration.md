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

# Word output settings
docx:
  reference: template.docx   # Optional reference doc for styling
  keepComments: true         # Preserve CriticMarkup comments
  toc: false
```

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

This creates `~/.revrc`:
```json
{
  "user": "Your Name"
}
```

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

## Journal Profiles

21 built-in journal profiles for validation:

```bash
rev validate --list              # List all profiles
rev validate -j nature           # Check against Nature requirements
rev word-count -j ecology-letters  # Use journal word limit
```

Profiles include: nature, science, pnas, ecology-letters, global-change-biology, etc.
