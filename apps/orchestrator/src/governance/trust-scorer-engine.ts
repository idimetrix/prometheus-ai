/**
 * GAP-094: Trust Scoring Engine
 *
 * Computes trust scores per agent based on historical performance.
 * Factors: success rate, error frequency, user corrections, task complexity.
 * Gates autonomous actions based on computed trust level.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:trust-scorer-engine");

// ─── Types ────────────────────────────────────────────────────────────────────

export type TrustLevel = "autonomous" | "supervised" | "restricted";

export interface AgentTrustRecord {
  agentId: string;
  avgQuality: number;
  avgTaskComplexity: number;
  errorCount: number;
  lastUpdated: number;
  successCount: number;
  totalTasks: number;
  userCorrections: number;
}

export interface TrustScoreResult {
  agentId: string;
  canActAutonomously: boolean;
  factors: {
    successRate: number;
    errorFrequency: number;
    correctionRate: number;
    complexityHandling: number;
    qualityScore: number;
  };
  level: TrustLevel;
  requiresApproval: boolean;
  score: number;
}

export interface TrustScorerConfig {
  /** Score above which agent is autonomous (default: 0.85) */
  autonomousThreshold: number;
  /** Minimum tasks before trust can exceed supervised (default: 20) */
  minTasksForAutonomous: number;
  /** Score below which agent is restricted (default: 0.5) */
  restrictedThreshold: number;
  /** Weight factors */
  weights: {
    successRate: number;
    errorFrequency: number;
    correctionRate: number;
    complexityHandling: number;
    qualityScore: number;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: TrustScorerConfig = {
  autonomousThreshold: 0.85,
  restrictedThreshold: 0.5,
  minTasksForAutonomous: 20,
  weights: {
    successRate: 0.3,
    errorFrequency: 0.15,
    correctionRate: 0.2,
    complexityHandling: 0.15,
    qualityScore: 0.2,
  },
};

// ─── Trust Scorer Engine ─────────────────────────────────────────────────────

export class TrustScorerEngine {
  private readonly records = new Map<string, AgentTrustRecord>();
  private readonly config: TrustScorerConfig;

  constructor(config?: Partial<TrustScorerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a task outcome for an agent.
   */
  recordOutcome(params: {
    agentId: string;
    success: boolean;
    hadErrors: boolean;
    userCorrected: boolean;
    taskComplexity: number;
    qualityScore: number;
  }): void {
    const record = this.getOrCreateRecord(params.agentId);

    record.totalTasks++;
    if (params.success) {
      record.successCount++;
    }
    if (params.hadErrors) {
      record.errorCount++;
    }
    if (params.userCorrected) {
      record.userCorrections++;
    }

    // Exponential moving average for complexity and quality
    const alpha = 2 / (Math.min(record.totalTasks, 50) + 1);
    record.avgTaskComplexity =
      alpha * params.taskComplexity + (1 - alpha) * record.avgTaskComplexity;
    record.avgQuality =
      alpha * params.qualityScore + (1 - alpha) * record.avgQuality;
    record.lastUpdated = Date.now();

    logger.debug(
      {
        agentId: params.agentId,
        totalTasks: record.totalTasks,
        success: params.success,
      },
      "Trust outcome recorded"
    );
  }

  /**
   * Compute the current trust score for an agent.
   */
  computeScore(agentId: string): TrustScoreResult {
    const record = this.getOrCreateRecord(agentId);
    const { weights, autonomousThreshold, restrictedThreshold } = this.config;

    // Calculate individual factors (0-1 scale)
    const successRate =
      record.totalTasks > 0 ? record.successCount / record.totalTasks : 0.5;

    const errorFrequency =
      record.totalTasks > 0 ? 1 - record.errorCount / record.totalTasks : 0.5;

    const correctionRate =
      record.totalTasks > 0
        ? 1 - record.userCorrections / record.totalTasks
        : 0.5;

    // Higher complexity tasks handled well = higher trust
    const complexityHandling =
      record.avgTaskComplexity > 0
        ? Math.min(1, record.avgQuality * record.avgTaskComplexity)
        : 0.5;

    const qualityScore = record.avgQuality;

    // Compute weighted score
    const score = Math.min(
      1,
      Math.max(
        0,
        successRate * weights.successRate +
          errorFrequency * weights.errorFrequency +
          correctionRate * weights.correctionRate +
          complexityHandling * weights.complexityHandling +
          qualityScore * weights.qualityScore
      )
    );

    // Determine trust level
    let level: TrustLevel;
    if (
      score >= autonomousThreshold &&
      record.totalTasks >= this.config.minTasksForAutonomous
    ) {
      level = "autonomous";
    } else if (score < restrictedThreshold) {
      level = "restricted";
    } else {
      level = "supervised";
    }

    const result: TrustScoreResult = {
      agentId,
      score,
      level,
      factors: {
        successRate,
        errorFrequency,
        correctionRate,
        complexityHandling,
        qualityScore,
      },
      canActAutonomously: level === "autonomous",
      requiresApproval: level === "restricted",
    };

    logger.info(
      {
        agentId,
        score: score.toFixed(3),
        level,
        totalTasks: record.totalTasks,
      },
      "Trust score computed"
    );

    return result;
  }

  /**
   * Check if an agent is allowed to perform a specific action autonomously.
   */
  canPerformAction(
    agentId: string,
    actionType: "file_write" | "git_commit" | "deploy" | "delete"
  ): boolean {
    const trust = this.computeScore(agentId);

    // Different actions require different trust levels
    const requiredLevels: Record<string, TrustLevel> = {
      file_write: "supervised",
      git_commit: "supervised",
      deploy: "autonomous",
      delete: "autonomous",
    };

    const required = requiredLevels[actionType] ?? "autonomous";
    const levelOrder: Record<TrustLevel, number> = {
      restricted: 0,
      supervised: 1,
      autonomous: 2,
    };

    return levelOrder[trust.level] >= levelOrder[required];
  }

  /**
   * Get all agent trust scores.
   */
  getAllScores(): TrustScoreResult[] {
    return [...this.records.keys()].map((id) => this.computeScore(id));
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private getOrCreateRecord(agentId: string): AgentTrustRecord {
    let record = this.records.get(agentId);
    if (!record) {
      record = {
        agentId,
        totalTasks: 0,
        successCount: 0,
        errorCount: 0,
        userCorrections: 0,
        avgTaskComplexity: 0.5,
        avgQuality: 0.5,
        lastUpdated: Date.now(),
      };
      this.records.set(agentId, record);
    }
    return record;
  }
}
