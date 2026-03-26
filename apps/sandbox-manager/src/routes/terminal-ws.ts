import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";
import type { ContainerManager } from "../container";

const logger = createLogger("sandbox:terminal-ws");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TerminalMessage {
  cols?: number;
  data?: string;
  rows?: number;
  type: "input" | "resize";
}

// ---------------------------------------------------------------------------
// Active PTY sessions
// ---------------------------------------------------------------------------

const activeSessions = new Map<
  string,
  { process: ChildProcess; sandboxId: string }
>();

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

/**
 * Creates the terminal WebSocket route.
 *
 * The route handles the WebSocket upgrade for `/terminal/:sandboxId`
 * and spawns a PTY (bash) process that bridges stdin/stdout over the
 * WebSocket connection.
 */
export function createTerminalWsRoute(containerManager: ContainerManager) {
  const route = new Hono();

  route.get("/terminal/:sandboxId", (c) => {
    const sandboxId = c.req.param("sandboxId");

    // Verify the sandbox exists
    const info = containerManager.getContainerInfo(sandboxId);
    if (!info) {
      return c.json({ error: "Sandbox not found" }, 404);
    }

    // Check for WebSocket upgrade
    const upgradeHeader = c.req.header("upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return c.json(
        { error: "WebSocket upgrade required" },
        { status: 426, headers: { Upgrade: "websocket" } }
      );
    }

    // For Hono + Node.js, we need raw access to the underlying socket.
    // This route is registered but the actual WebSocket upgrade is
    // handled by the custom upgrade handler in index.ts.
    // Return 200 to signal the sandbox exists and is ready.
    return c.json({ ready: true, sandboxId });
  });

  return route;
}

/**
 * Handle a raw WebSocket connection for a terminal session.
 *
 * This is called from the Node.js HTTP server upgrade handler,
 * not from the Hono route directly, because Hono does not natively
 * support WebSocket upgrades with @hono/node-server.
 *
 * In Docker mode, spawns a shell inside the container via `docker exec`.
 * In dev mode, spawns a local bash process in the workspace directory.
 */
export function handleTerminalWebSocket(
  ws: import("ws").WebSocket,
  sandboxId: string,
  containerManager: ContainerManager
): void {
  const info = containerManager.getContainerInfo(sandboxId);
  if (!info) {
    ws.close(4004, "Sandbox not found");
    return;
  }

  const sessionId = `${sandboxId}-${Date.now()}`;
  const mode = containerManager.getMode();
  logger.info({ sandboxId, sessionId, mode }, "Terminal session starting");

  let shell: ChildProcess;

  if (
    mode === "docker" &&
    info.containerId &&
    !info.containerId.startsWith("dev-")
  ) {
    // Docker mode: exec into the container
    shell = spawn(
      "docker",
      [
        "exec",
        "-i",
        "-w",
        "/workspace",
        "-e",
        "TERM=xterm-256color",
        "-e",
        "PS1=\\u@sandbox:\\w$ ",
        info.containerId,
        "sh",
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
      }
    );
  } else {
    // Dev mode: local shell in workspace directory
    shell = spawn("bash", ["--login"], {
      cwd: info.workspacePath,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        HOME: info.workspacePath,
        SHELL: "/bin/bash",
        PS1: "\\u@sandbox:\\w$ ",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
  }

  activeSessions.set(sessionId, { process: shell, sandboxId });

  // PTY stdout -> WebSocket
  shell.stdout?.on("data", (data: Buffer) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  // PTY stderr -> WebSocket
  shell.stderr?.on("data", (data: Buffer) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  // Shell exit -> notify client
  shell.on("close", (code) => {
    logger.info({ sandboxId, sessionId, code }, "Terminal session ended");
    activeSessions.delete(sessionId);
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "exit", code: code ?? 0 }));
      ws.close(1000, "Shell exited");
    }
  });

  shell.on("error", (err) => {
    logger.error(
      { sandboxId, sessionId, error: err.message },
      "Shell process error"
    );
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: "error", message: err.message }));
      ws.close(1011, "Shell error");
    }
    activeSessions.delete(sessionId);
  });

  // WebSocket messages -> PTY stdin
  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as TerminalMessage;

      switch (msg.type) {
        case "input": {
          if (msg.data && shell.stdin?.writable) {
            shell.stdin.write(msg.data);
          }
          break;
        }
        case "resize": {
          // In a real PTY we would call pty.resize(cols, rows).
          // With child_process pipes, resize is a no-op but we log it
          // for future PTY library integration (e.g. node-pty).
          logger.debug(
            { cols: msg.cols, rows: msg.rows, sessionId },
            "Terminal resize requested"
          );
          break;
        }
        default: {
          logger.warn({ msg, sessionId }, "Unknown terminal message type");
        }
      }
    } catch {
      // If not JSON, treat as raw input
      if (shell.stdin?.writable) {
        shell.stdin.write(String(raw));
      }
    }
  });

  // Clean up PTY on WebSocket close
  ws.on("close", () => {
    logger.info({ sandboxId, sessionId }, "WebSocket closed, killing shell");
    if (!shell.killed) {
      shell.kill("SIGTERM");
      // Force kill after 3 seconds
      setTimeout(() => {
        if (!shell.killed) {
          shell.kill("SIGKILL");
        }
      }, 3000);
    }
    activeSessions.delete(sessionId);
  });
}

/**
 * Get the number of active terminal sessions.
 */
export function getActiveSessionCount(): number {
  return activeSessions.size;
}
