# docrev

[![npm](https://img.shields.io/npm/v/docrev)](https://www.npmjs.com/package/docrev)
[![npm downloads](https://img.shields.io/npm/dm/docrev)](https://www.npmjs.com/package/docrev)
[![node](https://img.shields.io/node/v/docrev)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/gcol33/docrev/actions/workflows/ci.yml/badge.svg)](https://github.com/gcol33/docrev/actions/workflows/ci.yml)

A CLI for writing documents in Markdown while collaborating with Word users.

Write in `.md` files under version control; build Word or PDF when you need to share. When reviewers return their annotated copy, `rev sync` pulls the feedback into your markdown sections, where you reply to comments, accept or reject changes, and rebuild. Equations, figures, citations, and cross-references survive both directions.

## The Problem

After a few rounds of feedback, the project directory looks like this:

```
manuscript_v1.docx
manuscript_v2_john_comments.docx
manuscript_v2_jane_comments.docx
manuscript_v3_merged_final.docx
manuscript_v3_merged_final_REAL.docx
manuscript_v3_merged_final_REAL_submitted.docx
```

By the third filename, there's no canonical version. Jane's comments are in one file, John's track changes in another, your reconciliation attempt in a third; whether you merged the right sources depends on what you remember from last Tuesday.

docrev keeps the markdown as the canonical version, under git. The DOCX is rebuilt each time you share; reviewer comments and track changes come back into your section files when you sync, where you reply to or accept them in the terminal.

## Install

```bash
npm install -g docrev
```

Requires [Node.js](https://nodejs.org) 18+. Building DOCX or PDF needs [Pandoc](https://pandoc.org). For complex PDFs (math, cross-references, journal styles), LaTeX is also needed — see [Installing Dependencies](https://github.com/gcol33/docrev#installing-dependencies).

## Quick Start

Write in Markdown with citations and cross-references:

```markdown
Climate change poses significant challenges [@IPCC2021]. As shown in
@fig:temperature, global temperatures have risen steadily.

![Temperature anomalies](figures/temperature.png){#fig:temperature}
```

Build and share:

```bash
rev build docx    # → output/paper.docx
rev build pdf     # → output/paper.pdf
```

When collaborators return the Word doc with track changes:

```bash
rev sync reviewed.docx    # their comments → your markdown
rev todo                  # list all pending comments
rev reply methods.md -n 1 -m "Clarified in revised text."
rev build docx --dual     # clean + annotated versions
```

## Documentation

<div class="grid cards" markdown>

-   :material-rocket-launch: **Get Started**

    ---

    The full revision cycle: import, build, sync, reply, resolve, rebuild, archive.

    [:octicons-arrow-right-24: Revision Workflow](workflow.md)

-   :material-console: **Commands**

    ---

    Complete reference for all `rev` commands, grouped by task.

    [:octicons-arrow-right-24: Command Reference](commands.md)

-   :material-cog: **Configuration**

    ---

    `rev.yaml` options, journal profiles, custom templates, CSL styles.

    [:octicons-arrow-right-24: Configuration](configuration.md)

-   :material-wrench: **Troubleshooting**

    ---

    Common issues with installation, builds, imports, and cross-references.

    [:octicons-arrow-right-24: Troubleshooting](troubleshooting.md)

</div>
