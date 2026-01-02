# Complete Workflow Guide

The Word ↔ Markdown round-trip workflow for academic papers.

## The Big Picture

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Word Doc ──────► Markdown ──────► Word/PDF                    │
│      │               │                 │                        │
│      │          (you work here)        │                        │
│      │               │                 ▼                        │
│      │               │            Send to reviewers             │
│      │               │                 │                        │
│      │               │                 ▼                        │
│      │               │            Receive feedback              │
│      └───────────────┴─────────────────┘                        │
│                      │                                          │
│                   (repeat)                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key insight:** You always work in Markdown. Word is just for delivery and collecting feedback.

---

## Phase 1: Start Your Project

### Option A: Import from existing Word doc

```bash
rev import manuscript.docx
```

This creates:
```
my-paper/
├── rev.yaml           # Project config
├── introduction.md    # Section files (auto-detected)
├── methods.md
├── results.md
├── discussion.md
├── references.bib     # If citations found
└── figures/           # Extracted images
```

### Option B: Start fresh

```bash
rev new my-paper
cd my-paper
```

Edit the generated section files.

---

## Phase 2: Work in Markdown

Edit your section files using any text editor. The Markdown supports:

**Citations:**
```markdown
Previous studies [@Smith2020; @Jones2021] have shown...
```

**Figures with cross-refs:**
```markdown
![Caption text](figures/heatmap.png){#fig:heatmap}

See @fig:heatmap for the results.
```

**Equations:**
```markdown
The model is defined as $y = mx + b$ where...

$$
\hat{p} = \frac{\sum_d w_d p_d}{\sum_d w_d}
$$
```

---

## Phase 3: Build & Deliver

### Build for collaborators

```bash
rev build docx           # Standard Word doc
rev build --dual         # Clean + comments versions
rev build pdf            # PDF for submission
```

**Dual output creates:**
- `paper.docx` - Clean document for reading
- `paper_comments.docx` - With threaded Word comments for discussion

### Preview while writing

```bash
rev preview docx         # Build and open
rev watch docx           # Auto-rebuild on save
```

---

## Phase 4: Receive Reviewer Feedback

When reviewers return a Word doc with track changes and comments:

### Sync feedback to section files

```bash
rev sync reviewed.docx              # explicit file
rev sync                            # auto-detect most recent .docx
rev sync reviewed.docx methods      # sync only methods section
```

This:
- Extracts track changes → CriticMarkup annotations
- Extracts comments with author names
- Converts equations (OMML → LaTeX)
- Extracts images to `media/`

### Navigate comments

```bash
rev status                # project overview
rev todo                  # list all pending comments
rev next                  # show next pending comment
rev next -n 3             # skip to 3rd pending
rev first methods         # first comment in methods section
```

### Accept/reject track changes

```bash
rev accept methods.md            # list all changes
rev accept methods.md -n 1       # accept change #1
rev accept methods.md -a         # accept all
rev reject methods.md -n 2       # reject change #2
rev review methods.md            # interactive TUI (a/r/s/q)
```

---

## Phase 5: Reply to Comments

### Set your name (once)

```bash
rev config user "Your Name"
```

### Reply to specific comment

```bash
rev reply methods.md -n 1 -m "Clarified in revised text."
```

### Interactive replies

```bash
rev reply methods.md
```

**Result in markdown:**
```markdown
{>>Guy Colling: explain what you mean here<<} {>>Your Name: Clarified in revised text.<<}
```

---

## Phase 6: Rebuild & Send Back

### Rebuild with threaded comments

```bash
rev build docx --dual
```

The `paper_comments.docx` will have your replies threaded under the original comments - just like a conversation in Word.

### Generate response letter

```bash
rev response > response-to-reviewers.md
```

Creates a point-by-point response document.

---

## Phase 7: Archive & Repeat

### Archive reviewer files

```bash
rev archive                    # move all .docx to archive/
rev archive --by Smith         # name the reviewer
rev archive --dry-run          # preview first
```

Files are renamed with timestamps: `20241215_143022_Smith_my-paper.docx`

### The cycle continues

1. Archive old files → `rev archive`
2. Receive more feedback → `rev sync`
3. Review and reply → `rev next`, `rev reply`, `rev resolve`
4. Accept changes → `rev accept -a`
5. Rebuild → `rev build docx --dual`
6. Send back

**Your markdown files remain the source of truth.** Word is just the exchange format.

---

## Writing Markdown

### Tables

**Simple tables** (pipe syntax):

```markdown
| Site | Lat  | Long  |
|------|------|-------|
| A    | 45.2 | -120.5|
| B    | 52.1 | -105.3|

: Study sites and coordinates {#tbl:sites}
```

**Complex tables with merged cells** (grid syntax):

```markdown
+---------------+---------------+---------------+
| Results                                       |
+===============+===============+===============+
| Site          | 2023          | 2024          |
+---------------+---------------+---------------+
| A             | 100           | 150           |
+---------------+---------------+---------------+
| B             | 200           | 250           |
+---------------+---------------+---------------+

: Annual measurements {#tbl:results}
```

Grid tables support:
- Column spanning (header row above)
- Row spanning (repeat `|` for continuation)
- Multi-line cell content

### Equations

**Inline:** `$E = mc^2$` renders as E = mc²

**Display:**

```markdown
$$
\bar{x} = \frac{1}{n} \sum_{i=1}^{n} x_i
$$ {#eq:mean}
```

Reference with `@eq:mean` → "Equation 1"

### Citations

```markdown
Previous work [@Smith2020] showed this effect.
Multiple sources [@Smith2020; @Jones2021] confirm this.
As Smith [-@Smith2020] demonstrated...  (suppress author)
```

### Cross-references

```markdown
![Caption text](figures/plot.png){#fig:results}

See @fig:results and @tbl:sites.
```

- `@fig:label` → "Figure 1"
- `@tbl:label` → "Table 2"
- `@eq:label` → "Equation 3"
- `@sec:label` → "Section 4"

---

## Quick Reference

| Task | Command |
|------|---------|
| Start from Word | `rev import manuscript.docx` |
| Start fresh | `rev new my-paper` |
| Build DOCX | `rev build docx` |
| Build with comments | `rev build docx --dual` |
| Build PDF | `rev build pdf` |
| Sync feedback | `rev sync reviewed.docx` |
| Project status | `rev status` |
| List pending | `rev todo` |
| Next comment | `rev next` |
| Accept all changes | `rev accept file.md -a` |
| Reply to comment | `rev reply file.md -n 1 -m "..."` |
| Archive reviewer files | `rev archive` |
| Response letter | `rev response` |
| Pre-submit check | `rev check` |

---

## Tips

### Backup before major changes
```bash
rev backup --name "before-revision-2"
```

### Validate before submission
```bash
rev check                    # Full check
rev doi check               # Validate DOIs
rev validate -j nature      # Journal requirements
```

### Export comments for tracking
```bash
rev comments methods.md --export comments.csv
```
