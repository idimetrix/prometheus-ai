import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { LocalTool, ToolResult } from "./types";

export const fileWriteTool: LocalTool = {
  name: "file_write",
  description:
    "Write content to a file. Creates the file if it does not exist, and creates parent directories as needed.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to the file to write",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
    required: ["path", "content"],
  },
  requiresApproval: true,

  async execute(
    args: Record<string, unknown>,
    projectDir: string
  ): Promise<ToolResult> {
    const filePath = resolve(projectDir, String(args.path));

    // Safety: prevent writing outside the project directory
    if (!filePath.startsWith(projectDir)) {
      return {
        success: false,
        output: `Blocked: cannot write outside project directory (${projectDir})`,
      };
    }

    try {
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, String(args.content), "utf-8");
      return {
        success: true,
        output: `Wrote ${String(args.content).length} bytes to ${filePath}`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, output: `Error writing file: ${msg}` };
    }
  },
};
