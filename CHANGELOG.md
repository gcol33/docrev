# Changelog

All notable changes to docrev will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
