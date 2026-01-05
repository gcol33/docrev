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
 * Execute a script with environment variables
 * @param {string} scriptPath - Path to script file
 * @param {object} env - Environment variables to set
 * @param {object} options - { verbose: boolean }
 * @returns {Promise<{success: boolean, stdout: string, stderr: string, error?: string}>}
 */
export async function executeScript(scriptPath, env, options = {}) {
  return new Promise((resolve) => {
    const ext = path.extname(scriptPath).toLowerCase();
    let command, args;

    // Determine how to run based on extension
    if (ext === '.ps1') {
      command = 'powershell';
      args = ['-ExecutionPolicy', 'Bypass', '-File', scriptPath];
    } else if (ext === '.py') {
      command = process.platform === 'win32' ? 'python' : 'python3';
      args = [scriptPath];
    } else if (ext === '.js' || ext === '.mjs') {
      command = 'node';
      args = [scriptPath];
    } else {
      // Assume shell script (.sh or no extension)
      command = process.platform === 'win32' ? 'bash' : '/bin/bash';
      args = [scriptPath];
    }

    const proc = spawn(command, args, {
      env: { ...process.env, ...env },
      cwd: path.dirname(scriptPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32', // Use shell on Windows for better PATH handling
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
 * @param {string} outputPath - Path to generated file
 * @param {string} format - Output format (pdf, docx, etc.)
 * @param {object} config - Full config object
 * @param {object} options - { verbose: boolean }
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function runPostprocess(outputPath, format, config, options = {}) {
  const postprocessConfig = config.postprocess || {};

  // Collect scripts to run (format-specific + all)
  const scripts = [];
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
  const errors = [];

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
    } catch (err) {
      errors.push(`Script ${scriptPath} error: ${err.message}`);
    }
  }

  return {
    success: errors.length === 0,
    error: errors.length > 0 ? errors.join('\n') : undefined,
  };
}
