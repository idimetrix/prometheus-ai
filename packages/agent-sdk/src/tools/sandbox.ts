import type { ToolExecutionContext, ToolResult } from "./types";
import { exec } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 512_000; // 500KB max output

/**
 * Execute a command inside the project sandbox.
 *
 * In production, this sends the command to the sandbox-manager service
 * which runs it in an isolated container. For local dev, it executes
 * directly via child_process with timeout and output limits.
 */
export async function execInSandbox(
  command: string,
  ctx: ToolExecutionContext,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<ToolResult> {
  const sandboxManagerUrl = process.env.SANDBOX_MANAGER_URL;

  if (sandboxManagerUrl) {
    return execRemoteSandbox(sandboxManagerUrl, command, ctx, timeoutMs);
  }

  return execLocalSandbox(command, ctx, timeoutMs);
}

async function execRemoteSandbox(
  baseUrl: string,
  command: string,
  ctx: ToolExecutionContext,
  timeoutMs: number,
): Promise<ToolResult> {
  try {
    const response = await fetch(`${baseUrl}/api/exec`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sandboxId: ctx.sandboxId,
        command,
        workDir: ctx.workDir,
        timeoutMs,
      }),
      signal: AbortSignal.timeout(timeoutMs + 5_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        output: "",
        error: `Sandbox execution failed (${response.status}): ${errorText}`,
      };
    }

    const result = (await response.json()) as {
      exitCode: number;
      stdout: string;
      stderr: string;
    };

    return {
      success: result.exitCode === 0,
      output: result.stdout || result.stderr,
      error: result.exitCode !== 0 ? result.stderr : undefined,
      metadata: { exitCode: result.exitCode },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: "",
      error: `Sandbox connection error: ${message}`,
    };
  }
}

function execLocalSandbox(
  command: string,
  ctx: ToolExecutionContext,
  timeoutMs: number,
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const child = exec(command, {
      cwd: ctx.workDir,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES,
      env: {
        ...process.env,
        PROMETHEUS_SESSION_ID: ctx.sessionId,
        PROMETHEUS_PROJECT_ID: ctx.projectId,
        PROMETHEUS_SANDBOX_ID: ctx.sandboxId,
      },
    }, (error, stdout, stderr) => {
      if (error) {
        // Distinguish timeout from other errors
        if (error.killed) {
          resolve({
            success: false,
            output: stdout || "",
            error: `Command timed out after ${timeoutMs}ms`,
            metadata: { exitCode: -1, timedOut: true },
          });
          return;
        }

        resolve({
          success: false,
          output: stdout || "",
          error: stderr || error.message,
          metadata: { exitCode: error.code ?? 1 },
        });
        return;
      }

      resolve({
        success: true,
        output: stdout || stderr || "",
        metadata: { exitCode: 0 },
      });
    });
  });
}
