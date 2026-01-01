/**
 * In-session undo stack for comment/annotation operations
 *
 * Provides undo/redo functionality during interactive sessions
 */

/**
 * Create an undo stack
 * @param {number} maxSize - Maximum number of states to store
 * @returns {object} Undo stack controller
 */
export function createUndoStack(maxSize = 50) {
  const stack = [];
  let position = -1;

  return {
    /**
     * Push a new state onto the stack
     * @param {any} state - State to save
     * @param {string} description - Description of the change
     */
    push(state, description = '') {
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
     * @returns {{state: any, description: string}|null}
     */
    undo() {
      if (position <= 0) {
        return null;
      }

      position--;
      return stack[position];
    },

    /**
     * Redo to next state
     * @returns {{state: any, description: string}|null}
     */
    redo() {
      if (position >= stack.length - 1) {
        return null;
      }

      position++;
      return stack[position];
    },

    /**
     * Get current state
     * @returns {{state: any, description: string}|null}
     */
    current() {
      if (position < 0 || position >= stack.length) {
        return null;
      }
      return stack[position];
    },

    /**
     * Check if undo is available
     * @returns {boolean}
     */
    canUndo() {
      return position > 0;
    },

    /**
     * Check if redo is available
     * @returns {boolean}
     */
    canRedo() {
      return position < stack.length - 1;
    },

    /**
     * Get stack info
     * @returns {{position: number, size: number, undoSteps: number, redoSteps: number}}
     */
    info() {
      return {
        position,
        size: stack.length,
        undoSteps: position,
        redoSteps: stack.length - position - 1,
      };
    },

    /**
     * Get history of changes
     * @param {number} limit - Max items to return
     * @returns {Array<{description: string, current: boolean, index: number}>}
     */
    history(limit = 10) {
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
    clear() {
      stack.length = 0;
      position = -1;
    },

    /**
     * Get the full stack (for debugging)
     * @returns {Array}
     */
    getStack() {
      return [...stack];
    },
  };
}

/**
 * Create a document session with undo support
 * @param {string} initialText - Initial document text
 * @returns {object} Session controller
 */
export function createDocumentSession(initialText) {
  const undoStack = createUndoStack();

  // Save initial state
  undoStack.push(initialText, 'Initial state');

  return {
    /**
     * Get current text
     * @returns {string}
     */
    getText() {
      const current = undoStack.current();
      return current ? current.state : initialText;
    },

    /**
     * Apply a change
     * @param {string} newText - New document text
     * @param {string} description - What changed
     */
    applyChange(newText, description) {
      undoStack.push(newText, description);
    },

    /**
     * Undo last change
     * @returns {{text: string, description: string}|null}
     */
    undo() {
      const result = undoStack.undo();
      if (result) {
        return {
          text: result.state,
          description: result.description,
        };
      }
      return null;
    },

    /**
     * Redo last undone change
     * @returns {{text: string, description: string}|null}
     */
    redo() {
      const result = undoStack.redo();
      if (result) {
        return {
          text: result.state,
          description: result.description,
        };
      }
      return null;
    },

    /**
     * Check if undo is available
     * @returns {boolean}
     */
    canUndo() {
      return undoStack.canUndo();
    },

    /**
     * Check if redo is available
     * @returns {boolean}
     */
    canRedo() {
      return undoStack.canRedo();
    },

    /**
     * Get stack info
     * @returns {object}
     */
    info() {
      return undoStack.info();
    },

    /**
     * Get change history
     * @param {number} limit
     * @returns {Array}
     */
    history(limit = 10) {
      return undoStack.history(limit);
    },
  };
}
