# Troubleshooting

Common issues and solutions for docrev.

## Installation Issues

### "pandoc: command not found"

Pandoc is required for building documents.

**macOS:**
```bash
brew install pandoc
```

**Windows:**
```bash
winget install JohnMacFarlane.Pandoc
# or download from https://pandoc.org/installing.html
```

**Linux (Debian/Ubuntu):**
```bash
sudo apt install pandoc
```

Verify installation:
```bash
pandoc --version
```

### "pandoc-crossref: command not found"

pandoc-crossref is optional but required for figure/table cross-references.

**macOS:**
```bash
brew install pandoc-crossref
```

**Windows:**
Download from https://github.com/lierdakil/pandoc-crossref/releases

**Linux:**
```bash
# Check your package manager or download from GitHub releases
```

### LaTeX not found (PDF generation fails)

PDF output requires a LaTeX distribution.

**macOS:**
```bash
brew install --cask mactex-no-gui
# or smaller: brew install --cask basictex
```

**Windows:**
Install MiKTeX from https://miktex.org/download

**Linux:**
```bash
sudo apt install texlive-latex-base texlive-fonts-recommended
```

## Build Errors

### "No section files found"

**Cause:** No `.md` files in the directory, or sections not specified in `rev.yaml`.

**Solutions:**
1. Create section files: `rev new`
2. Specify sections in `rev.yaml`:
   ```yaml
   sections:
     - introduction.md
     - methods.md
   ```
3. Check you're in the correct directory

### "Failed to parse rev.yaml"

**Cause:** Invalid YAML syntax.

**Common fixes:**
- Check indentation (use spaces, not tabs)
- Quote strings with special characters
- Validate with: `rev check`

**Example of correct YAML:**
```yaml
title: "My Paper: A Study"  # Quotes needed for colon
authors:
  - name: John Doe          # 2-space indent
    affiliation: University
```

### Build produces empty PDF

**Causes:**
1. Section files are empty
2. Pandoc filter errors (check terminal output)
3. LaTeX errors

**Debug:**
```bash
rev build --verbose
rev build tex  # Check the .tex file for errors
```

## Import Issues

### Comments not imported from Word

**Causes:**
1. Document uses older .doc format (only .docx supported)
2. Comments are in review mode but not finalized

**Solutions:**
1. Save as .docx in Word
2. Accept/reject track changes before importing if you want clean text

### Track changes garbled or missing

**Cause:** Complex nested changes or unsupported Word features.

**Solution:**
```bash
rev import document.docx --no-track-changes
# Then manually review the Word file
```

### "Cannot read file" errors

**Causes:**
1. File is open in Word (Windows locks open files)
2. File path contains special characters
3. Corrupted .docx file

**Solutions:**
1. Close the file in Word
2. Rename file to remove special characters
3. Try opening in Word and re-saving

## Comment Issues

### Comments not appearing in Word export

**Cause:** Comments marked as resolved are hidden by default.

**Solutions:**
```bash
rev comments file.md --resolved  # Check resolved comments
rev resolve file.md -a -u        # Unresolve all comments
```

### Reply threading not working

Comments must be adjacent (no text between them) to thread in Word.

**Works:**
```markdown
text{>>Author1: comment<<}{>>Author2: reply<<}
```

**Won't thread:**
```markdown
text{>>Author1: comment<<} more text {>>Author2: reply<<}
```

### Author name not set

```bash
rev config user "Your Name"
# Or per-command:
rev reply file.md --author "Your Name"
```

## Cross-Reference Issues

### Figures/tables not numbered

**Causes:**
1. pandoc-crossref not installed
2. Labels not in correct format

**Correct format:**
```markdown
![Caption](image.png){#fig:label}

| Col1 | Col2 |
|------|------|
| a    | b    |

: Caption {#tbl:label}
```

### References show "??" instead of numbers

**Causes:**
1. Label doesn't exist
2. Typo in reference
3. pandoc-crossref not running

**Debug:**
```bash
rev refs           # List all labels
rev refs --check   # Find broken references
```

## PDF Issues

### Fonts missing or wrong

**LaTeX errors about fonts:**
```bash
# Install more fonts
sudo apt install texlive-fonts-extra  # Linux
# Or use standard fonts in rev.yaml:
pdf:
  mainfont: "Times New Roman"
```

### Images not appearing

**Causes:**
1. Image path incorrect (relative to project root)
2. Image format not supported by LaTeX

**Solutions:**
1. Use relative paths: `![](images/fig1.png)`
2. Convert to PNG/PDF: LaTeX prefers PDF for vector graphics

### PDF too large

```yaml
# In rev.yaml
pdf:
  geometry: "margin=0.75in"  # Smaller margins
  fontsize: "11pt"           # Smaller font
```

## Performance Issues

### DOI lookup slow

DOI validation queries external APIs. For large bibliographies:
```bash
rev doi check --no-lookup  # Skip online validation
```

### Build taking too long

```bash
# Build only what you need
rev build docx        # Skip PDF
rev build --no-toc    # Skip table of contents
```

## Encoding Issues

### Special characters corrupted

**Cause:** File encoding mismatch.

**Solutions:**
1. Ensure files are UTF-8 encoded
2. In Word, save with "UTF-8" encoding option
3. Check your editor's encoding settings

### BibTeX entries with accents fail

Use LaTeX-style escapes or UTF-8:
```bibtex
author = {M{\"u}ller, Hans}
# or with UTF-8:
author = {Müller, Hans}
```

## Getting Help

### Debug mode
```bash
rev build --verbose 2>&1 | tee build.log
```

### Check system status
```bash
rev doctor
```

### Report issues
https://github.com/gcol33/docrev/issues

Include:
- `rev --version` output
- `rev doctor` output
- Minimal reproducible example
