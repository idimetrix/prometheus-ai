import type { AgentToolDefinition, ToolExecutionContext, ToolResult } from "./types";

export const terminalTools: AgentToolDefinition[] = [
  {
    name: "terminal_exec",
    description: "Execute a shell command in the project sandbox",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        workDir: { type: "string", description: "Working directory (optional, defaults to project root)" },
        timeout: { type: "number", description: "Timeout in milliseconds (default 30000)" },
      },
      required: ["command"],
    },
    permissionLevel: "execute",
    execute: async (input, ctx) => {
      // Placeholder - actual implementation sends command to sandbox
      return {
        success: true,
        output: `[sandbox:${ctx.sandboxId}] Executed: ${input.command}`,
        metadata: { exitCode: 0 },
      };
    },
  },
  {
    name: "terminal_background",
    description: "Start a long-running process in the background (e.g., dev server)",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Command to run in background" },
        name: { type: "string", description: "Name for this background process" },
      },
      required: ["command", "name"],
    },
    permissionLevel: "execute",
    execute: async (input, ctx) => {
      return {
        success: true,
        output: `Started background process '${input.name}': ${input.command}`,
      };
    },
  },
];
