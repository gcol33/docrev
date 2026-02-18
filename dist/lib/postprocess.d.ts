/**
 * Postprocess scripting for docrev
 *
 * Allows users to run custom scripts after output generation.
 * Supports shell scripts, PowerShell, Python, and Node.js.
 */
/**
 * Script execution result
 */
interface ExecutionResult {
    success: boolean;
    stdout: string;
    stderr: string;
    error?: string;
}
/**
 * Execution options
 */
interface ExecutionOptions {
    verbose?: boolean;
}
/**
 * Postprocess result
 */
interface PostprocessResult {
    success: boolean;
    error?: string;
}
/**
 * Execute a script with environment variables
 */
export declare function executeScript(scriptPath: string, env: Record<string, string>, options?: ExecutionOptions): Promise<ExecutionResult>;
/**
 * Run postprocess scripts for a given format
 */
export declare function runPostprocess(outputPath: string, format: string, config: {
    postprocess?: Record<string, string>;
    _configPath?: string;
    [key: string]: unknown;
}, options?: ExecutionOptions): Promise<PostprocessResult>;
export {};
//# sourceMappingURL=postprocess.d.ts.map