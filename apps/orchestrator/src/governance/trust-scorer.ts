/**
 * Trust Scorer — Per-agent trust score based on performance history.
 *
 * Trust = 0.4*success_rate + 0.3*avg_quality + 0.2*(1-violation_rate) + 0.1*efficiency
 *
 * Trust levels:
 * - Autonomous (>0.85): No human oversight needed
 * - Supervised (0.6-0.85): Human review on significant changes
 * - Restricted (<0.6): Human approval for all file writes
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:trust-scorer");

export type TrustLevel = "autonomous" | "supervised" | "restricted";

export interface TrustScore {
  factors: {
    successRate: number;
    avgQuality: number;
    violationRate: number;
    efficiency: number;
  };
  level: TrustLevel;
  score: number;
}

interface AgentHistory {
  avgQualityScore: number;
  completedTasks: number;
  failedTasks: number;
  totalIterations: number;
  totalTokens: number;
  violations: number;
}

export class TrustScorer {
  private readonly history = new Map<string, AgentHistory>();

  recordOutcome(
    agentRole: string,
    success: boolean,
    qualityScore: number,
    iterations: number,
    tokens: number,
    violation = false
  ): void {
    let h = this.history.get(agentRole);
    if (!h) {
      h = {
        completedTasks: 0,
        failedTasks: 0,
        avgQualityScore: 0,
        violations: 0,
        totalIterations: 0,
        totalTokens: 0,
      };
      this.history.set(agentRole, h);
    }

    if (success) {
      h.completedTasks++;
    } else {
      h.failedTasks++;
    }

    // Running average for quality
    const totalTasks = h.completedTasks + h.failedTasks;
    h.avgQualityScore =
      (h.avgQualityScore * (totalTasks - 1) + qualityScore) / totalTasks;

    h.totalIterations += iterations;
    h.totalTokens += tokens;

    if (violation) {
      h.violations++;
    }
  }

  getTrustLevel(agentRole: string): TrustScore {
    const h = this.history.get(agentRole);

    // Default: supervised for new agents
    if (!h || h.completedTasks + h.failedTasks < 3) {
      return {
        score: 0.7,
        level: "supervised",
        factors: {
          successRate: 0.7,
          avgQuality: 0.7,
          violationRate: 0,
          efficiency: 0.7,
        },
      };
    }

    const totalTasks = h.completedTasks + h.failedTasks;
    const successRate = h.completedTasks / totalTasks;
    const avgQuality = h.avgQualityScore;
    const violationRate = h.violations / totalTasks;
    const avgIterations = h.totalIterations / totalTasks;
    const efficiency = Math.min(1, 10 / Math.max(avgIterations, 1));

    const score =
      0.4 * successRate +
      0.3 * avgQuality +
      0.2 * (1 - violationRate) +
      0.1 * efficiency;

    let level: TrustLevel;
    if (score > 0.85) {
      level = "autonomous";
    } else if (score >= 0.6) {
      level = "supervised";
    } else {
      level = "restricted";
    }

    logger.debug(
      {
        agentRole,
        score: score.toFixed(3),
        level,
        totalTasks,
        successRate: successRate.toFixed(2),
      },
      "Trust score calculated"
    );

    return {
      score,
      level,
      factors: { successRate, avgQuality, violationRate, efficiency },
    };
  }

  getAllScores(): Record<string, TrustScore> {
    const result: Record<string, TrustScore> = {};
    for (const role of this.history.keys()) {
      result[role] = this.getTrustLevel(role);
    }
    return result;
  }
}
