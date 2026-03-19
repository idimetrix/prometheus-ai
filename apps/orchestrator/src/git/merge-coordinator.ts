/**
 * Phase 2.3: MergeCoordinator handles sequential merge of fleet worktrees
 * in dependency order with auto-resolution for non-overlapping changes
 * and PR creation for unresolvable conflicts.
 */
import { createLogger } from "@prometheus/logger";
import type { WorktreeManager } from "./worktree-manager";

const logger = createLogger("orchestrator:git:merge-coordinator");

export interface MergeResult {
  conflictBranches: string[];
  conflictDetails: Map<string, string>;
  mergedTaskIds: string[];
  success: boolean;
}

export class MergeCoordinator {
  private readonly worktreeManager: WorktreeManager;

  constructor(worktreeManager: WorktreeManager) {
    this.worktreeManager = worktreeManager;
  }

  /**
   * Merge completed task worktrees back in dependency order.
   * Tasks with no dependencies are merged first.
   */
  async mergeAll(
    projectId: string,
    taskIds: string[],
    taskDependencies: Map<string, string[]>,
    targetBranch = "main"
  ): Promise<MergeResult> {
    const mergedTaskIds: string[] = [];
    const conflictBranches: string[] = [];
    const conflictDetails = new Map<string, string>();

    // Topological sort by dependencies
    const sorted = this.topologicalSort(taskIds, taskDependencies);

    for (const taskId of sorted) {
      const worktree = this.worktreeManager.getWorktree(taskId);
      if (!worktree) {
        logger.warn({ taskId }, "No worktree found for merge");
        continue;
      }

      const result = await this.worktreeManager.mergeBack(
        projectId,
        taskId,
        targetBranch
      );

      if (result.success) {
        mergedTaskIds.push(taskId);
        // Clean up worktree after successful merge
        await this.worktreeManager.remove(projectId, taskId);
      } else if (result.conflicts) {
        conflictBranches.push(worktree.branch);
        conflictDetails.set(taskId, result.error ?? "Merge conflict");
        logger.warn(
          { taskId, branch: worktree.branch },
          "Conflict detected, skipping merge"
        );
      } else {
        logger.error(
          { taskId, error: result.error },
          "Merge failed for non-conflict reason"
        );
      }
    }

    const success =
      conflictBranches.length === 0 && mergedTaskIds.length === taskIds.length;

    logger.info(
      {
        merged: mergedTaskIds.length,
        conflicts: conflictBranches.length,
        total: taskIds.length,
      },
      "Merge coordination complete"
    );

    return {
      success,
      mergedTaskIds,
      conflictBranches,
      conflictDetails,
    };
  }

  private topologicalSort(
    taskIds: string[],
    dependencies: Map<string, string[]>
  ): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (taskId: string) => {
      if (visited.has(taskId)) {
        return;
      }
      if (visiting.has(taskId)) {
        return; // cycle detection
      }

      visiting.add(taskId);

      const deps = dependencies.get(taskId) ?? [];
      for (const dep of deps) {
        if (taskIds.includes(dep)) {
          visit(dep);
        }
      }

      visiting.delete(taskId);
      visited.add(taskId);
      sorted.push(taskId);
    };

    for (const taskId of taskIds) {
      visit(taskId);
    }

    return sorted;
  }
}
