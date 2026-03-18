import { createLogger } from "@prometheus/logger";
import type { ContainerManager } from "./container";

const logger = createLogger("sandbox-manager:git-ops");

export interface GitCloneOptions {
  branch?: string;
  depth?: number;
  repoUrl: string;
}

export interface GitCommitOptions {
  authorEmail?: string;
  authorName?: string;
  files?: string[];
  message: string;
}

export interface GitDiffResult {
  files: Array<{
    path: string;
    status: "added" | "modified" | "deleted" | "renamed";
    additions: number;
    deletions: number;
  }>;
  rawDiff: string;
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}

export class GitOperations {
  private readonly containerManager: ContainerManager;

  constructor(containerManager: ContainerManager) {
    this.containerManager = containerManager;
  }

  /**
   * Clone a repository into the sandbox workspace.
   */
  async clone(
    sandboxId: string,
    options: GitCloneOptions
  ): Promise<{ success: boolean; error?: string }> {
    const { repoUrl, branch, depth } = options;

    let cmd = "git clone";
    if (depth && depth > 0) {
      cmd += ` --depth ${depth}`;
    }
    if (branch) {
      cmd += ` --branch ${encodeShellArg(branch)}`;
    }
    cmd += ` ${encodeShellArg(repoUrl)} /workspace/repo`;

    logger.info({ sandboxId, repoUrl, branch }, "Cloning repository");

    const result = await this.containerManager.exec(sandboxId, cmd, 120_000);

    if (result.exitCode !== 0) {
      logger.error({ sandboxId, stderr: result.stderr }, "Git clone failed");
      return { success: false, error: result.stderr };
    }

    // Configure git safe directory
    await this.containerManager.exec(
      sandboxId,
      "git config --global --add safe.directory /workspace/repo",
      10_000
    );

    logger.info({ sandboxId }, "Repository cloned successfully");
    return { success: true };
  }

  /**
   * Create a new branch in the sandbox repo.
   */
  async createBranch(
    sandboxId: string,
    branchName: string
  ): Promise<{ success: boolean; error?: string }> {
    const safeBranch = encodeShellArg(branchName);

    // Create and checkout the new branch
    const result = await this.containerManager.exec(
      sandboxId,
      `cd /workspace/repo && git checkout -b ${safeBranch}`,
      15_000
    );

    if (result.exitCode !== 0) {
      logger.error(
        { sandboxId, branchName, stderr: result.stderr },
        "Failed to create branch"
      );
      return { success: false, error: result.stderr };
    }

    logger.info({ sandboxId, branchName }, "Branch created");
    return { success: true };
  }

  /**
   * Stage files and commit changes.
   */
  async commit(
    sandboxId: string,
    options: GitCommitOptions
  ): Promise<{ success: boolean; commitSha?: string; error?: string }> {
    const { message, files, authorName, authorEmail } = options;
    const workDir = "/workspace/repo";

    // Configure author if provided
    if (authorName) {
      await this.containerManager.exec(
        sandboxId,
        `cd ${workDir} && git config user.name ${encodeShellArg(authorName)}`,
        10_000
      );
    }
    if (authorEmail) {
      await this.containerManager.exec(
        sandboxId,
        `cd ${workDir} && git config user.email ${encodeShellArg(authorEmail)}`,
        10_000
      );
    }

    // Ensure default author exists
    const configCheck = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git config user.name || echo ""`,
      10_000
    );
    if (!configCheck.stdout.trim()) {
      await this.containerManager.exec(
        sandboxId,
        `cd ${workDir} && git config user.name "Prometheus Agent" && git config user.email "agent@prometheus.dev"`,
        10_000
      );
    }

    // Stage files
    if (files && files.length > 0) {
      const safeFiles = files.map(encodeShellArg).join(" ");
      const addResult = await this.containerManager.exec(
        sandboxId,
        `cd ${workDir} && git add ${safeFiles}`,
        30_000
      );
      if (addResult.exitCode !== 0) {
        return {
          success: false,
          error: `Failed to stage files: ${addResult.stderr}`,
        };
      }
    } else {
      // Stage all changes
      const addResult = await this.containerManager.exec(
        sandboxId,
        `cd ${workDir} && git add -A`,
        30_000
      );
      if (addResult.exitCode !== 0) {
        return {
          success: false,
          error: `Failed to stage files: ${addResult.stderr}`,
        };
      }
    }

    // Check if there are staged changes
    const statusResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git diff --cached --stat`,
      10_000
    );
    if (!statusResult.stdout.trim()) {
      return { success: false, error: "No changes to commit" };
    }

    // Commit
    const commitResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git commit -m ${encodeShellArg(message)}`,
      30_000
    );

    if (commitResult.exitCode !== 0) {
      logger.error(
        { sandboxId, stderr: commitResult.stderr },
        "Git commit failed"
      );
      return { success: false, error: commitResult.stderr };
    }

    // Get commit SHA
    const shaResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git rev-parse HEAD`,
      10_000
    );

    const commitSha = shaResult.stdout.trim();
    logger.info({ sandboxId, commitSha, message }, "Changes committed");

    return { success: true, commitSha };
  }

  /**
   * Push current branch to remote.
   */
  async push(
    sandboxId: string,
    options?: { remote?: string; force?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    const remote = options?.remote ?? "origin";
    const force = options?.force ? " --force-with-lease" : "";
    const workDir = "/workspace/repo";

    // Get current branch name
    const branchResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git rev-parse --abbrev-ref HEAD`,
      10_000
    );
    const branch = branchResult.stdout.trim();

    const result = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git push${force} ${encodeShellArg(remote)} ${encodeShellArg(branch)}`,
      120_000
    );

    if (result.exitCode !== 0) {
      logger.error({ sandboxId, stderr: result.stderr }, "Git push failed");
      return { success: false, error: result.stderr };
    }

    logger.info({ sandboxId, remote, branch }, "Changes pushed");
    return { success: true };
  }

  /**
   * Get the current diff of the working directory.
   */
  async diff(
    sandboxId: string,
    options?: { staged?: boolean }
  ): Promise<GitDiffResult> {
    const workDir = "/workspace/repo";
    const stagedFlag = options?.staged ? " --cached" : "";

    // Get raw diff
    const diffResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git diff${stagedFlag}`,
      30_000
    );

    // Get diff stats
    const _statResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git diff${stagedFlag} --stat`,
      10_000
    );

    // Get file-level diff info using numstat
    const numstatResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git diff${stagedFlag} --numstat`,
      10_000
    );

    // Get status to determine added/modified/deleted
    const statusCmd = options?.staged
      ? `cd ${workDir} && git diff --cached --name-status`
      : `cd ${workDir} && git diff --name-status`;
    const statusResult = await this.containerManager.exec(
      sandboxId,
      statusCmd,
      10_000
    );

    const files: GitDiffResult["files"] = [];
    let totalInsertions = 0;
    let totalDeletions = 0;

    // Parse numstat output (additions\tdeletions\tfilename)
    const numstatLines = numstatResult.stdout
      .trim()
      .split("\n")
      .filter(Boolean);
    const statusLines = statusResult.stdout.trim().split("\n").filter(Boolean);

    const statusMap = new Map<string, string>();
    for (const line of statusLines) {
      const [statusCode, ...pathParts] = line.split("\t");
      if (statusCode && pathParts.length > 0) {
        statusMap.set(pathParts.at(-1) as string, statusCode.charAt(0));
      }
    }

    for (const line of numstatLines) {
      const parts = line.split("\t");
      if (parts.length < 3) {
        continue;
      }

      const additions = Number.parseInt(parts[0] as string, 10) || 0;
      const deletions = Number.parseInt(parts[1] as string, 10) || 0;
      const filePath = parts[2] as string;

      totalInsertions += additions;
      totalDeletions += deletions;

      const statusCode = statusMap.get(filePath) ?? "M";
      let status: "added" | "modified" | "deleted" | "renamed" = "modified";
      switch (statusCode) {
        case "A":
          status = "added";
          break;
        case "D":
          status = "deleted";
          break;
        case "R":
          status = "renamed";
          break;
        default:
          status = "modified";
          break;
      }

      files.push({ path: filePath, status, additions, deletions });
    }

    return {
      files,
      rawDiff: diffResult.stdout,
      stats: {
        filesChanged: files.length,
        insertions: totalInsertions,
        deletions: totalDeletions,
      },
    };
  }

  /**
   * Get the current branch name.
   */
  async getCurrentBranch(sandboxId: string): Promise<string> {
    const result = await this.containerManager.exec(
      sandboxId,
      "cd /workspace/repo && git rev-parse --abbrev-ref HEAD",
      10_000
    );
    return result.stdout.trim();
  }

  /**
   * Get the git log.
   */
  async log(
    sandboxId: string,
    maxCount = 10
  ): Promise<
    Array<{ sha: string; message: string; author: string; date: string }>
  > {
    const result = await this.containerManager.exec(
      sandboxId,
      `cd /workspace/repo && git log --format="%H|||%s|||%an|||%aI" -n ${maxCount}`,
      10_000
    );

    if (!result.stdout.trim()) {
      return [];
    }

    return result.stdout
      .trim()
      .split("\n")
      .map((line) => {
        const [sha, message, author, date] = line.split("|||");
        return {
          sha: sha ?? "",
          message: message ?? "",
          author: author ?? "",
          date: date ?? "",
        };
      });
  }
}

/**
 * Shell-safe argument encoding.
 */
function encodeShellArg(arg: string): string {
  // Single-quote the argument and escape any embedded single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
