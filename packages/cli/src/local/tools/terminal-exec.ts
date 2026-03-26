import { exec } from "node:child_process";

import type { LocalTool, ToolResult } from "./types";

const BLOCKED_COMMANDS = [
  "rm -rf /",
  "rm -rf /*",
  "mkfs",
  "dd if=",
  ":(){:|:&};:",
  "chmod -R 777 /",
  "curl | sh",
  "wget | sh",
  "curl | bash",
  "wget | bash",
];

export const terminalExecTool: LocalTool = {
  name: "terminal_exec",
  description:
    "Execute a bash command in the terminal. Returns stdout and stderr.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
    },
    required: ["command"],
  },
  requiresApproval: true,

  execute(
    args: Record<string, unknown>,
    projectDir: string
  ): Promise<ToolResult> {
    const command = String(args.command);
    const timeout = typeof args.timeout === "number" ? args.timeout : 30_000;

    // Safety: block obviously dangerous commands
    for (const blocked of BLOCKED_COMMANDS) {
      if (command.includes(blocked)) {
        return Promise.resolve({
          success: false,
          output: `Blocked: command contains dangerous pattern "${blocked}"`,
        });
      }
    }

    return new Promise((resolve) => {
      exec(
        command,
        {
          cwd: projectDir,
          timeout,
          maxBuffer: 1024 * 1024 * 5, // 5MB
          env: { ...process.env, FORCE_COLOR: "0" },
        },
        (error, stdout, stderr) => {
          const output = [
            stdout ? stdout.trim() : "",
            stderr ? `[stderr] ${stderr.trim()}` : "",
          ]
            .filter(Boolean)
            .join("\n");

          if (error && !stdout && !stderr) {
            resolve({
              success: false,
              output: `Command failed: ${error.message}`,
            });
          } else {
            resolve({
              success: !error,
              output: output || "(no output)",
            });
          }
        }
      );
    });
  },
};
