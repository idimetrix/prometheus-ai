/**
 * Cross-User Meta-Learning
 *
 * Aggregates anonymized task outcome patterns across all users to
 * identify the best strategies for different task types and agent roles.
 * Privacy-first: only stores pattern types, never code or user data.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:cross-user-learner");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OutcomeRecord {
  agentRole: string;
  quality: number;
  strategy: string;
  success: boolean;
  taskType: string;
  timestamp: string;
}

interface StrategyStats {
  avgQuality: number;
  observations: number;
  strategy: string;
  successCount: number;
  successRate: number;
  totalQuality: number;
}

export interface StrategyRecommendation {
  avgQuality: number;
  observations: number;
  strategy: string;
  successRate: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_OBSERVATIONS_FOR_RECOMMENDATION = 10;

// ---------------------------------------------------------------------------
// CrossUserLearner
// ---------------------------------------------------------------------------

export class CrossUserLearner {
  /**
   * In-memory store keyed by `taskType:agentRole` -> strategies.
   * In production, this would be backed by a database.
   */
  private readonly store = new Map<string, Map<string, StrategyStats>>();

  /**
   * Record an anonymized outcome for a task execution.
   * Only stores pattern types (taskType, agentRole, strategy, success, quality).
   * No code, user data, or PII is retained.
   */
  recordOutcome(
    taskType: string,
    agentRole: string,
    strategy: string,
    success: boolean,
    quality: number
  ): void {
    const key = `${taskType}:${agentRole}`;

    if (!this.store.has(key)) {
      this.store.set(key, new Map());
    }

    const strategies = this.store.get(key) as Map<string, StrategyStats>;
    const existing = strategies.get(strategy) ?? {
      strategy,
      observations: 0,
      successCount: 0,
      totalQuality: 0,
      successRate: 0,
      avgQuality: 0,
    };

    existing.observations++;
    if (success) {
      existing.successCount++;
    }
    existing.totalQuality += quality;
    existing.successRate =
      existing.observations > 0
        ? existing.successCount / existing.observations
        : 0;
    existing.avgQuality =
      existing.observations > 0
        ? existing.totalQuality / existing.observations
        : 0;

    strategies.set(strategy, existing);

    logger.debug(
      {
        taskType,
        agentRole,
        strategy,
        success,
        observations: existing.observations,
      },
      "Outcome recorded"
    );
  }

  /**
   * Get the best strategy for a given task type and agent role.
   * Returns null if fewer than MIN_OBSERVATIONS_FOR_RECOMMENDATION
   * observations have been collected.
   */
  getBestStrategy(
    taskType: string,
    agentRole: string
  ): StrategyRecommendation | null {
    const key = `${taskType}:${agentRole}`;
    const strategies = this.store.get(key);

    if (!strategies) {
      return null;
    }

    let best: StrategyStats | null = null;

    for (const stats of strategies.values()) {
      if (stats.observations < MIN_OBSERVATIONS_FOR_RECOMMENDATION) {
        continue;
      }

      if (
        !best ||
        stats.successRate > best.successRate ||
        (stats.successRate === best.successRate &&
          stats.avgQuality > best.avgQuality)
      ) {
        best = stats;
      }
    }

    if (!best) {
      return null;
    }

    return {
      strategy: best.strategy,
      successRate: best.successRate,
      avgQuality: best.avgQuality,
      observations: best.observations,
    };
  }

  /**
   * Get success rate by strategy for a given task type.
   * Returns all strategies with their effectiveness metrics.
   */
  getSuccessRateByStrategy(
    taskType: string
  ): Map<string, StrategyRecommendation> {
    const result = new Map<string, StrategyRecommendation>();

    for (const [key, strategies] of this.store) {
      if (!key.startsWith(`${taskType}:`)) {
        continue;
      }

      for (const [strategyName, stats] of strategies) {
        const existing = result.get(strategyName);
        if (existing) {
          // Merge across agent roles
          const totalObs = existing.observations + stats.observations;
          const totalSuccess =
            existing.successRate * existing.observations +
            stats.successRate * stats.observations;
          const totalQuality =
            existing.avgQuality * existing.observations +
            stats.avgQuality * stats.observations;

          result.set(strategyName, {
            strategy: strategyName,
            successRate: totalObs > 0 ? totalSuccess / totalObs : 0,
            avgQuality: totalObs > 0 ? totalQuality / totalObs : 0,
            observations: totalObs,
          });
        } else {
          result.set(strategyName, {
            strategy: stats.strategy,
            successRate: stats.successRate,
            avgQuality: stats.avgQuality,
            observations: stats.observations,
          });
        }
      }
    }

    return result;
  }
}
