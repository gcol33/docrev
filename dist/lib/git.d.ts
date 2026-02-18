/**
 * Git integration utilities
 * Compare sections against git history
 */
import type { FileChange, CommitInfo, ChangedFile, BlameEntry, AuthorStats, ContributorStats } from './types.js';
/**
 * Check if current directory is a git repository
 */
export declare function isGitRepo(): boolean;
/**
 * Get the current git branch
 */
export declare function getCurrentBranch(): string | null;
/**
 * Get the default branch (main or master)
 */
export declare function getDefaultBranch(): string;
/**
 * Get file content from a specific git ref
 * @param filePath - Path to file
 * @param ref - Git reference (branch, tag, commit)
 */
export declare function getFileAtRef(filePath: string, ref: string): string | null;
/**
 * Get list of changed files between refs
 * @param fromRef - Starting reference
 * @param toRef - Ending reference (default: HEAD)
 */
export declare function getChangedFiles(fromRef: string, toRef?: string): ChangedFile[];
/**
 * Get commit history for a file
 * @param filePath - Path to file
 * @param limit - Maximum number of commits to return
 */
export declare function getFileHistory(filePath: string, limit?: number): CommitInfo[];
/**
 * Compare file content between two refs
 * @param filePath - Path to file
 * @param fromRef - Starting reference
 * @param toRef - Ending reference (default: HEAD)
 */
export declare function compareFileVersions(filePath: string, fromRef: string, toRef?: string): FileChange;
/**
 * Get word count difference between refs
 * @param files - Array of file paths
 * @param fromRef - Starting reference
 * @param toRef - Ending reference (default: HEAD)
 */
export declare function getWordCountDiff(files: string[], fromRef: string, toRef?: string): {
    total: {
        added: number;
        removed: number;
    };
    byFile: Record<string, {
        added: number;
        removed: number;
    }>;
};
/**
 * Get recent commits
 * @param limit - Maximum number of commits to return
 */
export declare function getRecentCommits(limit?: number): CommitInfo[];
/**
 * Check if there are uncommitted changes
 */
export declare function hasUncommittedChanges(): boolean;
/**
 * Get tags
 */
export declare function getTags(): string[];
/**
 * Get blame information for a file
 * Returns author and commit info for each line
 * @param filePath - Path to file
 */
export declare function getFileBlame(filePath: string): BlameEntry[];
/**
 * Get author statistics for a file
 * @param filePath - Path to file
 */
export declare function getAuthorStats(filePath: string): Record<string, AuthorStats>;
/**
 * Get contributors across multiple files
 * @param files - Array of file paths
 */
export declare function getContributors(files: string[]): Record<string, ContributorStats>;
//# sourceMappingURL=git.d.ts.map