# Changelog

All notable changes to docrev will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.12.2] - 2026-08-05

### Fixed
- **`rev comments` / `rev status` list every comment in a `.docx` instead of silently dropping some (#10).** Both commands read a document through `readDocxAsAnnotatedMarkdown` and then count with `getComments`, but that round-trip lost comments on the re-parse: the false-positive filter — which exists to reject figure captions, code, and stray markers in hand-written Markdown — also rejected genuine reviewer comments whose anchor sat inside a tracked deletion, whose text mentioned a `.pdf`/code token, or which were threaded replies (emitted as `↪ Author: …`, a form the author-prefix check never recognized, so replies were hit hardest). On one 45-comment manuscript only 35 were listed, with no warning and no non-zero exit, while `rev verify-anchors` — which enumerates comments directly — correctly saw all 45. A `{>>…<<}` block that carries a clear `Author:` (or reply `↪ Author:`) prefix is now trusted as a real comment and skips the caption/code/track-change heuristics, which stay in force for bare, unauthored spans. As a backstop, the read-only path appends any comment that still could not be placed, so the listed count matches the document's comment count.
- **`rev verify-anchors` / `rev sync` honor `--config` independently of `--dir` (#11).** The sections config was resolved by joining the config name onto `--dir`, so a `sections.yaml` at the project root could not be reached once `--dir` pointed at a section subdirectory — the exact layout `verify-anchors` is meant for (a reviewer's docx against markdown that has since moved into its own directory). Passing `--config` explicitly did not help, since it was still resolved inside `--dir`. `--config` is now a path in its own right: resolved against the working directory, or taken as-is when absolute, and never joined onto `--dir`. `--dir` only locates the section markdown. The older layout with the config co-located in `--dir` still resolves via a fallback.

## [0.12.1] - 2026-08-04

### Fixed
- **Supplementary figure/table anchors no longer take their image attributes with them (#9).** `resolveSupplementaryRefs` stripped the entire `{#fig:label ...}` block from supplementary items so pandoc-crossref would not re-number them, but that also deleted any `width`, `height`, `class`, or `style` attribute sharing the block. A supplementary figure written in the documented portable form `![caption](path){#fig:label width=70%}` rendered at full text width with no warning. Only the `#fig:label` / `#tbl:label` anchor is now removed; the remaining attributes are kept (`{width=70%}`), and the block is emitted only when something survives. The anchor is also matched anywhere in the block, not just at the start.

## [0.12.0] - 2026-07-08

### Fixed
- **Images restored by caption match keep their `{#fig:label}` crossref anchor.** An add-then-check ordering bug in `restoreImagesFromRegistry` guaranteed the anchor was always dropped, so every `@fig:` reference to a caption-matched figure broke on the next build.
- **Markdown tables in CRLF files are protected through the import diff.** The table-protection pattern required `|\n` line endings, so on Windows-authored files no table was ever protected and the diff engine could mangle rows. Math protection also no longer captures escaped `\$` (currency amounts) as math spans.
- **Postprocess script failures now surface without `--verbose`.** A failing `postprocess.pdf`/`.docx` script used to be invisible unless verbose was on, with the build still reporting success; the failure is now returned through the build warnings and printed.
- **Reply comments whose anchor contains nested brackets no longer vanish.** The reply-places-parent-markers path re-parsed the anchor with a regex that bailed at the first inner `]`, silently dropping both the parent and the reply from the rebuilt docx; it now uses the anchor already extracted by the nested-bracket parser.
- **`rev orcid` and CSL style downloads can no longer hang forever.** Both now route through the shared rate limiter (per-request timeout via AbortController, bounded retries) that the DOI commands already used.
- **Unexpected errors inside commands print a clean message instead of a raw Node stack.** The CLI now runs `parseAsync` inside a try/catch and installs `unhandledRejection`/`uncaughtException` handlers (`DEBUG=1` shows the stack). A corrupt `package.json` or `.rev/conflicts.json` degrades gracefully instead of crashing.
- **Table cell text decodes XML entities correctly.** Table extraction had a private decoder that double-unescaped `&amp;lt;` and corrupted emoji/astral characters; it now shares the ooxml layer's decoder.
- **`rev completions` and `rev install-cli-skill` work from the published package.** Both resolved package assets with a fixed number of `..` segments that only matched the source layout, not `dist/`; assets now resolve via the nearest `package.json`. A CI pack-smoke-test job installs the tarball and exercises the CLI to keep this class of regression out.
- Temp files (`.paper-marked.*`, `.paper-annotated.*`, equation-sheet `.tmp.md`) are cleaned up in `finally` blocks, so a failed pandoc run no longer leaks them into the project directory.

### Changed
- **Table extraction is parser-backed.** Word tables are now read through the structural OOXML layer (namespace by URI, `gridSpan`/`vMerge` from cell properties), so documents binding WordprocessingML to a prefix other than `w:` yield their tables.
- **Visible-comment conversion is stricter.** `[Author: text]` conversion now requires a name-like author (no digits), skips documentary lead-ins (`[Note: …]`), markdown links, and image alt text, so bracketed prose is no longer rewritten into reviewer comments during import.
- Dual-mode orchestration (`_comments.docx` / `_comments.pdf`) moved from the command layer into `build.ts` (`buildCommentsDocx` / `buildCommentsPdf`) with a single output-suffix helper.
- Dead pre-parser extractors were removed from `word.ts`; its public comment/anchor entry points now delegate to the shipping implementations, so tests exercise the real code path. `isWordDocument` is content-based (ZIP + `word/document.xml`) rather than extension-based.
- crossref section discovery, config-key typo detection, and command suggestions now share single implementations (`resolveSectionsConfig`, `utils.levenshtein`).
- Packaging: `files` allowlist replaces `.npmignore` (tarball drops from 3.7 MB/412 files to 2.1 MB/312 files — no more TS source, mkdocs site, or planning docs), `tsx` moved to devDependencies, legacy hand-written `types/index.d.ts` removed, MIT `LICENSE` file added.
- CI: the test glob now includes `.test.ts` files (the pptx-template suite was silently excluded everywhere), ESLint actually lints the TypeScript source (it previously linted only compiled `dist/` output), and a pack-smoke-test job was added.

## [0.11.3] - 2026-07-08

### Fixed
- **`rev status` / `rev comments` (and the whole `[file]`-taking class) now read `.docx` files correctly instead of reporting silent garbage (#8).** These commands used to `readFileSync(file, 'utf-8')` every argument and regex the bytes for CriticMarkup. A `.docx` is a binary ZIP, so a Word document full of tracked changes and comments came back as "No annotations found" / "No comments found" — or an unstable, plausible-looking wrong count from an accidental byte-match in the DEFLATE stream, with no error. A new front door (`lib/input.ts`) detects a Word document by extension **and** by ZIP magic + `word/document.xml` (catching a mis-extensioned `.docx`), and routes it through the existing OOXML/pandoc reader so `rev status` / `rev comments` / `rev todo` / `rev next` / `rev first` / `rev reply-doc` / `rev response` / `rev strip` report the real insertions, deletions, substitutions, and comments — the same numbers a subsequent `rev import` produces. In-place editors (`rev review` / `accept` / `reject` / `resolve` / `reply` / interactive `comments`) refuse a `.docx` with a pointer to `rev import` rather than corrupting it. As a backstop, the annotation parsers (`parseAnnotations` / `countAnnotations` / `getComments` / `stripAnnotations` / `hasAnnotations`) now reject binary input loudly, so the whole class can never silently regress.

## [0.11.2] - 2026-07-06

### Fixed
- **`pdf.header` / `pdf.footer` are now injected into the PDF build (#7).** The schema documented `pdf.header` / `pdf.footer`, but the build never read them, so any user-supplied LaTeX preamble (custom fonts, `fancyhdr` running headers, `lineno` line numbers) was silently dropped from `rev build pdf` — no error, no warning. `runPandoc` now resolves `pdf.header` / `pdf.footer` (file paths relative to the project root) and passes them to pandoc with `-H`, the same channel the macros preamble and annotated-comments path use. A file named but not found is reported as a warning instead of dropped. An inline `header-includes:` block (pandoc's native key, at the top level or under `pdf:`) is also honored by writing it to a temp `.tex`. The preamble applies to `pdf`, `tex`, and `beamer` builds and to the annotated `_comments.pdf`.

## [0.11.1] - 2026-07-05

### Added
- **`rev build docx --dual --show-changes` emits tracked changes and threaded comments in one file (#6).** The standard "return to senior author" artifact — my `{++..++}`/`{--..--}` edits as Word tracked changes alongside the reviewer's `{>>..<<}` comments with my threaded replies — now builds as a single `<title>-changes.docx`. Previously the two were mutually exclusive: `--show-changes` dropped comments, `--dual` accepted all changes. A new `buildReviewedDocx` runs one pandoc pass through the full filter chain, then threads comments into the same file. Add `--reference <docx>` to realign comment anchors first.

### Changed
- **Track changes now use pandoc-native `w:ins`/`w:del` revisions.** `--show-changes` (and `rev apply`) previously injected revision XML by string-replacing text markers, which nested `<w:ins>`/`<w:del>` inside `<w:t>` (malformed OOXML) and bypassed crossref/citeproc/the reference-doc. CriticMarkup is now converted to pandoc `.insertion`/`.deletion` spans and emitted as well-formed run-level revisions through the full filter chain.

## [0.11.0] - 2026-07-05

### Changed
- **Parser-backed OOXML layer, unified placement engine, boundary hardening.** One structural OOXML tokenizer (`lib/ooxml.ts`) now backs every Word reader and the comment injector, collapsing the divergent `extractCommentAnchors`/`extractWordComments` paths onto a single namespace-aware engine (matches WordprocessingML by URI, decodes entities, excludes `instrText` field codes, enumerates footnote/endnote parts, finds runs structurally). Section comment placement is offset-first, with proportional estimates demoted to a flagged last resort surfaced by `sync`. Rate-limiter gains a per-request timeout and HTTP-date `Retry-After` parsing; `checkDoi` reports unreachable distinctly from invalid; PPTX post-processing failures warn instead of being swallowed.

## [0.10.2] - 2026-06-22

### Fixed
- **`rev init` now derives subsection headers too (#5 Bug B).** 0.10.1 fixed first-heading-at-any-level only for the `rev.yaml`-derived path; `generateConfig` (the `rev init` -> `sections.yaml` path) still used H1-only extraction, so a project initialised with `rev init` left a `## 1.2 Objectives` file headed `Sec2` and folded its content into the preceding section on sync. `generateConfig` and `splitAnnotatedPaper` now use the first heading at any level.
- **Comments routed to non-keyword sections are no longer silently dropped (#5 Bug C).** The main `sync` flow routed comments with a hardcoded keyword list (abstract/intro/methods/results/discussion/conclusion); sections named e.g. `Objectives` or `Annex 2` got no boundary and their comments were discarded while the summary still reported every comment as placed. Comment routing now uses the same heading-based `computeSectionBoundaries` as `sync --comments-only`.
- **Sections absent (as prose) from the reviewed document are left untouched (#5 Bug C).** A section that appears only as a bare heading with no body — e.g. when a "no-annex" export is synced against the full project — was diffed against empty content and rewritten to near-empty. Such sections are now reported as `untouched` and left on disk unchanged.

### Changed
- **Truthful sync summary (#5 Bug C).** The summary now reports `N of M comments placed`, plus `already present`, `unmatched`, and `not routed to any synced section` counts (from `insertCommentsIntoMarkdown`'s `outStats`), instead of asserting that the raw extracted count was placed.
- The main `sync` flow and `sync --comments-only` now share one comment-routing path, removing the divergent keyword-search boundary logic.

## [0.10.1] - 2026-06-05

### Fixed
- **`sync`/`verify-anchors`/`split` no longer require a separate `sections.yaml`.** `build` and `status` read the `sections:` list from `rev.yaml`, but the sync-side commands demanded a `sections.yaml` and aborted with `Config not found` on a perfectly valid `rev.yaml`-only project. They now resolve the section config from a single source of truth: an explicit `sections.yaml` is used when present (to override headers/aliases/order), otherwise the config is derived from `rev.yaml`'s `sections:` list. Running `rev init` first is no longer necessary.
- **Derived section headers honor the file's first heading at any level.** A section file that leads with a subsection (e.g. `02_objectives.md` starting with `## 1.2 Objectives`) now derives the header `1.2 Objectives` (via the new `extractFirstHeading`), so it matches the corresponding docx heading and routes to its own file instead of being folded into the preceding section. `extractHeader` keeps its H1-only contract for existing callers.

### Added
- `resolveSectionsConfig(dir, configFile?)` and `deriveSectionsFromRev(dir)` in `lib/sections.ts`, with tests.

## [0.10.0] - 2026-05-20

### Added
- **Placeholder macros.** Built-in `\tofill{X}` renders as bold orange `[X]` across DOCX, PDF/TeX/Beamer, and HTML — drop the LaTeX-style command anywhere in a section file and the build expands it per format. No more copying a `tofill_filter.lua` + `\providecommand` boilerplate into each project. Users can add their own one-argument macros under `macros:` in `rev.yaml` (color, bold/italic, bracket wrap, prefix/suffix, per-format overrides). See `docs/configuration.md` for the schema.
- **`lib/macros.ts` + `lib/macro-filter.lua`** — registry-style implementation. Built-ins and user macros merge by name; user entries override built-ins. The lua filter loads its macro list from a JSON sidecar via the `DOCREV_MACROS_FILE` env var.

### Fixed
- **Silent DOCX color drop.** Pandoc 3.x's docx writer does NOT honor `Span` with `style="color: #..."`, so a lua filter returning `pandoc.Span(pandoc.Strong(...), pandoc.Attr("", {}, {style="color: #C2410C"}))` produced zero `<w:color>` runs and the highlight vanished. The new filter emits raw OpenXML `<w:r>` nodes directly (the same pattern as the existing `pptx-color-filter.lua`), which produces real colored runs in Word.
- **Silent DOCX paragraph drop.** Wrapping a `\tofill{X}` line in raw LaTeX like `\noindent \textit{\small ...}` made pandoc drop the entire paragraph from DOCX output, including the `\tofill` inside. The built-in `\providecommand` + lua-filter mechanism removes the need for any wrapper at all — placeholders survive every format.
- **Filter path resolution on Windows paths with spaces.** `lib/build.ts` resolved `pptx-color-filter.lua` via `new URL(import.meta.url).pathname`, which returns URL-encoded `%20` for spaces, so `fs.existsSync` silently returned false on paths like `C:\Users\Gilles Colling\...`. Switched both pptx and macro filter resolution to `fileURLToPath`. PPTX color highlighting now actually works under default installs on user-named directories.
- **Lua filter not shipped to runtime.** `scripts/postbuild.js` left `.lua` files in `lib/` only; the compiled `dist/lib/build.js` looked for them next to itself. PPTX colour filter (and now the macro filter) are now copied to `dist/lib/` during build.

### Notes for `\tofill` migration
Projects that ship their own `tofill_filter.lua` and `\providecommand{\tofill}{...}` in a custom header keep working — docrev's preamble uses `\providecommand`, so user `\renewcommand` (or pre-existing `\providecommand`) takes priority. To migrate, delete the local lua filter and any markdown wrappers like `\noindent \textit{\small ...}`; docrev's built-in covers all three formats. Override the color or style by adding the macro under `macros:` in `rev.yaml`.

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
