/**
 * Agent Expertise Profiles
 *
 * Tracks performance metrics per agent role and task type to build
 * expertise profiles. Used for optimal agent selection and performance
 * monitoring.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:agent-expertise");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerformanceRecord {
  cost: number;
  quality: number;
  speed: number;
}

interface TaskTypeStats {
  avgCost: number;
  avgQuality: number;
  avgSpeed: number;
  observations: number;
  successes: number;
  successRate: number;
  totalCost: number;
  totalQuality: number;
  totalSpeed: number;
}

export interface ExpertiseProfile {
  agentRole: string;
  overallSuccessRate: number;
  strengths: string[];
  totalObservations: number;
  weaknesses: string[];
}

export interface PerformanceMatrixEntry {
  agentRole: string;
  avgCost: number;
  avgQuality: number;
  avgSpeed: number;
  observations: number;
  successRate: number;
  taskType: string;
}

// ---------------------------------------------------------------------------
// AgentExpertiseTracker
// ---------------------------------------------------------------------------

export class AgentExpertiseTracker {
  /** Keyed by `agentRole:taskType` */
  private readonly stats = new Map<string, TaskTypeStats>();

  /**
   * Record a performance observation for an agent on a specific task type.
   */
  recordPerformance(
    agentRole: string,
    taskType: string,
    quality: number,
    speed: number,
    cost: number,
    success = true
  ): void {
    const key = `${agentRole}:${taskType}`;
    const existing = this.stats.get(key) ?? {
      observations: 0,
      successes: 0,
      successRate: 0,
      totalQuality: 0,
      avgQuality: 0,
      totalSpeed: 0,
      avgSpeed: 0,
      totalCost: 0,
      avgCost: 0,
    };

    existing.observations++;
    if (success) {
      existing.successes++;
    }
    existing.successRate = existing.successes / existing.observations;
    existing.totalQuality += quality;
    existing.avgQuality = existing.totalQuality / existing.observations;
    existing.totalSpeed += speed;
    existing.avgSpeed = existing.totalSpeed / existing.observations;
    existing.totalCost += cost;
    existing.avgCost = existing.totalCost / existing.observations;

    this.stats.set(key, existing);

    logger.debug(
      {
        agentRole,
        taskType,
        quality,
        speed,
        observations: existing.observations,
      },
      "Performance recorded"
    );
  }

  /**
   * Get the expertise profile for an agent role.
   */
  getExpertise(agentRole: string): ExpertiseProfile {
    const taskTypes = new Map<string, TaskTypeStats>();
    let totalObs = 0;
    let totalSuccesses = 0;

    for (const [key, stats] of this.stats) {
      if (key.startsWith(`${agentRole}:`)) {
        const taskType = key.slice(agentRole.length + 1);
        taskTypes.set(taskType, stats);
        totalObs += stats.observations;
        totalSuccesses += stats.successes;
      }
    }

    const strengths: string[] = [];
    const weaknesses: string[] = [];

    for (const [taskType, stats] of taskTypes) {
      if (stats.observations < 3) {
        continue;
      }

      if (stats.successRate >= 0.8 && stats.avgQuality >= 0.7) {
        strengths.push(taskType);
      } else if (stats.successRate < 0.5 || stats.avgQuality < 0.5) {
        weaknesses.push(taskType);
      }
    }

    return {
      agentRole,
      totalObservations: totalObs,
      overallSuccessRate: totalObs > 0 ? totalSuccesses / totalObs : 0,
      strengths,
      weaknesses,
    };
  }

  /**
   * Find the best agent role for a given task type based on
   * historical performance.
   */
  getBestAgentFor(taskType: string): string | null {
    let bestRole: string | null = null;
    let bestScore = -1;

    for (const [key, stats] of this.stats) {
      if (!key.endsWith(`:${taskType}`)) {
        continue;
      }
      if (stats.observations < 3) {
        continue;
      }

      // Composite score: success rate * quality
      const score = stats.successRate * stats.avgQuality;
      if (score > bestScore) {
        bestScore = score;
        bestRole = key.split(":")[0] ?? null;
      }
    }

    return bestRole;
  }

  /**
   * Get a performance matrix of all agents x all task types.
   */
  getPerformanceMatrix(): PerformanceMatrixEntry[] {
    const entries: PerformanceMatrixEntry[] = [];

    for (const [key, stats] of this.stats) {
      const parts = key.split(":");
      const agentRole = parts[0] ?? "";
      const taskType = parts[1] ?? "";

      entries.push({
        agentRole,
        taskType,
        observations: stats.observations,
        successRate: stats.successRate,
        avgQuality: stats.avgQuality,
        avgSpeed: stats.avgSpeed,
        avgCost: stats.avgCost,
      });
    }

    return entries.sort((a, b) => {
      const scoreA = a.successRate * a.avgQuality;
      const scoreB = b.successRate * b.avgQuality;
      return scoreB - scoreA;
    });
  }
}
