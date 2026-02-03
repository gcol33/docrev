/**
 * Grammar checker module with custom dictionary support
 *
 * Features:
 * - Common grammar/style issues detection
 * - Custom dictionary for project-specific terms
 * - Learn mode to add words to dictionary
 */

import * as fs from 'fs';
import * as path from 'path';

// Default dictionary location
const DEFAULT_DICT_NAME = '.rev-dictionary';

interface GrammarRule {
  id: string;
  pattern: RegExp;
  message: string;
  severity: 'error' | 'warning' | 'info';
  check?: (match: string) => boolean;
}

interface GrammarIssue {
  rule: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  line: number;
  column: number;
  match: string;
  context: string;
}

interface GrammarSummary {
  total: number;
  errors: number;
  warnings: number;
  info: number;
  byRule: Record<string, number>;
}

interface CheckGrammarOptions {
  scientific?: boolean;
  directory?: string;
}

/**
 * Common grammar/style rules
 */
const GRAMMAR_RULES: GrammarRule[] = [
  {
    id: 'passive-voice',
    pattern: /\b(is|are|was|were|be|been|being)\s+(being\s+)?\w+ed\b/gi,
    message: 'Possible passive voice',
    severity: 'info',
  },
  {
    id: 'weasel-words',
    pattern: /\b(very|really|quite|extremely|fairly|rather|somewhat|just)\b/gi,
    message: 'Weasel word - consider removing or being more specific',
    severity: 'warning',
  },
  {
    id: 'weak-start',
    pattern: /^\s*(There (is|are|was|were)|It is)\b/gmi,
    message: 'Weak sentence start - consider restructuring',
    severity: 'info',
  },
  {
    id: 'duplicate-words',
    pattern: /\b(\w+)\s+\1\b/gi,
    message: 'Duplicate word',
    severity: 'error',
  },
  {
    id: 'split-infinitive',
    pattern: /\bto\s+(\w+ly)\s+\w+\b/gi,
    message: 'Split infinitive',
    severity: 'info',
  },
  {
    id: 'sentence-length',
    pattern: /[^.!?]*[.!?]/g,
    check: (match: string): boolean => {
      const words = match.trim().split(/\s+/).length;
      return words > 40;
    },
    message: 'Long sentence (>40 words) - consider breaking up',
    severity: 'warning',
  },
  {
    id: 'cliches',
    pattern: /\b(at the end of the day|in terms of|it goes without saying|needless to say|as a matter of fact|first and foremost|last but not least)\b/gi,
    message: 'Cliche - consider rephrasing',
    severity: 'warning',
  },
  {
    id: 'hedging',
    pattern: /\b(seems to|appears to|tends to|might|may|could possibly|would seem)\b/gi,
    message: 'Hedging language - be more direct if appropriate',
    severity: 'info',
  },
  {
    id: 'redundancy',
    pattern: /\b(basic fundamentals|end result|free gift|future plans|past history|completely unique|absolutely essential|close proximity|each and every|first began|true fact|advance planning|final outcome)\b/gi,
    message: 'Redundant phrase',
    severity: 'warning',
  },
];

/**
 * Scientific writing specific rules
 */
const SCIENTIFIC_RULES: GrammarRule[] = [
  {
    id: 'first-person',
    pattern: /\b(I|we|my|our)\b/gi,
    message: 'First person pronoun - check if appropriate for your journal',
    severity: 'info',
  },
  {
    id: 'significant',
    pattern: /\bsignificant(ly)?\b(?!\s+(P|p|α|difference|effect|increase|decrease|correlation))/gi,
    message: '"Significant" without statistical context - clarify or use different word',
    severity: 'warning',
  },
  {
    id: 'prove',
    pattern: /\b(prove[ds]?|proof)\b/gi,
    message: 'Avoid "prove" in science - use "demonstrate", "show", "suggest"',
    severity: 'warning',
  },
  {
    id: 'obviously',
    pattern: /\b(obviously|clearly|of course)\b/gi,
    message: 'If obvious, no need to say so; if not obvious, this doesn\'t help',
    severity: 'warning',
  },
];

/**
 * Load custom dictionary from file
 */
export function loadDictionary(directory: string = '.'): Set<string> {
  const dictPath = path.join(directory, DEFAULT_DICT_NAME);
  const words = new Set<string>();

  if (fs.existsSync(dictPath)) {
    const content = fs.readFileSync(dictPath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      const word = line.trim().toLowerCase();
      if (word && !word.startsWith('#')) {
        words.add(word);
      }
    }
  }

  return words;
}

/**
 * Save custom dictionary to file
 */
export function saveDictionary(words: Set<string>, directory: string = '.'): void {
  const dictPath = path.join(directory, DEFAULT_DICT_NAME);

  const header = `# Custom dictionary for docrev
# Add one word per line
# Lines starting with # are comments
`;

  const content = header + [...words].sort().join('\n') + '\n';
  fs.writeFileSync(dictPath, content, 'utf-8');
}

/**
 * Add word to custom dictionary
 */
export function addToDictionary(word: string, directory: string = '.'): boolean {
  const words = loadDictionary(directory);
  const normalizedWord = word.trim().toLowerCase();

  if (words.has(normalizedWord)) {
    return false;
  }

  words.add(normalizedWord);
  saveDictionary(words, directory);
  return true;
}

/**
 * Remove word from custom dictionary
 */
export function removeFromDictionary(word: string, directory: string = '.'): boolean {
  const words = loadDictionary(directory);
  const normalizedWord = word.trim().toLowerCase();

  if (!words.has(normalizedWord)) {
    return false;
  }

  words.delete(normalizedWord);
  saveDictionary(words, directory);
  return true;
}

/**
 * Check text for grammar/style issues
 */
export function checkGrammar(text: string, options: CheckGrammarOptions = {}): GrammarIssue[] {
  const { scientific = true, directory = '.' } = options;
  const customDict = loadDictionary(directory);
  const issues: GrammarIssue[] = [];

  // Get all rules
  const rules = scientific ? [...GRAMMAR_RULES, ...SCIENTIFIC_RULES] : GRAMMAR_RULES;

  // Split into lines for line number tracking
  const lines = text.split('\n');

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];
    if (!line) continue;

    // Skip code blocks and YAML frontmatter
    if (line.trim().startsWith('```') || line.trim().startsWith('---')) {
      continue;
    }

    // Skip lines that are just markdown syntax
    if (/^[#\-*>|]/.test(line.trim()) && line.trim().length < 5) {
      continue;
    }

    for (const rule of rules) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      let match;

      while ((match = pattern.exec(line)) !== null) {
        // Check if rule has additional check function
        if (rule.check && !rule.check(match[0])) {
          continue;
        }

        // Skip if word is in custom dictionary
        const word = match[0].toLowerCase();
        if (customDict.has(word)) {
          continue;
        }

        issues.push({
          rule: rule.id,
          message: rule.message,
          severity: rule.severity,
          line: lineNum + 1,
          column: match.index + 1,
          match: match[0],
          context: line.trim(),
        });
      }
    }
  }

  return issues;
}

/**
 * Get grammar check summary
 */
export function getGrammarSummary(issues: GrammarIssue[]): GrammarSummary {
  const summary: GrammarSummary = {
    total: issues.length,
    errors: 0,
    warnings: 0,
    info: 0,
    byRule: {},
  };

  for (const issue of issues) {
    if (issue.severity === 'error') summary.errors++;
    else if (issue.severity === 'warning') summary.warnings++;
    else summary.info++;

    summary.byRule[issue.rule] = (summary.byRule[issue.rule] || 0) + 1;
  }

  return summary;
}

/**
 * List available grammar rules
 */
export function listRules(scientific: boolean = true): Array<{ id: string; message: string; severity: string }> {
  const rules = scientific ? [...GRAMMAR_RULES, ...SCIENTIFIC_RULES] : GRAMMAR_RULES;
  return rules.map(r => ({
    id: r.id,
    message: r.message,
    severity: r.severity,
  }));
}
