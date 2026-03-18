import type { AgentToolDefinition } from "./types";
import { execInSandbox } from "./sandbox";

export const gitTools: AgentToolDefinition[] = [
  {
    name: "git_status",
    description: "Show the working tree status (modified, staged, untracked files)",
    inputSchema: { type: "object", properties: {}, required: [] },
    permissionLevel: "read",
    creditCost: 1,
    execute: async (_input, ctx) => {
      return execInSandbox("git status --porcelain", ctx);
    },
  },
  {
    name: "git_diff",
    description: "Show changes between commits, working tree, etc. Use staged=true to see only staged changes.",
    inputSchema: {
      type: "object",
      properties: {
        staged: { type: "boolean", description: "Show staged changes only" },
        path: { type: "string", description: "Specific file path to diff" },
      },
    },
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parts = ["git", "diff"];
      if (input.staged) parts.push("--cached");
      if (input.path) parts.push(`"${input.path}"`);
      // Limit diff output to prevent overwhelming context
      parts.push("| head -500");
      return execInSandbox(parts.join(" "), ctx);
    },
  },
  {
    name: "git_commit",
    description: "Stage all changes and create a new commit with the given message",
    inputSchema: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit message" },
        files: {
          type: "array",
          items: { type: "string" },
          description: "Specific files to stage (optional, defaults to all changes)",
        },
      },
      required: ["message"],
    },
    permissionLevel: "write",
    creditCost: 2,
    execute: async (input, ctx) => {
      const message = input.message as string;
      const files = input.files as string[] | undefined;

      let stageCmd: string;
      if (files && files.length > 0) {
        const quoted = files.map((f) => `"${f}"`).join(" ");
        stageCmd = `git add ${quoted}`;
      } else {
        stageCmd = "git add -A";
      }

      const escapedMsg = message.replace(/"/g, '\\"');
      const command = `${stageCmd} && git commit -m "${escapedMsg}"`;
      return execInSandbox(command, ctx);
    },
  },
  {
    name: "git_branch",
    description: "Create and switch to a new branch, or list existing branches",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Branch name to create and switch to" },
        list: { type: "boolean", description: "List all branches instead of creating" },
      },
    },
    permissionLevel: "write",
    creditCost: 1,
    execute: async (input, ctx) => {
      if (input.list) {
        return execInSandbox("git branch -a", ctx);
      }
      if (!input.name) {
        return { success: false, output: "", error: "Branch name is required when not listing" };
      }
      return execInSandbox(`git checkout -b "${input.name}"`, ctx);
    },
  },
  {
    name: "git_push",
    description: "Push commits to the remote repository",
    inputSchema: {
      type: "object",
      properties: {
        branch: { type: "string", description: "Branch to push (default: current branch)" },
        setUpstream: { type: "boolean", description: "Set upstream tracking (default: true for new branches)" },
      },
    },
    permissionLevel: "admin",
    creditCost: 2,
    execute: async (input, ctx) => {
      const branch = (input.branch as string) || "HEAD";
      const setUpstream = input.setUpstream !== false;

      let command: string;
      if (setUpstream) {
        command = `git push -u origin ${branch}`;
      } else {
        command = `git push origin ${branch}`;
      }
      return execInSandbox(command, ctx);
    },
  },
  {
    name: "git_create_pr",
    description: "Create a pull request on the remote repository using the GitHub CLI",
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
    permissionLevel: "admin",
    creditCost: 3,
    execute: async (input, ctx) => {
      const title = (input.title as string).replace(/"/g, '\\"');
      const body = (input.body as string).replace(/"/g, '\\"');
      const base = (input.base as string) || "main";
      const draft = input.draft ? "--draft" : "";

      const command = `gh pr create --title "${title}" --body "${body}" --base "${base}" ${draft}`.trim();
      return execInSandbox(command, ctx);
    },
  },
];
