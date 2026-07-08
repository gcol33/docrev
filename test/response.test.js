/**
 * Tests for response.js
 * Tests response letter generation
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseCommentsWithReplies,
  groupByReviewer,
  generateResponseLetter,
  collectComments,
} from '../lib/response.js';

let tempDir;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docrev-response-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('parseCommentsWithReplies', () => {
  it('should parse simple comments', () => {
    const text = 'Some text {>>Reviewer 1: Please clarify<<} more text.';
    const comments = parseCommentsWithReplies(text, 'test.md');

    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].author, 'Reviewer 1');
    assert.strictEqual(comments[0].text, 'Please clarify');
    assert.strictEqual(comments[0].file, 'test.md');
  });

  it('should parse comments with replies', () => {
    const text = 'Text {>>Reviewer: Question<<} {>>Author: Response<<} more.';
    const comments = parseCommentsWithReplies(text);

    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].author, 'Reviewer');
    assert.strictEqual(comments[0].text, 'Question');
    assert.strictEqual(comments[0].replies.length, 1);
    assert.strictEqual(comments[0].replies[0].author, 'Author');
    assert.strictEqual(comments[0].replies[0].text, 'Response');
  });

  it('should extract context from surrounding text', () => {
    const text = 'The methodology was used {>>R1: Explain more<<} for analysis.';
    const comments = parseCommentsWithReplies(text);

    assert.ok(comments[0].context.includes('methodology'));
    assert.ok(comments[0].context.includes('analysis'));
  });

  it('should track line numbers', () => {
    const text = `Line 1
Line 2
{>>Reviewer: Comment<<}
Line 4`;
    const comments = parseCommentsWithReplies(text);

    assert.strictEqual(comments[0].line, 3);
  });

  it('should handle multiple comments on different lines', () => {
    const text = `{>>R1: First<<}
Some text
{>>R2: Second<<}`;
    const comments = parseCommentsWithReplies(text);

    assert.strictEqual(comments.length, 2);
    assert.strictEqual(comments[0].author, 'R1');
    assert.strictEqual(comments[1].author, 'R2');
  });

  it('should return empty array for text without comments', () => {
    const text = 'Plain text without any comments.';
    const comments = parseCommentsWithReplies(text);

    assert.deepStrictEqual(comments, []);
  });

  it('should handle multiple replies', () => {
    const text = '{>>R1: Q1<<} {>>Author: A1<<} {>>R1: Follow-up<<}';
    const comments = parseCommentsWithReplies(text);

    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].replies.length, 2);
  });
});

describe('groupByReviewer', () => {
  it('should group comments by author', () => {
    const comments = [
      { author: 'Reviewer 1', text: 'Comment 1' },
      { author: 'Reviewer 2', text: 'Comment 2' },
      { author: 'Reviewer 1', text: 'Comment 3' },
    ];

    const grouped = groupByReviewer(comments);

    assert.strictEqual(grouped.size, 2);
    assert.strictEqual(grouped.get('Reviewer 1').length, 2);
    assert.strictEqual(grouped.get('Reviewer 2').length, 1);
  });

  it('should handle empty comments array', () => {
    const grouped = groupByReviewer([]);

    assert.strictEqual(grouped.size, 0);
  });

  it('should preserve comment order within groups', () => {
    const comments = [
      { author: 'R1', text: 'First' },
      { author: 'R1', text: 'Second' },
      { author: 'R1', text: 'Third' },
    ];

    const grouped = groupByReviewer(comments);
    const r1Comments = grouped.get('R1');

    assert.strictEqual(r1Comments[0].text, 'First');
    assert.strictEqual(r1Comments[1].text, 'Second');
    assert.strictEqual(r1Comments[2].text, 'Third');
  });
});

describe('generateResponseLetter', () => {
  it('should generate markdown response letter', () => {
    const comments = [
      {
        author: 'Reviewer 1',
        text: 'Please explain the methodology.',
        replies: [{ author: 'Author', text: 'Added explanation in section 2.' }],
        context: 'We used a novel approach',
        file: 'methods.md',
        line: 10,
      },
    ];

    const letter = generateResponseLetter(comments);

    assert.ok(letter.includes('# Response to Reviewers'));
    assert.ok(letter.includes('## Reviewer 1'));
    assert.ok(letter.includes('Please explain the methodology'));
    assert.ok(letter.includes('Added explanation in section 2'));
  });

  it('should mark unanswered comments as TODO', () => {
    const comments = [
      {
        author: 'Reviewer 1',
        text: 'Pending question',
        replies: [],
        context: '',
        file: 'test.md',
        line: 1,
      },
    ];

    const letter = generateResponseLetter(comments);

    assert.ok(letter.includes('[TODO: Add response]'));
  });

  it('should include context when option enabled', () => {
    const comments = [
      {
        author: 'R1',
        text: 'Comment',
        replies: [],
        context: 'Important context here',
        file: 'test.md',
        line: 1,
      },
    ];

    const letter = generateResponseLetter(comments, { includeContext: true });

    assert.ok(letter.includes('Important context here'));
  });

  it('should include location when option enabled', () => {
    const comments = [
      {
        author: 'R1',
        text: 'Comment',
        replies: [],
        context: '',
        file: 'methods.md',
        line: 42,
      },
    ];

    const letter = generateResponseLetter(comments, { includeLocation: true });

    assert.ok(letter.includes('methods.md:42'));
  });

  it('should skip author own comments', () => {
    const comments = [
      { author: 'John', text: 'Note to self', replies: [], file: '', line: 1 },
      { author: 'Reviewer', text: 'Question', replies: [], file: '', line: 2 },
    ];

    const letter = generateResponseLetter(comments, { authorName: 'John' });

    assert.ok(!letter.includes('## John'));
    assert.ok(letter.includes('## Reviewer'));
  });

  it('should skip Claude comments', () => {
    const comments = [
      { author: 'Claude', text: 'AI suggestion', replies: [], file: '', line: 1 },
      { author: 'Reviewer', text: 'Question', replies: [], file: '', line: 2 },
    ];

    const letter = generateResponseLetter(comments);

    assert.ok(!letter.includes('## Claude'));
  });

  it('should include summary statistics', () => {
    const comments = [
      { author: 'R1', text: 'Q1', replies: [{ author: 'A', text: 'A1' }], file: '', line: 1 },
      { author: 'R1', text: 'Q2', replies: [], file: '', line: 2 },
    ];

    const letter = generateResponseLetter(comments);

    assert.ok(letter.includes('## Summary'));
    assert.ok(letter.includes('Total comments:'));
    assert.ok(letter.includes('Addressed:'));
    assert.ok(letter.includes('Pending:'));
  });

  it('should support custom title', () => {
    const letter = generateResponseLetter([], { title: 'Custom Title' });

    assert.ok(letter.includes('# Custom Title'));
  });
});

describe('collectComments', () => {
  it('should collect comments from multiple files', async () => {
    const file1 = path.join(tempDir, 'intro.md');
    const file2 = path.join(tempDir, 'methods.md');

    fs.writeFileSync(file1, 'Text {>>R1: Comment 1<<} here.');
    fs.writeFileSync(file2, 'More {>>R2: Comment 2<<} text.');

    const comments = await collectComments([file1, file2]);

    assert.strictEqual(comments.length, 2);
    assert.ok(comments.some(c => c.author === 'R1'));
    assert.ok(comments.some(c => c.author === 'R2'));
  });

  it('should skip non-existent files', async () => {
    const file1 = path.join(tempDir, 'exists.md');
    fs.writeFileSync(file1, '{>>R1: Comment<<}');

    const comments = await collectComments([file1, '/nonexistent.md']);

    assert.strictEqual(comments.length, 1);
  });

  it('should include file basename in comments', async () => {
    const file = path.join(tempDir, 'section.md');
    fs.writeFileSync(file, '{>>R1: Comment<<}');

    const comments = await collectComments([file]);

    assert.strictEqual(comments[0].file, 'section.md');
  });

  it('should handle empty files', async () => {
    const file = path.join(tempDir, 'empty.md');
    fs.writeFileSync(file, '');

    const comments = await collectComments([file]);

    assert.deepStrictEqual(comments, []);
  });
});
