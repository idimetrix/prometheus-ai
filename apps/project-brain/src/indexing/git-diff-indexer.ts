/**
 * Phase 5.3: Incremental Git Diff Indexing.
 * Detects changes via `git diff --name-status` and only re-indexes changed files.
 * Stores lastIndexedCommit in Redis for fast lookup.
 */
import { createLogger } from "@prometheus/logger";
import { redis } from "@prometheus/queue";

const logger = createLogger("project-brain:git-diff-indexer");

const LAST_COMMIT_PREFIX = "index:last-commit:";

export interface FileChange {
  filePath: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed";
}

export class GitDiffIndexer {
  /**
   * Detect changed files since the last indexed commit.
   * Returns list of file changes to re-index.
   */
  async detectChanges(
    projectId: string,
    repoPath: string
  ): Promise<{
    changes: FileChange[];
    currentCommit: string;
    lastIndexedCommit: string | null;
  }> {
    const lastCommit = await this.getLastIndexedCommit(projectId);
    const currentCommit = await this.getCurrentCommit(repoPath);

    if (lastCommit === currentCommit) {
      return { changes: [], currentCommit, lastIndexedCommit: lastCommit };
    }

    const diffRange = lastCommit
      ? `${lastCommit}..${currentCommit}`
      : currentCommit;

    const changes = await this.getChangedFiles(repoPath, diffRange);

    logger.info(
      {
        projectId,
        lastCommit: lastCommit?.slice(0, 8),
        currentCommit: currentCommit.slice(0, 8),
        changeCount: changes.length,
      },
      "Detected file changes"
    );

    return { changes, currentCommit, lastIndexedCommit: lastCommit };
  }

  /**
   * Mark the current commit as indexed.
   */
  async markIndexed(projectId: string, commitHash: string): Promise<void> {
    const key = `${LAST_COMMIT_PREFIX}${projectId}`;
    await redis.set(key, commitHash);
  }

  /**
   * Get the last indexed commit hash.
   */
  async getLastIndexedCommit(projectId: string): Promise<string | null> {
    const key = `${LAST_COMMIT_PREFIX}${projectId}`;
    return await redis.get(key);
  }

  private async getCurrentCommit(repoPath: string): Promise<string> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: repoPath,
    });
    return stdout.trim();
  }

  private async getChangedFiles(
    repoPath: string,
    diffRange: string
  ): Promise<FileChange[]> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    try {
      const { stdout } = await execFileAsync(
        "git",
        ["diff", "--name-status", diffRange],
        { cwd: repoPath }
      );

      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => this.parseDiffLine(line));
    } catch {
      // If diff fails (e.g., first index), list all tracked files
      const { stdout } = await execFileAsync("git", ["ls-files"], {
        cwd: repoPath,
      });

      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((filePath) => ({
          filePath,
          status: "added" as const,
        }));
    }
  }

  private parseDiffLine(line: string): FileChange {
    const parts = line.split("\t");
    const statusChar = parts[0]?.charAt(0) ?? "M";
    const filePath = parts[1] ?? "";
    const oldPath = parts[2]; // Only set for renames

    const statusMap: Record<string, FileChange["status"]> = {
      A: "added",
      M: "modified",
      D: "deleted",
      R: "renamed",
    };

    return {
      filePath: oldPath ?? filePath,
      status: statusMap[statusChar] ?? "modified",
      oldPath: statusChar === "R" ? filePath : undefined,
    };
  }
}
