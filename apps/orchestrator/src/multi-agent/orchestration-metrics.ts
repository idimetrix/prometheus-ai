/**
 * GAP-041: Multi-Agent Orchestration Metrics
 *
 * Tracks multi-agent vs single-agent performance, task delegation
 * efficiency, handoff success rate, and collaboration quality score.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:orchestration-metrics");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TaskOutcome {
  agentCount: number;
  collaborationMode: "single" | "multi";
  durationMs: number;
  handoffCount: number;
  qualityScore: number;
  success: boolean;
  taskId: string;
  taskType: string;
  timestamp: number;
}

export interface HandoffOutcome {
  durationMs: number;
  fromAgent: string;
  handoffId: string;
  success: boolean;
  taskId: string;
  timestamp: number;
  toAgent: string;
}

export interface DelegationRecord {
  agentRole: string;
  completedSubtasks: number;
  delegatedSubtasks: number;
  taskId: string;
  timestamp: number;
}

export interface OrchestrationReport {
  avgCollaborationQuality: number;
  delegationEfficiency: number;
  handoffSuccessRate: number;
  multiAgentAvgDuration: number;
  multiAgentAvgQuality: number;
  multiAgentSuccessRate: number;
  period: { from: number; to: number };
  singleAgentAvgDuration: number;
  singleAgentAvgQuality: number;
  singleAgentSuccessRate: number;
  speedupFactor: number;
  totalTasks: number;
}

// ---------------------------------------------------------------------------
// OrchestrationMetrics
// ---------------------------------------------------------------------------

export class OrchestrationMetrics {
  private readonly taskOutcomes: TaskOutcome[] = [];
  private readonly handoffOutcomes: HandoffOutcome[] = [];
  private readonly delegationRecords: DelegationRecord[] = [];

  /**
   * Record the outcome of a completed task (single or multi-agent).
   */
  recordTaskOutcome(outcome: TaskOutcome): void {
    this.taskOutcomes.push(outcome);

    // Trim to last 5000 entries
    if (this.taskOutcomes.length > 5000) {
      this.taskOutcomes.splice(0, this.taskOutcomes.length - 5000);
    }

    logger.info(
      {
        taskId: outcome.taskId,
        mode: outcome.collaborationMode,
        agentCount: outcome.agentCount,
        success: outcome.success,
        quality: outcome.qualityScore,
        durationMs: outcome.durationMs,
      },
      "Task outcome recorded"
    );
  }

  /**
   * Record the outcome of a handoff between agents.
   */
  recordHandoffOutcome(outcome: HandoffOutcome): void {
    this.handoffOutcomes.push(outcome);

    if (this.handoffOutcomes.length > 5000) {
      this.handoffOutcomes.splice(0, this.handoffOutcomes.length - 5000);
    }

    logger.debug(
      {
        handoffId: outcome.handoffId,
        from: outcome.fromAgent,
        to: outcome.toAgent,
        success: outcome.success,
      },
      "Handoff outcome recorded"
    );
  }

  /**
   * Record delegation statistics for a task.
   */
  recordDelegation(record: DelegationRecord): void {
    this.delegationRecords.push(record);

    if (this.delegationRecords.length > 5000) {
      this.delegationRecords.splice(0, this.delegationRecords.length - 5000);
    }
  }

  /**
   * Generate a report comparing multi-agent vs single-agent performance.
   */
  generateReport(sinceMs?: number): OrchestrationReport {
    const cutoff = sinceMs ?? Date.now() - 7 * 24 * 60 * 60 * 1000; // Default: 7 days
    const tasks = this.taskOutcomes.filter((t) => t.timestamp >= cutoff);
    const handoffs = this.handoffOutcomes.filter((h) => h.timestamp >= cutoff);
    const delegations = this.delegationRecords.filter(
      (d) => d.timestamp >= cutoff
    );

    const singleTasks = tasks.filter((t) => t.collaborationMode === "single");
    const multiTasks = tasks.filter((t) => t.collaborationMode === "multi");

    const singleSuccessRate = this.successRate(singleTasks);
    const multiSuccessRate = this.successRate(multiTasks);

    const singleAvgQuality = this.avgField(singleTasks, "qualityScore");
    const multiAvgQuality = this.avgField(multiTasks, "qualityScore");

    const singleAvgDuration = this.avgField(singleTasks, "durationMs");
    const multiAvgDuration = this.avgField(multiTasks, "durationMs");

    const handoffSuccessRate =
      handoffs.length > 0
        ? handoffs.filter((h) => h.success).length / handoffs.length
        : 0;

    const delegationEfficiency =
      delegations.length > 0
        ? delegations.reduce(
            (sum, d) =>
              sum +
              (d.delegatedSubtasks > 0
                ? d.completedSubtasks / d.delegatedSubtasks
                : 0),
            0
          ) / delegations.length
        : 0;

    const avgCollaborationQuality = multiAvgQuality;
    const speedupFactor =
      multiAvgDuration > 0 && singleAvgDuration > 0
        ? singleAvgDuration / multiAvgDuration
        : 1;

    const report: OrchestrationReport = {
      period: { from: cutoff, to: Date.now() },
      totalTasks: tasks.length,
      singleAgentSuccessRate: singleSuccessRate,
      multiAgentSuccessRate: multiSuccessRate,
      singleAgentAvgQuality: singleAvgQuality,
      multiAgentAvgQuality: multiAvgQuality,
      singleAgentAvgDuration: singleAvgDuration,
      multiAgentAvgDuration: multiAvgDuration,
      handoffSuccessRate,
      delegationEfficiency,
      avgCollaborationQuality,
      speedupFactor,
    };

    logger.info(
      {
        totalTasks: report.totalTasks,
        multiSuccess: multiSuccessRate.toFixed(3),
        singleSuccess: singleSuccessRate.toFixed(3),
        speedup: speedupFactor.toFixed(2),
      },
      "Orchestration report generated"
    );

    return report;
  }

  /**
   * Get raw counts for dashboards.
   */
  getStats(): {
    delegationRecords: number;
    handoffOutcomes: number;
    taskOutcomes: number;
  } {
    return {
      taskOutcomes: this.taskOutcomes.length,
      handoffOutcomes: this.handoffOutcomes.length,
      delegationRecords: this.delegationRecords.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private successRate(tasks: TaskOutcome[]): number {
    if (tasks.length === 0) {
      return 0;
    }
    return tasks.filter((t) => t.success).length / tasks.length;
  }

  private avgField(
    tasks: TaskOutcome[],
    field: "qualityScore" | "durationMs"
  ): number {
    if (tasks.length === 0) {
      return 0;
    }
    return tasks.reduce((sum, t) => sum + t[field], 0) / tasks.length;
  }
}
