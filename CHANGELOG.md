# Changelog

All notable changes to docrev will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **`docrev journey load` profiles the reader load.** For every body paragraph it lists the `information.md` terms introduced there, the terms used before the text introduces them, and how many terms the reader holds: those between their introduction (or first use) and their last use. `known` terms cost nothing and are left out; the abstract, captions and tables, which are read on their own, are not profiled. The summary gives the terms met by body word 500, 1000 and 2000 and the paragraph where the most are held; `--all` lists every paragraph, `--json` the full profile. On a 9,000-word proposal it showed one State-of-the-art paragraph introducing five defined terms at once, with eleven held by word 612.

### Fixed
- **Ecology Letters counts the main text alone.** The profile added the abstract, the figure legends and the statements to the 5,000-word limit, so a Letter whose Introduction to Discussion ran 4,000 words reported 6,300 and an error. The author guidelines count "the main text only (excluding title page, abstract, acknowledgements, reference list, table/figure/box legends)", and the profile now counts the same; the title page's "Statement of authorship" is recognised as a statement. The guidelines state no maximum number of references, so the profile's cap of 50 is gone; the keyword limit of 10 is in.
- **A file `wordCount.exclude` leaves out of the count still provides the keywords.** `docrev word-count --json` and `docrev validate` read the keywords, title, figures and references over every section file, so a title page kept out of a word limit no longer makes the keyword count zero.

## [0.17.6] - 2026-10-28

### Added
- **`docrev word-count --config <file>` counts a project under another config.** A paper that keeps one `rev.yaml` per journal (`rev-ecology-letters.yaml` next to the base `rev.yaml`) could only be counted under the base one, or by swapping the files. The option reads the named config instead of `./rev.yaml`; its section, bibliography and CSL paths stay relative to the current directory, as they are in every docrev config. A missing or unparsable file is an error rather than a silent fall back to the defaults.

### Fixed
- **Word counts leave the reviewers' notes out.** `countWords` dropped CriticMarkup with a pattern that stopped at a line break, so a comment spanning several lines was counted as prose: an annotated abstract of 143 words counted 4,171. CriticMarkup is now resolved by the same stripper the build uses (insertions and the new text of substitutions stay; deletions and comments go) before counting, and `docrev word-count` hands the stripped text to the abstract and keyword extraction as well, so a `Keywords:` line quoted inside a comment no longer adds to the keyword count.

## [0.17.5] - 2026-10-23

### Fixed
- **`docrev import manuscript.docx` keeps the reviewers' work.** Starting a project from a Word file read only its plain text: comments, tracked changes, images and equations were lost, and a paper whose headings were not exactly "Introduction", "Methods" and the like came out as one `content.md`. The import now reads the document as `docrev sync` does: comments and tracked changes become CriticMarkup, images go to `figures/media/`, equations become LaTeX, and the title and authors of the Title and Author paragraphs go into `rev.yaml`. It splits the text at the document's top heading level, with the text before the first heading in `preamble.md`; a document without Word heading styles is split at paragraphs that consist of a standard section name, as before. On the test manuscript (298 comments) the import keeps every comment, the tracked changes and 7 images in 9 section files, where it used to write one file with none of them.
- **Tracked changes nested inside other changes or comments come through intact.** Word lets a comment end inside a deletion and a deletion fall inside an earlier insertion; reading pandoc's output text with patterns left such spans as raw `[...]{.deletion author=...}` in the Markdown. The changes are now rewritten in pandoc's document tree, so the nesting resolves: a comment marker inside a change disappears with the comment, and a change inside the opposite change (text inserted and then deleted) is dropped as having no effect. This applies to `sync`, `import`, `status` and `comments`.
- **Comments land on the text they were made on.** Anchors were searched in a lower-cased copy of the Markdown, and a character whose lower case is longer (Turkish "İ" becomes "i" plus a combining dot) moved every later comment one character into its anchor, so a comment on "Discussion" came out as `D{>>...<<}[iscussion ]{.mark}` and could take the `+` of a closing `++}` with it. Matches found after ignoring whitespace or CriticMarkup were also placed at their offsets in the altered copy. All matches are now mapped back to the Markdown itself; on the test manuscript all 280 comments found by their anchor text land on it, where 262 of them were off before. A comment whose anchor spans tracked changes is placed at the start of the span without a highlight, so it never breaks the change markup.
- **A comment with no highlighted text keeps the space after it.** `Alps.{>>R2: How were the plots placed?<<} Each plot` built as "Alps.Each plot" in Word: the comment borrows the next word as its anchor, and the space before that word was dropped with it. The space now stays outside the comment's range, so the DOCX reads "Alps. Each plot".

## [0.17.4] - 2026-10-23

### Changed
- **docrev requires Node.js 20.16 or later.** Its PDF reader, pdfjs-dist 5, requires that version, so `engines` declared Node 18 support that the dependency did not have. CI tests Node 20, 22 and 24.

### Fixed
- **A PDF built with characters its font lacks is reported.** xelatex leaves such a character off the page and only notes it in its log; `docrev build` now lists the missing characters as a build warning (`missingGlyphWarning`).
- **Windows paths in `bibliography` and `csl` survive.** Pandoc reads header metadata as markdown, so in `C:\Users\...` every backslash segment parsed as a raw TeX command and vanished ("File C:Colling-in-ecology-and-evolution.csl not found"). Both paths are now written with forward slashes.

## [0.17.3] - 2026-10-23

### Fixed
- **DOCX tables render the same in Google Docs and LibreOffice as in Word.** Pandoc writes each table on a fixed grid whose widths come from the markdown dash counts and sum to 5.5 in whatever the page, and puts the header rule in a table style. Word stretches such a table to the page; Google Docs and LibreOffice keep the grid, so narrow columns broke words mid-word ("Targe|t") and the rules were lost. Every DOCX build now sizes each column from its content (the longest word sets the minimum, the cell text the share of the remaining width), fills the page's text width read from the section properties, and writes the top, bottom and header rules and the cell font size (10 pt, stepping down to 9 or 8 pt only when the longest words do not fit) on the table itself (`lib/docx-tables.ts`). Set `docx.tableLayout: false` in rev.yaml to keep pandoc's layout.

## [0.17.2] - 2026-10-23

### Fixed
- **A paragraph marker followed by a blank line attaches to its paragraph (#24).** `<!-- @p:id -->` was read only when it sat directly above its paragraph; with a blank line after it, the marker was skipped without notice, so `docrev journey check` reported the paragraph as having no marker and its journey entry as having no paragraph, and every information.md anchor on it as unresolved. A marker on a line of its own now attaches to the next block that prints something, passing over blank lines and comment-only blocks, in `journey check`, `journey init` (which no longer adds a second marker to such a paragraph) and the Word round-trip's marker reattachment. A marker followed by a heading, another marker or the end of the file is reported as `stray-marker` (label "marker without paragraph") in place of the "no matching paragraph" finding on its entry.

## [0.17.1] - 2026-10-23

### Added
- **story.md's `## Spine` section and journey.md's `- assumes:` field are parsed.** Both are written by the paper-assumed-knowledge skill and were rejected as an unknown story section and an unknown entry field. The Spine (the opening's belief, question, explanation, A- and B-plot as decided with the author) is kept as written in `spine`; an `@p:` anchor in it that no paragraph carries is reported as `unresolved-anchor` by `docrev journey check`. `assumes` is kept on the entry and survives `docrev journey init`.

### Fixed
- **`docrev journey init` keeps `- negotiated:` lines.** The rewrite of journey.md dropped them, so re-running init deleted every paragraph pin settled with a co-author.

## [0.17.0] - 2026-10-23

### Added
- **The CLI installs as `docrev`, with `rev` kept as an alias.** On Linux and macOS `rev` is usually the util-linux tool that reverses lines, so in a VM, container or CI runner a bare `rev word-count` can reach that tool instead. Help, usage hints, error suggestions, the docs and the Claude Code skill now name `docrev`; existing scripts that call `rev` keep working. Shell completions register both names and ship as `completions/docrev.{bash,zsh,ps1}`; the zsh script, when loaded with `eval "$(docrev completions zsh)"`, now registers itself with `compdef` instead of running the completer once on load.
- **story.md's `## Funnel` section is parsed** into `funnel`, kept as written: the paper-funnel skill's spec (claim sentence, headline and scope numbers, section orders, recurrence). It was reported as an unknown story section.

### Fixed
- **Figure and table references build as pandoc-crossref prints them.** `rev build` rewrote every reference that came before its anchor as a hardcoded "Figure N", so a paper whose figures sit after the text (Nature format) built "Fig. [-@fig:a]" as "Fig. [-Figure 1]" and ignored `figPrefix`. pandoc-crossref resolves a reference before or after its anchor in the combined document itself, so the pre-pass now resolves only references whose anchor is outside the text (`resolveExternalRefs`, was `resolveForwardRefs`). That pass, the supplementary pass and the DOCX conversion share one replacement, `replaceRefs`, which reads the citation syntax (`[-@fig:a]` the number alone, `[@fig:a]` and `@fig:a` prefix and number, `[@fig:a; @fig:b]` the plural prefix, `@Fig:a` capitalised) and takes the prefixes from rev.yaml's `crossref` block (`refPrefixes`).

## [0.16.1] - 2026-10-21

### Added
- **story.md's Stakes, Idea, Design logic and Meaning sections are parsed** into `stakes`, `idea`, `designLogic` and `meaning`, beside Claim, Audience, Problem and Question.
- **`information.md` checks whether a term is reused under one name.** `many-names`: an entry whose forms are more than one name (a shortening that drops words, a plural or an acronym of the expansion counts as the same name; "constant prediction; baseline" does not). `unlisted-variant`: the plural or singular of a form occurs in the text but no entry lists it, so the word is used unchecked, often in another sense ("settings" for tuning choices beside the form "evaluation setting"). `single-use-term`: a term defined in one paragraph and not used after it. `unused-acronym`: an acronym used in one paragraph only. None of them blocks `rev check`; an `accept:` line overrules them as before.

### Fixed
- **Word counts leave out the numbers of ordered-list items.** pandoc renders them as list numbering, so an abstract numbered 1-4, as Methods in Ecology and Evolution asks, counted four words too many. A list starts after a blank line, as in pandoc; a wrapped line of prose that opens with a number keeps it.
- **Term checks read the text without CriticMarkup comments and deletions.** Reviewer comments no longer count as uses of a term or as avoided wording.

## [0.16.0] - 2026-10-14

### Fixed
- **`rev lint` and `rev check` resolve cross-references across all configured sections and ignore Pandoc attributes** ([#22](https://github.com/gcol33/docrev/issues/22)). `@fig:demo` next to `![...](...){#fig:demo width="100%"}` no longer reports a broken reference, and a reference in one section to an anchor in another passes `rev check` as it already did `rev lint`. Both commands share one resolver covering `fig`, `tbl`, `eq` and `sec` labels, including an id placed after other attributes (`{.unnumbered #sec:intro}`) and the capitalised `@Fig:` form; broken references are reported with their file.

### Added
- **`information.md` is checked against the manuscript.** Its Terms and Populations (`forms`, `as`, `defined`, `avoid`, `glossed`, `abstract`/`caption`/`supplement`/`reminder`, `accept`), as the paper-sidecars skill writes them, are read by `rev journey check` and step 4 of `rev check`, reported in their own block and under `information` in `--json`: a term with `defined: none` or no definition that is not `known`, a definition anchor no paragraph carries, a form listed under two entries, a gloss using its own name or relying on a term the text defines later, an avoided wording in the text (with its paragraph and sentence), a use before the paragraph that introduces the term (once per paragraph; abstract, captions and the entry's read-alone anchors exempt), and an entry no form of which occurs. `accept:` lines on the entry overrule a finding; an `@p:` in them names the paragraph the finding sits in. New `rev.yaml` key `information` overrides the default path.
- **Paragraphs settled with a co-author are pinned.** A journey entry may carry `- negotiated: <who> <date> [#<hash>]: <decision>`. Without a hash the check asks for one; with one, a change to the paragraph's text since (whitespace aside) is reported as `negotiated-changed`. `rev journey ack <ids...>` writes the current text's hash into those lines: the change is reconfirmed.
- **`rev check` fails on what a draft should not go out with:** an undefined term, an avoided wording and a negotiated paragraph changed since its decision, unless an `accept:` line overrules them. Every other sidecar finding stays a warning.

## [0.15.0] - 2026-10-14

### Added
- **The supporting information is checked against its own journey, `supplement/journey.md`.** One entry per SI table, figure, appendix or unnumbered section (`### tbl.key  [arcs]`, then `file`, `tier`, `supports`, `title`, `configuration`, `status`, `source`, `accept`), in print order, as the paper-sidecars skill writes it. `rev journey check` (and step 4 of `rev check`) now also reports, in its own block and under `supplement` in `--json`: a named section file that is missing, a file in `supplement/sections/` no entry places, a file that does not print its item's key (`[[tbl:key]]` or `{#tbl:key}`), a `[[key]]` or literal `Table S<n>`/`Figure A<n>` reference that resolves to no item, a manuscript section citing an `archive` item, an `evidence` item that supports no paragraph, a `supports: @p:id` no manuscript paragraph carries, an arc story.md does not define, and a `supplement/numbers.json` label lock that differs from the journey's order. Labels follow position: S1, S2, ... per kind, A1, A2, ... per kind for archive items, none for `sec.` entries. `accept:` lines on an item overrule its findings as in journey.md. New `rev.yaml` keys `supplementJourney` and `supplementSections` override the default paths.

### Changed
- `rev journey check` and `rev check` run the sidecar checks through one shared function, so the two can no longer differ in what they read.

## [0.14.7] - 2026-10-14

### Fixed
- **`rev journey check` reported `[no marker]` for front and back matter (#21).** Paragraphs before the first level-1 heading (title-page lines), paragraphs under a back-matter heading (acknowledgements, author contributions, conflict/competing interests, data and code availability, funding, references, bibliography, supporting information, supplementary; the same set the paper-sidecars reader pass uses), and bold-label metadata lines (`**Keywords:** ...`, `**Classification:** ...`) no longer need a marker, and `rev journey init` no longer assigns them one. Back matter runs until the next heading at its own level or above. A paragraph there that the author anchors with `<!-- @p:id -->` is still checked as usual. Front-matter position is tracked across section files in build order; a manuscript with no level-1 heading has no front matter.

## [0.14.6] - 2026-10-14

### Added
- **PNAS sidecar notation: `Significance audience`, `significance: yes`, `sig.*` entries (#20).** `story.md` now accepts a `## Significance audience` section (the reader of the PNAS Significance statement, narrower than `Audience`) and a `significance: yes` field on an arc the Significance statement carries. `rev journey check` flags drift between the arcs marked `significance: yes` and the arcs `sig.*` journey entries claim (`significance-drift`), and flags an arc whose `evidence` lists only `SI Appendix, ...` items (`si-only-evidence`), since PNAS requires the main text to stand without the SI.

### Fixed
- **`rev journey check`/`init` read `sections.yaml` before the `rev.yaml` `sections:` list, so a project with both read zero manuscript blocks (#18).** `sections.yaml` is the Word-import header/alias map and can list bare names (`abstract.md`) that don't exist once `rev.yaml` lists the real build paths (`src/clean/abstract.md`); journey silently skipped every missing file and reported every journey entry as an orphan. Journey commands now resolve sections the same way `rev build` does — `rev.yaml` `sections:` first, `sections.yaml` only as a fallback — and a listed section file that doesn't exist on disk is now a reported error instead of a silent skip.
- **An HTML-comment-only block was counted as an unmarked paragraph (#19).** `parseManuscriptBlocks` now skips a block whose content, once HTML comments are stripped, is empty. Pandoc drops such a block entirely, so it is never a printed paragraph and needs no `<!-- @p:id -->` marker or journey entry.

## [0.14.5] - 2026-09-30

### Added
- **`story.md` `Problem` and `Question` sections.** `Problem` records the larger problem the opening names, at the width the closer returns to; `Question` states the paper's challenge in one sentence ("to learn X, we did Y"). Parsed the same way as `Claim`/`Audience`.
- **A display equation and the sentence around it stay one journey unit.** `parseManuscriptBlocks` now joins a paragraph that ends without a full stop to the equation that continues it, and joins the lower-case where-clause that follows an equation back to the sentence it belongs to — unless the author marked either block with its own `<!-- @p:id -->` marker.

### Fixed
- **`word-count`/`wc` ignored a `.tex` argument and silently counted the project's Markdown files instead (#16).** The command took no file argument at all; any extra word on the command line was accepted and dropped. It now takes an optional `[file]`: a `.tex` file is read directly and counted per top-level `\section`, with the abstract, figure/table captions and back matter (from `\appendix` on) reported separately and the bibliography excluded entirely; a `.md` file is counted on its own instead of the whole project; any other extension is now a clear error instead of a silent fallback. Math and code listings count as one word each by default, or are dropped with `--exclude-formulas`.

## [0.14.4] - 2026-09-30

### Added
- **Journey sidecar: `idea`, `warning`, `accept` entry fields; story arc `payoff`.** A journey entry records its point in a few words (`idea:`), open findings against it (`warning:`, repeatable) and findings already considered and overruled (`accept:`, repeatable), so a re-check doesn't re-raise something already decided. A story arc records what the answer gets the reader (`payoff:`), alongside `question`/`answer`/`evidence`/`limits`/`needs`.
- **Markers on list items.** `rev journey init` puts a paragraph marker inside a list item that doesn't have one yet (`2. <!-- @p:abs.p1 --> Second point.`), and `parseManuscriptBlocks` reads a list whose items already carry markers as one journey unit per item, not one unit for the whole list — for an abstract or highlights written as a numbered list.
- `journeyCheck`'s arc-order check (`needs:`) skips front matter (abstract, summary, author summary, significance statement, highlights, graphical abstract, keywords): a summary read before the body states every arc at once, so it isn't evidence of the order the body itself introduces them in.

### Fixed
- **`rev journey init` corrupted a file with Windows line endings.** Marker insertion split on `\n` and rejoined the same way, turning every `\r\n` in the file into a bare `\n`. It now splits on `\r?\n` and rejoins with whatever the file used.
- **A journey.md rewrite that hit an unparseable line used to continue silently**, keeping only the entries it could parse and dropping the rest without saying so. It now stops and exits nonzero, naming the file and telling you to fix the line and rerun.



### Fixed
- **Statements had no per-journal setting, and back-matter headings truncated mid-file (#15).** `countForWordLimit`'s back-matter heading was matched as a prefix (`References?\b.*$`), so a mid-file `## Reference plots`, `### Funding of the survey`, `## Supporting Information` or `## Ethics` subsection dropped the rest of the section it was in from the count, with no warning. A heading is now matched only when it IS the whole heading text (an optional trailing "Statement" or colon is fine), and a back-matter span runs from its heading to the next heading of the same or higher level, not to the end of the file.
- Acknowledgements, Author Contributions, Conflict of Interest/Competing Interests, Data/Code Availability, Funding and Ethics are "statements": whether they count toward `main` differs by journal (MEE counts them, for one), and neither `main` (which always counted them) nor the previous back-matter stripping (which never did) could be set per profile. `wordLimit.includeStatements` in a journal profile (default `true`, matching a plain count with no journal in play) and `wordCount.includeStatements` in `rev.yaml` (wins over the profile) now decide it; `statementHeadings` in either extends the built-in list. References/Bibliography and Supporting Information/Supplementary Material are still always excluded — the reference list is measured by rendering it (`includeReferences`), and neither is main text.
- `statementWords` is reported beside `tableCellWords` and `figureCaptionWords` in `WordLimitCount`, `rev word-count --json`, the `rev validate`/`rev word-count -j` stats table, and the over-limit error's inline breakdown.



### Fixed
- **`rev validate`/`rev word-count -j` counted back matter as body text (#14).** `countForWordLimit` summed `countWords` over every section file with no distinction between the sections a journal's limit covers (Abstract → Discussion) and Acknowledgements, Author Contributions, Competing/Conflict of Interest, Data/Code Availability, Funding, Supporting Information and the References heading — on a manuscript with ~500–800 words of back matter, `main` was checked against a body ~10% too high. Each section file is now counted only up to its first back-matter heading, whether that heading starts its own file or trails the discussion in one shared with it.
- The one-line over-limit error now states the breakdown inline (`current: 8098 = body 7357 + abstract 343 + captions 398`), matching the parts already shown in the stats table, so a wrong number is visible without reading it.

### Added
- `wordCount.exclude` in `rev.yaml` drops named section files from `rev validate` and `rev word-count` entirely — for a section that is never part of the manuscript's word count, such as a reviewer-only note kept only so it lands in the anonymized build.

## [0.14.1] - 2026-09-30

### Fixed
- **`countWords` counted HTML comments as prose (#13).** `<!-- ... -->` was left in place, so a paragraph anchor such as `<!-- @p:a.one -->` survived as `.problem` after the citation regex ran, and a comment left for a co-author had every word in it counted. Comments are now stripped before anything else, which also fixes the count inside table cells, figure captions and the extracted abstract, since all three call `countWords`.

### Added
- `rev word-count --json` prints per-section counts, the total, the limit and (when a journal applies) its requirements, count breakdown, keyword count and reference-list warning, as one JSON object.
- `rev word-count -j` now defaults to the `journal:` set in `rev.yaml` when `-j`/`--journal` is omitted.

## [0.14.0] - 2026-09-29

### Added
- **Story and journey sidecars (#12).** `story.md` records a paper's argument as a handful of arcs (claim, audience, `question`/`answer`/`evidence`/`limits`/`needs` per arc); `journey.md` records one entry per paragraph, figure, table, equation, or code block, in reading order, tagged with the arc(s) it serves. Neither file is ever part of a build. `story:`/`journey:` keys in `rev.yaml` override the default filenames.
- `rev journey init` assigns a stable `<!-- @p:id -->` marker to every unmarked paragraph/float and scaffolds `journey.md` (draft `job` from the paragraph's first sentence). Idempotent: re-running only fills gaps and keeps existing entries' hand-authored fields.
- `rev journey check` (`--json` for structured output) checks the manuscript against `story.md`/`journey.md`: every paragraph has an ID and entry and the order matches; `job` is one sentence; every entry has an arc and every arc has an entry; an arc's first entry comes after an entry of each arc it `needs`; evidence labels resolve (and `TODO` evidence is reported); near-identical `job`/`leaves` across sections; every figure/table/equation has an entry. Also runs as step 4 of `rev check` when `journey.md` exists.
- `rev build story` / `rev build journey` render a sidecar to a standalone docx/pdf for co-authors, without touching the main paper's configured output.
- A paragraph marker survives a Word round-trip: the legacy diff-based `rev import` protects/restores it like a figure anchor; the OOXML-based `rev sync` path (which rebuilds a section purely from the reviewed docx) re-attaches markers by matching reconstructed paragraphs back against the on-disk original.

## [0.13.1] - 2026-09-15

### Fixed
- **`rev word-count -j` checks the limit the journal states.** It compared the prose total of every section against `wordLimit.main` and ignored `includeAbstract` / `includeFigureCaptions` / `includeTableCells` / `includeReferences`, so on the same manuscript it could pass a limit that `rev validate -j` failed. Both commands now measure through one function, `countForWordLimit` in `lib/journals.ts`, render the reference list the same way, and print the same breakdown. An unknown journal name is an error instead of being ignored.
- **`rev validate` reads the manuscript the build reads.** With no files given it took every `.md` in the directory, so a response letter or notes file sitting next to the sections was counted. It now uses the build's section list (`rev.yaml` `sections:`, then `sections.yaml`, then the directory), as `word-count` does.
- **Frontmatter in a later section file is no longer counted.** Sections were joined before counting, and frontmatter is only recognized at the top of a document, so a second file's YAML block was counted as prose. Each file is now counted on its own and the parts summed.

## [0.13.0] - 2026-09-09

### Fixed
- **`rev validate` counts what the journal counts.** A limit stated as "including tables/figure captions, statements and references list" was checked against body prose alone: the reference list does not exist in the sources, since citeproc renders it at build time, and figure captions were removed with their image. On a manuscript with 31 references and 5 figures that is 1,661 words the count never saw. The parts are now measured separately and the profile says which of them its limit covers, through `wordLimit.includeReferences` / `includeFigureCaptions` / `includeTableCells` / `includeAbstract`. The reference list is rendered with the project's own bibliography and CSL, through the same pandoc + citeproc pass the build uses, so a style that prints every author of a consortium paper is counted at what it actually prints. The stats table shows each part and whether it was counted.
- **The abstract ended at its first `z`.** `\Z` is not a JavaScript escape; written into the extraction pattern it matched a literal Z, and under `/i` a literal z, so an abstract was cut at its first one. A 356-word abstract was reported as 162 and passed a 350-word limit. A trailing `Keywords:` line is also dropped, since journals limit the two separately.
- **The title was the first heading.** A rev project carries its title in `rev.yaml`, so the first H1 in the sections is "Abstract" and the reported title length was 8 characters. `validate` reads the configured title.
- **A table was counted as five rows.** `countTables` divided the row total by an assumed rows-per-table, so the figure was a function of table length: 8 tables reported as 15. One table is now one run of consecutive rows.
- **A cross-reference counted as a reference.** `@fig:one` was recorded under the key `fig`, because the guard tested the captured key for a colon the pattern had already stopped at.
- **`sections: {required: [...]}` no longer dies at validation time.** The `--new` template suggested that shape, and it reached the validator as an object, which failed with "req.sections is not iterable". Both the list and the nested form are accepted; the template and the documented example now write the list.

### Added
- `keywords.max` and `dataAvailability` in a profile are read: both were accepted, stored, and never checked.
- `countTableCellWords` and `countFigureCaptionWords` in `lib/utils.ts`, and `renderBibliography` in the new `lib/bibliography.ts`.

## [0.12.3] - 2026-09-09

### Fixed
- **`rev validate` counts the prose between two tables.** `countWords` stripped table content with `/\|[^|]+\|/g`, and `[^|]` matches a newline, so the pattern ran from the last pipe of one table to the first pipe of the next and deleted every paragraph standing between them. On an 8-table results section it dropped about 2,000 words of running text, and the reported count fell as prose was added between tables and rose as a table was removed. `/\{[^}]+\}/g` had the same shape and joined one figure's attribute block to the next. Both are now bounded: table rows are dropped line by line, so a table contributes nothing and nothing else is taken with it, and every pattern without a same-line closing delimiter is confined to one line.
- **A citation no longer leaves its brackets behind as words.** `[@Ellenberg_1991; @Diekmann_2003]` had its keys removed and the residue `[; ]` counted as two words. Bracketed citations are removed whole, and a token carrying no letter or digit is not counted.
- **A cross-reference label with a hyphen is removed in full.** `@\w+` stopped at the hyphen of `@fig:sample-efficiency`, leaving `-efficiency` to be counted.
- **Frontmatter is recognized only at the top of the document.** The `^---[\s\S]*?---` pattern carried the `m` flag, so a horizontal rule mid-document could open a match and delete everything up to the next one. Horizontal rules are likewise matched as whole lines, not as any run of three dashes inside a word.

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
