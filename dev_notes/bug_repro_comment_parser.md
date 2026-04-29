# Bug repro — comment parser drops valid comments

## Symptom

A markdown file with 24 valid `{>>Author: text<<}` comments is shown by `rev comments file.md` as containing only 21. Three comments are silently dropped.

## Reproducer

`test.md`:
```markdown
# Test

**Para 1.** Sentence one{>>Jonathan Lenoir: short comment<<}.

**Para 2.** Sentence two{>>Jens-Christian Svenning: I'm quite skeptical about these listings of all the bad things alien species do, with any kind of proper benchmarking - you could arguably make similar lists of all the annoying or dangerous things native species do<<}.

**Para 3.** Sentence three{>>Jens-Christian Svenning: see https://besjournals.onlinelibrary.wiley.com/doi/full/10.1111/1365-2745.14307<<}.
```

```bash
rev comments test.md
```

**Expected:** 3 comments listed.
**Actual:** 1 comment listed (Lenoir's short comment). Both Svenning comments are dropped.

## Root cause — `lib/annotations.ts`

### Bug A: hyphenated reviewer names (line 102)

```ts
const hasAuthorPrefix = /^[A-Za-z][A-Za-z\s]{0,20}:\s/.test(commentContent.trim());
```

The character class `[A-Za-z\s]` forbids hyphens, apostrophes, and accented characters. So:

- `Jens-Christian Svenning:` — fails (hyphen at position 4)
- `Camilla T Colding-Jørgensen:` — fails (hyphen + diacritic)
- `Renata Ćušterevska:` — fails (diacritic at position 7)
- Any name with `-`, `'`, or non-ASCII letters fails

When `hasAuthorPrefix === false` AND content > `MAX_COMMENT_CONTENT_LENGTH = 200`, line 104 discards the comment. Any long comment from a hyphenated reviewer is silently dropped.

### Bug B: any comment containing a URL <150 chars (line 95)

```ts
if (/https?:\/\/|www\./i.test(commentContent) && commentContent.length < 150) return true;
```

This filter assumes URLs in CriticMarkup blocks are markdown links wrapped in CriticMarkup syntax (a real false positive). But reviewers legitimately cite URLs/DOIs inside comments — that gets dropped too.

`{>>Lenoir: see https://www.pnas.org/doi/10.1073/pnas.1608980113<<}` — 60 chars, contains URL → dropped, even though `Lenoir:` is a valid author prefix.

## Suggested fix

1. **Line 102 — broaden author-prefix regex:**
   ```ts
   const hasAuthorPrefix = /^[\p{L}][\p{L}\s\-'.]{0,30}:\s/u.test(commentContent.trim());
   ```
   Allows hyphens, apostrophes, periods, and Unicode letters. Length bumped to 30 (Camilla T Colding-Jørgensen is 27 chars).

2. **Line 95 — only filter URLs when there's no author prefix:**
   ```ts
   const looksLikeAuthor = /^[\p{L}][\p{L}\s\-'.]{0,30}:\s/u.test(commentContent.trim());
   if (!looksLikeAuthor && /https?:\/\/|www\./i.test(commentContent) && commentContent.length < 150) return true;
   ```
   A comment with a real `Author:` prefix should not be dropped just because it cites a URL.

## Impact

In `paper_hexgrids_2026/abstract.md`, three reviewer comments from Jens-Christian Svenning (one tone-related, two with cited URLs/DOIs) were silently dropped from `rev comments`, `rev next`, and presumably `rev build docx --dual` output. Other affected reviewers in this manuscript: Camilla T Colding-Jørgensen (long comments would drop), Renata Ćušterevska, Jean-Christian Svenning across all sections.
