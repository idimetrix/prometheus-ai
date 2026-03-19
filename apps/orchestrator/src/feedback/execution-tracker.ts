import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:feedback");

const PROJECT_BRAIN_URL =
  process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003";

export interface ExecutionOutcome {
  agentRole: string;
  duration: number;
  errorType?: string;
  filesChanged: number;
  iterations: number;
  projectId: string;
  success: boolean;
  taskType: string;
  tokensUsed: number;
}

interface RoleStats {
  avgDuration: number;
  avgIterations: number;
  avgTokens: number;
  commonErrors: Map<string, number>;
  failCount: number;
  successCount: number;
}

/**
 * ExecutionTracker records and analyzes execution outcomes per agent role
 * and task type. Builds a learning loop where future planning can use
 * historical success rates to make better decisions.
 */
export class ExecutionTracker {
  private readonly stats = new Map<string, RoleStats>();

  /**
   * Record an execution outcome and persist as episodic memory.
   */
  async record(outcome: ExecutionOutcome): Promise<void> {
    const key = `${outcome.agentRole}:${outcome.taskType}`;
    const existing = this.stats.get(key) ?? {
      successCount: 0,
      failCount: 0,
      avgDuration: 0,
      avgIterations: 0,
      avgTokens: 0,
      commonErrors: new Map<string, number>(),
    };

    if (outcome.success) {
      existing.successCount++;
    } else {
      existing.failCount++;
      if (outcome.errorType) {
        existing.commonErrors.set(
          outcome.errorType,
          (existing.commonErrors.get(outcome.errorType) ?? 0) + 1
        );
      }
    }

    const total = existing.successCount + existing.failCount;
    existing.avgDuration =
      (existing.avgDuration * (total - 1) + outcome.duration) / total;
    existing.avgIterations =
      (existing.avgIterations * (total - 1) + outcome.iterations) / total;
    existing.avgTokens =
      (existing.avgTokens * (total - 1) + outcome.tokensUsed) / total;

    this.stats.set(key, existing);

    // Persist to episodic memory for cross-session learning
    await this.persistOutcome(outcome).catch((err) => {
      logger.warn({ err }, "Failed to persist execution outcome");
    });

    logger.debug(
      {
        role: outcome.agentRole,
        taskType: outcome.taskType,
        success: outcome.success,
        successRate: existing.successCount / total,
      },
      "Execution outcome recorded"
    );
  }

  /**
   * Get success rate for a role+taskType combination.
   */
  getSuccessRate(agentRole: string, taskType: string): number {
    const key = `${agentRole}:${taskType}`;
    const stats = this.stats.get(key);
    if (!stats) {
      return 0.5; // No data = neutral
    }
    const total = stats.successCount + stats.failCount;
    return total > 0 ? stats.successCount / total : 0.5;
  }

  /**
   * Get common error patterns for a role.
   */
  getCommonErrors(agentRole: string): Array<{ error: string; count: number }> {
    const errors = new Map<string, number>();
    for (const [key, stats] of this.stats) {
      if (key.startsWith(`${agentRole}:`)) {
        for (const [err, count] of stats.commonErrors) {
          errors.set(err, (errors.get(err) ?? 0) + count);
        }
      }
    }
    return Array.from(errors.entries())
      .map(([error, count]) => ({ error, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Generate a context string with execution insights for agent prompts.
   */
  getInsightsForRole(agentRole: string): string {
    const insights: string[] = [];

    for (const [key, stats] of this.stats) {
      if (!key.startsWith(`${agentRole}:`)) {
        continue;
      }
      const taskType = key.split(":")[1];
      const total = stats.successCount + stats.failCount;
      if (total < 3) {
        continue; // Not enough data
      }

      const rate = ((stats.successCount / total) * 100).toFixed(0);
      insights.push(
        `- ${taskType}: ${rate}% success rate (avg ${stats.avgIterations.toFixed(0)} iterations, ${stats.avgTokens.toFixed(0)} tokens)`
      );
    }

    const errors = this.getCommonErrors(agentRole);
    if (errors.length > 0) {
      insights.push("\nCommon error patterns to avoid:");
      for (const { error, count } of errors.slice(0, 3)) {
        insights.push(`- ${error} (${count} occurrences)`);
      }
    }

    return insights.length > 0
      ? `## Execution History Insights\n${insights.join("\n")}`
      : "";
  }

  private async persistOutcome(outcome: ExecutionOutcome): Promise<void> {
    const decision = outcome.success
      ? `${outcome.agentRole} completed ${outcome.taskType} in ${outcome.iterations} iterations`
      : `${outcome.agentRole} failed ${outcome.taskType}: ${outcome.errorType ?? "unknown"}`;

    await fetch(`${PROJECT_BRAIN_URL}/memory/store`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: outcome.projectId,
        type: "episodic",
        data: {
          eventType: "execution_outcome",
          decision,
          reasoning: `Duration: ${outcome.duration}ms, Tokens: ${outcome.tokensUsed}, Files: ${outcome.filesChanged}`,
          outcome: outcome.success ? "success" : "failure",
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
  }
}
