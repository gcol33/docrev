/**
 * Postprocess scripting for docrev
 *
 * Allows users to run custom scripts after output generation.
 * Supports shell scripts, PowerShell, Python, and Node.js.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

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
export async function executeScript(
  scriptPath: string,
  env: Record<string, string>,
  options: ExecutionOptions = {}
): Promise<ExecutionResult> {
  return new Promise((resolve) => {
    const ext = path.extname(scriptPath).toLowerCase();
    const isWindows = process.platform === 'win32';
    let command: string;
    let args: string[];
    let useShell: boolean;

    // Determine how to run based on extension
    if (ext === '.ps1') {
      command = 'powershell';
      args = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath];
      useShell = false;
    } else if (ext === '.py') {
      // Python needs shell on Windows for PATH resolution
      command = isWindows ? 'python' : 'python3';
      // On Windows, wrap path in quotes to handle spaces
      args = [isWindows ? `"${scriptPath}"` : scriptPath];
      useShell = isWindows;
    } else if (ext === '.js' || ext === '.mjs') {
      // Node.js is typically in PATH and works without shell
      command = process.execPath; // Use the same Node that's running this script
      args = [scriptPath];
      useShell = false;
    } else {
      // Assume shell script (.sh or no extension)
      command = isWindows ? 'bash' : '/bin/bash';
      args = [scriptPath];
      useShell = false;
    }

    const proc = spawn(command, args, {
      env: { ...process.env, ...env },
      cwd: path.dirname(scriptPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
      // On Windows with shell, use windowsVerbatimArguments to preserve paths with spaces
      windowsVerbatimArguments: isWindows && useShell,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      if (options.verbose) {
        process.stdout.write(data);
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (options.verbose) {
        process.stderr.write(data);
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, stdout, stderr, error: err.message });
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, stdout, stderr });
      } else {
        resolve({
          success: false,
          stdout,
          stderr,
          error: `Exit code ${code}: ${stderr.trim() || 'Unknown error'}`,
        });
      }
    });
  });
}

/**
 * Run postprocess scripts for a given format
 */
export async function runPostprocess(
  outputPath: string,
  format: string,
  config: { postprocess?: Record<string, string>; _configPath?: string; [key: string]: unknown },
  options: ExecutionOptions = {}
): Promise<PostprocessResult> {
  const postprocessConfig = config.postprocess || {};

  // Collect scripts to run (format-specific + all)
  const scripts: string[] = [];
  if (postprocessConfig[format]) {
    scripts.push(postprocessConfig[format]);
  }
  if (postprocessConfig.all) {
    scripts.push(postprocessConfig.all);
  }

  if (scripts.length === 0) {
    return { success: true };
  }

  const directory = path.dirname(outputPath);
  const errors: string[] = [];

  for (const scriptPath of scripts) {
    const absoluteScript = path.isAbsolute(scriptPath)
      ? scriptPath
      : path.join(directory, scriptPath);

    if (!fs.existsSync(absoluteScript)) {
      errors.push(`Postprocess script not found: ${scriptPath}`);
      continue;
    }

    try {
      if (options.verbose) {
        console.log(`Running postprocess script: ${scriptPath}`);
      }

      const result = await executeScript(
        absoluteScript,
        {
          OUTPUT_FILE: outputPath,
          OUTPUT_FORMAT: format,
          PROJECT_DIR: directory,
          CONFIG_PATH: config._configPath || '',
        },
        options
      );

      if (!result.success) {
        errors.push(`Script ${scriptPath} failed: ${result.error}`);
      } else if (options.verbose) {
        console.log(`Postprocess script completed: ${scriptPath}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Script ${scriptPath} error: ${message}`);
    }
  }

  return {
    success: errors.length === 0,
    error: errors.length > 0 ? errors.join('\n') : undefined,
  };
}
