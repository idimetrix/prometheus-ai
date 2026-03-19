import { createLogger } from "@prometheus/logger";
import type { ConflictReport, FileConflict } from "./conflict-detector";

const logger = createLogger("orchestrator:merge-coordinator");

export interface MergeResult {
  conflicts: UnresolvedConflict[];
  merged: MergedFile[];
  status: "success" | "partial" | "failed";
}

export interface MergedFile {
  filePath: string;
  strategy: "auto" | "agent-priority" | "manual";
}

export interface UnresolvedConflict {
  filePath: string;
  reason: string;
}

export interface MergeStrategy {
  agentPriority?: string[];
  allowAutoMerge: boolean;
  requireHumanReview: boolean;
}

const DEFAULT_STRATEGY: MergeStrategy = {
  allowAutoMerge: true,
  requireHumanReview: false,
};

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

  async coordinateMerge(
    report: ConflictReport,
    worktrees: Map<string, string>
  ): Promise<MergeResult> {
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
