/**
 * Slide processing for Beamer and PPTX output
 *
 * Handles:
 * - ::: step blocks for incremental reveals
 * - ::: notes blocks for speaker notes
 * - Slide boundaries (---)
 * - Slide styles: {.dark}, {.light}, {.accent}, {.inverse}
 * - Special slides: {.cover}, {.thanks}, {.section}, {.plain}
 *
 * Syntax examples:
 *   ## Title {.dark}           - Dark background slide
 *   ## Welcome {.cover}        - Cover slide (no numbering, centered)
 *   ## Thank You {.thanks}     - Thanks slide (no numbering)
 *   # Part 1 {.section}        - Section divider slide
 *   ## Image {.plain}          - No header/footer, full content
 *   ## Highlight {.accent .nonumber}  - Accent color, no slide number
 */

/**
 * @typedef {Object} Step
 * @property {number} index - Step number (1-based)
 * @property {string} content - Markdown content of the step
 */

/**
 * Slide style options
 * @typedef {Object} SlideStyle
 * @property {string|null} background - Background style: 'dark', 'light', 'accent', 'inverse'
 * @property {string|null} type - Special type: 'cover', 'thanks', 'section', 'plain'
 * @property {boolean} nonumber - Disable slide numbering
 * @property {boolean} center - Center content vertically
 * @property {string[]} classes - Raw CSS classes for PPTX
 */

/**
 * @typedef {Object} Slide
 * @property {string} title - Slide title (## heading)
 * @property {number} titleLevel - Number of # in heading
 * @property {Step[]} steps - Array of steps (at least one)
 * @property {string|null} notes - Speaker notes content
 * @property {string} preamble - Content before first step (if no explicit steps)
 * @property {SlideStyle} style - Slide styling options
 */

/**
 * Background styles mapped to Beamer options
 */
const BEAMER_BACKGROUNDS = {
  dark: '\\setbeamercolor{background canvas}{bg=black}\\setbeamercolor{normal text}{fg=white}\\usebeamercolor[fg]{normal text}',
  light: '\\setbeamercolor{background canvas}{bg=white}\\setbeamercolor{normal text}{fg=black}\\usebeamercolor[fg]{normal text}',
  accent: '\\setbeamercolor{background canvas}{bg=structure.fg}\\setbeamercolor{normal text}{fg=white}\\usebeamercolor[fg]{normal text}',
  inverse: '\\setbeamercolor{background canvas}{bg=structure.fg!90!black}\\setbeamercolor{normal text}{fg=white}\\usebeamercolor[fg]{normal text}',
};

/**
 * Special slide types mapped to Beamer frame options
 */
const BEAMER_FRAME_OPTIONS = {
  cover: 'plain,noframenumbering,c',
  thanks: 'plain,noframenumbering,c',
  section: 'plain,noframenumbering,c',
  plain: 'plain',
};

/**
 * Parse slide style attributes from heading
 * @param {string} heading - Full heading text including {.class} attributes
 * @returns {{ title: string, style: SlideStyle }}
 */
function parseSlideStyle(heading) {
  const style = {
    background: null,
    type: null,
    nonumber: false,
    center: false,
    classes: [],
  };

  // Match {.class1 .class2} at end of heading
  const attrMatch = heading.match(/\s*\{([^}]+)\}\s*$/);
  if (!attrMatch) {
    return { title: heading.trim(), style };
  }

  const title = heading.slice(0, attrMatch.index).trim();
  const attrs = attrMatch[1];

  // Parse each .class
  const classMatches = attrs.matchAll(/\.(\w+)/g);
  for (const match of classMatches) {
    const cls = match[1].toLowerCase();
    style.classes.push(cls);

    // Background styles
    if (['dark', 'light', 'accent', 'inverse'].includes(cls)) {
      style.background = cls;
    }
    // Special slide types
    else if (['cover', 'thanks', 'section', 'plain'].includes(cls)) {
      style.type = cls;
      // Cover, thanks, section slides default to no numbering
      if (['cover', 'thanks', 'section'].includes(cls)) {
        style.nonumber = true;
        style.center = true;
      }
    }
    // Explicit options
    else if (cls === 'nonumber' || cls === 'unnumbered') {
      style.nonumber = true;
    } else if (cls === 'center' || cls === 'centered') {
      style.center = true;
    }
  }

  return { title, style };
}

/**
 * Parse a single slide's content into steps and notes
 * @param {string} slideContent - Content between --- delimiters
 * @returns {Slide}
 */
export function parseSlide(slideContent) {
  const lines = slideContent.split('\n');

  // Extract title (first heading)
  let title = '';
  let titleLevel = 2;
  let titleLineIndex = -1;
  let style = {
    background: null,
    type: null,
    nonumber: false,
    center: false,
    classes: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      titleLevel = match[1].length;
      // Parse style from heading
      const parsed = parseSlideStyle(match[2]);
      title = parsed.title;
      style = parsed.style;
      titleLineIndex = i;
      break;
    }
  }

  // Content after title
  const contentStart = titleLineIndex >= 0 ? titleLineIndex + 1 : 0;
  const bodyContent = lines.slice(contentStart).join('\n');

  // Parse ::: step and ::: notes blocks
  const steps = [];
  let notes = null;
  let preamble = '';

  // Regex to match fenced div blocks
  const blockPattern = /^:::\s*(step|notes)\s*$/gm;
  const endPattern = /^:::\s*$/gm;

  let currentPos = 0;
  let inBlock = false;
  let blockType = null;
  let blockStart = 0;

  const bodyLines = bodyContent.split('\n');
  let currentBlockContent = [];
  let beforeFirstStep = [];
  let foundFirstStep = false;

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];

    if (!inBlock) {
      // Check for block start
      const stepMatch = line.match(/^:::\s*step\s*$/);
      const notesMatch = line.match(/^:::\s*notes\s*$/);

      if (stepMatch) {
        inBlock = true;
        blockType = 'step';
        currentBlockContent = [];
        foundFirstStep = true;
      } else if (notesMatch) {
        inBlock = true;
        blockType = 'notes';
        currentBlockContent = [];
      } else if (!foundFirstStep) {
        beforeFirstStep.push(line);
      }
    } else {
      // Check for block end
      if (line.match(/^:::\s*$/)) {
        // End of block
        if (blockType === 'step') {
          steps.push({
            index: steps.length + 1,
            content: currentBlockContent.join('\n').trim(),
          });
        } else if (blockType === 'notes') {
          notes = currentBlockContent.join('\n').trim();
        }
        inBlock = false;
        blockType = null;
        currentBlockContent = [];
      } else {
        currentBlockContent.push(line);
      }
    }
  }

  // Handle content before first step as preamble
  preamble = beforeFirstStep.join('\n').trim();

  // If no explicit steps, treat entire body as single step
  if (steps.length === 0) {
    // Remove notes from body if present
    let bodyWithoutNotes = bodyContent;
    const notesBlockMatch = bodyContent.match(/^:::\s*notes\s*$[\s\S]*?^:::\s*$/m);
    if (notesBlockMatch) {
      bodyWithoutNotes = bodyContent.replace(notesBlockMatch[0], '').trim();
    }

    steps.push({
      index: 1,
      content: bodyWithoutNotes.trim(),
    });
    preamble = '';
  }

  return {
    title,
    titleLevel,
    steps,
    notes,
    preamble,
    style,
  };
}

/**
 * Parse markdown document into slides
 * @param {string} markdown - Full markdown content
 * @returns {Slide[]}
 */
export function parseSlides(markdown) {
  // Normalize line endings to \n
  const normalized = markdown.replace(/\r\n/g, '\n');

  // Split by --- (horizontal rule / slide delimiter)
  // Handle YAML frontmatter by checking for --- at start
  let content = normalized;
  let frontmatter = null;

  // Extract YAML frontmatter if present
  if (normalized.startsWith('---')) {
    const endMatch = normalized.slice(3).indexOf('\n---');
    if (endMatch !== -1) {
      frontmatter = normalized.slice(0, endMatch + 7); // Include both ---
      content = normalized.slice(endMatch + 7).trim();
    }
  }

  // Split remaining content by ---
  const parts = content.split(/\n---\n/);

  const slides = [];
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) {
      slides.push(parseSlide(trimmed));
    }
  }

  // Attach frontmatter to first slide's preamble if exists
  if (frontmatter && slides.length > 0) {
    slides[0]._frontmatter = frontmatter;
  }

  return slides;
}

/**
 * Build Beamer frame options string
 * @param {SlideStyle} style
 * @returns {string} Frame options like [plain,noframenumbering]
 */
function buildBeamerFrameOptions(style) {
  if (!style) return '';

  const options = [];

  // Special slide type options
  if (style.type && BEAMER_FRAME_OPTIONS[style.type]) {
    options.push(...BEAMER_FRAME_OPTIONS[style.type].split(','));
  } else {
    // Individual options
    if (style.nonumber) {
      options.push('noframenumbering');
    }
    if (style.center) {
      options.push('c');
    }
  }

  // Deduplicate
  const unique = [...new Set(options)];
  return unique.length > 0 ? `[${unique.join(',')}]` : '';
}

/**
 * Generate Beamer markdown using pandoc's native slide structure
 * Works WITH pandoc, not against it - pandoc creates frames, we add overlays
 * @param {Slide[]} slides
 * @returns {string} Markdown with Beamer-specific syntax
 */
export function generateBeamerMarkdown(slides) {
  const output = [];

  // Check if first slide is a cover slide - if so, skip pandoc's auto title page
  const hasExplicitCover = slides.length > 0 && slides[0].style && slides[0].style.type === 'cover';

  for (const slide of slides) {
    // Include frontmatter if present
    if (slide._frontmatter) {
      let frontmatter = slide._frontmatter;

      // If we have an explicit cover slide, remove title/author/date to prevent
      // pandoc from generating a duplicate title frame
      if (hasExplicitCover) {
        // Remove title, author, date lines but keep other frontmatter
        frontmatter = frontmatter
          .replace(/^title:.*\n?/m, '')
          .replace(/^author:.*\n?/m, '')
          .replace(/^date:.*\n?/m, '')
          .replace(/\n{2,}/g, '\n'); // Clean up extra blank lines

        // Check if frontmatter is now empty (just --- and ---)
        const content = frontmatter.replace(/---/g, '').trim();
        if (!content) {
          // Skip empty frontmatter entirely - don't output anything
          // The slide content will follow directly
        } else {
          output.push(frontmatter);
          output.push('');
        }
      } else {
        output.push(frontmatter);
        output.push('');
      }
    }

    // Build pandoc heading with beamer attributes
    let headingAttrs = '';
    const attrList = [];

    if (slide.style) {
      if (slide.style.type === 'cover' || slide.style.type === 'thanks' || slide.style.type === 'section') {
        attrList.push('.plain');
        attrList.push('.noframenumbering');
        attrList.push('.c');
      } else if (slide.style.type === 'plain') {
        attrList.push('.plain');
      }
      if (slide.style.nonumber && !attrList.includes('.noframenumbering')) {
        attrList.push('.noframenumbering');
      }
      if (slide.style.center && !attrList.includes('.c')) {
        attrList.push('.c');
      }
    }

    if (attrList.length > 0) {
      headingAttrs = ' {' + attrList.join(' ') + '}';
    }

    // Frame heading - pandoc creates the frame from this
    const heading = '#'.repeat(slide.titleLevel) + ' ' + slide.title + headingAttrs;
    output.push(heading);
    output.push('');

    // Note: Per-frame background colors (.dark, .accent) are not yet supported
    // in the pandoc-based beamer output. The classes are preserved for PPTX.

    // Add preamble if present (visible on all overlays)
    if (slide.preamble) {
      output.push(slide.preamble);
      output.push('');
    }

    // Generate content
    if (slide.steps.length === 1) {
      // Single step - just output content, no overlays needed
      output.push(slide.steps[0].content);
    } else {
      // Multiple steps - use \pause between steps
      // This is the pandoc-friendly way to do incremental reveals
      for (let i = 0; i < slide.steps.length; i++) {
        const step = slide.steps[i];
        output.push(step.content);
        output.push('');
        // Add pause after each step except the last
        if (i < slide.steps.length - 1) {
          output.push('. . .');
          output.push('');
        }
      }
    }

    // Add speaker notes
    if (slide.notes) {
      output.push('::: notes');
      output.push(slide.notes);
      output.push(':::');
    }

    output.push('');
    output.push('---');
    output.push('');
  }

  // Remove trailing ---
  while (output.length > 0 && output[output.length - 1].trim() === '') {
    output.pop();
  }
  if (output.length > 0 && output[output.length - 1] === '---') {
    output.pop();
  }

  return output.join('\n');
}

/**
 * Build PPTX slide class attribute string
 * @param {SlideStyle} style
 * @returns {string} Attribute string like {.dark .cover}
 */
function buildPptxSlideClasses(style) {
  if (!style || !style.classes || style.classes.length === 0) {
    return '';
  }
  return ' {.' + style.classes.join(' .') + '}';
}

/**
 * Generate PPTX markdown with duplicated slides for steps
 * Each step becomes a separate physical slide
 * @param {Slide[]} slides
 * @returns {string} Expanded markdown
 */
export function generatePptxMarkdown(slides) {
  const output = [];

  for (const slide of slides) {
    // Include frontmatter if present (only on first slide)
    if (slide._frontmatter) {
      output.push(slide._frontmatter);
      output.push('');
    }

    // Generate one physical slide per step
    for (let i = 0; i < slide.steps.length; i++) {
      const step = slide.steps[i];

      // Slide title with optional style classes
      const classes = buildPptxSlideClasses(slide.style);
      const heading = '#'.repeat(slide.titleLevel) + ' ' + slide.title + classes;
      output.push(heading);
      output.push('');

      // Add preamble if present
      if (slide.preamble) {
        output.push(slide.preamble);
        output.push('');
      }

      // Add cumulative steps up to current
      // For PPTX, each slide shows all steps up to and including current
      for (let j = 0; j <= i; j++) {
        output.push(slide.steps[j].content);
        output.push('');
      }

      // Add speaker notes (same for all step slides)
      if (slide.notes) {
        output.push('::: notes');
        output.push(slide.notes);
        output.push(':::');
      }

      // Slide delimiter (except for last step of last slide)
      output.push('');
      output.push('---');
      output.push('');
    }
  }

  // Remove trailing ---
  while (output.length > 0 && output[output.length - 1].trim() === '') {
    output.pop();
  }
  if (output.length > 0 && output[output.length - 1] === '---') {
    output.pop();
  }

  return output.join('\n');
}

/**
 * Process markdown for slide output format
 * @param {string} markdown - Source markdown
 * @param {'beamer'|'pptx'} format - Target format
 * @returns {string} Processed markdown
 */
export function processSlideMarkdown(markdown, format) {
  const slides = parseSlides(markdown);

  if (format === 'beamer') {
    return generateBeamerMarkdown(slides);
  } else if (format === 'pptx') {
    return generatePptxMarkdown(slides);
  }

  return markdown;
}

/**
 * Check if markdown contains slide syntax (steps, notes, or slide styles)
 * @param {string} markdown
 * @returns {boolean}
 */
export function hasSlideSyntax(markdown) {
  // Check for ::: step or ::: notes
  if (/^:::\s*(step|notes)\s*$/m.test(markdown)) {
    return true;
  }
  // Check for slide style attributes on headings: ## Title {.dark}
  if (/^#{1,6}\s+.+\{[^}]*\.(dark|light|accent|inverse|cover|thanks|section|plain|nonumber|center)/m.test(markdown)) {
    return true;
  }
  return false;
}

// Export style parser for testing
export { parseSlideStyle };
