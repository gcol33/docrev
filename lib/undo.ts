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

interface StackInfo {
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
  clear(): void;
  getStack(): StackEntry[];
}

interface DocumentChange {
  text: string;
  description: string;
}

interface DocumentSession {
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
export function createUndoStack(maxSize: number = 50): UndoStack {
  const stack: StackEntry[] = [];
  let position = -1;

  return {
    /**
     * Push a new state onto the stack
     */
    push(state: string | object, description: string = ''): void {
      // Remove any states after current position (for redo)
      if (position < stack.length - 1) {
        stack.splice(position + 1);
      }

      // Add new state
      stack.push({
        state: typeof state === 'string' ? state : JSON.parse(JSON.stringify(state)),
        description,
        timestamp: Date.now(),
      });

      // Enforce max size
      while (stack.length > maxSize) {
        stack.shift();
      }

      position = stack.length - 1;
    },

    /**
     * Undo to previous state
     */
    undo(): StackEntry | null {
      if (position <= 0) {
        return null;
      }

      position--;
      return stack[position] || null;
    },

    /**
     * Redo to next state
     */
    redo(): StackEntry | null {
      if (position >= stack.length - 1) {
        return null;
      }

      position++;
      return stack[position] || null;
    },

    /**
     * Get current state
     */
    current(): StackEntry | null {
      if (position < 0 || position >= stack.length) {
        return null;
      }
      return stack[position] || null;
    },

    /**
     * Check if undo is available
     */
    canUndo(): boolean {
      return position > 0;
    },

    /**
     * Check if redo is available
     */
    canRedo(): boolean {
      return position < stack.length - 1;
    },

    /**
     * Get stack info
     */
    info(): StackInfo {
      return {
        position,
        size: stack.length,
        undoSteps: position,
        redoSteps: stack.length - position - 1,
      };
    },

    /**
     * Get history of changes
     */
    history(limit: number = 10): HistoryEntry[] {
      const start = Math.max(0, position - Math.floor(limit / 2));
      const end = Math.min(stack.length, start + limit);

      return stack.slice(start, end).map((item, i) => ({
        description: item.description,
        current: start + i === position,
        index: start + i,
      }));
    },

    /**
     * Clear the stack
     */
    clear(): void {
      stack.length = 0;
      position = -1;
    },

    /**
     * Get the full stack (for debugging)
     */
    getStack(): StackEntry[] {
      return [...stack];
    },
  };
}

/**
 * Create a document session with undo support
 */
export function createDocumentSession(initialText: string): DocumentSession {
  const undoStack = createUndoStack();

  // Save initial state
  undoStack.push(initialText, 'Initial state');

  return {
    /**
     * Get current text
     */
    getText(): string {
      const current = undoStack.current();
      return current ? current.state as string : initialText;
    },

    /**
     * Apply a change
     */
    applyChange(newText: string, description: string): void {
      undoStack.push(newText, description);
    },

    /**
     * Undo last change
     */
    undo(): DocumentChange | null {
      const result = undoStack.undo();
      if (result) {
        return {
          text: result.state as string,
          description: result.description,
        };
      }
      return null;
    },

    /**
     * Redo last undone change
     */
    redo(): DocumentChange | null {
      const result = undoStack.redo();
      if (result) {
        return {
          text: result.state as string,
          description: result.description,
        };
      }
      return null;
    },

    /**
     * Check if undo is available
     */
    canUndo(): boolean {
      return undoStack.canUndo();
    },

    /**
     * Check if redo is available
     */
    canRedo(): boolean {
      return undoStack.canRedo();
    },

    /**
     * Get stack info
     */
    info(): StackInfo {
      return undoStack.info();
    },

    /**
     * Get change history
     */
    history(limit: number = 10): HistoryEntry[] {
      return undoStack.history(limit);
    },
  };
}
