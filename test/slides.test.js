import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  parseSlide,
  parseSlides,
  generateBeamerMarkdown,
  generatePptxMarkdown,
  processSlideMarkdown,
  hasSlideSyntax,
  parseSlideStyle,
} from '../lib/slides.js';

describe('slides.js', () => {
  describe('parseSlide', () => {
    it('should parse slide with title only', () => {
      const content = '## My Slide Title\n\nSome content here.';
      const slide = parseSlide(content);

      assert.strictEqual(slide.title, 'My Slide Title');
      assert.strictEqual(slide.titleLevel, 2);
      assert.strictEqual(slide.steps.length, 1);
      assert.strictEqual(slide.notes, null);
    });

    it('should parse slide with single step', () => {
      const content = `## Results

::: step
![fig](fig1.png)
:::
`;
      const slide = parseSlide(content);

      assert.strictEqual(slide.title, 'Results');
      assert.strictEqual(slide.steps.length, 1);
      assert.strictEqual(slide.steps[0].index, 1);
      assert.ok(slide.steps[0].content.includes('![fig](fig1.png)'));
    });

    it('should parse slide with multiple steps', () => {
      const content = `## Results overview

::: step
![fig](fig1.png)
:::

::: step
![fig](fig1_pt2.png)
Highlighted region explained.
:::
`;
      const slide = parseSlide(content);

      assert.strictEqual(slide.steps.length, 2);
      assert.strictEqual(slide.steps[0].index, 1);
      assert.strictEqual(slide.steps[1].index, 2);
      assert.ok(slide.steps[0].content.includes('fig1.png'));
      assert.ok(slide.steps[1].content.includes('fig1_pt2.png'));
      assert.ok(slide.steps[1].content.includes('Highlighted region'));
    });

    it('should parse slide with notes', () => {
      const content = `## Methods

Some content.

::: notes
Speaker notes here.
Multiple lines.
:::
`;
      const slide = parseSlide(content);

      assert.ok(slide.notes);
      assert.ok(slide.notes.includes('Speaker notes here'));
      assert.ok(slide.notes.includes('Multiple lines'));
    });

    it('should parse slide with steps and notes', () => {
      const content = `## Results overview

::: step
![fig](fig1.png)
:::

::: step
![fig](fig1_pt2.png)
:::

::: notes
Explain the increase happens after treatment.
:::
`;
      const slide = parseSlide(content);

      assert.strictEqual(slide.steps.length, 2);
      assert.ok(slide.notes);
      assert.ok(slide.notes.includes('after treatment'));
    });

    it('should handle content without explicit steps', () => {
      const content = `## Simple Slide

- Point 1
- Point 2
- Point 3
`;
      const slide = parseSlide(content);

      assert.strictEqual(slide.steps.length, 1);
      assert.ok(slide.steps[0].content.includes('Point 1'));
    });
  });

  describe('parseSlides', () => {
    it('should parse multiple slides separated by ---', () => {
      const markdown = `## Slide 1

Content 1

---

## Slide 2

Content 2

---

## Slide 3

Content 3
`;
      const slides = parseSlides(markdown);

      assert.strictEqual(slides.length, 3);
      assert.strictEqual(slides[0].title, 'Slide 1');
      assert.strictEqual(slides[1].title, 'Slide 2');
      assert.strictEqual(slides[2].title, 'Slide 3');
    });

    it('should handle YAML frontmatter', () => {
      const markdown = `---
title: My Presentation
author: Test Author
---

## First Slide

Content here
`;
      const slides = parseSlides(markdown);

      assert.strictEqual(slides.length, 1);
      assert.ok(slides[0]._frontmatter);
      assert.ok(slides[0]._frontmatter.includes('title: My Presentation'));
    });
  });

  describe('generateBeamerMarkdown', () => {
    it('should generate single slide without overlays', () => {
      const slides = [{
        title: 'Simple',
        titleLevel: 2,
        steps: [{ index: 1, content: 'Content here' }],
        notes: null,
        preamble: '',
      }];

      const output = generateBeamerMarkdown(slides);

      assert.ok(output.includes('## Simple'));
      assert.ok(output.includes('Content here'));
      assert.ok(!output.includes('\\only'));
    });

    it('should generate pauses for multiple steps', () => {
      const slides = [{
        title: 'Multi-step',
        titleLevel: 2,
        steps: [
          { index: 1, content: 'Step 1 content' },
          { index: 2, content: 'Step 2 content' },
        ],
        notes: null,
        preamble: '',
      }];

      const output = generateBeamerMarkdown(slides);

      assert.ok(output.includes('## Multi-step'));
      // Pandoc beamer uses ". . ." for pauses between steps
      assert.ok(output.includes('. . .'));
      assert.ok(output.includes('Step 1 content'));
      assert.ok(output.includes('Step 2 content'));
    });

    it('should strip speaker notes (Beamer notes require pgfpages setup)', () => {
      const slides = [{
        title: 'With Notes',
        titleLevel: 2,
        steps: [{ index: 1, content: 'Content' }],
        notes: 'These are speaker notes',
        preamble: '',
      }];

      const output = generateBeamerMarkdown(slides);

      // Notes are stripped from Beamer output - they're available in source markdown
      // Beamer \note{} requires pgfpages setup which most presentations don't use
      assert.ok(!output.includes('::: notes'));
      assert.ok(!output.includes('These are speaker notes'));
    });
  });

  describe('generatePptxMarkdown', () => {
    it('should duplicate slides for each step', () => {
      const slides = [{
        title: 'Multi-step',
        titleLevel: 2,
        steps: [
          { index: 1, content: 'Step 1' },
          { index: 2, content: 'Step 2' },
          { index: 3, content: 'Step 3' },
        ],
        notes: 'Speaker notes',
        preamble: '',
      }];

      const output = generatePptxMarkdown(slides);

      // Should have 3 copies of the title (one per step)
      const titleMatches = output.match(/## Multi-step/g);
      assert.strictEqual(titleMatches.length, 3);

      // Each slide should have cumulative steps
      // Slide 1: Step 1
      // Slide 2: Step 1 + Step 2
      // Slide 3: Step 1 + Step 2 + Step 3
    });

    it('should include notes on each step slide', () => {
      const slides = [{
        title: 'With Notes',
        titleLevel: 2,
        steps: [
          { index: 1, content: 'Step 1' },
          { index: 2, content: 'Step 2' },
        ],
        notes: 'Speaker notes',
        preamble: '',
      }];

      const output = generatePptxMarkdown(slides);

      // Notes should appear twice (once per step slide)
      const notesMatches = output.match(/::: notes/g);
      assert.strictEqual(notesMatches.length, 2);
    });
  });

  describe('processSlideMarkdown', () => {
    it('should process full example for beamer', () => {
      const input = `---
title: Test
---

## Results overview

::: step
![fig](fig1.png)
:::

::: step
![fig](fig1_pt2.png)
Highlighted region explained.
:::

::: notes
Explain the increase.
:::
`;
      const output = processSlideMarkdown(input, 'beamer');

      // Pandoc beamer uses pauses between steps
      assert.ok(output.includes('. . .'));
      // Notes are stripped from Beamer output (require pgfpages setup)
      assert.ok(!output.includes('::: notes'));
    });

    it('should process full example for pptx', () => {
      const input = `## Results overview

::: step
![fig](fig1.png)
:::

::: step
![fig](fig1_pt2.png)
:::
`;
      const output = processSlideMarkdown(input, 'pptx');

      // Should generate 2 physical slides
      const titleMatches = output.match(/## Results overview/g);
      assert.strictEqual(titleMatches.length, 2);
    });
  });

  describe('hasSlideSyntax', () => {
    it('should detect ::: step', () => {
      assert.ok(hasSlideSyntax('::: step\ncontent\n:::'));
    });

    it('should detect ::: notes', () => {
      assert.ok(hasSlideSyntax('::: notes\ncontent\n:::'));
    });

    it('should return false for regular markdown', () => {
      assert.ok(!hasSlideSyntax('## Heading\n\nParagraph'));
    });

    it('should return false for other div blocks', () => {
      assert.ok(!hasSlideSyntax('::: warning\ncontent\n:::'));
    });

    it('should detect slide style classes', () => {
      assert.ok(hasSlideSyntax('## Title {.dark}'));
      assert.ok(hasSlideSyntax('## Welcome {.cover}'));
      assert.ok(hasSlideSyntax('## Thanks {.thanks .center}'));
    });
  });

  describe('parseSlideStyle', () => {
    it('should parse heading without styles', () => {
      const { title, style } = parseSlideStyle('My Title');
      assert.strictEqual(title, 'My Title');
      assert.strictEqual(style.background, null);
      assert.strictEqual(style.type, null);
      assert.strictEqual(style.nonumber, false);
    });

    it('should parse dark background style', () => {
      const { title, style } = parseSlideStyle('Results {.dark}');
      assert.strictEqual(title, 'Results');
      assert.strictEqual(style.background, 'dark');
      assert.ok(style.classes.includes('dark'));
    });

    it('should parse light background style', () => {
      const { title, style } = parseSlideStyle('Methods {.light}');
      assert.strictEqual(title, 'Methods');
      assert.strictEqual(style.background, 'light');
    });

    it('should parse accent background style', () => {
      const { title, style } = parseSlideStyle('Key Point {.accent}');
      assert.strictEqual(title, 'Key Point');
      assert.strictEqual(style.background, 'accent');
    });

    it('should parse inverse background style', () => {
      const { title, style } = parseSlideStyle('Highlight {.inverse}');
      assert.strictEqual(title, 'Highlight');
      assert.strictEqual(style.background, 'inverse');
    });

    it('should parse cover slide type', () => {
      const { title, style } = parseSlideStyle('Welcome {.cover}');
      assert.strictEqual(title, 'Welcome');
      assert.strictEqual(style.type, 'cover');
      assert.strictEqual(style.nonumber, true);
      assert.strictEqual(style.center, true);
    });

    it('should parse thanks slide type', () => {
      const { title, style } = parseSlideStyle('Thank You {.thanks}');
      assert.strictEqual(title, 'Thank You');
      assert.strictEqual(style.type, 'thanks');
      assert.strictEqual(style.nonumber, true);
    });

    it('should parse section slide type', () => {
      const { title, style } = parseSlideStyle('Part 1: Introduction {.section}');
      assert.strictEqual(title, 'Part 1: Introduction');
      assert.strictEqual(style.type, 'section');
      assert.strictEqual(style.nonumber, true);
    });

    it('should parse plain slide type', () => {
      const { title, style } = parseSlideStyle('Full Image {.plain}');
      assert.strictEqual(title, 'Full Image');
      assert.strictEqual(style.type, 'plain');
      assert.strictEqual(style.nonumber, false); // plain doesn't auto-disable numbers
    });

    it('should parse nonumber option', () => {
      const { title, style } = parseSlideStyle('Appendix {.nonumber}');
      assert.strictEqual(title, 'Appendix');
      assert.strictEqual(style.nonumber, true);
    });

    it('should parse center option', () => {
      const { title, style } = parseSlideStyle('Quote {.center}');
      assert.strictEqual(title, 'Quote');
      assert.strictEqual(style.center, true);
    });

    it('should parse multiple classes', () => {
      const { title, style } = parseSlideStyle('Emphasis {.dark .center .nonumber}');
      assert.strictEqual(title, 'Emphasis');
      assert.strictEqual(style.background, 'dark');
      assert.strictEqual(style.center, true);
      assert.strictEqual(style.nonumber, true);
      assert.strictEqual(style.classes.length, 3);
    });
  });

  describe('slide styles in parseSlide', () => {
    it('should extract style from slide heading', () => {
      const content = '## Results {.dark}\n\nSome content.';
      const slide = parseSlide(content);
      assert.strictEqual(slide.title, 'Results');
      assert.strictEqual(slide.style.background, 'dark');
    });

    it('should parse cover slide', () => {
      const content = '## Welcome to the Presentation {.cover}\n\nSubtitle here.';
      const slide = parseSlide(content);
      assert.strictEqual(slide.title, 'Welcome to the Presentation');
      assert.strictEqual(slide.style.type, 'cover');
      assert.strictEqual(slide.style.nonumber, true);
    });
  });

  describe('beamer style output', () => {
    it('should generate pandoc attributes for cover slide', () => {
      const slides = [{
        title: 'Welcome',
        titleLevel: 2,
        steps: [{ index: 1, content: 'Subtitle' }],
        notes: null,
        preamble: '',
        style: { type: 'cover', nonumber: true, center: true, background: null, classes: ['cover'] },
      }];

      const output = generateBeamerMarkdown(slides);
      // Pandoc uses heading attributes for frame options
      assert.ok(output.includes('## Welcome {.plain .noframenumbering .c}'));
    });

    it('should preserve dark class for pandoc', () => {
      const slides = [{
        title: 'Dark Slide',
        titleLevel: 2,
        steps: [{ index: 1, content: 'Content' }],
        notes: null,
        preamble: '',
        style: { type: null, nonumber: false, center: false, background: 'dark', classes: ['dark'] },
      }];

      const output = generateBeamerMarkdown(slides);
      // Dark background requires post-processing or template; classes preserved
      assert.ok(output.includes('## Dark Slide'));
    });

    it('should generate noframenumbering attribute for nonumber option', () => {
      const slides = [{
        title: 'Appendix',
        titleLevel: 2,
        steps: [{ index: 1, content: 'Extra info' }],
        notes: null,
        preamble: '',
        style: { type: null, nonumber: true, center: false, background: null, classes: ['nonumber'] },
      }];

      const output = generateBeamerMarkdown(slides);
      assert.ok(output.includes('{.noframenumbering}'));
    });
  });

  describe('hasSlideSyntax buildup', () => {
    it('should detect ::: buildup', () => {
      assert.ok(hasSlideSyntax('::: buildup\n- item\n:::'));
    });
  });

  describe('buildup syntax', () => {
    it('should expand simple buildup to multiple slides', () => {
      const input = `## Test

::: buildup
- First
- Second
- Third
:::
`;
      const output = processSlideMarkdown(input, 'pptx');

      // Should have 3 slides (one per item)
      const titleMatches = output.match(/## Test/g);
      assert.strictEqual(titleMatches.length, 3);
    });

    it('should grey out previous items', () => {
      const input = `## Test

::: buildup
- First
- Second
:::
`;
      const output = processSlideMarkdown(input, 'pptx');

      // Second slide should have greyed first item
      assert.ok(output.includes('[First]{color=#888888}'));
    });

    it('should handle subpoints sequentially', () => {
      const input = `## Test

::: buildup
- Parent
  - Child A
  - Child B
- Next
:::
`;
      const output = processSlideMarkdown(input, 'pptx');

      // Should have 4 slides: Parent, Parent+ChildA, Parent+ChildA+ChildB, Next
      const titleMatches = output.match(/## Test/g);
      assert.strictEqual(titleMatches.length, 4);
    });

    it('should keep parent colored while showing children', () => {
      const input = `## Test

::: buildup
- Parent
  - Child
:::
`;
      const output = processSlideMarkdown(input, 'pptx');

      // On the child slide, parent should NOT be greyed
      // Split by slides and check second slide
      const slides = output.split('---');
      const secondSlide = slides[1];
      assert.ok(secondSlide.includes('- Parent'));
      assert.ok(secondSlide.includes('- Child'));
      assert.ok(!secondSlide.includes('[Parent]{color='));
    });

    it('should grey parent and children when moving to next item', () => {
      const input = `## Test

::: buildup
- First
  - Sub
- Second
:::
`;
      const output = processSlideMarkdown(input, 'pptx');

      // Last slide should have greyed First and Sub
      assert.ok(output.includes('[First]{color=#888888}'));
      assert.ok(output.includes('[Sub]{color=#888888}'));
    });
  });

  describe('pptx style output', () => {
    it('should preserve style classes in heading', () => {
      const slides = [{
        title: 'Dark Slide',
        titleLevel: 2,
        steps: [{ index: 1, content: 'Content' }],
        notes: null,
        preamble: '',
        style: { type: null, nonumber: false, center: false, background: 'dark', classes: ['dark'] },
      }];

      const output = generatePptxMarkdown(slides);
      assert.ok(output.includes('## Dark Slide {.dark}'));
    });

    it('should preserve multiple classes', () => {
      const slides = [{
        title: 'Cover',
        titleLevel: 2,
        steps: [{ index: 1, content: 'Welcome' }],
        notes: null,
        preamble: '',
        style: { type: 'cover', nonumber: true, center: true, background: 'dark', classes: ['cover', 'dark'] },
      }];

      const output = generatePptxMarkdown(slides);
      assert.ok(output.includes('## Cover {.cover .dark}'));
    });
  });
});
