# Architecture

This document describes the internal architecture of docrev for contributors.

## Directory Structure

```
docrev/
├── bin/
│   └── rev.js              # CLI entry point
├── lib/
│   ├── commands/           # Command implementations (modular)
│   │   ├── index.js        # Command registration hub
│   │   ├── core.js         # review, strip, status
│   │   ├── comments.js     # Comment management
│   │   ├── sections.js     # import, extract, split, sync, merge
│   │   ├── build.js        # Document building
│   │   ├── citations.js    # Citation validation
│   │   ├── doi.js          # DOI operations
│   │   ├── init.js         # Project creation
│   │   ├── response.js     # Response letter generation
│   │   ├── history.js      # Git-based history
│   │   ├── utilities.js    # Miscellaneous commands
│   │   └── context.js      # Shared utilities & CLI helpers
│   ├── annotations.js      # CriticMarkup parsing
│   ├── build.js            # Pandoc integration
│   ├── citations.js        # BibTeX/citation handling
│   ├── crossref.js         # Figure/table references
│   ├── doi.js              # DOI validation & lookup
│   ├── equations.js        # LaTeX equation handling
│   ├── import.js           # Word document import
│   ├── merge.js            # Multi-reviewer merge
│   ├── pdf-import.js       # PDF annotation extraction
│   ├── sections.js         # Section management
│   ├── spelling.js         # Spell checking
│   ├── trackchanges.js     # Track change processing
│   ├── word.js             # Word document extraction
│   └── wordcomments.js     # Word comment injection
├── types/
│   └── index.d.ts          # TypeScript definitions
├── test/                   # Test files
└── docs/                   # User documentation
```

## Core Concepts

### CriticMarkup

The annotation syntax used throughout:

- `{++inserted text++}` - Insertions
- `{--deleted text--}` - Deletions
- `{~~old~>new~~}` - Substitutions
- `{>>Author: comment<<}` - Comments
- `{==highlighted==}` - Highlights

Parsing is handled by `lib/annotations.js`.

### Workflow

1. **Write** in Markdown with CriticMarkup
2. **Build** to Word/PDF via Pandoc (`rev build`)
3. **Send** to reviewers who add track changes/comments
4. **Import** feedback back to Markdown (`rev sync`)
5. **Review** and accept/reject changes (`rev review`)
6. **Repeat** until final version

## Command System

Commands are organized in `lib/commands/` with each module exporting a `register(program)` function:

```javascript
// lib/commands/example.js
export function register(program) {
  program
    .command('example')
    .description('Example command')
    .action(async (options) => {
      // Implementation
    });
}
```

Commands are registered in `lib/commands/index.js` and invoked from `bin/rev.js`.

### Shared Utilities

`lib/commands/context.js` provides common helpers:

- `fmt.header()`, `fmt.status()` - Formatted output
- `fmt.progressBar()` - Progress indication
- `findFiles()` - File discovery
- Configuration loading

## Key Modules

### annotations.js

Parses and manipulates CriticMarkup syntax:

- `parseAnnotations(text)` - Extract all annotations
- `stripAnnotations(text)` - Remove markup, apply changes
- `countAnnotations(text)` - Statistics
- `getComments(text)` - Extract comments only

### build.js

Integrates with Pandoc for document generation:

- `loadConfig(dir)` - Load `rev.yaml` configuration
- `getSectionFiles(dir)` - Ordered section list
- `buildCombined(dir, options)` - Combine sections
- `build(dir, format, options)` - Generate output

### import.js / word.js

Handles Word document processing:

- `extractWordComments(docxPath)` - Get comments from .docx
- `extractCommentAnchors(docxPath)` - Map comments to text
- `importWord(docxPath, options)` - Full import workflow

### doi.js

DOI validation with rate limiting and caching:

- `checkDoi(doi)` - Validate DOI exists
- `lookupDoi(title, author)` - Search for DOI
- `fetchBibtex(doi)` - Get BibTeX from DOI

Includes:
- 7-day cache in `~/.rev-doi-cache.json`
- Exponential backoff for API rate limits
- Crossref and DataCite API support

### crossref.js

Figure/table reference handling:

- `buildRegistry(dir)` - Scan for anchors
- `detectDynamicRefs(text)` - Find hardcoded references
- `convertToSymbolic(text, registry)` - Numbers → `@fig:label`
- `convertToHardcoded(text, registry)` - `@fig:label` → Numbers

## Configuration

Project configuration in `rev.yaml`:

```yaml
title: "Paper Title"
authors:
  - name: "Author Name"
sections:
  - introduction.md
  - methods.md
  - results.md
bibliography: references.bib
output:
  formats: [docx, pdf]
crossref:
  figPrefix: "Figure"
  tblPrefix: "Table"
```

## Testing

Tests use Node's built-in test runner:

```bash
npm test                    # Run all tests
npm run test:watch          # Watch mode
npm run test:coverage       # With coverage
```

Test files are in `test/` with `.test.js` suffix.

## External Dependencies

### Required

- **Pandoc** (2.11+) - Document conversion
- **Node.js** (20+) - Runtime

### Optional

- **pandoc-crossref** - Figure/table numbering
- **LaTeX** - PDF output

Run `rev doctor` to check environment.

## Adding a New Command

1. Create or edit a file in `lib/commands/`
2. Export a `register(program)` function
3. Import and call in `lib/commands/index.js`
4. Add tests in `test/`
5. Update TypeScript definitions if needed

## Error Handling

- Use descriptive error messages with context
- Throw errors for unrecoverable conditions
- Log warnings for non-fatal issues
- Use `process.exit(1)` for CLI errors

## API Rate Limiting

External APIs (Crossref, DataCite) use the `RateLimiter` class in `lib/doi.js`:

- Exponential backoff on 429/5xx responses
- Respects `Retry-After` headers
- Configurable min/max delays
- Automatic retry on transient failures
