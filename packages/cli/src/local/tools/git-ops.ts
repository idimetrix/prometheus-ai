import { exec } from "node:child_process";

import type { LocalTool, ToolResult } from "./types";

function runGit(
  args: string,
  cwd: string,
  timeout = 15_000
): Promise<ToolResult> {
  return new Promise((resolve) => {
    exec(`git ${args}`, { cwd, timeout }, (error, stdout, stderr) => {
      const output = [stdout ? stdout.trim() : "", stderr ? stderr.trim() : ""]
        .filter(Boolean)
        .join("\n");

      resolve({
        success: !error,
        output: output || "(no output)",
      });
    });
  });
}

export const gitStatusTool: LocalTool = {
  name: "git_status",
  description: "Show git status of the working tree.",
  parameters: {
    type: "object",
    properties: {},
    required: [],
  },
  requiresApproval: false,

  execute(
    _args: Record<string, unknown>,
    projectDir: string
  ): Promise<ToolResult> {
    return runGit("status --short", projectDir);
  },
};

export const gitDiffTool: LocalTool = {
  name: "git_diff",
  description: "Show git diff of current changes.",
  parameters: {
    type: "object",
    properties: {
      staged: {
        type: "boolean",
        description: "Show only staged changes (default: false)",
      },
      path: {
        type: "string",
        description: "Limit diff to a specific file or directory",
      },
    },
    required: [],
  },
  requiresApproval: false,

  execute(
    args: Record<string, unknown>,
    projectDir: string
  ): Promise<ToolResult> {
    const staged = args.staged === true ? "--cached " : "";
    const path = args.path ? ` -- ${String(args.path)}` : "";
    return runGit(`diff ${staged}${path}`.trim(), projectDir);
  },
};

export const gitCommitTool: LocalTool = {
  name: "git_commit",
  description: "Stage files and create a git commit.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Commit message",
      },
      files: {
        type: "array",
        description:
          "Files to stage (default: all modified files). Use ['.'] for all.",
        items: { type: "string" },
      },
    },
    required: ["message"],
  },
  requiresApproval: true,

  async execute(
    args: Record<string, unknown>,
    projectDir: string
  ): Promise<ToolResult> {
    const message = String(args.message);
    const files = Array.isArray(args.files)
      ? (args.files as string[]).join(" ")
      : ".";

    const addResult = await runGit(`add ${files}`, projectDir);
    if (!addResult.success) {
      return addResult;
    }

    return runGit(`commit -m "${message.replace(/"/g, '\\"')}"`, projectDir);
  },
};

export const gitLogTool: LocalTool = {
  name: "git_log",
  description: "Show recent git commit log.",
  parameters: {
    type: "object",
    properties: {
      count: {
        type: "number",
        description: "Number of commits to show (default: 10)",
      },
    },
    required: [],
  },
  requiresApproval: false,

  execute(
    args: Record<string, unknown>,
    projectDir: string
  ): Promise<ToolResult> {
    const count = typeof args.count === "number" ? args.count : 10;
    return runGit(`log --oneline --no-decorate -${String(count)}`, projectDir);
  },
};
