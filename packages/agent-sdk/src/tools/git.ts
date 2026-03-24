import { z } from "zod";
import { execInSandbox } from "./sandbox";
import type { AgentToolDefinition } from "./types";

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

export const gitCloneSchema = z
  .object({
    repoUrl: z.string().describe("Repository URL to clone"),
    branch: z
      .string()
      .optional()
      .describe("Specific branch to clone (default: default branch)"),
    depth: z
      .number()
      .optional()
      .describe("Shallow clone depth (e.g. 1 for latest commit only)"),
  })
  .strict();

export const gitStatusSchema = z.object({}).strict();

export const gitDiffSchema = z
  .object({
    staged: z.boolean().optional().describe("Show staged changes only"),
    path: z.string().optional().describe("Specific file path to diff"),
  })
  .strict();

export const gitCommitSchema = z
  .object({
    message: z.string().describe("Commit message"),
    files: z
      .array(z.string())
      .optional()
      .describe("Specific files to stage (defaults to all changes)"),
  })
  .strict();

export const gitBranchSchema = z
  .object({
    name: z.string().optional().describe("Branch name to create and switch to"),
    list: z
      .boolean()
      .optional()
      .describe("List all branches instead of creating"),
  })
  .strict();

export const gitPushSchema = z
  .object({
    branch: z
      .string()
      .optional()
      .describe("Branch to push (default: current branch)"),
    setUpstream: z
      .boolean()
      .optional()
      .describe("Set upstream tracking (default: true for new branches)"),
  })
  .strict();

export const gitCreatePrSchema = z
  .object({
    title: z.string().describe("PR title"),
    body: z.string().describe("PR description (markdown)"),
    base: z.string().optional().describe("Base branch (default: main)"),
    draft: z.boolean().optional().describe("Create as draft PR"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const gitTools: AgentToolDefinition[] = [
  {
    name: "git_clone",
    description:
      "Clone a Git repository into the sandbox workspace. Optionally specify a branch or shallow depth.",
    inputSchema: {
      type: "object",
      properties: {
        repoUrl: { type: "string", description: "Repository URL to clone" },
        branch: {
          type: "string",
          description: "Specific branch to clone (default: default branch)",
        },
        depth: {
          type: "number",
          description: "Shallow clone depth (e.g. 1 for latest commit only)",
        },
      },
      required: ["repoUrl"],
    },
    zodSchema: gitCloneSchema,
    permissionLevel: "write",
    creditCost: 2,
    execute: async (input, ctx) => {
      const parsed = gitCloneSchema.parse(input);
      const parts = ["git", "clone"];
      if (parsed.depth && parsed.depth > 0) {
        parts.push(`--depth ${parsed.depth}`);
      }
      if (parsed.branch) {
        parts.push(`--branch "${parsed.branch}"`);
      }
      parts.push(`"${parsed.repoUrl}"`, "/workspace/repo");
      return await execInSandbox(parts.join(" "), ctx, 120_000);
    },
  },
  {
    name: "git_status",
    description:
      "Show the working tree status (modified, staged, untracked files)",
    inputSchema: { type: "object", properties: {}, required: [] },
    zodSchema: gitStatusSchema,
    permissionLevel: "read",
    creditCost: 1,
    execute: async (_input, ctx) => {
      return await execInSandbox("git status --porcelain", ctx);
    },
  },
  {
    name: "git_diff",
    description:
      "Show changes between commits, working tree, etc. Use staged=true to see only staged changes.",
    inputSchema: {
      type: "object",
      properties: {
        staged: { type: "boolean", description: "Show staged changes only" },
        path: { type: "string", description: "Specific file path to diff" },
      },
    },
    zodSchema: gitDiffSchema,
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parsed = gitDiffSchema.parse(input);
      const parts = ["git", "diff"];
      if (parsed.staged) {
        parts.push("--cached");
      }
      if (parsed.path) {
        parts.push(`"${parsed.path}"`);
      }
      // Limit diff output to prevent overwhelming context
      parts.push("| head -500");
      return await execInSandbox(parts.join(" "), ctx);
    },
  },
  {
    name: "git_commit",
    description:
      "Stage all changes and create a new commit with the given message",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit message" },
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "Specific files to stage (optional, defaults to all changes)",
        },
      },
      required: ["message"],
    },
    zodSchema: gitCommitSchema,
    permissionLevel: "write",
    creditCost: 2,
    execute: async (input, ctx) => {
      const parsed = gitCommitSchema.parse(input);

      let stageCmd: string;
      if (parsed.files && parsed.files.length > 0) {
        const quoted = parsed.files.map((f) => `"${f}"`).join(" ");
        stageCmd = `git add ${quoted}`;
      } else {
        stageCmd = "git add -A";
      }

      const escapedMsg = parsed.message.replace(/"/g, '\\"');
      const command = `${stageCmd} && git commit -m "${escapedMsg}"`;
      return await execInSandbox(command, ctx);
    },
  },
  {
    name: "git_branch",
    description: "Create and switch to a new branch, or list existing branches",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Branch name to create and switch to",
        },
        list: {
          type: "boolean",
          description: "List all branches instead of creating",
        },
      },
    },
    zodSchema: gitBranchSchema,
    permissionLevel: "write",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parsed = gitBranchSchema.parse(input);
      if (parsed.list) {
        return execInSandbox("git branch -a", ctx);
      }
      if (!parsed.name) {
        return {
          success: false,
          output: "",
          error: "Branch name is required when not listing",
        };
      }
      return await execInSandbox(`git checkout -b "${parsed.name}"`, ctx);
    },
  },
  {
    name: "git_push",
    description: "Push commits to the remote repository",
    inputSchema: {
      type: "object",
      properties: {
        branch: {
          type: "string",
          description: "Branch to push (default: current branch)",
        },
        setUpstream: {
          type: "boolean",
          description: "Set upstream tracking (default: true for new branches)",
        },
      },
    },
    zodSchema: gitPushSchema,
    permissionLevel: "admin",
    creditCost: 2,
    execute: async (input, ctx) => {
      const parsed = gitPushSchema.parse(input);
      const branch = parsed.branch || "HEAD";
      const setUpstream = parsed.setUpstream !== false;

      let command: string;
      if (setUpstream) {
        command = `git push -u origin ${branch}`;
      } else {
        command = `git push origin ${branch}`;
      }
      return await execInSandbox(command, ctx);
    },
  },
  {
    name: "git_create_pr",
    description:
      "Create a pull request on the remote repository using the GitHub CLI",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "PR title" },
        body: { type: "string", description: "PR description (markdown)" },
        base: { type: "string", description: "Base branch (default: main)" },
        draft: { type: "boolean", description: "Create as draft PR" },
      },
      required: ["title", "body"],
    },
    zodSchema: gitCreatePrSchema,
    permissionLevel: "admin",
    creditCost: 3,
    execute: async (input, ctx) => {
      const parsed = gitCreatePrSchema.parse(input);
      const title = parsed.title.replace(/"/g, '\\"');
      const body = parsed.body.replace(/"/g, '\\"');
      const base = parsed.base || "main";
      const draft = parsed.draft ? "--draft" : "";

      const command =
        `gh pr create --title "${title}" --body "${body}" --base "${base}" ${draft}`.trim();
      return await execInSandbox(command, ctx);
    },
  },
];
