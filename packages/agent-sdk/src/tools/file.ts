import type { AgentToolDefinition, ToolExecutionContext, ToolResult } from "./types";

async function executeInSandbox(command: string, ctx: ToolExecutionContext): Promise<ToolResult> {
  // Placeholder - actual implementation connects to sandbox manager
  return { success: true, output: `[sandbox:${ctx.sandboxId}] ${command}` };
}

export const fileTools: AgentToolDefinition[] = [
  {
    name: "file_read",
    description: "Read the contents of a file at the given path",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        startLine: { type: "number", description: "Start line number (optional)" },
        endLine: { type: "number", description: "End line number (optional)" },
      },
      required: ["path"],
    },
    permissionLevel: "read",
    execute: async (input, ctx) => {
      return executeInSandbox(`cat "${input.path}"`, ctx);
    },
  },
  {
    name: "file_write",
    description: "Write content to a file, creating it if it doesn't exist",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        content: { type: "string", description: "Content to write" },
      },
      required: ["path", "content"],
    },
    permissionLevel: "write",
    execute: async (input, ctx) => {
      return executeInSandbox(`write "${input.path}"`, ctx);
    },
  },
  {
    name: "file_edit",
    description: "Replace a specific string in a file with new content",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        oldString: { type: "string", description: "Exact string to find and replace" },
        newString: { type: "string", description: "Replacement string" },
      },
      required: ["path", "oldString", "newString"],
    },
    permissionLevel: "write",
    execute: async (input, ctx) => {
      return executeInSandbox(`edit "${input.path}"`, ctx);
    },
  },
  {
    name: "file_delete",
    description: "Delete a file at the given path",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
      },
      required: ["path"],
    },
    permissionLevel: "write",
    execute: async (input, ctx) => {
      return executeInSandbox(`rm "${input.path}"`, ctx);
    },
  },
  {
    name: "file_list",
    description: "List files in a directory, optionally with a glob pattern",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path" },
        pattern: { type: "string", description: "Glob pattern to filter files" },
      },
      required: ["path"],
    },
    permissionLevel: "read",
    execute: async (input, ctx) => {
      return executeInSandbox(`ls "${input.path}"`, ctx);
    },
  },
];
