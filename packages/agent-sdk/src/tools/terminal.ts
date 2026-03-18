import { z } from "zod";
import { execInSandbox } from "./sandbox";
import type { AgentToolDefinition } from "./types";

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const terminalExecSchema = z
  .object({
    command: z.string().describe("Shell command to execute"),
    workDir: z
      .string()
      .optional()
      .describe(
        "Working directory relative to project root (defaults to project root)"
      ),
    timeout: z
      .number()
      .int()
      .positive()
      .max(120_000)
      .optional()
      .describe("Timeout in milliseconds (default 30000, max 120000)"),
  })
  .strict();

export const terminalBackgroundSchema = z
  .object({
    command: z.string().describe("Command to run in background"),
    name: z
      .string()
      .describe(
        "Name for this background process (used to reference it later)"
      ),
  })
  .strict();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_COMMAND_TIMEOUT_MS = 120_000; // 2 minutes max

// Commands that are blocked for security reasons
const BLOCKED_COMMANDS = [
  /\brm\s+-rf\s+\/(?!\w)/, // rm -rf / (root deletion)
  /\b(curl|wget).*\|\s*sh/, // piping downloads to shell
  /\bdd\s+.*of=\/dev\//, // writing to raw devices
  /\b:[()\s]*{.*}.*;\s*:/, // fork bombs
  /\bmkfs\b/, // formatting filesystems
];

function isCommandBlocked(command: string): string | null {
  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      return `Command blocked by security policy: matches pattern ${pattern.source}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const terminalTools: AgentToolDefinition[] = [
  {
    name: "terminal_exec",
    description:
      "Execute a shell command in the project sandbox. Commands run with a timeout and output is captured. Use this for running builds, tests, installing dependencies, and other CLI operations.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        workDir: {
          type: "string",
          description:
            "Working directory relative to project root (optional, defaults to project root)",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default 30000, max 120000)",
        },
      },
      required: ["command"],
    },
    zodSchema: terminalExecSchema,
    permissionLevel: "execute",
    creditCost: 3,
    execute: async (input, ctx) => {
      const parsed = terminalExecSchema.parse(input);
      const blocked = isCommandBlocked(parsed.command);
      if (blocked) {
        return { success: false, output: "", error: blocked };
      }

      const timeout = Math.min(
        parsed.timeout ?? 30_000,
        MAX_COMMAND_TIMEOUT_MS
      );

      const workDir = parsed.workDir
        ? `${ctx.workDir}/${parsed.workDir}`
        : ctx.workDir;

      return await execInSandbox(parsed.command, { ...ctx, workDir }, timeout);
    },
  },
  {
    name: "terminal_background",
    description:
      "Start a long-running process in the background (e.g., dev server, watcher). The process continues running and its output can be checked later.",
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to run in background",
        },
        name: {
          type: "string",
          description:
            "Name for this background process (used to reference it later)",
        },
      },
      required: ["command", "name"],
    },
    zodSchema: terminalBackgroundSchema,
    permissionLevel: "execute",
    creditCost: 3,
    execute: async (input, ctx) => {
      const parsed = terminalBackgroundSchema.parse(input);
      const blocked = isCommandBlocked(parsed.command);
      if (blocked) {
        return { success: false, output: "", error: blocked };
      }

      // Start process in background with nohup, redirect output to a log file
      const logFile = `/tmp/prometheus-bg-${ctx.sandboxId}-${parsed.name}.log`;
      const bgCommand = `nohup ${parsed.command} > "${logFile}" 2>&1 & echo $!`;

      const result = await execInSandbox(bgCommand, ctx);
      if (result.success) {
        const pid = result.output.trim();
        return {
          success: true,
          output: `Started background process '${parsed.name}' (PID: ${pid}). Logs at: ${logFile}`,
          metadata: {
            pid: Number.parseInt(pid, 10),
            logFile,
            name: parsed.name,
          },
        };
      }
      return result;
    },
  },
];
