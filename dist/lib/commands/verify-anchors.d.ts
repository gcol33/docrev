/**
 * VERIFY-ANCHORS command: report drift between Word comment anchors
 * and the current markdown.
 *
 * Useful when prose has been revised between sending the docx out for
 * review and receiving it back. Each comment is classified by how well
 * its anchor still matches the current section prose:
 *
 *   clean        – exact or whitespace-normalized hit
 *   drift        – anchor only matches via stripped/partial fallbacks
 *   context-only – anchor text is gone, only surrounding context survives
 *   ambiguous    – multiple matches, can't pick one without context
 *   unmatched    – nothing maps; user must place the comment manually
 */
import type { Command } from 'commander';
export declare function register(program: Command): void;
//# sourceMappingURL=verify-anchors.d.ts.map