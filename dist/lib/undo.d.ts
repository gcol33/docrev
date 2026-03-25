/**
 * In-session undo stack for comment/annotation operations
 *
 * Provides undo/redo functionality during interactive sessions
 */
interface StackEntry {
    state: string | object;
    description: string;
    timestamp: number;
}
interface HistoryEntry {
    description: string;
    current: boolean;
    index: number;
}
export interface StackInfo {
    position: number;
    size: number;
    undoSteps: number;
    redoSteps: number;
}
interface UndoStack {
    push(state: string | object, description?: string): void;
    undo(): StackEntry | null;
    redo(): StackEntry | null;
    current(): StackEntry | null;
    canUndo(): boolean;
    canRedo(): boolean;
    info(): StackInfo;
    history(limit?: number): HistoryEntry[];
    getStack(): StackEntry[];
}
export interface DocumentChange {
    text: string;
    description: string;
}
export interface DocumentSession {
    getText(): string;
    applyChange(newText: string, description: string): void;
    undo(): DocumentChange | null;
    redo(): DocumentChange | null;
    canUndo(): boolean;
    canRedo(): boolean;
    info(): StackInfo;
    history(limit?: number): HistoryEntry[];
}
/**
 * Create an undo stack
 */
export declare function createUndoStack(maxSize?: number): UndoStack;
/**
 * Create a document session with undo support
 */
export declare function createDocumentSession(initialText: string): DocumentSession;
export {};
//# sourceMappingURL=undo.d.ts.map