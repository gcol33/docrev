# Reviewer Workflow Guide

Step-by-step guide for handling reviewer feedback.

## 1. Receive Reviewed Document

When you receive a Word document with track changes and comments:

```bash
cd my-paper

# Import to section files (recommended)
rev sections reviewed.docx

# Or import to single file
rev import reviewed.docx paper.md
```

**What happens:**
- Track changes become CriticMarkup annotations
- Comments are extracted with author names
- Equations are converted to LaTeX
- Images are extracted to `media/`

## 2. Review Track Changes

Go through each change interactively:

```bash
rev review methods.md
```

**TUI controls:**
- `a` - Accept change
- `r` - Reject change
- `s` - Skip for now
- `q` - Quit and save

Or see all annotations:

```bash
rev status methods.md
```

Output:
```
methods.md:
  Insertions:    12
  Deletions:     5
  Substitutions: 8
  Comments:      15
```

## 3. Address Comments

List all comments with context:

```bash
rev comments methods.md
```

Output:
```
#1 [Guy Colling] line 45
   "explain what you mean here"
   Context: ...This coarse classification obscured substantial within-group heterogeneity...

#2 [Guy Colling] line 67
   "add citation"
   Context: ...as documented in previous studies...
```

### Reply to Comments

Set your name (once):
```bash
rev config user "Gilles Colling"
```

Reply to specific comment:
```bash
rev reply methods.md -n 1 -m "Clarified: heterogeneity within habitat groups."
```

Or go through interactively:
```bash
rev reply methods.md
```

**Result in markdown:**
```markdown
{>>Guy Colling: explain what you mean here<<} {>>Gilles Colling: Clarified: heterogeneity within habitat groups.<<}
```

### Resolve Comments

Mark as resolved (adds [RESOLVED] tag):
```bash
rev resolve methods.md -n 1
```

## 4. Rebuild Document

Generate updated Word document:

```bash
# Clean version (annotations applied)
rev build docx

# Dual output: clean + with threaded comments
rev build --dual
```

**Dual output creates:**
- `paper.docx` - Clean document
- `paper_comments.docx` - With threaded Word comments

### Comment Threading

Adjacent comments from different authors become threaded:
```markdown
{>>Guy Colling: Question?<<} {>>Gilles Colling: Answer.<<}
```

In Word, "Answer" appears as a reply to "Question" in the same thread.

## 5. Generate Response Letter

Create point-by-point response to reviewers:

```bash
rev response
```

Output:
```markdown
# Response to Reviewers

## Reviewer 1 (Guy Colling)

### Comment 1 (methods.md, line 45)
> explain what you mean here

**Response:** Clarified: heterogeneity within habitat groups.

### Comment 2 (methods.md, line 67)
...
```

## 6. Pre-Submission Check

Before submitting:

```bash
# Full check
rev check

# Individual checks
rev lint                    # Broken refs, missing citations
rev doi check               # Validate DOIs
rev validate -j nature      # Journal requirements
rev word-count -j nature    # Word limit
```

## Tips

### Export Comments to CSV

For tracking in spreadsheet:
```bash
rev comments methods.md --export comments.csv
```

### Search Across Files

Find all mentions of a term:
```bash
rev search "habitat"
rev search -i "EUNIS"  # Case-insensitive
```

### Backup Before Major Changes

```bash
rev backup --name "before-revision"
```

### Watch for Changes

Auto-rebuild while editing:
```bash
rev watch docx
```
