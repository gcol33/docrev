/**
 * In-session undo stack for comment/annotation operations
 *
 * Provides undo/redo functionality during interactive sessions
 */
/**
 * Create an undo stack
 */
export function createUndoStack(maxSize = 50) {
    const stack = [];
    let position = -1;
    return {
        /**
         * Push a new state onto the stack
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
         */
        undo() {
            if (position <= 0) {
                return null;
            }
            position--;
            return stack[position] || null;
        },
        /**
         * Redo to next state
         */
        redo() {
            if (position >= stack.length - 1) {
                return null;
            }
            position++;
            return stack[position] || null;
        },
        /**
         * Get current state
         */
        current() {
            if (position < 0 || position >= stack.length) {
                return null;
            }
            return stack[position] || null;
        },
        /**
         * Check if undo is available
         */
        canUndo() {
            return position > 0;
        },
        /**
         * Check if redo is available
         */
        canRedo() {
            return position < stack.length - 1;
        },
        /**
         * Get stack info
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
         */
        getStack() {
            return [...stack];
        },
    };
}
/**
 * Create a document session with undo support
 */
export function createDocumentSession(initialText) {
    const undoStack = createUndoStack();
    // Save initial state
    undoStack.push(initialText, 'Initial state');
    return {
        /**
         * Get current text
         */
        getText() {
            const current = undoStack.current();
            return current ? current.state : initialText;
        },
        /**
         * Apply a change
         */
        applyChange(newText, description) {
            undoStack.push(newText, description);
        },
        /**
         * Undo last change
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
         */
        canUndo() {
            return undoStack.canUndo();
        },
        /**
         * Check if redo is available
         */
        canRedo() {
            return undoStack.canRedo();
        },
        /**
         * Get stack info
         */
        info() {
            return undoStack.info();
        },
        /**
         * Get change history
         */
        history(limit = 10) {
            return undoStack.history(limit);
        },
    };
}
//# sourceMappingURL=undo.js.map