# docrev

<div class="badge-row">
[![npm](https://img.shields.io/npm/v/docrev)](https://www.npmjs.com/package/docrev)
[![npm downloads](https://img.shields.io/npm/dm/docrev)](https://www.npmjs.com/package/docrev)
[![node](https://img.shields.io/node/v/docrev)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/gcol33/docrev/actions/workflows/ci.yml/badge.svg)](https://github.com/gcol33/docrev/actions/workflows/ci.yml)
</div>

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

Requires [Node.js](https://nodejs.org) 18+. Building DOCX or PDF needs [Pandoc](https://pandoc.org). For complex PDFs (math, cross-references, journal styles), LaTeX is also needed — see the [Troubleshooting](troubleshooting.html) page.

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

<div class="row g-3 mt-1">
<div class="col-sm-6">
<div class="doc-card position-relative">
<h5>Get Started</h5>
<p>The full revision cycle: import, build, sync, reply, resolve, rebuild, archive.</p>
<a href="workflow.html" class="stretched-link text-decoration-none">Revision Workflow →</a>
</div>
</div>
<div class="col-sm-6">
<div class="doc-card position-relative">
<h5>Commands</h5>
<p>Complete reference for all <code>rev</code> commands, grouped by task.</p>
<a href="commands.html" class="stretched-link text-decoration-none">Command Reference →</a>
</div>
</div>
<div class="col-sm-6">
<div class="doc-card position-relative">
<h5>Configuration</h5>
<p><code>rev.yaml</code> options, journal profiles, custom templates, CSL styles.</p>
<a href="configuration.html" class="stretched-link text-decoration-none">Configuration →</a>
</div>
</div>
<div class="col-sm-6">
<div class="doc-card position-relative">
<h5>Troubleshooting</h5>
<p>Common issues with installation, builds, imports, and cross-references.</p>
<a href="troubleshooting.html" class="stretched-link text-decoration-none">Troubleshooting →</a>
</div>
</div>
</div>
