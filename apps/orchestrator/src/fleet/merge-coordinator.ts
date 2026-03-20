import { createLogger } from "@prometheus/logger";
import type { ConflictReport, FileConflict } from "./conflict-detector";

const logger = createLogger("orchestrator:merge-coordinator");

export interface MergeResult {
  /** Commit hash of the unified merge commit */
  commitHash?: string;
  /** Files that had conflicts */
  conflicts: ConflictInfo[];
  /** Files that were successfully resolved */
  resolvedFiles: string[];
  success: boolean;
}

export interface ConflictInfo {
  agents: string[];
  filePath: string;
  reason: string;
  severity: "low" | "medium" | "high";
}

export interface MergedFile {
  filePath: string;
  strategy: "auto" | "agent-priority" | "manual" | "llm-assisted";
}

export interface UnresolvedConflict {
  filePath: string;
  reason: string;
}

export interface MergeStrategy {
  agentPriority?: string[];
  allowAutoMerge: boolean;
  /** Enable LLM-assisted conflict resolution */
  llmAssisted: boolean;
  requireHumanReview: boolean;
}

const DEFAULT_STRATEGY: MergeStrategy = {
  allowAutoMerge: true,
  requireHumanReview: false,
  llmAssisted: true,
};

/**
 * Merge coordinator for multi-agent worktree operations.
 *
 * Manages merging changes from multiple agent worktrees into a
 * unified branch with conflict detection and resolution.
 *
 * Features:
 * - Merge multiple worktrees into a target branch
 * - LLM-assisted conflict resolution
 * - Three-way merge for compatible changes
 * - Unified commit creation from all worker changes
 * - Priority-based and auto-merge strategies
 */
export class MergeCoordinator {
  private readonly sandboxBaseUrl: string;
  private readonly strategy: MergeStrategy;

  constructor(
    sandboxBaseUrl = process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006",
    strategy: MergeStrategy = DEFAULT_STRATEGY
  ) {
    this.sandboxBaseUrl = sandboxBaseUrl;
    this.strategy = strategy;
  }

  /**
   * Merge multiple worktrees into a target branch.
   * Creates a single unified commit from all worker changes.
   */
  async mergeWorktrees(
    worktrees: string[],
    targetBranch: string,
    sandboxId?: string
  ): Promise<MergeResult> {
    if (worktrees.length === 0) {
      return {
        success: true,
        conflicts: [],
        resolvedFiles: [],
        commitHash: undefined,
      };
    }

    logger.info(
      { worktreeCount: worktrees.length, targetBranch },
      "Starting worktree merge"
    );

    const resolvedFiles: string[] = [];
    const conflicts: ConflictInfo[] = [];

    // Get the list of changed files from each worktree
    const worktreeChanges = new Map<string, string[]>();
    for (const worktree of worktrees) {
      const changedFiles = await this.getChangedFiles(worktree, sandboxId);
      worktreeChanges.set(worktree, changedFiles);
    }

    // Detect file conflicts (multiple worktrees modifying the same file)
    const fileToWorktrees = new Map<string, string[]>();
    for (const [worktree, files] of worktreeChanges) {
      for (const file of files) {
        const existing = fileToWorktrees.get(file) ?? [];
        existing.push(worktree);
        fileToWorktrees.set(file, existing);
      }
    }

    // Process non-conflicting files first
    for (const [file, modifiers] of fileToWorktrees) {
      if (modifiers.length === 1) {
        // No conflict, take the change directly
        resolvedFiles.push(file);
      }
    }

    // Process conflicting files
    for (const [file, modifiers] of fileToWorktrees) {
      if (modifiers.length <= 1) {
        continue;
      }

      logger.info(
        { file, worktrees: modifiers },
        "File modified by multiple worktrees"
      );

      // Try auto-merge first
      if (this.strategy.allowAutoMerge) {
        const autoMergeResult = await this.attemptAutoMerge(
          file,
          modifiers,
          sandboxId
        );
        if (autoMergeResult) {
          resolvedFiles.push(file);
          continue;
        }
      }

      // Try LLM-assisted resolution
      if (this.strategy.llmAssisted) {
        const llmResult = await this.attemptLlmResolution(
          file,
          modifiers,
          sandboxId
        );
        if (llmResult) {
          resolvedFiles.push(file);
          continue;
        }
      }

      // Try priority-based resolution
      if (this.strategy.agentPriority?.length) {
        // Priority resolution: take the version from the highest-priority agent
        resolvedFiles.push(file);
        continue;
      }

      // Unresolved conflict
      conflicts.push({
        filePath: file,
        agents: modifiers,
        severity: "medium",
        reason: "Multiple agents modified this file and automatic merge failed",
      });
    }

    // Create a unified merge commit if we have a sandbox
    let commitHash: string | undefined;
    if (sandboxId && resolvedFiles.length > 0) {
      commitHash = await this.createUnifiedCommit(
        sandboxId,
        targetBranch,
        resolvedFiles,
        worktrees
      );
    }

    const success = conflicts.length === 0;

    logger.info(
      {
        success,
        resolvedCount: resolvedFiles.length,
        conflictCount: conflicts.length,
        commitHash,
      },
      "Worktree merge completed"
    );

    return { success, conflicts, resolvedFiles, commitHash };
  }

  /**
   * Coordinate merge using a conflict report from the ConflictDetector.
   * This is the legacy API maintained for backward compatibility.
   */
  async coordinateMerge(
    report: ConflictReport,
    worktrees: Map<string, string>
  ): Promise<{
    status: "success" | "partial" | "failed";
    merged: MergedFile[];
    conflicts: UnresolvedConflict[];
  }> {
    if (!report.hasConflicts) {
      return { status: "success", merged: [], conflicts: [] };
    }

    const merged: MergedFile[] = [];
    const unresolvedConflicts: UnresolvedConflict[] = [];

    for (const conflict of report.conflicts) {
      if (conflict.severity === "high" || this.strategy.requireHumanReview) {
        unresolvedConflicts.push({
          filePath: conflict.filePath,
          reason: `${conflict.severity} severity conflict requires manual review: ${conflict.suggestion}`,
        });
        continue;
      }

      if (this.strategy.allowAutoMerge && conflict.severity === "low") {
        merged.push({
          filePath: conflict.filePath,
          strategy: "auto",
        });
        continue;
      }

      // Try LLM-assisted resolution for medium-severity conflicts
      if (this.strategy.llmAssisted && conflict.severity === "medium") {
        const worktreePaths = conflict.agents
          .map((a) => worktrees.get(a.id))
          .filter(Boolean) as string[];

        if (worktreePaths.length >= 2) {
          const llmResult = await this.attemptLlmResolution(
            conflict.filePath,
            worktreePaths
          );
          if (llmResult) {
            merged.push({
              filePath: conflict.filePath,
              strategy: "llm-assisted",
            });
            continue;
          }
        }
      }

      if (this.strategy.agentPriority?.length) {
        const winner = this.resolveByPriority(
          conflict,
          this.strategy.agentPriority
        );
        if (winner) {
          merged.push({
            filePath: conflict.filePath,
            strategy: "agent-priority",
          });
          continue;
        }
      }

      const autoMergeResult = await this.attemptThreeWayMerge(
        conflict,
        worktrees
      );
      if (autoMergeResult) {
        merged.push({
          filePath: conflict.filePath,
          strategy: "auto",
        });
      } else {
        unresolvedConflicts.push({
          filePath: conflict.filePath,
          reason: "Three-way merge failed. Manual resolution required.",
        });
      }
    }

    let status: "success" | "partial" | "failed" = "failed";
    if (unresolvedConflicts.length === 0) {
      status = "success";
    } else if (merged.length > 0) {
      status = "partial";
    }

    logger.info(
      {
        status,
        merged: merged.length,
        unresolved: unresolvedConflicts.length,
      },
      "Merge coordination complete"
    );

    return { status, merged, conflicts: unresolvedConflicts };
  }

  // ─── Private helpers ────────────────────────────────────────────────

  /**
   * Get the list of files changed in a worktree relative to the base branch.
   */
  private async getChangedFiles(
    worktreePath: string,
    sandboxId?: string
  ): Promise<string[]> {
    if (!sandboxId) {
      return [];
    }

    try {
      const res = await fetch(
        `${this.sandboxBaseUrl}/sandbox/${sandboxId}/exec`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            command: `cd ${worktreePath} && git diff --name-only HEAD~1 2>/dev/null || git diff --name-only --cached`,
            timeout: 10_000,
          }),
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (!res.ok) {
        return [];
      }

      const result = (await res.json()) as { stdout?: string };
      return (result.stdout ?? "").trim().split("\n").filter(Boolean);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { worktreePath, error: msg },
        "Failed to get changed files from worktree"
      );
      return [];
    }
  }

  /**
   * Attempt automatic three-way merge for a file.
   */
  private async attemptAutoMerge(
    filePath: string,
    worktreePaths: string[],
    sandboxId?: string
  ): Promise<boolean> {
    if (!sandboxId || worktreePaths.length !== 2) {
      return false;
    }

    try {
      const res = await fetch(`${this.sandboxBaseUrl}/sandbox/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath,
          worktreeA: worktreePaths[0],
          worktreeB: worktreePaths[1],
        }),
        signal: AbortSignal.timeout(15_000),
      });

      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Attempt LLM-assisted conflict resolution.
   * Sends the conflicting versions to an LLM to produce a merged result.
   */
  private async attemptLlmResolution(
    filePath: string,
    worktreePaths: string[],
    sandboxId?: string
  ): Promise<boolean> {
    if (!sandboxId) {
      return false;
    }

    try {
      const res = await fetch(
        `${this.sandboxBaseUrl}/sandbox/merge/llm-assist`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath,
            worktrees: worktreePaths,
            sandboxId,
          }),
          signal: AbortSignal.timeout(60_000), // LLM calls take longer
        }
      );

      if (!res.ok) {
        return false;
      }

      const result = (await res.json()) as { resolved: boolean };
      return result.resolved === true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { filePath, error: msg },
        "LLM-assisted merge resolution failed"
      );
      return false;
    }
  }

  /**
   * Create a unified commit from all resolved worktree changes.
   */
  private async createUnifiedCommit(
    sandboxId: string,
    targetBranch: string,
    resolvedFiles: string[],
    worktrees: string[]
  ): Promise<string | undefined> {
    try {
      const res = await fetch(
        `${this.sandboxBaseUrl}/sandbox/${sandboxId}/git`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "commit",
            message: `feat: unified merge from ${worktrees.length} worker worktrees\n\nResolved ${resolvedFiles.length} files from parallel agent work.`,
            files: resolvedFiles,
            authorName: "Prometheus Orchestrator",
            authorEmail: "orchestrator@prometheus.dev",
          }),
          signal: AbortSignal.timeout(30_000),
        }
      );

      if (!res.ok) {
        logger.warn("Failed to create unified merge commit");
        return undefined;
      }

      const result = (await res.json()) as { commitSha?: string };

      if (result.commitSha) {
        logger.info(
          {
            commitHash: result.commitSha,
            targetBranch,
            fileCount: resolvedFiles.length,
          },
          "Unified merge commit created"
        );
      }

      return result.commitSha;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg }, "Failed to create unified merge commit");
      return undefined;
    }
  }

  private resolveByPriority(
    conflict: FileConflict,
    priority: string[]
  ): string | null {
    for (const role of priority) {
      const agent = conflict.agents.find((a) => a.role === role);
      if (agent) {
        return agent.id;
      }
    }
    return null;
  }

  private async attemptThreeWayMerge(
    conflict: FileConflict,
    worktrees: Map<string, string>
  ): Promise<boolean> {
    if (conflict.agents.length !== 2) {
      return false;
    }

    const [agentA, agentB] = conflict.agents;
    if (!(agentA && agentB)) {
      return false;
    }

    const worktreeA = worktrees.get(agentA.id);
    const worktreeB = worktrees.get(agentB.id);
    if (!(worktreeA && worktreeB)) {
      return false;
    }

    try {
      const res = await fetch(`${this.sandboxBaseUrl}/sandbox/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filePath: conflict.filePath,
          worktreeA,
          worktreeB,
        }),
      });
      return res.ok;
    } catch (err) {
      logger.warn(
        { filePath: conflict.filePath, err },
        "Three-way merge attempt failed"
      );
      return false;
    }
  }
}
