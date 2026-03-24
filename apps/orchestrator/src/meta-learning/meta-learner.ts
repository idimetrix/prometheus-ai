/**
 * Meta-Learner — Self-improving agent system.
 *
 * Analyzes completed sessions to extract patterns about which prompts,
 * tools, and agent configurations yield the best results. Feeds these
 * insights back into agent role configs so subsequent sessions improve.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:meta-learner");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionOutcome {
  /** Agent role that executed the session */
  agentRole: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Error message if the session failed */
  error?: string;
  /** Unique session identifier */
  sessionId: string;
  /** Whether the session succeeded */
  success: boolean;
  /** The task description */
  taskDescription: string;
  /** Total tokens consumed */
  tokensUsed: number;
  /** Number of tool calls made */
  toolCalls: number;
  /** Tools that were used */
  toolsUsed: string[];
  /** User satisfaction rating (1-5) if available */
  userRating?: number;
}

export interface LearnedPattern {
  /** Agent role this pattern applies to */
  agentRole: string;
  /** Pattern category */
  category: "prompt" | "tool" | "config" | "workflow";
  /** Confidence score (0-1) */
  confidence: number;
  /** Description of the pattern */
  description: string;
  /** When this pattern was discovered */
  discoveredAt: string;
  id: string;
  /** Recommended adjustments */
  recommendation: string;
  /** Number of sessions that contributed to this pattern */
  sampleSize: number;
}

export interface RoleAdjustment {
  adjustments: Array<{
    field: string;
    oldValue: string;
    newValue: string;
    reason: string;
  }>;
  agentRole: string;
}

export interface MetaLearnerStats {
  averageSuccessRate: number;
  commonFailureModes: Array<{ pattern: string; count: number }>;
  topPerformingRoles: Array<{ role: string; successRate: number }>;
  totalPatterns: number;
  totalSessions: number;
}

// ---------------------------------------------------------------------------
// MetaLearner
// ---------------------------------------------------------------------------

export class MetaLearner {
  private readonly outcomes: SessionOutcome[] = [];
  private readonly patterns: LearnedPattern[] = [];
  private readonly roleAdjustments = new Map<string, RoleAdjustment>();

  /**
   * Record a completed session outcome for analysis.
   */
  recordOutcome(outcome: SessionOutcome): void {
    this.outcomes.push(outcome);

    logger.info(
      {
        sessionId: outcome.sessionId,
        agentRole: outcome.agentRole,
        success: outcome.success,
        durationMs: outcome.durationMs,
        toolCalls: outcome.toolCalls,
      },
      "Recorded session outcome"
    );

    // Trigger pattern extraction when we have enough data
    if (this.outcomes.length % 10 === 0) {
      this.extractPatterns();
    }
  }

  /**
   * Analyze collected outcomes and extract actionable patterns.
   */
  extractPatterns(): LearnedPattern[] {
    const newPatterns: LearnedPattern[] = [];
    const byRole = this.groupByRole();

    for (const [role, roleOutcomes] of byRole) {
      if (roleOutcomes.length < 3) {
        continue;
      }

      const successfulOutcomes = roleOutcomes.filter((o) => o.success);
      const failedOutcomes = roleOutcomes.filter((o) => !o.success);
      const successRate = successfulOutcomes.length / roleOutcomes.length;

      newPatterns.push(
        ...this.extractToolPatterns(role, roleOutcomes, successfulOutcomes)
      );
      newPatterns.push(
        ...this.extractDurationPatterns(role, roleOutcomes, successfulOutcomes)
      );
      newPatterns.push(...this.extractFailurePatterns(role, failedOutcomes));

      if (successRate < 0.5 && roleOutcomes.length >= 5) {
        newPatterns.push({
          id: generateId("pat"),
          category: "prompt",
          agentRole: role,
          description: `Low success rate: ${(successRate * 100).toFixed(0)}% across ${roleOutcomes.length} sessions`,
          confidence: 0.8,
          sampleSize: roleOutcomes.length,
          recommendation: `Review and improve system prompt for ${role}`,
          discoveredAt: new Date().toISOString(),
        });
      }
    }

    this.deduplicateAndStore(newPatterns);

    logger.info(
      { newPatterns: newPatterns.length, totalPatterns: this.patterns.length },
      "Pattern extraction complete"
    );

    return newPatterns;
  }

  /**
   * Generate role adjustment recommendations based on learned patterns.
   */
  generateAdjustments(): RoleAdjustment[] {
    const adjustments: RoleAdjustment[] = [];

    // Group patterns by role
    const byRole = new Map<string, LearnedPattern[]>();
    for (const pattern of this.patterns) {
      const list = byRole.get(pattern.agentRole) ?? [];
      list.push(pattern);
      byRole.set(pattern.agentRole, list);
    }

    for (const [role, rolePatterns] of byRole) {
      const highConfidence = rolePatterns.filter((p) => p.confidence >= 0.6);
      if (highConfidence.length === 0) {
        continue;
      }

      const adjustment: RoleAdjustment = {
        agentRole: role,
        adjustments: highConfidence.map((p) => ({
          field: p.category,
          oldValue: "current",
          newValue: p.recommendation,
          reason: p.description,
        })),
      };

      adjustments.push(adjustment);
      this.roleAdjustments.set(role, adjustment);
    }

    logger.info(
      { adjustmentCount: adjustments.length },
      "Generated role adjustments"
    );

    return adjustments;
  }

  /**
   * Get overall statistics about meta-learning progress.
   */
  getStats(): MetaLearnerStats {
    const totalSessions = this.outcomes.length;
    const successful = this.outcomes.filter((o) => o.success).length;

    // Compute per-role success rates
    const roleStats = new Map<string, { total: number; success: number }>();
    for (const outcome of this.outcomes) {
      const stats = roleStats.get(outcome.agentRole) ?? {
        total: 0,
        success: 0,
      };
      stats.total += 1;
      if (outcome.success) {
        stats.success += 1;
      }
      roleStats.set(outcome.agentRole, stats);
    }

    const topPerformingRoles = [...roleStats.entries()]
      .map(([role, stats]) => ({
        role,
        successRate: stats.total > 0 ? stats.success / stats.total : 0,
      }))
      .sort((a, b) => b.successRate - a.successRate)
      .slice(0, 5);

    // Common failure modes
    const failureCounts = new Map<string, number>();
    for (const outcome of this.outcomes) {
      if (!outcome.success && outcome.error) {
        const key = outcome.error.slice(0, 80);
        failureCounts.set(key, (failureCounts.get(key) ?? 0) + 1);
      }
    }

    const commonFailureModes = [...failureCounts.entries()]
      .map(([pattern, count]) => ({ pattern, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalSessions,
      totalPatterns: this.patterns.length,
      averageSuccessRate: totalSessions > 0 ? successful / totalSessions : 0,
      topPerformingRoles,
      commonFailureModes,
    };
  }

  /**
   * Get all learned patterns.
   */
  getPatterns(): readonly LearnedPattern[] {
    return this.patterns;
  }

  /**
   * Get adjustments for a specific role.
   */
  getAdjustmentsForRole(role: string): RoleAdjustment | undefined {
    return this.roleAdjustments.get(role);
  }

  /**
   * Clear all collected data.
   */
  clear(): void {
    this.outcomes.length = 0;
    this.patterns.length = 0;
    this.roleAdjustments.clear();
    logger.info("Cleared all meta-learning data");
  }

  // ── Private helpers ──

  private groupByRole(): Map<string, SessionOutcome[]> {
    const byRole = new Map<string, SessionOutcome[]>();
    for (const outcome of this.outcomes) {
      const list = byRole.get(outcome.agentRole) ?? [];
      list.push(outcome);
      byRole.set(outcome.agentRole, list);
    }
    return byRole;
  }

  private extractToolPatterns(
    role: string,
    roleOutcomes: SessionOutcome[],
    successfulOutcomes: SessionOutcome[]
  ): LearnedPattern[] {
    const patterns: LearnedPattern[] = [];
    const toolSuccessRates = this.computeToolSuccessRates(roleOutcomes);

    for (const [tool, rate] of toolSuccessRates) {
      if (rate > 0.8 && successfulOutcomes.length >= 3) {
        patterns.push({
          id: generateId("pat"),
          category: "tool",
          agentRole: role,
          description: `Tool "${tool}" correlates with high success rate (${(rate * 100).toFixed(0)}%)`,
          confidence: Math.min(rate, roleOutcomes.length / 20),
          sampleSize: roleOutcomes.length,
          recommendation: `Prioritize "${tool}" in the tool ordering for ${role}`,
          discoveredAt: new Date().toISOString(),
        });
      }
    }

    return patterns;
  }

  private extractDurationPatterns(
    role: string,
    roleOutcomes: SessionOutcome[],
    successfulOutcomes: SessionOutcome[]
  ): LearnedPattern[] {
    const avgDuration =
      roleOutcomes.reduce((sum, o) => sum + o.durationMs, 0) /
      roleOutcomes.length;
    const successAvgDuration =
      successfulOutcomes.length > 0
        ? successfulOutcomes.reduce((sum, o) => sum + o.durationMs, 0) /
          successfulOutcomes.length
        : avgDuration;

    if (successAvgDuration > 120_000 && successfulOutcomes.length >= 3) {
      return [
        {
          id: generateId("pat"),
          category: "config",
          agentRole: role,
          description: `Average successful session duration is ${(successAvgDuration / 1000).toFixed(0)}s`,
          confidence: 0.7,
          sampleSize: successfulOutcomes.length,
          recommendation: `Consider increasing token budget or splitting tasks for ${role}`,
          discoveredAt: new Date().toISOString(),
        },
      ];
    }

    return [];
  }

  private extractFailurePatterns(
    role: string,
    failedOutcomes: SessionOutcome[]
  ): LearnedPattern[] {
    if (failedOutcomes.length < 2) {
      return [];
    }

    const patterns: LearnedPattern[] = [];
    const errorCounts = new Map<string, number>();

    for (const outcome of failedOutcomes) {
      const errorKey = outcome.error?.slice(0, 80) ?? "unknown";
      errorCounts.set(errorKey, (errorCounts.get(errorKey) ?? 0) + 1);
    }

    for (const [error, count] of errorCounts) {
      if (count >= 2) {
        patterns.push({
          id: generateId("pat"),
          category: "workflow",
          agentRole: role,
          description: `Recurring failure: "${error}" (${count} occurrences)`,
          confidence: count / failedOutcomes.length,
          sampleSize: failedOutcomes.length,
          recommendation: `Add error handling or pre-check for: ${error}`,
          discoveredAt: new Date().toISOString(),
        });
      }
    }

    return patterns;
  }

  private deduplicateAndStore(newPatterns: LearnedPattern[]): void {
    for (const pattern of newPatterns) {
      const exists = this.patterns.some(
        (p) =>
          p.agentRole === pattern.agentRole &&
          p.description === pattern.description
      );
      if (!exists) {
        this.patterns.push(pattern);
      }
    }
  }

  private computeToolSuccessRates(
    outcomes: SessionOutcome[]
  ): Map<string, number> {
    const toolStats = new Map<string, { total: number; success: number }>();

    for (const outcome of outcomes) {
      for (const tool of outcome.toolsUsed) {
        const stats = toolStats.get(tool) ?? { total: 0, success: 0 };
        stats.total += 1;
        if (outcome.success) {
          stats.success += 1;
        }
        toolStats.set(tool, stats);
      }
    }

    const rates = new Map<string, number>();
    for (const [tool, stats] of toolStats) {
      if (stats.total >= 2) {
        rates.set(tool, stats.success / stats.total);
      }
    }

    return rates;
  }
}
