# docrev

[![npm](https://img.shields.io/npm/v/docrev)](https://www.npmjs.com/package/docrev)
[![npm downloads](https://img.shields.io/npm/dm/docrev)](https://www.npmjs.com/package/docrev)
[![node](https://img.shields.io/node/v/docrev)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/gcol33/docrev/actions/workflows/ci.yml/badge.svg)](https://github.com/gcol33/docrev/actions/workflows/ci.yml)

Write in Markdown. Collaborate with Word users. Keep everything in git.

## Why docrev

Word is where collaboration happens. Your reviewers, co-authors, and editors use track changes and comments. But Word documents are opaque binaries that don't diff, don't merge, and don't version control.

docrev bridges this gap:

```
You write          Collaborators review       You see
─────────────────────────────────────────────────────
methods.md    →    methods.docx          →    methods.md
(plain text)       (track changes,            (annotations
                    comments)                  in text)
```

The core workflow:

```bash
rev build docx        # markdown → Word document
# ... collaborators review in Word ...
rev sections reviewed.docx   # Word feedback → markdown annotations
```

Your markdown files now contain their track changes and comments as inline annotations. Review them in your editor, accept or reject changes, reply to comments, rebuild. All under version control.

**This works for any document**: scientific papers, contracts, reports, proposals, manuals—anything that goes through Word-based review.

## Install

### Step 1: Install docrev

Requires [Node.js](https://nodejs.org) 18 or later.

```bash
npm install -g docrev
```

### Step 2: Install Pandoc

[Pandoc](https://pandoc.org) handles document conversion. Install it for your platform:

**macOS**
```bash
brew install pandoc
```

**Windows**
```bash
winget install JohnMacFarlane.Pandoc
```

**Linux (Debian/Ubuntu)**
```bash
sudo apt install pandoc
```

**Linux (Fedora)**
```bash
sudo dnf install pandoc
```

**Other platforms**: Download from [pandoc.org/installing](https://pandoc.org/installing.html)

Verify installation:

```bash
rev --version
pandoc --version
```

### Step 3: Configure your name

Set your name for comment replies:

```bash
rev config user "Your Name"
```

This is stored locally and used when you reply to reviewer comments.

## Getting Started

### Starting a New Document

Create a new project:

```bash
rev new my-report
cd my-report
```

Replace `my-report` with any name—this creates a folder with that name containing:

```
my-report/
├── introduction.md
├── methods.md
├── results.md
├── discussion.md
├── references.bib
└── rev.yaml
```

Write your content in the markdown files. When ready to share:

```bash
rev build docx
```

This produces `my-report.docx`—a properly formatted Word document with your citations resolved, equations rendered, and cross-references numbered.

### Starting from an Existing Word Document

If you have a Word document to convert:

```bash
rev import manuscript.docx
```

This creates a project folder and splits the document into section files. Any existing track changes and comments are preserved as markdown annotations.

## Two Workflows: Layout vs Text

docrev supports two distinct approaches depending on your document's complexity:

### Text Workflow (recommended for most documents)

Best for: papers, reports, proposals—documents where content matters more than layout.

```bash
rev build docx          # rebuild from markdown each time
rev sections feedback.docx   # import feedback into markdown
```

You maintain markdown as the source of truth. Word is just for review.

### Layout Workflow

Best for: documents with complex formatting, embedded objects, or layouts that Pandoc can't reproduce.

```bash
rev annotate document.docx -m "Comment text" -s "target phrase"
rev apply changes.md document.docx
```

You work directly with the Word file, adding comments and applying tracked changes without round-tripping through markdown.

Most users should start with the text workflow. Use layout workflow only when you need pixel-perfect Word formatting that must be preserved.

## The Revision Cycle

### 1. Build and Share

Generate a Word document:

```bash
rev build docx
```

Send this to reviewers. They add comments and track changes in Word as usual.

### 2. Import Feedback

When the reviewed document returns:

```bash
rev sections reviewed.docx
```

Your markdown files now contain their feedback as inline annotations.

### 3. Review Changes

Track changes appear as inline markup:

```markdown
The sample size was {--100--}{++150++} participants.
Data was collected {~~monthly~>weekly~~} from each site.
```

- `{++text++}` — inserted text
- `{--text--}` — deleted text
- `{~~old~>new~~}` — substitution

To accept a change, keep the new text and remove the markup. To reject, keep the old text.

### 4. Review Comments

Comments appear inline:

```markdown
We used a random sampling approach.
{>>Reviewer 2: Please clarify the sampling method.<<}
```

List all comments in a file:

```bash
rev comments methods.md
```

Example output:

```
methods.md: 3 comments

  #1 [line 12] Reviewer 2
     "Please clarify the sampling method."
     Context: "We used a random sampling approach."

  #2 [line 34] Reviewer 1
     "Citation needed here."
     Context: "Previous studies have shown this effect."

  #3 [line 45] Editor
     "Consider shortening this section."
     Context: "The methodology employed in this study..."
```

### 5. Reply to Comments

Reply directly from the command line:

```bash
rev reply methods.md -n 1 -m "Added clarification in paragraph 2"
```

Your reply threads beneath the original:

```markdown
We used a random sampling approach.
{>>Reviewer 2: Please clarify the sampling method.<<}
{>>Your Name: Added clarification in paragraph 2.<<}
```

Mark resolved comments:

```bash
rev resolve methods.md -n 1
```

### 6. Rebuild with Threads

Generate both a clean version and one showing comment threads:

```bash
rev build --dual
```

Produces:
- `paper.docx` — clean, for submission
- `paper_comments.docx` — includes threaded comments visible in Word's comment pane

### 7. Repeat

Send the updated document. Import new feedback. Continue until done.

## Before Submission

### Validate Your Bibliography

Check DOIs resolve correctly:

```bash
rev doi check references.bib
```

Find DOIs for entries missing them:

```bash
rev doi lookup references.bib
```

Add citations directly from a DOI:

```bash
rev doi add 10.1038/s41586-020-2649-2
```

### Run Pre-Submission Checks

Check for broken references, missing citations, and common issues:

```bash
rev check
```

## Writing in Markdown

### Citations

Add references to `references.bib`:

```bibtex
@article{Smith2020,
  author = {Smith, Jane},
  title = {Paper Title},
  journal = {Nature},
  year = {2020},
  doi = {10.1038/example}
}
```

Cite in text:

```markdown
Previous work [@Smith2020] established this relationship.
Multiple sources support this [@Smith2020; @Jones2021].
```

### Equations

Inline: `$E = mc^2$`

Display:

```markdown
$$
\bar{x} = \frac{1}{n} \sum_{i=1}^{n} x_i
$$
```

### Figures and Cross-References

```markdown
![Study site locations](figures/map.png){#fig:map}

Results are shown in @fig:map.
```

The reference `@fig:map` becomes "Figure 1" in output. Numbers update automatically when figures reorder. Tables and equations work the same: `@tbl:label`, `@eq:label`.

## Command Reference

| Task | Command |
|------|---------|
| Create project | `rev new my-project` |
| Import Word document | `rev import manuscript.docx` |
| Build Word | `rev build docx` |
| Build PDF | `rev build pdf` |
| Build clean + annotated | `rev build --dual` |
| Import feedback | `rev sections reviewed.docx` |
| List comments | `rev comments file.md` |
| Reply to comment | `rev reply file.md -n 1 -m "response"` |
| Resolve comment | `rev resolve file.md -n 1` |
| Check DOIs | `rev doi check references.bib` |
| Find missing DOIs | `rev doi lookup references.bib` |
| Word count | `rev word-count` |
| Pre-submission check | `rev check` |
| Watch for changes | `rev watch docx` |

Full command reference: [docs/commands.md](docs/commands.md)

## Claude Code Integration

If you use [Claude Code](https://claude.ai/claude-code), install the docrev skill to teach Claude how to help with your revision workflow:

```bash
rev install-cli-skill      # install skill to ~/.claude/skills/docrev
rev uninstall-cli-skill    # remove the skill
```

Once installed, Claude Code understands docrev commands and can help you navigate comments, draft replies, and manage your revision cycle.

## Requirements

- Node.js 18+
- Pandoc 2.11+

## License

MIT
