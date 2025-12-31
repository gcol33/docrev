# docrev

[![npm](https://img.shields.io/npm/v/docrev)](https://www.npmjs.com/package/docrev)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Write scientific papers in Markdown. Generate Word documents for collaborators. Import their feedback. Repeat.

```
Markdown  ──►  docrev  ──►  Word/PDF  ──►  Collaborators
    ▲                                           │
    └───────────  docrev  ◄─────────────────────┘
                (import feedback)
```

Scientific papers go through many revision cycles with collaborators and reviewers. Track changes become unreadable, versions multiply, equations break when copying, figures get embedded at wrong resolutions. docrev keeps your source in plain Markdown under version control while generating Word documents for the review cycle. Your collaborators keep using Word as usual. You handle conversion on your end.

## Install

```bash
npm install -g docrev
brew install pandoc
```

## Start a Project

From scratch:
```bash
rev new my-paper
cd my-paper
```

From existing Word document:
```bash
rev import manuscript.docx
```

Project structure:
```
my-paper/
├── introduction.md
├── methods.md
├── results.md
├── discussion.md
├── references.bib
└── rev.yaml
```

## Markdown Basics

```markdown
# Heading

Paragraph text. **Bold** and *italic*.

- Bullet point
- Another point

1. Numbered item
2. Second item
```

### Citations

references.bib:
```bibtex
@article{Smith2020,
  author = {Smith, Jane},
  title = {Paper Title},
  journal = {Nature},
  year = {2020}
}
```

In text:
```markdown
Previous studies [@Smith2020] demonstrated this.
```

Output: "Previous studies (Smith 2020) demonstrated this."

### Equations

Inline: `$E = mc^2$`

Display:
```markdown
$$
\hat{p} = \frac{\sum_d w_d p_d}{\sum_d w_d}
$$
```

### Figures

```markdown
![Study site locations](figures/map.png){#fig:map}

Results shown in @fig:map indicate regional variation.
```

Output: "Results shown in Figure 1 indicate regional variation."

Figure numbers update automatically when reordered.

## Build

```bash
rev build docx          # Word document
rev build pdf           # PDF
rev build --dual        # Clean + comments versions
rev watch docx          # Auto-rebuild on save
```

## Handle Reviewer Feedback

Import reviewed document:
```bash
rev sections reviewed.docx
```

View comments:
```bash
rev comments methods.md
```

Reply to comment:
```bash
rev config user "Your Name"
rev reply methods.md -n 1 -m "Clarified sampling methodology"
```

Rebuild with threaded comments:
```bash
rev build --dual
```

Output:
- `paper.docx` (clean)
- `paper_comments.docx` (with comment threads)

## Commands

| Task | Command |
|------|---------|
| New project | `rev new my-paper` |
| Import Word | `rev import manuscript.docx` |
| Build Word | `rev build docx` |
| Build PDF | `rev build pdf` |
| Import feedback | `rev sections reviewed.docx` |
| View comments | `rev comments methods.md` |
| Reply to comment | `rev reply methods.md -n 1 -m "text"` |
| Word count | `rev word-count` |
| Validate DOIs | `rev doi check` |
| Pre-submit check | `rev check` |

Full reference: [docs/commands.md](docs/commands.md)

## Requirements

- Node.js 18+
- Pandoc

```bash
# macOS
brew install pandoc

# Windows
winget install JohnMacFarlane.Pandoc

# Linux
sudo apt install pandoc
```

## License

MIT
