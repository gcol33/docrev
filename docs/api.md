# API Reference

Use docrev as a library in your Node.js projects.

## Installation

```bash
npm install docrev
```

## Subpath Exports

```javascript
// Main exports
import { parseAnnotations, stripAnnotations } from 'docrev'

// Subpath imports
import { build } from 'docrev/build'
import { extractCitations, validateCitations } from 'docrev/citations'
import { checkDoi, lookupDoi, fetchDoi } from 'docrev/doi'
import { extractEquations, extractEquationsFromWord } from 'docrev/equations'
import { extractFromWord, importFromWord } from 'docrev/import'
import { prepareMarkdownWithMarkers, injectCommentsAtMarkers } from 'docrev/wordcomments'
```

## Annotations

```javascript
import { parseAnnotations, stripAnnotations, applyAnnotations } from 'docrev/annotations'

// Parse CriticMarkup from text
const result = parseAnnotations(markdown)
// Returns: { insertions: [...], deletions: [...], substitutions: [...], comments: [...] }

// Remove annotations, apply changes
const clean = stripAnnotations(markdown, { keepComments: false })

// Apply annotations (accept all changes)
const applied = applyAnnotations(markdown)
```

## Word Import

```javascript
import { extractFromWord, importFromWord, moveExtractedMedia } from 'docrev/import'

// Extract text, comments, and images from Word
const result = await extractFromWord('document.docx', { mediaDir: './figures' })
// Returns: { text, comments, anchors, messages, extractedMedia }

// Full import pipeline: diff Word against original MD
const imported = await importFromWord('reviewed.docx', 'original.md', {
  author: 'Reviewer',
  figuresDir: './figures'
})
// Returns: { annotated, stats, extractedMedia }

// Move extracted images to figures directory
const moved = moveExtractedMedia(extractedMedia, './figures', 'figure')
// Returns: { moved: [...], errors: [...] }
```

## Word Comments

```javascript
import { prepareMarkdownWithMarkers, injectCommentsAtMarkers } from 'docrev/wordcomments'

// Parse comments and insert markers
const { comments, markedMarkdown } = prepareMarkdownWithMarkers(markdown)
// comments: [{ author, text, isReply, parentIdx, ... }]

// Inject comments into DOCX at marker positions
const result = await injectCommentsAtMarkers('input.docx', comments, 'output.docx')
// Returns: { success, commentCount, replyCount, skippedComments }
```

## Equations

```javascript
import { extractEquations, extractEquationsFromWord, getEquationStats } from 'docrev/equations'

// Extract LaTeX equations from markdown
const equations = extractEquations(markdown, 'file.md')
// Returns: [{ type: 'inline'|'display', content, line, file }]

// Extract equations from Word (OMML → LaTeX)
const result = await extractEquationsFromWord('document.docx')
// Returns: { success, equations: [{ type, latex, position }] }

// Get equation statistics
const stats = getEquationStats(['intro.md', 'methods.md'])
// Returns: { total, display, inline, byFile: [...] }
```

## DOI Validation

```javascript
import { checkDoi, lookupDoi, fetchDoi } from 'docrev/doi'

// Validate a DOI
const result = await checkDoi('10.1038/nature12373')
// Returns: { valid, doi, title, ... }

// Lookup DOI by metadata
const matches = await lookupDoi({ title, author, year })
// Returns: [{ doi, confidence, title, ... }]

// Fetch BibTeX from DOI
const bibtex = await fetchDoi('10.1038/nature12373')
```

## Citations

```javascript
import { extractCitations, validateCitations } from 'docrev/citations'

// Extract citation keys from markdown
const citations = extractCitations(markdown)
// Returns: ['Author2021', 'Other2020', ...]

// Validate against bibliography
const result = validateCitations(citations, 'references.bib')
// Returns: { valid: [...], missing: [...], unused: [...] }
```

## Cross-References

```javascript
import { buildRegistry, migrateRefs } from 'docrev/crossref'

// Build figure/table registry from markdown
const registry = buildRegistry(markdown)
// Returns: Map<label, { type, number, caption }>

// Convert hardcoded refs to dynamic
const migrated = migrateRefs(markdown, registry)
// "Figure 1" → "@fig:label"
```

## Build

```javascript
import { build } from 'docrev/build'

// Build outputs
await build({
  formats: ['pdf', 'docx'],
  toc: false,
  dual: true  // Create clean + comments DOCX
})
```

## TypeScript

Full type definitions available:

```typescript
import type {
  Annotation,
  Comment,
  Equation,
  Citation,
  BuildOptions
} from 'docrev'
```
