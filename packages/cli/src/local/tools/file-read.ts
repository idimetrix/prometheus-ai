import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { LocalTool, ToolResult } from "./types";

export const fileReadTool: LocalTool = {
  name: "file_read",
  description:
    "Read a file from the local filesystem. Returns the file contents as text.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file to read",
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (1-based, optional)",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to read (optional)",
      },
    },
    required: ["path"],
  },
  requiresApproval: false,

  async execute(
    args: Record<string, unknown>,
    projectDir: string
  ): Promise<ToolResult> {
    const filePath = resolve(projectDir, String(args.path));

    try {
      const content = await readFile(filePath, "utf-8");
      const lines = content.split("\n");

      const offset = typeof args.offset === "number" ? args.offset - 1 : 0;
      const limit = typeof args.limit === "number" ? args.limit : lines.length;
      const selected = lines.slice(Math.max(0, offset), offset + limit);

      const numbered = selected
        .map((line, i) => `${String(offset + i + 1).padStart(5)}  ${line}`)
        .join("\n");

      return {
        success: true,
        output: numbered,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, output: `Error reading file: ${msg}` };
    }
  },
};
