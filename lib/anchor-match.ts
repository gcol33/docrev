/**
 * Anchor matching primitives shared between sync (insertion) and
 * verify-anchors (drift reporting). The functions are pure: given an
 * anchor string and surrounding context, locate candidate positions in
 * a target text using progressively looser strategies.
 */

export type AnchorStrategy =
  | 'direct'
  | 'normalized'
  | 'stripped'
  | 'partial-start'
  | 'partial-start-stripped'
  | 'context-both'
  | 'context-before'
  | 'context-after'
  | 'split-match'
  | 'empty-anchor'
  | 'failed';

export interface AnchorSearchResult {
  occurrences: number[];
  matchedAnchor: string | null;
  strategy: AnchorStrategy;
  stripped?: boolean;
}

/**
 * Strip CriticMarkup so the matcher sees plain prose instead of
 * `{++inserted++}`/`{--deleted--}`/etc. Used when an anchor lives
 * underneath previously imported track changes.
 */
export function stripCriticMarkup(text: string): string {
  return text
    .replace(/\{\+\+([^+]*)\+\+\}/g, '$1')        // insertions: keep new text
    .replace(/\{--([^-]*)--\}/g, '')              // deletions: remove old text
    .replace(/\{~~([^~]*)~>([^~]*)~~\}/g, '$2')   // substitutions: keep new text
    .replace(/\{>>[\s\S]*?<<\}/g, '')             // comments: remove (non-greedy; comment text may contain '<')
    .replace(/\[([^\]]*)\]\{\.mark\}/g, '$1');    // marked text: keep text
}

/**
 * Return every starting index where `needle` occurs in `haystack`.
 * Empty needles return no occurrences (empty matches are not useful
 * for anchor placement).
 */
/**
 * Score how well the docx-side `before` / `after` context matches the
 * surroundings of a candidate position in the target text. Used by
 * `verify-anchors` to tell apart "multiple hits but context picks one
 * cleanly" (sync will place it correctly) from "multiple hits, context
 * doesn't help" (truly ambiguous, needs human placement).
 *
 * Returns 0 if no context was provided.
 */
export function scoreContextAt(
  pos: number,
  text: string,
  before: string,
  after: string,
  anchorLen: number,
): number {
  let score = 0;
  if (before) {
    const contextBefore = text.slice(Math.max(0, pos - before.length - 20), pos).toLowerCase();
    const beforeLower = before.toLowerCase();
    const beforeWords = beforeLower.split(/\s+/).filter(w => w.length > 3);
    for (const word of beforeWords) {
      if (contextBefore.includes(word)) score += 2;
    }
    if (contextBefore.includes(beforeLower.slice(-30))) score += 5;
  }
  if (after) {
    const contextAfter = text.slice(pos + anchorLen, pos + anchorLen + after.length + 20).toLowerCase();
    const afterLower = after.toLowerCase();
    const afterWords = afterLower.split(/\s+/).filter(w => w.length > 3);
    for (const word of afterWords) {
      if (contextAfter.includes(word)) score += 2;
    }
    if (contextAfter.includes(afterLower.slice(0, 30))) score += 5;
  }
  return score;
}

export function findAllOccurrences(haystack: string, needle: string): number[] {
  if (!needle || needle.length === 0) return [];
  const occurrences: number[] = [];
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    occurrences.push(idx);
    idx += 1;
  }
  return occurrences;
}

/**
 * Find candidate positions for `anchor` in `text`, falling back through
 * progressively looser strategies (whitespace normalization, stripped
 * CriticMarkup, partial-prefix, surrounding context, word splitting).
 *
 * The returned `strategy` lets callers distinguish a clean direct hit
 * from a fuzzy approximation — useful for drift reporting.
 */
export function findAnchorInText(
  anchor: string,
  text: string,
  before: string = '',
  after: string = ''
): AnchorSearchResult {
  // Empty anchor: skip directly to context-based matching
  if (!anchor || anchor.trim().length === 0) {
    if (before || after) {
      const beforeLower = (before || '').toLowerCase();
      const afterLower = (after || '').toLowerCase();
      const textLower = text.toLowerCase();

      if (before && after) {
        const beforeIdx = textLower.indexOf(beforeLower.slice(-50));
        if (beforeIdx !== -1) {
          const searchStart = beforeIdx + beforeLower.slice(-50).length;
          const afterIdx = textLower.indexOf(afterLower.slice(0, 50), searchStart);
          if (afterIdx !== -1 && afterIdx - searchStart < 500) {
            return { occurrences: [searchStart], matchedAnchor: null, strategy: 'context-both' };
          }
        }
      }

      if (before) {
        const beforeIdx = textLower.lastIndexOf(beforeLower.slice(-30));
        if (beforeIdx !== -1) {
          return {
            occurrences: [beforeIdx + beforeLower.slice(-30).length],
            matchedAnchor: null,
            strategy: 'context-before',
          };
        }
      }

      if (after) {
        const afterIdx = textLower.indexOf(afterLower.slice(0, 30));
        if (afterIdx !== -1) {
          return { occurrences: [afterIdx], matchedAnchor: null, strategy: 'context-after' };
        }
      }
    }
    return { occurrences: [], matchedAnchor: null, strategy: 'empty-anchor' };
  }

  const anchorLower = anchor.toLowerCase();
  const textLower = text.toLowerCase();

  // Strategy 1: direct match
  let occurrences = findAllOccurrences(textLower, anchorLower);
  if (occurrences.length > 0) {
    return { occurrences, matchedAnchor: anchor, strategy: 'direct' };
  }

  // Strategy 2: normalized whitespace
  const normalizedAnchor = anchor.replace(/\s+/g, ' ').toLowerCase();
  const normalizedText = text.replace(/\s+/g, ' ').toLowerCase();
  const idx = normalizedText.indexOf(normalizedAnchor);
  if (idx !== -1) {
    return { occurrences: [idx], matchedAnchor: anchor, strategy: 'normalized' };
  }

  // Strategy 3: match in stripped CriticMarkup version
  const strippedText = stripCriticMarkup(text);
  const strippedLower = strippedText.toLowerCase();
  occurrences = findAllOccurrences(strippedLower, anchorLower);
  if (occurrences.length > 0) {
    return { occurrences, matchedAnchor: anchor, strategy: 'stripped', stripped: true };
  }

  // Strategy 4: first N words of anchor (long anchors)
  const words = anchor.split(/\s+/);
  if (words.length > 3) {
    for (let n = Math.min(6, words.length); n >= 3; n--) {
      const partialAnchor = words.slice(0, n).join(' ').toLowerCase();
      if (partialAnchor.length >= 15) {
        occurrences = findAllOccurrences(textLower, partialAnchor);
        if (occurrences.length > 0) {
          return { occurrences, matchedAnchor: words.slice(0, n).join(' '), strategy: 'partial-start' };
        }
        occurrences = findAllOccurrences(strippedLower, partialAnchor);
        if (occurrences.length > 0) {
          return {
            occurrences,
            matchedAnchor: words.slice(0, n).join(' '),
            strategy: 'partial-start-stripped',
            stripped: true,
          };
        }
      }
    }
  }

  // Strategy 5: context (before/after) only
  if (before || after) {
    const beforeLower = before.toLowerCase();
    const afterLower = after.toLowerCase();

    if (before && after) {
      const beforeIdx = textLower.indexOf(beforeLower.slice(-50));
      if (beforeIdx !== -1) {
        const searchStart = beforeIdx + beforeLower.slice(-50).length;
        const afterIdx = textLower.indexOf(afterLower.slice(0, 50), searchStart);
        if (afterIdx !== -1 && afterIdx - searchStart < 500) {
          return { occurrences: [searchStart], matchedAnchor: null, strategy: 'context-both' };
        }
      }
    }

    if (before) {
      const beforeIdx = textLower.lastIndexOf(beforeLower.slice(-30));
      if (beforeIdx !== -1) {
        return {
          occurrences: [beforeIdx + beforeLower.slice(-30).length],
          matchedAnchor: null,
          strategy: 'context-before',
        };
      }
    }

    if (after) {
      const afterIdx = textLower.indexOf(afterLower.slice(0, 30));
      if (afterIdx !== -1) {
        return { occurrences: [afterIdx], matchedAnchor: null, strategy: 'context-after' };
      }
    }
  }

  // Strategy 6: split anchor on transition characters
  const splitPatterns = [' ', ', ', '. ', ' - ', ' – '];
  for (const sep of splitPatterns) {
    if (anchor.includes(sep)) {
      const parts = anchor.split(sep).filter(p => p.length >= 4);
      for (const part of parts) {
        const partLower = part.toLowerCase();
        occurrences = findAllOccurrences(textLower, partLower);
        if (occurrences.length > 0 && occurrences.length < 5) {
          return { occurrences, matchedAnchor: part, strategy: 'split-match' };
        }
      }
    }
  }

  return { occurrences: [], matchedAnchor: null, strategy: 'failed' };
}

/**
 * Classify a strategy as a clean hit, a fuzzy/drifted hit, or no hit.
 * Used by `verify-anchors` to summarize per-comment match quality.
 */
export type AnchorMatchQuality = 'clean' | 'drift' | 'context-only' | 'unmatched';

export function classifyStrategy(strategy: AnchorStrategy, occurrences: number): AnchorMatchQuality {
  if (occurrences === 0) return 'unmatched';
  switch (strategy) {
    case 'direct':
    case 'normalized':
      return 'clean';
    case 'stripped':
    case 'partial-start':
    case 'partial-start-stripped':
    case 'split-match':
      return 'drift';
    case 'context-both':
    case 'context-before':
    case 'context-after':
      return 'context-only';
    case 'empty-anchor':
    case 'failed':
    default:
      return 'unmatched';
  }
}
