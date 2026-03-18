import type { AgentToolDefinition } from "./types";

export const gitTools: AgentToolDefinition[] = [
  {
    name: "git_status",
    description: "Show the working tree status (modified, staged, untracked files)",
    inputSchema: { type: "object", properties: {}, required: [] },
    permissionLevel: "read",
    execute: async (_input, ctx) => {
      return { success: true, output: `[sandbox:${ctx.sandboxId}] git status` };
    },
  },
  {
    name: "git_diff",
    description: "Show changes between commits, working tree, etc.",
    inputSchema: {
      type: "object",
      properties: {
        staged: { type: "boolean", description: "Show staged changes only" },
        path: { type: "string", description: "Specific file path to diff" },
      },
    },
    permissionLevel: "read",
    execute: async (_input, ctx) => {
      return { success: true, output: `[sandbox:${ctx.sandboxId}] git diff` };
    },
  },
  {
    name: "git_commit",
    description: "Create a new commit with the staged changes",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit message" },
      },
      required: ["message"],
    },
    permissionLevel: "write",
    execute: async (input, ctx) => {
      return { success: true, output: `[sandbox:${ctx.sandboxId}] git commit -m "${input.message}"` };
    },
  },
  {
    name: "git_branch",
    description: "Create and switch to a new branch",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Branch name" },
      },
      required: ["name"],
    },
    permissionLevel: "write",
    execute: async (input, ctx) => {
      return { success: true, output: `[sandbox:${ctx.sandboxId}] git checkout -b ${input.name}` };
    },
  },
  {
    name: "git_push",
    description: "Push commits to the remote repository",
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string", description: "Branch to push" },
      },
    },
    permissionLevel: "admin",
    execute: async (input, ctx) => {
      return { success: true, output: `[sandbox:${ctx.sandboxId}] git push origin ${input.branch ?? "HEAD"}` };
    },
  },
  {
    name: "git_create_pr",
    description: "Create a pull request on the remote repository",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "PR title" },
        body: { type: "string", description: "PR description" },
        base: { type: "string", description: "Base branch (default: main)" },
      },
      required: ["title", "body"],
    },
    permissionLevel: "admin",
    execute: async (input, ctx) => {
      return { success: true, output: `[sandbox:${ctx.sandboxId}] Created PR: ${input.title}` };
    },
  },
];
