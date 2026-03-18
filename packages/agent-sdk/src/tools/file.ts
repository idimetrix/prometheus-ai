import type { AgentToolDefinition, ToolExecutionContext, ToolResult } from "./types";
import { execInSandbox } from "./sandbox";

export const fileTools: AgentToolDefinition[] = [
  {
    name: "file_read",
    description: "Read the contents of a file at the given path. Optionally specify a line range to read a subset.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        startLine: { type: "number", description: "Start line number (1-indexed, optional)" },
        endLine: { type: "number", description: "End line number (1-indexed, optional)" },
      },
      required: ["path"],
    },
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const filePath = resolveProjectPath(ctx.workDir, input.path as string);
      const startLine = input.startLine as number | undefined;
      const endLine = input.endLine as number | undefined;

      let command: string;
      if (startLine !== undefined && endLine !== undefined) {
        command = `sed -n '${startLine},${endLine}p' "${filePath}" | cat -n`;
      } else if (startLine !== undefined) {
        command = `tail -n +${startLine} "${filePath}" | cat -n`;
      } else {
        command = `cat -n "${filePath}"`;
      }

      return execInSandbox(command, ctx);
    },
  },
  {
    name: "file_write",
    description: "Write content to a file, creating it and any parent directories if they don't exist. Overwrites existing content.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        content: { type: "string", description: "Content to write to the file" },
      },
      required: ["path", "content"],
    },
    permissionLevel: "write",
    creditCost: 2,
    execute: async (input, ctx) => {
      const filePath = resolveProjectPath(ctx.workDir, input.path as string);
      const content = input.content as string;
      // Ensure parent directory exists, then write content via heredoc
      const escapedContent = content.replace(/'/g, "'\\''");
      const command = `mkdir -p "$(dirname "${filePath}")" && cat > "${filePath}" << 'PROMETHEUS_EOF'\n${content}\nPROMETHEUS_EOF`;

      const result = await execInSandbox(command, ctx);
      if (result.success) {
        return {
          success: true,
          output: `Successfully wrote ${content.length} bytes to ${input.path}`,
          metadata: { path: input.path, bytesWritten: content.length },
        };
      }
      return result;
    },
  },
  {
    name: "file_edit",
    description: "Replace a specific string in a file with new content. The old string must be an exact match.",
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
    creditCost: 2,
    execute: async (input, ctx) => {
      const filePath = resolveProjectPath(ctx.workDir, input.path as string);

      // Read file, perform replacement, write back
      // Using node-style approach via sandbox
      const readResult = await execInSandbox(`cat "${filePath}"`, ctx);
      if (!readResult.success) {
        return { success: false, output: "", error: `Failed to read file: ${readResult.error}` };
      }

      const oldStr = input.oldString as string;
      const newStr = input.newString as string;
      const fileContent = readResult.output;

      if (!fileContent.includes(oldStr)) {
        return {
          success: false,
          output: "",
          error: `The string to replace was not found in ${input.path}. Make sure oldString is an exact match.`,
        };
      }

      const occurrences = fileContent.split(oldStr).length - 1;
      if (occurrences > 1) {
        return {
          success: false,
          output: "",
          error: `Found ${occurrences} occurrences of oldString in ${input.path}. Provide more context to make the match unique.`,
        };
      }

      const updatedContent = fileContent.replace(oldStr, newStr);
      const writeCommand = `cat > "${filePath}" << 'PROMETHEUS_EOF'\n${updatedContent}\nPROMETHEUS_EOF`;
      const writeResult = await execInSandbox(writeCommand, ctx);
      if (writeResult.success) {
        return {
          success: true,
          output: `Successfully edited ${input.path}`,
          metadata: { path: input.path },
        };
      }
      return writeResult;
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
    creditCost: 1,
    execute: async (input, ctx) => {
      const filePath = resolveProjectPath(ctx.workDir, input.path as string);
      const result = await execInSandbox(`rm -f "${filePath}"`, ctx);
      if (result.success) {
        return {
          success: true,
          output: `Deleted ${input.path}`,
          metadata: { path: input.path },
        };
      }
      return result;
    },
  },
  {
    name: "file_list",
    description: "List files in a directory, optionally filtering with a glob pattern. Returns file names with types.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to project root" },
        pattern: { type: "string", description: "Glob pattern to filter files (e.g., '*.ts')" },
      },
      required: ["path"],
    },
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const dirPath = resolveProjectPath(ctx.workDir, input.path as string);
      const pattern = input.pattern as string | undefined;

      let command: string;
      if (pattern) {
        command = `find "${dirPath}" -maxdepth 3 -name "${pattern}" -type f 2>/dev/null | head -200 | sort`;
      } else {
        command = `ls -la "${dirPath}" 2>/dev/null | head -200`;
      }

      return execInSandbox(command, ctx);
    },
  },
];

function resolveProjectPath(workDir: string, relativePath: string): string {
  if (relativePath.startsWith("/")) return relativePath;
  return `${workDir}/${relativePath}`;
}
