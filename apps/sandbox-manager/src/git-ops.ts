import { createLogger } from "@prometheus/logger";
import type { ContainerManager } from "./container";

const logger = createLogger("sandbox-manager:git-ops");

/** Default working directory for git operations inside the sandbox */
const REPO_DIR = "/workspace/repo";

export interface GitCloneOptions {
  branch?: string;
  depth?: number;
  repoUrl: string;
  /** OAuth token for HTTPS authentication (private repos) */
  token?: string;
}

export interface GitCommitOptions {
  authorEmail?: string;
  authorName?: string;
  files?: string[];
  message: string;
  signingKey?: string;
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

export interface GitStatusEntry {
  path: string;
  status: string;
}

export interface WorktreeInfo {
  branch: string;
  isMainWorktree: boolean;
  path: string;
}

export class GitOperations {
  private readonly containerManager: ContainerManager;

  constructor(containerManager: ContainerManager) {
    this.containerManager = containerManager;
  }

  // ─── Authentication ────────────────────────────────────────────────────

  /**
   * Configure git authentication inside the sandbox.
   * Sets up a credential helper backed by a file, and writes the token
   * so that subsequent push/pull operations authenticate automatically.
   */
  async setupAuth(
    sandboxId: string,
    options: {
      token: string;
      host?: string;
      username?: string;
    }
  ): Promise<{ success: boolean; error?: string }> {
    const host = options.host ?? "github.com";
    const username = options.username ?? "x-access-token";

    logger.info({ sandboxId, host }, "Setting up git authentication");

    // Configure the credential store helper
    const credResult = await this.containerManager.exec(
      sandboxId,
      `git config --global credential.helper 'store --file=/tmp/.git-credentials'`,
      10_000
    );
    if (credResult.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to configure credential helper: ${credResult.stderr}`,
      };
    }

    // Write the credential entry
    const credLine = `https://${encodeShellArg(username).slice(1, -1)}:${encodeShellArg(options.token).slice(1, -1)}@${host}`;
    const writeResult = await this.containerManager.exec(
      sandboxId,
      `printf '%s\\n' ${encodeShellArg(credLine)} > /tmp/.git-credentials && chmod 600 /tmp/.git-credentials`,
      10_000
    );
    if (writeResult.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to write credentials: ${writeResult.stderr}`,
      };
    }

    // Also set GH_TOKEN so that `gh` CLI works for PR creation
    const ghTokenResult = await this.containerManager.exec(
      sandboxId,
      `echo 'export GH_TOKEN=${encodeShellArg(options.token)}' >> /etc/profile.d/github.sh`,
      10_000
    );
    if (ghTokenResult.exitCode !== 0) {
      logger.warn(
        { sandboxId, stderr: ghTokenResult.stderr },
        "Failed to set GH_TOKEN profile (gh CLI may not work)"
      );
    }

    logger.info({ sandboxId, host }, "Git authentication configured");
    return { success: true };
  }

  // ─── Clone ─────────────────────────────────────────────────────────────

  /**
   * Clone a repository into the sandbox workspace.
   * If a token is provided, injects it for HTTPS authentication.
   */
  async clone(
    sandboxId: string,
    options: GitCloneOptions
  ): Promise<{ success: boolean; error?: string }> {
    const { repoUrl, branch, depth, token } = options;

    // Build clone URL with optional authentication
    let cloneUrl = repoUrl;
    if (token && repoUrl.startsWith("https://")) {
      try {
        const url = new URL(repoUrl);
        url.username = "x-access-token";
        url.password = token;
        cloneUrl = url.toString();
      } catch {
        cloneUrl = repoUrl.replace(
          "https://",
          `https://x-access-token:${token}@`
        );
      }
    }

    let cmd = "git clone";
    if (depth && depth > 0) {
      cmd += ` --depth ${depth}`;
    }
    if (branch) {
      cmd += ` --branch ${encodeShellArg(branch)}`;
    }
    cmd += ` ${encodeShellArg(cloneUrl)} ${REPO_DIR}`;

    logger.info({ sandboxId, repoUrl, branch }, "Cloning repository");

    const result = await this.containerManager.exec(sandboxId, cmd, 120_000);

    if (result.exitCode !== 0) {
      logger.error({ sandboxId, stderr: result.stderr }, "Git clone failed");
      return { success: false, error: result.stderr };
    }

    // Configure git safe directory
    await this.containerManager.exec(
      sandboxId,
      `git config --global --add safe.directory ${REPO_DIR}`,
      10_000
    );

    // Set default user identity for the sandbox
    await this.containerManager.exec(
      sandboxId,
      `cd ${REPO_DIR} && git config user.name "Prometheus Agent" && git config user.email "agent@prometheus.dev"`,
      10_000
    );

    // If we used an authenticated URL, replace the remote with the clean URL
    // and set up credential storage for future operations
    if (token) {
      await this.containerManager.exec(
        sandboxId,
        `cd ${REPO_DIR} && git remote set-url origin ${encodeShellArg(repoUrl)}`,
        10_000
      );
      await this.setupAuth(sandboxId, { token });
    }

    logger.info({ sandboxId }, "Repository cloned successfully");
    return { success: true };
  }

  // ─── Branch ────────────────────────────────────────────────────────────

  /**
   * Create a new branch in the sandbox repo.
   */
  async createBranch(
    sandboxId: string,
    branchName: string
  ): Promise<{ success: boolean; error?: string }> {
    const safeBranch = encodeShellArg(branchName);

    const result = await this.containerManager.exec(
      sandboxId,
      `cd ${REPO_DIR} && git checkout -b ${safeBranch}`,
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
   * Checkout an existing branch, tag, or commit.
   */
  async checkout(
    sandboxId: string,
    ref: string,
    options?: { create?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    const safeRef = encodeShellArg(ref);
    const flag = options?.create ? " -b" : "";

    const result = await this.containerManager.exec(
      sandboxId,
      `cd ${REPO_DIR} && git checkout${flag} ${safeRef}`,
      15_000
    );

    if (result.exitCode !== 0) {
      logger.error(
        { sandboxId, ref, stderr: result.stderr },
        "Checkout failed"
      );
      return { success: false, error: result.stderr };
    }

    logger.info({ sandboxId, ref }, "Checked out ref");
    return { success: true };
  }

  // ─── Status ────────────────────────────────────────────────────────────

  /**
   * Get the working tree status.
   */
  async status(
    sandboxId: string
  ): Promise<{ success: boolean; entries: GitStatusEntry[]; raw: string }> {
    const result = await this.containerManager.exec(
      sandboxId,
      `cd ${REPO_DIR} && git status --porcelain`,
      10_000
    );

    const raw = result.stdout.trim();
    const entries: GitStatusEntry[] = [];

    if (raw) {
      for (const line of raw.split("\n")) {
        if (line.length < 4) {
          continue;
        }
        const statusCode = line.slice(0, 2).trim();
        const path = line.slice(3);
        entries.push({ status: statusCode, path });
      }
    }

    return { success: result.exitCode === 0, entries, raw };
  }

  // ─── Add ───────────────────────────────────────────────────────────────

  /**
   * Stage files for the next commit.
   */
  async add(
    sandboxId: string,
    files: string[]
  ): Promise<{ success: boolean; error?: string }> {
    if (files.length === 0) {
      return { success: false, error: "No files specified" };
    }

    const safeFiles = files.map(encodeShellArg).join(" ");
    const result = await this.containerManager.exec(
      sandboxId,
      `cd ${REPO_DIR} && git add ${safeFiles}`,
      30_000
    );

    if (result.exitCode !== 0) {
      return {
        success: false,
        error: `Failed to stage files: ${result.stderr}`,
      };
    }

    return { success: true };
  }

  // ─── Commit ────────────────────────────────────────────────────────────

  /**
   * Stage files and commit changes.
   */
  async commit(
    sandboxId: string,
    options: GitCommitOptions
  ): Promise<{ success: boolean; commitSha?: string; error?: string }> {
    const { message, files, authorName, authorEmail } = options;
    const workDir = REPO_DIR;

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

    const statusResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git diff --cached --stat`,
      10_000
    );
    if (!statusResult.stdout.trim()) {
      return { success: false, error: "No changes to commit" };
    }

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

    const shaResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git rev-parse HEAD`,
      10_000
    );

    const commitSha = shaResult.stdout.trim();
    logger.info({ sandboxId, commitSha, message }, "Changes committed");

    return { success: true, commitSha };
  }

  // ─── Push ──────────────────────────────────────────────────────────────

  /**
   * Push current branch to remote.
   */
  async push(
    sandboxId: string,
    options?: { remote?: string; force?: boolean; setUpstream?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    const remote = options?.remote ?? "origin";
    const force = options?.force ? " --force-with-lease" : "";
    const workDir = REPO_DIR;

    const branchResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git rev-parse --abbrev-ref HEAD`,
      10_000
    );
    const branch = branchResult.stdout.trim();

    const setUpstream = options?.setUpstream === false ? "" : " -u";

    const result = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git push${force}${setUpstream} ${encodeShellArg(remote)} ${encodeShellArg(branch)}`,
      120_000
    );

    if (result.exitCode !== 0) {
      logger.error({ sandboxId, stderr: result.stderr }, "Git push failed");
      return { success: false, error: result.stderr };
    }

    logger.info({ sandboxId, remote, branch }, "Changes pushed");
    return { success: true };
  }

  // ─── Diff ──────────────────────────────────────────────────────────────

  /**
   * Get the current diff of the working directory.
   */
  async diff(
    sandboxId: string,
    options?: { staged?: boolean }
  ): Promise<GitDiffResult> {
    const workDir = REPO_DIR;
    const stagedFlag = options?.staged ? " --cached" : "";

    const diffResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git diff${stagedFlag}`,
      30_000
    );

    const numstatResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git diff${stagedFlag} --numstat`,
      10_000
    );

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

  // ─── Log ───────────────────────────────────────────────────────────────

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
      `cd ${REPO_DIR} && git log --format="%H|||%s|||%an|||%aI" -n ${maxCount}`,
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

  /**
   * Get the current branch name.
   */
  async getCurrentBranch(sandboxId: string): Promise<string> {
    const result = await this.containerManager.exec(
      sandboxId,
      `cd ${REPO_DIR} && git rev-parse --abbrev-ref HEAD`,
      10_000
    );
    return result.stdout.trim();
  }

  // ─── Sparse Checkout ──────────────────────────────────────────────────

  /**
   * Sparse checkout for large repos -- only check out specified paths.
   */
  async sparseCheckout(
    sandboxId: string,
    repoUrl: string,
    paths: string[]
  ): Promise<void> {
    const workDir = REPO_DIR;
    const safeRepoUrl = encodeShellArg(repoUrl);

    logger.info(
      { sandboxId, repoUrl, pathCount: paths.length },
      "Starting sparse checkout"
    );

    const initResult = await this.containerManager.exec(
      sandboxId,
      `mkdir -p ${workDir} && cd ${workDir} && git init && git remote add origin ${safeRepoUrl}`,
      30_000
    );
    if (initResult.exitCode !== 0) {
      throw new Error(`Sparse checkout init failed: ${initResult.stderr}`);
    }

    const sparseResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git sparse-checkout init --cone`,
      15_000
    );
    if (sparseResult.exitCode !== 0) {
      throw new Error(`Sparse checkout init failed: ${sparseResult.stderr}`);
    }

    const safePaths = paths.map(encodeShellArg).join(" ");
    const setResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git sparse-checkout set ${safePaths}`,
      15_000
    );
    if (setResult.exitCode !== 0) {
      throw new Error(`Sparse checkout set failed: ${setResult.stderr}`);
    }

    const fetchResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git fetch --depth=1 origin main && git checkout main`,
      120_000
    );
    if (fetchResult.exitCode !== 0) {
      const fallbackResult = await this.containerManager.exec(
        sandboxId,
        `cd ${workDir} && git fetch --depth=1 origin master && git checkout master`,
        120_000
      );
      if (fallbackResult.exitCode !== 0) {
        throw new Error(
          `Sparse checkout fetch failed: ${fallbackResult.stderr}`
        );
      }
    }

    await this.containerManager.exec(
      sandboxId,
      `git config --global --add safe.directory ${workDir}`,
      10_000
    );

    logger.info({ sandboxId, repoUrl, paths }, "Sparse checkout completed");
  }

  // ─── Worktree Operations ──────────────────────────────────────────────

  /**
   * Create a git worktree for an agent to work in isolation.
   * Returns the worktree path: /workspace/worker-{agentId}
   */
  async createWorktree(
    sandboxId: string,
    repoPath: string,
    agentId: string
  ): Promise<string> {
    const worktreePath = `/workspace/worker-${agentId}`;
    const branchName = `worker/${agentId}`;
    const safePath = encodeShellArg(worktreePath);
    const safeBranch = encodeShellArg(branchName);
    const safeRepoPath = encodeShellArg(repoPath);

    logger.info(
      { sandboxId, agentId, worktreePath, branchName },
      "Creating git worktree for agent"
    );

    const result = await this.containerManager.exec(
      sandboxId,
      `cd ${safeRepoPath} && git worktree add -b ${safeBranch} ${safePath}`,
      30_000
    );

    if (result.exitCode !== 0) {
      // Branch may already exist; try without -b
      const retryResult = await this.containerManager.exec(
        sandboxId,
        `cd ${safeRepoPath} && git worktree add ${safePath} ${safeBranch}`,
        30_000
      );

      if (retryResult.exitCode !== 0) {
        throw new Error(
          `Worktree creation failed: ${retryResult.stderr || result.stderr}`
        );
      }
    }

    await this.containerManager.exec(
      sandboxId,
      `git config --global --add safe.directory ${safePath}`,
      10_000
    );

    logger.info(
      { sandboxId, agentId, worktreePath },
      "Git worktree created for agent"
    );

    return worktreePath;
  }

  /**
   * Remove a git worktree and clean up.
   */
  async removeWorktree(sandboxId: string, worktreePath: string): Promise<void> {
    const safePath = encodeShellArg(worktreePath);

    logger.info({ sandboxId, worktreePath }, "Removing git worktree");

    const result = await this.containerManager.exec(
      sandboxId,
      `git worktree remove --force ${safePath} 2>/dev/null; rm -rf ${safePath}`,
      15_000
    );

    if (result.exitCode !== 0) {
      logger.warn(
        { sandboxId, worktreePath, stderr: result.stderr },
        "Worktree removal had warnings"
      );
    }

    await this.containerManager.exec(
      sandboxId,
      `cd ${REPO_DIR} && git worktree prune`,
      10_000
    );

    logger.info({ sandboxId, worktreePath }, "Git worktree removed");
  }

  /**
   * List all git worktrees for a repository.
   */
  async listWorktrees(
    sandboxId: string,
    repoPath: string
  ): Promise<WorktreeInfo[]> {
    const safeRepoPath = encodeShellArg(repoPath);
    const result = await this.containerManager.exec(
      sandboxId,
      `cd ${safeRepoPath} && git worktree list --porcelain`,
      10_000
    );

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return [];
    }

    const worktrees: WorktreeInfo[] = [];
    const blocks = result.stdout.trim().split("\n\n");

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      let path = "";
      let branch = "";
      let isMainWorktree = false;

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          path = line.replace("worktree ", "");
        } else if (line.startsWith("branch ")) {
          branch = line.replace("branch refs/heads/", "");
        } else if (line === "bare") {
          isMainWorktree = true;
        }
      }

      if (path) {
        if (worktrees.length === 0) {
          isMainWorktree = true;
        }
        worktrees.push({ path, branch, isMainWorktree });
      }
    }

    return worktrees;
  }

  /**
   * Clean up all worktrees for an agent (e.g., on agent completion).
   */
  async cleanupAgentWorktrees(
    sandboxId: string,
    repoPath: string,
    agentId: string
  ): Promise<number> {
    const worktrees = await this.listWorktrees(sandboxId, repoPath);
    const agentWorktrees = worktrees.filter(
      (w) => w.path.includes(`worker-${agentId}`) && !w.isMainWorktree
    );

    let cleaned = 0;
    for (const wt of agentWorktrees) {
      try {
        await this.removeWorktree(sandboxId, wt.path);
        cleaned++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { sandboxId, path: wt.path, error: msg },
          "Failed to clean up agent worktree"
        );
      }
    }

    if (cleaned > 0) {
      logger.info(
        { sandboxId, agentId, cleaned },
        "Agent worktrees cleaned up"
      );
    }

    return cleaned;
  }

  /**
   * Create a git worktree for parallel branch work (legacy API).
   */
  async worktreeCreate(
    sandboxId: string,
    branch: string,
    path: string
  ): Promise<void> {
    const repoDir = REPO_DIR;
    const safeBranch = encodeShellArg(branch);
    const safePath = encodeShellArg(path);

    logger.info({ sandboxId, branch, path }, "Creating git worktree");

    const checkResult = await this.containerManager.exec(
      sandboxId,
      `cd ${repoDir} && git rev-parse --verify ${safeBranch} 2>/dev/null`,
      10_000
    );

    let cmd: string;
    if (checkResult.exitCode === 0) {
      cmd = `cd ${repoDir} && git worktree add ${safePath} ${safeBranch}`;
    } else {
      cmd = `cd ${repoDir} && git worktree add -b ${safeBranch} ${safePath}`;
    }

    const result = await this.containerManager.exec(sandboxId, cmd, 30_000);

    if (result.exitCode !== 0) {
      throw new Error(`Worktree creation failed: ${result.stderr}`);
    }

    await this.containerManager.exec(
      sandboxId,
      `git config --global --add safe.directory ${safePath}`,
      10_000
    );

    logger.info({ sandboxId, branch, path }, "Git worktree created");
  }

  /**
   * Create a GPG-signed commit.
   */
  async commitSigned(
    sandboxId: string,
    options: GitCommitOptions & { signingKey: string }
  ): Promise<string> {
    const { message, files, authorName, authorEmail, signingKey } = options;
    const workDir = REPO_DIR;

    const importResult = await this.containerManager.exec(
      sandboxId,
      `echo ${encodeShellArg(signingKey)} | gpg --batch --import`,
      15_000
    );
    if (importResult.exitCode !== 0) {
      throw new Error(`GPG key import failed: ${importResult.stderr}`);
    }

    await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git config commit.gpgsign true`,
      10_000
    );

    const keyIdResult = await this.containerManager.exec(
      sandboxId,
      "gpg --list-secret-keys --keyid-format LONG | grep sec | head -1 | awk '{print $2}' | cut -d'/' -f2",
      10_000
    );
    const keyId = keyIdResult.stdout.trim();
    if (keyId) {
      await this.containerManager.exec(
        sandboxId,
        `cd ${workDir} && git config user.signingkey ${encodeShellArg(keyId)}`,
        10_000
      );
    }

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

    if (files && files.length > 0) {
      const safeFiles = files.map(encodeShellArg).join(" ");
      const addResult = await this.containerManager.exec(
        sandboxId,
        `cd ${workDir} && git add ${safeFiles}`,
        30_000
      );
      if (addResult.exitCode !== 0) {
        throw new Error(`Failed to stage files: ${addResult.stderr}`);
      }
    } else {
      const addResult = await this.containerManager.exec(
        sandboxId,
        `cd ${workDir} && git add -A`,
        30_000
      );
      if (addResult.exitCode !== 0) {
        throw new Error(`Failed to stage files: ${addResult.stderr}`);
      }
    }

    const commitResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git commit -S -m ${encodeShellArg(message)}`,
      30_000
    );

    if (commitResult.exitCode !== 0) {
      throw new Error(`Signed commit failed: ${commitResult.stderr}`);
    }

    const shaResult = await this.containerManager.exec(
      sandboxId,
      `cd ${workDir} && git rev-parse HEAD`,
      10_000
    );

    const commitSha = shaResult.stdout.trim();
    logger.info(
      { sandboxId, commitSha, signed: true },
      "Signed commit created"
    );

    return commitSha;
  }
}

/**
 * Shell-safe argument encoding.
 */
function encodeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
