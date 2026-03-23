/**
 * Phase 1.2: Streaming Terminal Tools.
 * AsyncGenerator that yields stdout/stderr line-by-line instead of buffering.
 * Used by the ExecutionEngine for real-time terminal output.
 */

export interface TerminalStreamEvent {
  data: string;
  type: "stdout" | "stderr" | "exit";
}

/**
 * Execute a command and stream output line-by-line as an async generator.
 * This enables real-time terminal output instead of waiting for completion.
 */
export async function* streamCommand(
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  } = {}
): AsyncGenerator<TerminalStreamEvent, void, undefined> {
  const { spawn } = await import("node:child_process");
  const { cwd = "/workspace", timeout = 30_000 } = options;

  const proc = spawn("sh", ["-c", command], {
    cwd,
    env: { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  const events: TerminalStreamEvent[] = [];
  let done = false;
  let resolveWait: (() => void) | null = null;

  const pushEvent = (event: TerminalStreamEvent) => {
    events.push(event);
    if (resolveWait) {
      resolveWait();
      resolveWait = null;
    }
  };

  const processBuffer = (buffer: string, type: "stdout" | "stderr"): string => {
    const lines = buffer.split("\n");
    // Keep the last incomplete line in the buffer
    const remaining = lines.pop() ?? "";
    for (const line of lines) {
      pushEvent({ type, data: `${line}\n` });
    }
    return remaining;
  };

  proc.stdout?.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString();
    stdoutBuffer = processBuffer(stdoutBuffer, "stdout");
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
    stderrBuffer = processBuffer(stderrBuffer, "stderr");
  });

  proc.on("close", (code) => {
    // Flush remaining buffers
    if (stdoutBuffer) {
      pushEvent({ type: "stdout", data: stdoutBuffer });
    }
    if (stderrBuffer) {
      pushEvent({ type: "stderr", data: stderrBuffer });
    }
    pushEvent({ type: "exit", data: String(code ?? 0) });
    done = true;
    if (resolveWait) {
      resolveWait();
      resolveWait = null;
    }
  });

  // Set timeout
  const timer = setTimeout(() => {
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!done) {
        proc.kill("SIGKILL");
      }
    }, 5000);
  }, timeout);

  try {
    while (!done || events.length > 0) {
      if (events.length > 0) {
        const event = events.shift();
        if (event) {
          yield event;
          if (event.type === "exit") {
            return;
          }
        }
      } else if (!done) {
        // Wait for next event
        await new Promise<void>((resolve) => {
          resolveWait = resolve;
        });
      }
    }
  } finally {
    clearTimeout(timer);
    if (!done) {
      proc.kill("SIGTERM");
    }
  }
}

/**
 * Collect streaming output into a single result (for backward compatibility).
 */
export async function collectStreamOutput(
  command: string,
  options: {
    cwd?: string;
    timeout?: number;
    env?: Record<string, string>;
  } = {}
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  let stdout = "";
  let stderr = "";
  let exitCode = 0;

  for await (const event of streamCommand(command, options)) {
    if (event.type === "stdout") {
      stdout += event.data;
    } else if (event.type === "stderr") {
      stderr += event.data;
    } else if (event.type === "exit") {
      exitCode = Number.parseInt(event.data, 10);
    }
  }

  return { stdout, stderr, exitCode };
}
