import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { LocalTool, ToolResult } from "./types";

export const fileListTool: LocalTool = {
  name: "file_list",
  description:
    "List directory contents. Returns file and directory names with type indicators.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Directory path to list (relative to project root, default: '.')",
      },
      recursive: {
        type: "boolean",
        description:
          "Whether to list recursively (default: false, max depth: 3)",
      },
    },
    required: [],
  },
  requiresApproval: false,

  async execute(
    args: Record<string, unknown>,
    projectDir: string
  ): Promise<ToolResult> {
    const dirPath = resolve(projectDir, String(args.path ?? "."));
    const recursive = args.recursive === true;

    try {
      const entries = await listDir(dirPath, recursive ? 3 : 1, "");
      return { success: true, output: entries.join("\n") };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, output: `Error listing directory: ${msg}` };
    }
  },
};

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  ".next",
  ".turbo",
  "__pycache__",
  ".venv",
  "target",
]);

async function listDir(
  dirPath: string,
  maxDepth: number,
  prefix: string
): Promise<string[]> {
  if (maxDepth <= 0) {
    return [`${prefix}...`];
  }

  const entries = await readdir(dirPath);
  const results: string[] = [];

  for (const entry of entries.sort()) {
    if (entry.startsWith(".") && entry !== ".env.example") {
      continue;
    }
    if (IGNORED_DIRS.has(entry)) {
      continue;
    }

    const fullPath = join(dirPath, entry);
    try {
      const s = await stat(fullPath);
      if (s.isDirectory()) {
        results.push(`${prefix}${entry}/`);
        const children = await listDir(fullPath, maxDepth - 1, `${prefix}  `);
        results.push(...children);
      } else {
        results.push(`${prefix}${entry}`);
      }
    } catch {
      // Skip files we can't stat
    }
  }
  return results;
}
