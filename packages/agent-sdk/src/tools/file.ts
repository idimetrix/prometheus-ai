import { z } from "zod";
import { execInSandbox } from "./sandbox";
import type {
  AgentToolDefinition,
  ToolExecutionContext,
  ToolResult,
} from "./types";

// ---------------------------------------------------------------------------
// Remote sandbox-manager helpers (bypass shell exec for file I/O)
// ---------------------------------------------------------------------------

function getSandboxManagerUrl(ctx: ToolExecutionContext): string | undefined {
  return ctx.sandboxManagerUrl || process.env.SANDBOX_MANAGER_URL;
}

async function readFileRemote(
  baseUrl: string,
  sandboxId: string,
  filePath: string
): Promise<ToolResult> {
  try {
    const url = `${baseUrl}/sandbox/${sandboxId}/read?path=${encodeURIComponent(filePath)}`;
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        output: "",
        error: `Failed to read file (${response.status}): ${errorText}`,
      };
    }

    const content = await response.text();
    return { success: true, output: content };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: "",
      error: `Sandbox read error: ${message}`,
    };
  }
}

async function writeFileRemote(
  baseUrl: string,
  sandboxId: string,
  filePath: string,
  content: string
): Promise<ToolResult> {
  try {
    const response = await fetch(`${baseUrl}/sandbox/${sandboxId}/write`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, content }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        output: "",
        error: `Failed to write file (${response.status}): ${errorText}`,
      };
    }

    return {
      success: true,
      output: `Successfully wrote ${content.length} bytes to ${filePath}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      output: "",
      error: `Sandbox write error: ${message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const fileReadSchema = z
  .object({
    path: z.string().describe("File path relative to project root"),
    startLine: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Start line number (1-indexed)"),
    endLine: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("End line number (1-indexed)"),
  })
  .strict();

export const fileWriteSchema = z
  .object({
    path: z.string().describe("File path relative to project root"),
    content: z.string().describe("Content to write to the file"),
  })
  .strict();

export const fileEditSchema = z
  .object({
    path: z.string().describe("File path relative to project root"),
    oldString: z.string().describe("Exact string to find and replace"),
    newString: z.string().describe("Replacement string"),
  })
  .strict();

export const fileDeleteSchema = z
  .object({
    path: z.string().describe("File path relative to project root"),
  })
  .strict();

export const fileListSchema = z
  .object({
    path: z.string().describe("Directory path relative to project root"),
    pattern: z
      .string()
      .optional()
      .describe("Glob pattern to filter files (e.g., '*.ts')"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function resolveProjectPath(workDir: string, relativePath: string): string {
  if (relativePath.startsWith("/")) {
    return relativePath;
  }
  return `${workDir}/${relativePath}`;
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const fileTools: AgentToolDefinition[] = [
  {
    name: "file_read",
    description:
      "Read the contents of a file at the given path. Optionally specify a line range to read a subset.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to project root",
        },
        startLine: {
          type: "number",
          description: "Start line number (1-indexed, optional)",
        },
        endLine: {
          type: "number",
          description: "End line number (1-indexed, optional)",
        },
      },
      required: ["path"],
    },
    zodSchema: fileReadSchema,
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parsed = fileReadSchema.parse(input);
      const filePath = resolveProjectPath(ctx.workDir, parsed.path);

      const baseUrl = getSandboxManagerUrl(ctx);
      if (baseUrl) {
        // Use dedicated read endpoint for remote sandboxes
        const result = await readFileRemote(baseUrl, ctx.sandboxId, filePath);
        if (!result.success) {
          return result;
        }
        // Apply line range filtering if requested
        if (parsed.startLine !== undefined || parsed.endLine !== undefined) {
          const lines = result.output.split("\n");
          const start = (parsed.startLine ?? 1) - 1;
          const end = parsed.endLine ?? lines.length;
          const sliced = lines.slice(start, end);
          const numbered = sliced
            .map(
              (line, i) => `${String(start + i + 1).padStart(6, " ")}\t${line}`
            )
            .join("\n");
          return { success: true, output: numbered };
        }
        // Add line numbers like cat -n
        const numbered = result.output
          .split("\n")
          .map((line, i) => `${String(i + 1).padStart(6, " ")}\t${line}`)
          .join("\n");
        return { success: true, output: numbered };
      }

      // Fallback: execute via shell command in local sandbox
      let command: string;
      if (parsed.startLine !== undefined && parsed.endLine !== undefined) {
        command = `sed -n '${parsed.startLine},${parsed.endLine}p' "${filePath}" | cat -n`;
      } else if (parsed.startLine === undefined) {
        command = `cat -n "${filePath}"`;
      } else {
        command = `tail -n +${parsed.startLine} "${filePath}" | cat -n`;
      }

      return await execInSandbox(command, ctx);
    },
  },
  {
    name: "file_write",
    description:
      "Write content to a file, creating it and any parent directories if they don't exist. Overwrites existing content.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to project root",
        },
        content: {
          type: "string",
          description: "Content to write to the file",
        },
      },
      required: ["path", "content"],
    },
    zodSchema: fileWriteSchema,
    permissionLevel: "write",
    creditCost: 2,
    execute: async (input, ctx) => {
      const parsed = fileWriteSchema.parse(input);
      const filePath = resolveProjectPath(ctx.workDir, parsed.path);

      const baseUrl = getSandboxManagerUrl(ctx);
      if (baseUrl) {
        // Use dedicated write endpoint for remote sandboxes
        const result = await writeFileRemote(
          baseUrl,
          ctx.sandboxId,
          filePath,
          parsed.content
        );
        if (result.success) {
          return {
            success: true,
            output: `Successfully wrote ${parsed.content.length} bytes to ${parsed.path}`,
            metadata: {
              path: parsed.path,
              bytesWritten: parsed.content.length,
            },
          };
        }
        return result;
      }

      // Fallback: execute via shell command in local sandbox
      const command = `mkdir -p "$(dirname "${filePath}")" && cat > "${filePath}" << 'PROMETHEUS_EOF'\n${parsed.content}\nPROMETHEUS_EOF`;

      const result = await execInSandbox(command, ctx);
      if (result.success) {
        return {
          success: true,
          output: `Successfully wrote ${parsed.content.length} bytes to ${parsed.path}`,
          metadata: { path: parsed.path, bytesWritten: parsed.content.length },
        };
      }
      return result;
    },
  },
  {
    name: "file_edit",
    description:
      "Replace a specific string in a file with new content. The old string must be an exact match.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "File path relative to project root",
        },
        oldString: {
          type: "string",
          description: "Exact string to find and replace",
        },
        newString: { type: "string", description: "Replacement string" },
      },
      required: ["path", "oldString", "newString"],
    },
    zodSchema: fileEditSchema,
    permissionLevel: "write",
    creditCost: 2,
    execute: async (input, ctx) => {
      const parsed = fileEditSchema.parse(input);
      const filePath = resolveProjectPath(ctx.workDir, parsed.path);

      // Read file, perform replacement, write back
      const readResult = await execInSandbox(`cat "${filePath}"`, ctx);
      if (!readResult.success) {
        return {
          success: false,
          output: "",
          error: `Failed to read file: ${readResult.error}`,
        };
      }

      const fileContent = readResult.output;

      if (!fileContent.includes(parsed.oldString)) {
        return {
          success: false,
          output: "",
          error: `The string to replace was not found in ${parsed.path}. Make sure oldString is an exact match.`,
        };
      }

      const occurrences = fileContent.split(parsed.oldString).length - 1;
      if (occurrences > 1) {
        return {
          success: false,
          output: "",
          error: `Found ${occurrences} occurrences of oldString in ${parsed.path}. Provide more context to make the match unique.`,
        };
      }

      const updatedContent = fileContent.replace(
        parsed.oldString,
        parsed.newString
      );
      const writeCommand = `cat > "${filePath}" << 'PROMETHEUS_EOF'\n${updatedContent}\nPROMETHEUS_EOF`;
      const writeResult = await execInSandbox(writeCommand, ctx);
      if (writeResult.success) {
        return {
          success: true,
          output: `Successfully edited ${parsed.path}`,
          metadata: { path: parsed.path },
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
        path: {
          type: "string",
          description: "File path relative to project root",
        },
      },
      required: ["path"],
    },
    zodSchema: fileDeleteSchema,
    permissionLevel: "write",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parsed = fileDeleteSchema.parse(input);
      const filePath = resolveProjectPath(ctx.workDir, parsed.path);
      const result = await execInSandbox(`rm -f "${filePath}"`, ctx);
      if (result.success) {
        return {
          success: true,
          output: `Deleted ${parsed.path}`,
          metadata: { path: parsed.path },
        };
      }
      return result;
    },
  },
  {
    name: "file_list",
    description:
      "List files in a directory, optionally filtering with a glob pattern. Returns file names with types.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory path relative to project root",
        },
        pattern: {
          type: "string",
          description: "Glob pattern to filter files (e.g., '*.ts')",
        },
      },
      required: ["path"],
    },
    zodSchema: fileListSchema,
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parsed = fileListSchema.parse(input);
      const dirPath = resolveProjectPath(ctx.workDir, parsed.path);

      let command: string;
      if (parsed.pattern) {
        command = `find "${dirPath}" -maxdepth 3 -name "${parsed.pattern}" -type f 2>/dev/null | head -200 | sort`;
      } else {
        command = `ls -la "${dirPath}" 2>/dev/null | head -200`;
      }

      return await execInSandbox(command, ctx);
    },
  },
];
