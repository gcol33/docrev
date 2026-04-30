# Changelog

All notable changes to docrev will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.11] - 2026-04-30

### Fixed
- **Single-section comment placement.** `computeSectionBoundaries` left the last section's `end` at `Number.MAX_SAFE_INTEGER`, which collapsed the proportional-position math in `insertCommentsIntoMarkdown` to ~0. Every comment whose anchor wasn't in the first 200 chars of the markdown stacked at position 0. Now caps the last boundary's `end` at `fullDocText.length`, passed in from sync and verify-anchors.
- **Re-sync duplicated comments.** `sync --comments-only` re-inserted every comment on each invocation, producing `{>>R1<<}{>>R1<<}{>>R1<<}…` over time. `insertCommentsIntoMarkdown` now scans ±200 chars around the target for an identical `{>>author: text<<}` block and skips insertion when found.
- **Threading content destruction.** `prepareMarkdownWithMarkers`'s whitespace-consumption loops captured `charBefore` once outside the loop, so a single leading space caused `removeStart` to walk to position 0 and `slice()` to delete every preceding paragraph. Replaced with a one-char check.
- **Multi-run anchor injection.** Pandoc splits a single anchor across multiple `<w:r>` blocks whenever it applies styling mid-anchor — smart-quote substitution, `*italic*`, `` `code` ``, `**bold**` all trigger this. The single-run scan in `injectCommentsAtMarkers` grabbed the start marker's `<w:t>`, looked for the end marker inside it, found nothing, and silently skipped the comment. New multi-run path splits the start run at the start marker, keeps middle runs verbatim, splits the end run at the end marker, and rebuilds with `commentRangeStart`/`commentRangeEnd` around the styled anchor portions.
- **Nested-bracket anchors.** `prepareMarkdownWithMarkers` used `\[([^\]]+)\]\{\.mark\}` for the trailing anchor group, so any inner `]` (e.g. `[[0..9]]{.mark}`, `[*italic*]{.mark}`) terminated the match prematurely. Replaced with a manual balanced-bracket walker that handles arbitrary nesting depth and verifies a `{.mark}` suffix.
- **Orphan-`[` over-stripping.** `stripAnnotations`'s orphan cleanup used `\[(?![^\[\]]*\])`, treating any inner `[` as a barrier and stripping the outer `[` of nested forms. Loosened to `\[(?![^\]\n]*\])`: an `[` is orphan only when no `]` follows before end of line.

### Changed
- `sync --comments-only` summary distinguishes `placed` / `already present` / `unmatched` instead of subtracting before/after counts. Re-syncs now report "6 already present (skipped to avoid duplication)" instead of misreporting them as fully placed or fully unmatched. New `outStats` channel from `insertCommentsIntoMarkdown`.

## [0.9.10] - 2026-04-30

### Fixed
- `stripAnnotations` stripped `[anchor]{.mark}` spans even when `keepComments=true`, leaving the dual-build marker generator with no anchor text and collapsing every multi-word anchor to a single fallback word in the rebuilt docx. Now preserves anchor spans that belong to retained `{>>...<<}` comments.
- Comments authored at the very start of a Word section landed before the markdown file's `# Heading` line and rendered in the previous section. Added `pushPastSectionHeading` so position-0 comments advance to the first body paragraph of the section they were authored in.
- Empty-anchor comments fell through to proportional placement even when before/after context uniquely identified the position, landing mid-word or splitting unrelated phrases. Context match now runs first; proportional placement is the fallback.
- When an anchor appeared multiple times in the search window (repeated phrasing, formulaic prose), `insertCommentsIntoMarkdown` always picked the first occurrence. Now picks the occurrence closest to the docx-derived insert position.

## [0.9.7] - 2026-04-29

### Added
- `rev sync --comments-only` — import only Word comments at fuzzy-matched anchors, leaving prose byte-identical. Use when the markdown was revised between sending the docx out for review and receiving it back; applying track changes from a stale draft would clobber newer edits.
- `rev verify-anchors <docx>` — drift report classifying every comment as `clean` / `drift` / `context-only` / `ambiguous` / `unmatched` against the current section markdown. Pair with `--comments-only` to plan placement before sync. Supports `--json` for scripting.
- `extractHeadings()` in `word-extraction.ts` — read heading paragraphs directly from `<w:pStyle>` styles, returning text + level + position in the same coordinate system as comment anchors.
- Shared `lib/commands/section-boundaries.ts` — single source of truth that maps `sections.yaml` to docx text positions, used by both sync and verify-anchors.
- Shared `lib/anchor-match.ts` — pure anchor-matching primitives (`findAnchorInText`, `stripCriticMarkup`, `classifyStrategy`) so sync (insertion) and verify-anchors (drift reporting) use the same fallback strategies.
- New tests: `test/anchor-match.test.js` (11 cases covering each fallback strategy and the quality classifier).

### Fixed
- **Section detection mistook prose for headings.** The old keyword finder scanned the concatenated body text and would match "results across countries" as the Results heading or skip the real Methods heading because the structured-abstract label `Methods:` lost its colon during text-run concatenation. Replaced with paragraph-style-based heading extraction, so boundaries now reflect actual heading paragraphs. Affects the new commands; the existing sync flow already used pandoc-derived headings and was unaffected.
- `stripCriticMarkup` regex used `[^<]*` and silently failed on comments containing `<` characters (e.g. `pre-industrial trade (<1825)`). Switched to non-greedy `[\s\S]*?`.
- `insertCommentsIntoMarkdown` always prepended a leading space when there was no anchor, accumulating multiple spaces when several comments shared a position 0 anchor. Removed the heuristic; comments insert at exact position so prose stays byte-identical except for the inserted blocks.
- `verify-anchors` crashed with a stack trace when given a non-docx file (e.g. an `.md` path). Now reports a friendly error.

### Changed
- New flag is `--comments-only` (positive form). The originally proposed `--no-overwrite` was dropped because Commander assigns `--no-X` to `options.x === false` rather than `options.noX === true`, which made the flag silently ignored.
- `insertCommentsIntoMarkdown` now accepts `wrapAnchor?: boolean` (default `true`). When `false`, comment blocks are inserted next to the anchor without `[anchor]{.mark}` wrapping. `--comments-only` uses this so multiple comments sharing an anchor (e.g. 6 reviewers commenting on the same word) no longer produce nested broken CriticMarkup.

## [0.7.1] - 2025-01-02

### Added
- Writing Markdown guide in docs (tables, equations, citations, cross-refs)
- Grid table syntax documentation for merged cells

### Changed
- README restructured for better scannability (490 → 290 lines)
- Install section moved up for faster onboarding
- Added Highlights section with quick feature overview
- Condensed overlapping sections

## [0.7.0] - 2025-01-02

### Added
- API rate limiting with exponential backoff for Crossref/DataCite/doi.org APIs
- Windows support in CI matrix
- Architecture documentation for contributors (`ARCHITECTURE.md`)
- Exclusion patterns for cross-reference false positives (e.g., "Table of Contents")
- Timeout support for PDF extraction (30s default)

### Changed
- Consolidated YAML dependencies (removed `js-yaml`, using `yaml` package only)
- Improved annotation false positive detection (code blocks, URLs, LaTeX patterns)
- Enhanced error messages for Word import and PDF extraction
- Updated User-Agent strings for API requests
- Improved README with problem statement and quick example

### Fixed
- CI lint step now checks all command files separately
- Windows temp directory paths in tests

## [0.3.2] - 2024-12-29

### Added
- Full TypeScript type definitions (`types/index.d.ts`)
- GitHub Actions CI workflow (Node 18/20/22)
- ESM subpath exports for all library modules
- CLI integration tests (26 tests)
- Comprehensive test coverage: 419 tests across 18 modules

### Fixed
- DOI skip detection: `% no-doi` comments now correctly apply only to the next entry

### Changed
- Added `engines` field requiring Node.js >=18.0.0
- Updated README with badges (npm, CI, Node.js, License)

## [0.3.1] - 2024-12-28

### Fixed
- Equation extraction test assertions
- Minor bug fixes

## [0.3.0] - 2024-12-27

### Added
- DOI validation via Crossref and DataCite APIs (`rev doi check`)
- DOI lookup for missing entries (`rev doi lookup`)
- DOI fetch and add commands (`rev doi fetch`, `rev doi add`)
- Citation validation against bibliography (`rev citations`)
- LaTeX equation extraction (`rev equations list`)
- Word equation import OMML → LaTeX (`rev equations from-word`)
- Response letter generation (`rev response`)
- Journal validation profiles (`rev validate --journal`)
- Advanced figure/table reference patterns (Figs. 1-3, Fig. 1a-c)

### Changed
- Improved cross-reference pattern detection
- Enhanced Word import with better section splitting

## [0.2.1] - 2024-12-26

### Added
- Table of contents option (`rev build --toc`)
- CSV export for comments (`rev comments --export`)
- Anonymize command for blind review (`rev anonymize`)
- Formatting utilities (tables, boxes, spinners)

## [0.2.0] - 2024-12-25

### Added
- Integrated build system (`rev build pdf/docx/tex`)
- Comment reply functionality (`rev reply`)
- Word document bootstrap (`rev import` creates project from .docx)
- Section-aware import (`rev sections`)
- Cross-reference migration (`rev migrate`)

### Changed
- Renamed project to docrev
- Published to npm

## [0.1.0] - 2024-12-24

### Added
- Initial release
- CriticMarkup annotation parsing
- Word ↔ Markdown round-trips
- Interactive review TUI (`rev review`)
- Comment management (`rev comments`, `rev resolve`)
- Project templates (`rev new`)
