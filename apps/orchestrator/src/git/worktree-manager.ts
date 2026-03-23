import { createLogger } from "@prometheus/logger";
import { generateId, sandboxManagerClient } from "@prometheus/utils";

const logger = createLogger("orchestrator:git:worktree");

const WORKTREE_PATH_RE = /worktree (.+)/;

export interface WorktreeInfo {
  branch: string;
  path: string;
  taskId: string;
}

/**
 * WorktreeManager handles git worktree lifecycle for isolated agent execution.
 * Each agent task gets its own worktree to prevent file conflicts during
 * parallel execution.
 */
export class WorktreeManager {
  private readonly activeWorktrees = new Map<string, WorktreeInfo>();

  /**
   * Create a new worktree for a task. The worktree is a lightweight
   * copy of the repo that shares the git history but has its own
   * working directory and branch.
   */
  async create(
    projectId: string,
    taskId: string,
    baseBranch = "main"
  ): Promise<WorktreeInfo> {
    const branchName = `prometheus/${taskId}-${generateId("wt").slice(0, 8)}`;
    const worktreePath = `/workspace/${projectId}-wt-${taskId}`;

    logger.info(
      { projectId, taskId, branchName, worktreePath },
      "Creating worktree"
    );

    try {
      // Create branch and worktree via sandbox
      await this.execInSandbox(
        projectId,
        [
          `cd /workspace/${projectId}`,
          `git worktree add -b ${branchName} ${worktreePath} ${baseBranch}`,
        ].join(" && ")
      );

      const info: WorktreeInfo = {
        path: worktreePath,
        branch: branchName,
        taskId,
      };
      this.activeWorktrees.set(taskId, info);

      logger.info({ taskId, branchName }, "Worktree created");
      return info;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { taskId, error: msg },
        "Worktree creation failed, using shared workspace"
      );

      // Fallback to shared workspace
      const fallback: WorktreeInfo = {
        path: `/workspace/${projectId}`,
        branch: baseBranch,
        taskId,
      };
      this.activeWorktrees.set(taskId, fallback);
      return fallback;
    }
  }

  /**
   * Commit all changes in a worktree with a descriptive message.
   */
  async commit(
    projectId: string,
    taskId: string,
    message: string
  ): Promise<{ committed: boolean; hash?: string }> {
    const info = this.activeWorktrees.get(taskId);
    if (!info) {
      return { committed: false };
    }

    try {
      const result = await this.execInSandbox(
        projectId,
        [
          `cd ${info.path}`,
          "git add -A",
          `git diff --cached --quiet || git commit -m "${message.replace(/"/g, '\\"')}"`,
          "git rev-parse HEAD",
        ].join(" && ")
      );

      const hash = result.trim().split("\n").pop();
      logger.info({ taskId, hash }, "Changes committed");
      return { committed: true, hash };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ taskId, error: msg }, "Commit failed");
      return { committed: false };
    }
  }

  /**
   * Get the diff of changes in a worktree compared to base branch.
   */
  async getDiff(projectId: string, taskId: string): Promise<string> {
    const info = this.activeWorktrees.get(taskId);
    if (!info) {
      return "";
    }

    try {
      return await this.execInSandbox(
        projectId,
        [`cd ${info.path}`, "git diff HEAD"].join(" && ")
      );
    } catch {
      return "";
    }
  }

  /**
   * Remove a worktree after task completion.
   */
  async remove(projectId: string, taskId: string): Promise<void> {
    const info = this.activeWorktrees.get(taskId);
    if (!info) {
      return;
    }

    try {
      await this.execInSandbox(
        projectId,
        [
          `cd /workspace/${projectId}`,
          `git worktree remove ${info.path} --force`,
          `git branch -D ${info.branch}`,
        ].join(" && ")
      );
    } catch (err) {
      logger.warn({ taskId, error: err }, "Worktree cleanup failed");
    }

    this.activeWorktrees.delete(taskId);
  }

  /** Get info for an active worktree */
  getWorktree(taskId: string): WorktreeInfo | undefined {
    return this.activeWorktrees.get(taskId);
  }

  /**
   * Phase 2.1: Bulk worktree creation for fleet mode.
   * Creates one worktree per task ID.
   */
  async createForFleet(
    projectId: string,
    taskIds: string[],
    baseBranch = "main"
  ): Promise<Map<string, WorktreeInfo>> {
    const results = new Map<string, WorktreeInfo>();

    // Create worktrees in parallel (up to 5 at a time)
    const batchSize = 5;
    for (let i = 0; i < taskIds.length; i += batchSize) {
      const batch = taskIds.slice(i, i + batchSize);
      const promises = batch.map((taskId) =>
        this.create(projectId, taskId, baseBranch)
      );
      const batchResults = await Promise.allSettled(promises);

      for (let j = 0; j < batch.length; j++) {
        const taskId = batch[j] as string;
        const result = batchResults[j];
        if (result?.status === "fulfilled") {
          results.set(taskId, result.value);
        }
      }
    }

    logger.info(
      { projectId, requested: taskIds.length, created: results.size },
      "Fleet worktrees created"
    );
    return results;
  }

  /**
   * Phase 2.2: Merge a task worktree back to the target branch.
   * Returns whether the merge succeeded or needs manual resolution.
   */
  async mergeBack(
    projectId: string,
    taskId: string,
    targetBranch = "main"
  ): Promise<{ success: boolean; conflicts: boolean; error?: string }> {
    const info = this.activeWorktrees.get(taskId);
    if (!info) {
      return { success: false, conflicts: false, error: "No worktree found" };
    }

    try {
      // First commit any uncommitted changes
      await this.commit(projectId, taskId, `feat: complete task ${taskId}`);

      // Attempt merge
      await this.execInSandbox(
        projectId,
        [
          `cd /workspace/${projectId}`,
          `git checkout ${targetBranch}`,
          `git merge ${info.branch} --no-ff -m "Merge task ${taskId}"`,
        ].join(" && ")
      );

      logger.info({ taskId, targetBranch }, "Worktree merged back");
      return { success: true, conflicts: false };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes("CONFLICT") || msg.includes("conflict")) {
        logger.warn({ taskId }, "Merge conflicts detected");
        // Abort the merge
        await this.execInSandbox(
          projectId,
          `cd /workspace/${projectId} && git merge --abort`
        ).catch(() => {
          // Best-effort abort — may fail if merge wasn't started
        });
        return { success: false, conflicts: true, error: msg };
      }

      logger.error({ taskId, error: msg }, "Merge failed");
      return { success: false, conflicts: false, error: msg };
    }
  }

  /**
   * Phase 2.1: Clean up stale worktrees older than maxAge.
   */
  async cleanupStale(
    projectId: string,
    maxAgeMs = 24 * 60 * 60 * 1000
  ): Promise<number> {
    let cleaned = 0;

    try {
      const output = await this.execInSandbox(
        projectId,
        `cd /workspace/${projectId} && git worktree list --porcelain`
      );

      const worktrees = output.split("\n\n").filter(Boolean);
      const now = Date.now();

      for (const wt of worktrees) {
        const pathMatch = wt.match(WORKTREE_PATH_RE);
        if (!pathMatch) {
          continue;
        }

        const wtPath = pathMatch[1] as string;
        // Skip main workspace
        if (!wtPath.includes("-wt-")) {
          continue;
        }

        // Check if the worktree directory is old
        try {
          const statOutput = await this.execInSandbox(
            projectId,
            `stat -c %Y ${wtPath} 2>/dev/null || echo 0`
          );
          const mtime = Number.parseInt(statOutput.trim(), 10) * 1000;
          if (mtime > 0 && now - mtime > maxAgeMs) {
            await this.execInSandbox(
              projectId,
              `cd /workspace/${projectId} && git worktree remove ${wtPath} --force`
            );
            cleaned++;
          }
        } catch {
          // Skip if we can't stat
        }
      }
    } catch (err) {
      logger.warn({ projectId, error: err }, "Stale worktree cleanup failed");
    }

    if (cleaned > 0) {
      logger.info({ projectId, cleaned }, "Stale worktrees cleaned up");
    }
    return cleaned;
  }

  /** Get count of active worktrees */
  getActiveCount(): number {
    return this.activeWorktrees.size;
  }

  /**
   * Push a worktree's branch to the remote.
   */
  async push(
    projectId: string,
    taskId: string,
    remote = "origin"
  ): Promise<{ pushed: boolean; error?: string }> {
    const info = this.activeWorktrees.get(taskId);
    if (!info) {
      return { pushed: false, error: "No worktree found" };
    }

    try {
      await this.execInSandbox(
        projectId,
        `cd ${info.path} && git push ${remote} ${info.branch}`
      );
      logger.info({ taskId, branch: info.branch }, "Branch pushed to remote");
      return { pushed: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ taskId, error: msg }, "Push failed");
      return { pushed: false, error: msg };
    }
  }

  private async execInSandbox(
    projectId: string,
    command: string
  ): Promise<string> {
    const response = await sandboxManagerClient.post<{
      output: string;
      exitCode: number;
    }>("/exec", { projectId, command });

    if (response.data.exitCode !== 0) {
      throw new Error(
        `Command failed (exit ${response.data.exitCode}): ${response.data.output}`
      );
    }

    return response.data.output;
  }
}
