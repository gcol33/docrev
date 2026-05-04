// What got eaten in the prose? Find the actual diff position.
import {
  extractWordComments,
  extractCommentAnchors,
  insertCommentsIntoMarkdown,
} from '../../lib/import.js';
import { extractTextFromWord } from '../../lib/word.js';

const DOCX = 'test/fixtures/paper-niche-expansion.docx';
const extracted = await extractWordComments(DOCX);
const { anchors } = await extractCommentAnchors(DOCX);
const baseText = await extractTextFromWord(DOCX);
const synced = insertCommentsIntoMarkdown(baseText, extracted, anchors, {
  quiet: true, wrapAnchor: false,
});

const strip = (t) => t.replace(/\{>>[\s\S]*?<<\}/g, '');
const norm = (t) => t.replace(/\s+/g, ' ').trim();

const stripped = norm(strip(synced));
const target = norm(baseText);

if (stripped === target) {
  console.log('prose intact ✓');
  process.exit(0);
}

// Find first divergence
let i = 0;
while (i < Math.min(stripped.length, target.length) && stripped[i] === target[i]) i++;
console.log(`first divergence at index ${i}`);
console.log(`stripped len: ${stripped.length}, target len: ${target.length}`);
console.log(`stripped[${i-30}..${i+80}]:`, JSON.stringify(stripped.slice(Math.max(0,i-30), i+80)));
console.log(`  target[${i-30}..${i+80}]:`, JSON.stringify(target.slice(Math.max(0,i-30), i+80)));

// Look for `<<}` literal in any comment text
const offending = extracted.filter(c => /<<\}/.test(c.text || '') || /<<\}/.test(c.author || ''));
console.log(`\ncomments containing literal '<<}': ${offending.length}`);
offending.forEach(c => console.log(`  id=${c.id} author=${c.author}: ${c.text.slice(0,60)}...`));

// Look for `{>>` literal in any comment text
const offending2 = extracted.filter(c => /\{>>/.test(c.text || ''));
console.log(`comments containing literal '{>>': ${offending2.length}`);
