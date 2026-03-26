import { z } from "zod";
import { execInSandbox } from "./sandbox";
import type { AgentToolDefinition } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default working directory for git operations inside the sandbox */
const REPO_DIR = "/workspace/repo";

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
    token: z
      .string()
      .optional()
      .describe(
        "OAuth token for private repos (injected by platform, not set by agent)"
      ),
  })
  .strict();

export const gitStatusSchema = z
  .object({
    short: z
      .boolean()
      .optional()
      .describe("Use short format (--porcelain). Default: true"),
  })
  .strict();

export const gitDiffSchema = z
  .object({
    staged: z.boolean().optional().describe("Show staged changes only"),
    path: z.string().optional().describe("Specific file path to diff"),
  })
  .strict();

export const gitAddSchema = z
  .object({
    files: z
      .array(z.string())
      .describe("Files to stage. Use ['.'] or ['--all'] to stage everything."),
  })
  .strict();

export const gitCommitSchema = z
  .object({
    message: z.string().describe("Commit message"),
    files: z
      .array(z.string())
      .optional()
      .describe("Specific files to stage before committing (defaults to all)"),
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

export const gitCheckoutSchema = z
  .object({
    ref: z.string().describe("Branch name, tag, or commit SHA to check out"),
    create: z
      .boolean()
      .optional()
      .describe("Create the branch if it does not exist (-b flag)"),
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
    force: z
      .boolean()
      .optional()
      .describe("Use --force-with-lease for safe force push"),
  })
  .strict();

export const gitLogSchema = z
  .object({
    maxCount: z
      .number()
      .optional()
      .describe("Maximum number of commits to show (default: 20)"),
    oneline: z
      .boolean()
      .optional()
      .describe("Use --oneline format (default: true)"),
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
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrap a command so it runs inside the repository directory.
 * Ensures git operations target the cloned repo.
 */
function inRepo(cmd: string): string {
  return `cd ${REPO_DIR} && ${cmd}`;
}

/**
 * Build an authenticated clone URL by embedding an OAuth token.
 * Converts github.com/owner/repo URLs to https://x-access-token:TOKEN@github.com/owner/repo
 */
function buildAuthenticatedUrl(repoUrl: string, token: string): string {
  try {
    const url = new URL(repoUrl);
    url.username = "x-access-token";
    url.password = token;
    return url.toString();
  } catch {
    // If repoUrl isn't a valid URL (e.g. SSH), try a simple replacement
    if (repoUrl.startsWith("https://")) {
      return repoUrl.replace("https://", `https://x-access-token:${token}@`);
    }
    return repoUrl;
  }
}

// ---------------------------------------------------------------------------
// Tool Definitions
// ---------------------------------------------------------------------------

export const gitTools: AgentToolDefinition[] = [
  // ---- git_clone ----
  {
    name: "git_clone",
    description:
      "Clone a Git repository into the sandbox workspace. Supports private repos when a token is provided. Optionally specify a branch or shallow depth.",
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
        token: {
          type: "string",
          description:
            "OAuth token for private repos (injected by platform, not set by agent)",
        },
      },
      required: ["repoUrl"],
    },
    zodSchema: gitCloneSchema,
    permissionLevel: "write",
    creditCost: 2,
    execute: async (input, ctx) => {
      const parsed = gitCloneSchema.parse(input);

      // Build the clone URL, injecting auth token if provided
      const cloneUrl = parsed.token
        ? buildAuthenticatedUrl(parsed.repoUrl, parsed.token)
        : parsed.repoUrl;

      const parts = ["git", "clone"];
      if (parsed.depth && parsed.depth > 0) {
        parts.push(`--depth ${parsed.depth}`);
      }
      if (parsed.branch) {
        parts.push(`--branch '${parsed.branch.replace(/'/g, "'\\''")}'`);
      }
      parts.push(`'${cloneUrl.replace(/'/g, "'\\''")}'`, REPO_DIR);

      // After clone, set up safe.directory, default user config, and
      // configure credential helper so subsequent push/pull works
      const setupCmds = [
        `git config --global --add safe.directory ${REPO_DIR}`,
        `cd ${REPO_DIR} && git config user.name "Prometheus Agent" || true`,
        `cd ${REPO_DIR} && git config user.email "agent@prometheus.dev" || true`,
      ];

      // If we have a token, set up a credential helper for future push/pull
      if (parsed.token) {
        setupCmds.push(
          `cd ${REPO_DIR} && git config credential.helper 'store --file=/tmp/.git-credentials'`,
          `echo 'https://x-access-token:${parsed.token.replace(/'/g, "'\\''")}@github.com' > /tmp/.git-credentials`,
          // Remove token from remote URL to keep it out of .git/config
          `cd ${REPO_DIR} && git remote set-url origin '${parsed.repoUrl.replace(/'/g, "'\\''")}'`
        );
      }

      const fullCommand = `${parts.join(" ")} && ${setupCmds.join(" && ")}`;
      return await execInSandbox(fullCommand, ctx, 120_000);
    },
  },

  // ---- git_status ----
  {
    name: "git_status",
    description:
      "Show the working tree status (modified, staged, untracked files). Returns porcelain output by default for easy parsing.",
    inputSchema: {
      type: "object",
      properties: {
        short: {
          type: "boolean",
          description: "Use short format (--porcelain). Default: true",
        },
      },
    },
    zodSchema: gitStatusSchema,
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parsed = gitStatusSchema.parse(input);
      const useShort = parsed.short !== false;
      const cmd = useShort ? "git status --porcelain" : "git status";
      return await execInSandbox(inRepo(cmd), ctx);
    },
  },

  // ---- git_diff ----
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
        parts.push(`'${parsed.path.replace(/'/g, "'\\''")}'`);
      }
      // Limit diff output to prevent overwhelming context
      parts.push("| head -500");
      return await execInSandbox(inRepo(parts.join(" ")), ctx);
    },
  },

  // ---- git_add ----
  {
    name: "git_add",
    description:
      "Stage files for the next commit. Specify individual file paths, or use ['.'] to stage all changes.",
    inputSchema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string" },
          description:
            "Files to stage. Use ['.'] or ['--all'] to stage everything.",
        },
      },
      required: ["files"],
    },
    zodSchema: gitAddSchema,
    permissionLevel: "write",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parsed = gitAddSchema.parse(input);
      if (parsed.files.length === 0) {
        return { success: false, output: "", error: "No files specified" };
      }

      const quoted = parsed.files
        .map((f) => `'${f.replace(/'/g, "'\\''")}'`)
        .join(" ");
      return await execInSandbox(inRepo(`git add ${quoted}`), ctx);
    },
  },

  // ---- git_commit ----
  {
    name: "git_commit",
    description:
      "Stage changes and create a new commit with the given message. If files are specified, only those are staged; otherwise all changes are staged.",
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
        const quoted = parsed.files
          .map((f) => `'${f.replace(/'/g, "'\\''")}'`)
          .join(" ");
        stageCmd = `git add ${quoted}`;
      } else {
        stageCmd = "git add -A";
      }

      const safeMsg = parsed.message.replace(/'/g, "'\\''");
      const command = `${stageCmd} && git commit -m '${safeMsg}'`;
      return await execInSandbox(inRepo(command), ctx);
    },
  },

  // ---- git_branch ----
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
        return execInSandbox(inRepo("git branch -a"), ctx);
      }
      if (!parsed.name) {
        return {
          success: false,
          output: "",
          error: "Branch name is required when not listing",
        };
      }
      const safeName = parsed.name.replace(/'/g, "'\\''");
      return await execInSandbox(inRepo(`git checkout -b '${safeName}'`), ctx);
    },
  },

  // ---- git_checkout ----
  {
    name: "git_checkout",
    description:
      "Switch to an existing branch, tag, or commit. Optionally create the branch if it does not exist.",
    inputSchema: {
      type: "object",
      properties: {
        ref: {
          type: "string",
          description: "Branch name, tag, or commit SHA to check out",
        },
        create: {
          type: "boolean",
          description: "Create the branch if it does not exist (-b flag)",
        },
      },
      required: ["ref"],
    },
    zodSchema: gitCheckoutSchema,
    permissionLevel: "write",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parsed = gitCheckoutSchema.parse(input);
      const safeRef = parsed.ref.replace(/'/g, "'\\''");
      const flag = parsed.create ? " -b" : "";
      return await execInSandbox(
        inRepo(`git checkout${flag} '${safeRef}'`),
        ctx
      );
    },
  },

  // ---- git_push ----
  {
    name: "git_push",
    description:
      "Push commits to the remote repository. Requires authentication to be configured (via git_clone with token).",
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
        force: {
          type: "boolean",
          description: "Use --force-with-lease for safe force push",
        },
      },
    },
    zodSchema: gitPushSchema,
    permissionLevel: "admin",
    creditCost: 2,
    execute: async (input, ctx) => {
      const parsed = gitPushSchema.parse(input);

      // Determine the branch to push
      const branch = parsed.branch || "HEAD";
      const setUpstream = parsed.setUpstream !== false;
      const forceFlag = parsed.force ? " --force-with-lease" : "";

      let command: string;
      if (setUpstream) {
        command = `git push${forceFlag} -u origin ${branch}`;
      } else {
        command = `git push${forceFlag} origin ${branch}`;
      }

      return await execInSandbox(inRepo(command), ctx, 120_000);
    },
  },

  // ---- git_log ----
  {
    name: "git_log",
    description:
      "Show the commit history. Defaults to the last 20 commits in oneline format.",
    inputSchema: {
      type: "object",
      properties: {
        maxCount: {
          type: "number",
          description: "Maximum number of commits to show (default: 20)",
        },
        oneline: {
          type: "boolean",
          description: "Use --oneline format (default: true)",
        },
      },
    },
    zodSchema: gitLogSchema,
    permissionLevel: "read",
    creditCost: 1,
    execute: async (input, ctx) => {
      const parsed = gitLogSchema.parse(input);
      const maxCount = parsed.maxCount ?? 20;
      const useOneline = parsed.oneline !== false;
      const format = useOneline ? " --oneline" : "";
      return await execInSandbox(
        inRepo(`git log${format} -n ${maxCount}`),
        ctx
      );
    },
  },

  // ---- git_create_pr ----
  {
    name: "git_create_pr",
    description:
      "Create a pull request on the remote repository using the GitHub CLI. Requires GH_TOKEN to be set in the sandbox environment.",
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
      const title = parsed.title.replace(/'/g, "'\\''");
      const body = parsed.body.replace(/'/g, "'\\''");
      const base = parsed.base || "main";
      const draftFlag = parsed.draft ? " --draft" : "";

      const command = `gh pr create --title '${title}' --body '${body}' --base '${base}'${draftFlag}`;
      return await execInSandbox(inRepo(command), ctx, 60_000);
    },
  },
];
