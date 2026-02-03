/**
 * Slide processing for Beamer and PPTX output
 *
 * Handles:
 * - ::: step blocks for incremental reveals
 * - ::: buildup blocks for progressive bullet reveals with greying
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
 *
 * Buildup syntax:
 *   ::: buildup
 *   - First point
 *     - Sub A
 *     - Sub B
 *   - Second point
 *   :::
 *
 * Generates slides where current point is colored, previous are greyed out.
 * Subpoints appear sequentially within their parent.
 */

interface Step {
  index: number;
  content: string;
}

interface SlideStyle {
  background: string | null;
  type: string | null;
  nonumber: boolean;
  center: boolean;
  classes: string[];
}

interface Slide {
  title: string;
  titleLevel: number;
  steps: Step[];
  notes: string | null;
  preamble: string;
  style: SlideStyle;
  _frontmatter?: string;
}

interface BulletItem {
  text: string;
  indent: number;
  children: BulletItem[];
}

interface BuildupStep {
  itemIndex: number;
  subIndex: number | null;
}

interface BuildupResult {
  content: string;
  afterContent?: string;
  buildupSteps: string[] | null;
}

interface StepWithBuildup extends Step {
  beforeBuildup?: string;
  afterBuildup?: string;
  buildupSteps?: string[] | null;
}

/**
 * Grey color for "completed" buildup items
 */
const GREY_COLOR = '#888888';

/**
 * Background styles mapped to Beamer options
 */
const BEAMER_BACKGROUNDS: Record<string, string> = {
  dark: '\\setbeamercolor{background canvas}{bg=black}\\setbeamercolor{normal text}{fg=white}\\usebeamercolor[fg]{normal text}',
  light: '\\setbeamercolor{background canvas}{bg=white}\\setbeamercolor{normal text}{fg=black}\\usebeamercolor[fg]{normal text}',
  accent: '\\setbeamercolor{background canvas}{bg=structure.fg}\\setbeamercolor{normal text}{fg=white}\\usebeamercolor[fg]{normal text}',
  inverse: '\\setbeamercolor{background canvas}{bg=structure.fg!90!black}\\setbeamercolor{normal text}{fg=white}\\usebeamercolor[fg]{normal text}',
};

/**
 * Special slide types mapped to Beamer frame options
 */
const BEAMER_FRAME_OPTIONS: Record<string, string> = {
  cover: 'plain,noframenumbering,c',
  thanks: 'plain,noframenumbering,c',
  section: 'plain,noframenumbering,c',
  plain: 'plain',
};

/**
 * Parse a bullet list into a tree structure
 */
function parseBulletList(content: string): BulletItem[] {
  const lines = content.split('\n');
  const items: BulletItem[] = [];
  const stack: Array<BulletItem & { children: BulletItem[] }> = [{ children: items, indent: -1 } as any];

  for (const line of lines) {
    // Match bullet lines: "- text" or "  - text" etc.
    const match = line.match(/^(\s*)[-*]\s+(.+)$/);
    if (!match) continue;

    const indent = (match[1] || '').length;
    const text = (match[2] || '').trim();

    const item: BulletItem = { text, indent, children: [] };

    // Find parent based on indentation
    while (stack.length > 1) {
      const top = stack[stack.length - 1];
      if (!top || top.indent < indent) break;
      stack.pop();
    }

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(item);
    }
    stack.push(item as any);
  }

  return items;
}

/**
 * Flatten bullet tree into sequential reveal steps
 * Each step is: { itemIndex, subIndex, isSubItem }
 */
function flattenBuildupSteps(items: BulletItem[]): BuildupStep[] {
  const steps: BuildupStep[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (!item) continue;

    if (item.children.length === 0) {
      // No children - single step for this item
      steps.push({ itemIndex: i, subIndex: null });
    } else {
      // Has children - first show parent, then each child
      steps.push({ itemIndex: i, subIndex: -1 }); // Parent only

      for (let j = 0; j < item.children.length; j++) {
        steps.push({ itemIndex: i, subIndex: j });
      }
    }
  }

  return steps;
}

/**
 * Render a bullet item with optional color
 */
function renderBulletItem(
  item: BulletItem,
  color: string | null,
  indentLevel: number = 0,
  showChildrenUpTo: number | null = null
): string {
  const indent = '  '.repeat(indentLevel);
  const lines: string[] = [];

  // Render the main item
  const text = color ? `[${item.text}]{color=${color}}` : item.text;
  lines.push(`${indent}- ${text}`);

  // Render children if any should be shown
  if (showChildrenUpTo !== null && showChildrenUpTo >= 0 && item.children) {
    for (let i = 0; i <= showChildrenUpTo && i < item.children.length; i++) {
      const child = item.children[i];
      if (!child) continue;
      const childColor = color; // Children inherit parent's color state
      const childText = childColor ? `[${child.text}]{color=${childColor}}` : child.text;
      lines.push(`${indent}  - ${childText}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate buildup slides from a bullet list
 */
function expandBuildup(content: string, format: string): string[] {
  const items = parseBulletList(content);
  if (items.length === 0) return [content];

  const steps = flattenBuildupSteps(items);
  const slideContents: string[] = [];

  for (const step of steps) {
    const lines: string[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item) continue;

      if (i < step.itemIndex) {
        // Previous top-level item - greyed out with all children
        const allChildrenIndex = item.children.length > 0 ? item.children.length - 1 : null;
        lines.push(renderBulletItem(item, GREY_COLOR, 0, allChildrenIndex));
      } else if (i === step.itemIndex) {
        // Current top-level item - colored
        if (step.subIndex === null) {
          // No children case - just show item
          lines.push(renderBulletItem(item, null, 0, null));
        } else if (step.subIndex === -1) {
          // Has children but showing parent only first
          lines.push(renderBulletItem(item, null, 0, null));
        } else {
          // Showing parent + children up to subIndex
          lines.push(renderBulletItem(item, null, 0, step.subIndex));
        }
      }
      // Future items (i > step.itemIndex) - not shown yet
    }

    slideContents.push(lines.join('\n'));
  }

  return slideContents;
}

/**
 * Process ::: buildup blocks in content and expand to steps
 */
function processBuildupBlocks(content: string, format: string): BuildupResult {
  const buildupMatch = content.match(/^:::\s*buildup\s*\n([\s\S]*?)\n:::\s*$/m);

  if (!buildupMatch || buildupMatch.index === undefined) {
    return { content, buildupSteps: null };
  }

  const buildupContent = buildupMatch[1] || '';
  const buildupSteps = expandBuildup(buildupContent, format);

  // Remove the buildup block from content (will be replaced by steps)
  const beforeBuildup = content.slice(0, buildupMatch.index).trim();
  const afterBuildup = content.slice(buildupMatch.index + buildupMatch[0].length).trim();

  return {
    content: beforeBuildup,
    afterContent: afterBuildup,
    buildupSteps,
  };
}

/**
 * Parse slide style attributes from heading
 */
function parseSlideStyle(heading: string): { title: string; style: SlideStyle } {
  const style: SlideStyle = {
    background: null,
    type: null,
    nonumber: false,
    center: false,
    classes: [],
  };

  // Match {.class1 .class2} at end of heading
  const attrMatch = heading.match(/\s*\{([^}]+)\}\s*$/);
  if (!attrMatch || attrMatch.index === undefined) {
    return { title: heading.trim(), style };
  }

  const title = heading.slice(0, attrMatch.index).trim();
  const attrs = attrMatch[1] || '';

  // Parse each .class
  const classMatches = attrs.matchAll(/\.(\w+)/g);
  for (const match of classMatches) {
    if (!match[1]) continue;
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
 */
export function parseSlide(slideContent: string): Slide {
  const lines = slideContent.split('\n');

  // Extract title (first heading)
  let title = '';
  let titleLevel = 2;
  let titleLineIndex = -1;
  let style: SlideStyle = {
    background: null,
    type: null,
    nonumber: false,
    center: false,
    classes: [],
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match && match[1] && match[2]) {
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
  const steps: Step[] = [];
  let notes: string | null = null;
  let preamble = '';

  // Regex to match fenced div blocks
  const bodyLines = bodyContent.split('\n');
  let inBlock = false;
  let blockType: string | null = null;
  let currentBlockContent: string[] = [];
  let beforeFirstStep: string[] = [];
  let foundFirstStep = false;

  for (let i = 0; i < bodyLines.length; i++) {
    const line = bodyLines[i];
    if (!line && line !== '') continue;

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
 */
export function parseSlides(markdown: string): Slide[] {
  // Normalize line endings to \n
  const normalized = markdown.replace(/\r\n/g, '\n');

  // Split by --- (horizontal rule / slide delimiter)
  // Handle YAML frontmatter by checking for --- at start
  let content = normalized;
  let frontmatter: string | null = null;

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

  const slides: Slide[] = [];
  for (const part of parts) {
    if (!part) continue;
    const trimmed = part.trim();
    if (trimmed) {
      slides.push(parseSlide(trimmed));
    }
  }

  // Attach frontmatter to first slide's preamble if exists
  if (frontmatter && slides.length > 0 && slides[0]) {
    slides[0]._frontmatter = frontmatter;
  }

  return slides;
}

/**
 * Build Beamer frame options string
 */
function buildBeamerFrameOptions(style: SlideStyle | null): string {
  if (!style) return '';

  const options: string[] = [];

  // Special slide type options
  if (style.type && BEAMER_FRAME_OPTIONS[style.type]) {
    const opts = BEAMER_FRAME_OPTIONS[style.type];
    if (opts) options.push(...opts.split(','));
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
 */
export function generateBeamerMarkdown(slides: Slide[]): string {
  const output: string[] = [];

  // Check if first slide is a cover slide - if so, skip pandoc's auto title page
  const hasExplicitCover = slides.length > 0 && slides[0] && slides[0].style && slides[0].style.type === 'cover';

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
    const attrList: string[] = [];

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
    if (slide.steps.length === 1 && slide.steps[0]) {
      // Single step - just output content, no overlays needed
      output.push(slide.steps[0].content);
    } else {
      // Multiple steps - use \pause between steps
      // This is the pandoc-friendly way to do incremental reveals
      for (let i = 0; i < slide.steps.length; i++) {
        const step = slide.steps[i];
        if (!step) continue;
        output.push(step.content);
        output.push('');
        // Add pause after each step except the last
        if (i < slide.steps.length - 1) {
          output.push('. . .');
          output.push('');
        }
      }
    }

    // Add speaker notes as LaTeX \note{} command
    if (slide.notes) {
      output.push('');
      // Escape special LaTeX characters in notes
      const notes = slide.notes || '';
      const escapedNotes = notes
        .replace(/\\/g, '\\textbackslash{}')
        .replace(/[&%$#_{}]/g, '\\$&')
        .replace(/\n/g, '\\\\');
      output.push('\\note{' + escapedNotes + '}');
    }

    output.push('');
    output.push('---');
    output.push('');
  }

  // Remove trailing ---
  while (output.length > 0) {
    const last = output[output.length - 1];
    if (!last || last.trim() !== '') break;
    output.pop();
  }
  if (output.length > 0 && output[output.length - 1] === '---') {
    output.pop();
  }

  return output.join('\n');
}

/**
 * Build PPTX slide class attribute string
 */
function buildPptxSlideClasses(style: SlideStyle | null): string {
  if (!style || !style.classes || style.classes.length === 0) {
    return '';
  }
  return ' {.' + style.classes.join(' .') + '}';
}

/**
 * Generate PPTX markdown with duplicated slides for steps
 * Each step becomes a separate physical slide
 * Handles ::: buildup blocks by expanding them into multiple slides
 */
export function generatePptxMarkdown(slides: Slide[]): string {
  const output: string[] = [];

  for (const slide of slides) {
    // Include frontmatter if present (only on first slide)
    if (slide._frontmatter) {
      output.push(slide._frontmatter);
      output.push('');
    }

    // Check if any step contains a buildup block
    const stepsWithBuildup: StepWithBuildup[] = slide.steps.map((step) => {
      const result = processBuildupBlocks(step.content, 'pptx');
      return {
        ...step,
        beforeBuildup: result.content,
        afterBuildup: result.afterContent || '',
        buildupSteps: result.buildupSteps,
      };
    });

    // Generate slides - handle buildup expansion
    for (let i = 0; i < stepsWithBuildup.length; i++) {
      const step = stepsWithBuildup[i];
      if (!step) continue;

      if (step.buildupSteps && step.buildupSteps.length > 0) {
        // This step has a buildup block - generate one slide per buildup step
        for (const buildupContent of step.buildupSteps) {
          const classes = buildPptxSlideClasses(slide.style);
          const heading = '#'.repeat(slide.titleLevel) + ' ' + slide.title + classes;
          output.push(heading);
          output.push('');

          // Add preamble if present
          if (slide.preamble) {
            output.push(slide.preamble);
            output.push('');
          }

          // Add content before buildup block
          if (step.beforeBuildup) {
            output.push(step.beforeBuildup);
            output.push('');
          }

          // Add this buildup step content
          output.push(buildupContent);
          output.push('');

          // Add content after buildup block
          if (step.afterBuildup) {
            output.push(step.afterBuildup);
            output.push('');
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
      } else {
        // Regular step - no buildup
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
        for (let j = 0; j <= i; j++) {
          const s = stepsWithBuildup[j];
          if (s) {
            output.push(s.content);
            output.push('');
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
    }
  }

  // Remove trailing ---
  while (output.length > 0) {
    const last = output[output.length - 1];
    if (!last || last.trim() !== '') break;
    output.pop();
  }
  if (output.length > 0 && output[output.length - 1] === '---') {
    output.pop();
  }

  return output.join('\n');
}

/**
 * Process markdown for slide output format
 */
export function processSlideMarkdown(markdown: string, format: 'beamer' | 'pptx'): string {
  const slides = parseSlides(markdown);

  if (format === 'beamer') {
    return generateBeamerMarkdown(slides);
  } else if (format === 'pptx') {
    return generatePptxMarkdown(slides);
  }

  return markdown;
}

/**
 * Check if markdown contains slide syntax (steps, notes, buildup, or slide styles)
 */
export function hasSlideSyntax(markdown: string): boolean {
  // Check for ::: step, ::: notes, or ::: buildup
  if (/^:::\s*(step|notes|buildup)\s*$/m.test(markdown)) {
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
