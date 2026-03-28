/**
 * Git Workflow Engine — GAP-012
 *
 * Automates the full git workflow for agent-driven code changes:
 * branch creation, conventional commits, push, PR creation, and
 * conflict resolution. Built on top of the existing WorktreeManager
 * and PRWorkflow.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:git:workflow-engine");
const PR_URL_REGEX = /\/pull\/(\d+)/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConflictResolution {
  /** The file that had a conflict */
  filePath: string;
  /** How the conflict was resolved */
  resolution: "ours" | "theirs" | "manual";
  /** Whether resolution was successful */
  success: boolean;
}

export interface PRCreateOptions {
  /** Base branch to merge into (default: main) */
  baseBranch: string;
  /** PR description body */
  body: string;
  /** Create as draft PR */
  draft?: boolean;
  /** PR title */
  title: string;
}

export interface PRCreateResult {
  /** PR number on the remote */
  prNumber: number;
  /** Full PR URL */
  prUrl: string;
}

export interface CommitResult {
  /** The commit SHA */
  commitSha: string;
  /** Files included in the commit */
  files: string[];
  /** The commit message */
  message: string;
}

export interface SandboxExecResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface SandboxExecutor {
  exec(
    sandboxId: string,
    command: string,
    timeoutMs: number
  ): Promise<SandboxExecResult>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BRANCH_PREFIX_MAP: Record<string, string> = {
  feature: "feat",
  bugfix: "fix",
  fix: "fix",
  refactor: "refactor",
  docs: "docs",
  test: "test",
  chore: "chore",
};

const WORKSPACE_DIR = "/workspace/repo";

/** Regex for sanitizing branch names */
const BRANCH_SANITIZE_RE = /[^a-z0-9-]/g;
const MULTI_DASH_RE = /-+/g;
const TRAILING_DASH_RE = /-$/;

/** Max branch name length */
const MAX_BRANCH_LENGTH = 60;

// ---------------------------------------------------------------------------
// Shell encoding
// ---------------------------------------------------------------------------

function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// ---------------------------------------------------------------------------
// GitWorkflowEngine
// ---------------------------------------------------------------------------

export class GitWorkflowEngine {
  private readonly executor: SandboxExecutor;

  constructor(executor: SandboxExecutor) {
    this.executor = executor;
  }

  /**
   * Create a feature branch with a name derived from the task description.
   * Uses conventional naming: feat/short-description, fix/short-description, etc.
   */
  async createFeatureBranch(
    sandboxId: string,
    taskDescription: string
  ): Promise<string> {
    const branchName = this.generateBranchName(taskDescription);

    logger.info(
      { sandboxId, branchName, taskDescription: taskDescription.slice(0, 100) },
      "Creating feature branch"
    );

    // Ensure we are on the latest default branch first
    await this.executor.exec(
      sandboxId,
      `cd ${WORKSPACE_DIR} && git fetch origin 2>/dev/null || true`,
      30_000
    );

    const result = await this.executor.exec(
      sandboxId,
      `cd ${WORKSPACE_DIR} && git checkout -b ${shellEscape(branchName)}`,
      15_000
    );

    if (result.exitCode !== 0) {
      // Branch may already exist, try switching to it
      const switchResult = await this.executor.exec(
        sandboxId,
        `cd ${WORKSPACE_DIR} && git checkout ${shellEscape(branchName)}`,
        15_000
      );
      if (switchResult.exitCode !== 0) {
        throw new Error(
          `Failed to create branch ${branchName}: ${result.stderr || switchResult.stderr}`
        );
      }
    }

    logger.info({ sandboxId, branchName }, "Feature branch created");
    return branchName;
  }

  /**
   * Stage files and create a commit with a conventional commit message.
   */
  async commitChanges(
    sandboxId: string,
    files: string[],
    message: string
  ): Promise<CommitResult> {
    logger.info(
      { sandboxId, fileCount: files.length, message: message.slice(0, 80) },
      "Committing changes"
    );

    // Ensure git user is configured
    await this.ensureGitConfig(sandboxId);

    // Stage files
    if (files.length > 0) {
      const fileArgs = files.map(shellEscape).join(" ");
      const addResult = await this.executor.exec(
        sandboxId,
        `cd ${WORKSPACE_DIR} && git add ${fileArgs}`,
        30_000
      );
      if (addResult.exitCode !== 0) {
        throw new Error(`Failed to stage files: ${addResult.stderr}`);
      }
    } else {
      const addResult = await this.executor.exec(
        sandboxId,
        `cd ${WORKSPACE_DIR} && git add -A`,
        30_000
      );
      if (addResult.exitCode !== 0) {
        throw new Error(`Failed to stage files: ${addResult.stderr}`);
      }
    }

    // Check there are staged changes
    const statusResult = await this.executor.exec(
      sandboxId,
      `cd ${WORKSPACE_DIR} && git diff --cached --stat`,
      10_000
    );
    if (!statusResult.stdout.trim()) {
      throw new Error("No changes to commit");
    }

    // Commit
    const commitResult = await this.executor.exec(
      sandboxId,
      `cd ${WORKSPACE_DIR} && git commit -m ${shellEscape(message)}`,
      30_000
    );
    if (commitResult.exitCode !== 0) {
      throw new Error(`Commit failed: ${commitResult.stderr}`);
    }

    // Get the commit SHA
    const shaResult = await this.executor.exec(
      sandboxId,
      `cd ${WORKSPACE_DIR} && git rev-parse HEAD`,
      10_000
    );
    const commitSha = shaResult.stdout.trim();

    logger.info({ sandboxId, commitSha, message }, "Changes committed");

    return { commitSha, files, message };
  }

  /**
   * Push the current branch and create a pull request on the remote.
   */
  async pushAndCreatePR(
    sandboxId: string,
    opts: PRCreateOptions
  ): Promise<PRCreateResult> {
    const baseBranch = opts.baseBranch || "main";

    // Get current branch name
    const branchResult = await this.executor.exec(
      sandboxId,
      `cd ${WORKSPACE_DIR} && git rev-parse --abbrev-ref HEAD`,
      10_000
    );
    const branch = branchResult.stdout.trim();

    logger.info(
      { sandboxId, branch, baseBranch, title: opts.title },
      "Pushing branch and creating PR"
    );

    // Push branch to remote
    const pushResult = await this.executor.exec(
      sandboxId,
      `cd ${WORKSPACE_DIR} && git push -u origin ${shellEscape(branch)}`,
      120_000
    );
    if (pushResult.exitCode !== 0) {
      throw new Error(`Push failed: ${pushResult.stderr}`);
    }

    // Create PR using gh CLI
    const draftFlag = opts.draft ? " --draft" : "";
    const prResult = await this.executor.exec(
      sandboxId,
      `cd ${WORKSPACE_DIR} && gh pr create --title ${shellEscape(opts.title)} --body ${shellEscape(opts.body)} --base ${shellEscape(baseBranch)}${draftFlag}`,
      60_000
    );

    if (prResult.exitCode !== 0) {
      throw new Error(`PR creation failed: ${prResult.stderr}`);
    }

    // Parse PR URL and number from gh output
    const prUrl = prResult.stdout.trim();
    const prNumberMatch = prUrl.match(PR_URL_REGEX);
    const prNumber = prNumberMatch?.[1]
      ? Number.parseInt(prNumberMatch[1], 10)
      : 0;

    logger.info({ sandboxId, prUrl, prNumber }, "Pull request created");

    return { prUrl, prNumber };
  }

  /**
   * Attempt to resolve merge conflicts in the current branch.
   * Tries to merge the base branch and auto-resolve simple conflicts.
   */
  async resolveConflicts(sandboxId: string): Promise<ConflictResolution[]> {
    const resolutions: ConflictResolution[] = [];

    logger.info({ sandboxId }, "Attempting to resolve merge conflicts");

    // Get list of conflicted files
    const statusResult = await this.executor.exec(
      sandboxId,
      `cd ${WORKSPACE_DIR} && git diff --name-only --diff-filter=U`,
      10_000
    );

    const conflictedFiles = statusResult.stdout
      .trim()
      .split("\n")
      .filter(Boolean);

    if (conflictedFiles.length === 0) {
      logger.info({ sandboxId }, "No merge conflicts found");
      return resolutions;
    }

    for (const filePath of conflictedFiles) {
      try {
        // Try to auto-resolve by accepting ours (the agent's changes)
        const resolveResult = await this.executor.exec(
          sandboxId,
          `cd ${WORKSPACE_DIR} && git checkout --ours ${shellEscape(filePath)} && git add ${shellEscape(filePath)}`,
          15_000
        );

        if (resolveResult.exitCode === 0) {
          resolutions.push({
            filePath,
            resolution: "ours",
            success: true,
          });
        } else {
          resolutions.push({
            filePath,
            resolution: "manual",
            success: false,
          });
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { sandboxId, filePath, error: msg },
          "Conflict resolution failed"
        );
        resolutions.push({
          filePath,
          resolution: "manual",
          success: false,
        });
      }
    }

    // If all conflicts resolved, complete the merge
    const allResolved = resolutions.every((r) => r.success);
    if (allResolved && resolutions.length > 0) {
      await this.executor.exec(
        sandboxId,
        `cd ${WORKSPACE_DIR} && git commit --no-edit`,
        15_000
      );
    }

    logger.info(
      {
        sandboxId,
        total: resolutions.length,
        resolved: resolutions.filter((r) => r.success).length,
      },
      "Conflict resolution completed"
    );

    return resolutions;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Generate a branch name from a task description.
   */
  private generateBranchName(taskDescription: string): string {
    const lower = taskDescription.toLowerCase();

    // Detect the task type prefix
    let prefix = "feat";
    for (const [keyword, branchPrefix] of Object.entries(BRANCH_PREFIX_MAP)) {
      if (lower.includes(keyword)) {
        prefix = branchPrefix;
        break;
      }
    }

    // Create a slug from the task description
    const slug = lower
      .replace(BRANCH_SANITIZE_RE, "-")
      .replace(MULTI_DASH_RE, "-")
      .replace(TRAILING_DASH_RE, "")
      .slice(0, MAX_BRANCH_LENGTH);

    const shortId = generateId("br").slice(0, 8);
    return `${prefix}/${slug}-${shortId}`;
  }

  /**
   * Ensure git user config is set in the sandbox.
   */
  private async ensureGitConfig(sandboxId: string): Promise<void> {
    const nameResult = await this.executor.exec(
      sandboxId,
      `cd ${WORKSPACE_DIR} && git config user.name || echo ""`,
      10_000
    );

    if (!nameResult.stdout.trim()) {
      await this.executor.exec(
        sandboxId,
        `cd ${WORKSPACE_DIR} && git config user.name "Prometheus Agent" && git config user.email "agent@prometheus.dev"`,
        10_000
      );
    }
  }
}
