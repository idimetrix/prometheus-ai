/**
 * FleetMetrics — Tracks performance metrics for multi-agent fleet
 * orchestration, including parallel speedup ratios, conflict resolution
 * counts, and per-agent success rates.
 *
 * Provides evidence for the effectiveness of fleet orchestration by
 * comparing parallel execution time against estimated sequential time.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:fleet:metrics");

/** Metrics for a single agent's execution within the fleet */
export interface AgentMetric {
  agentId: string;
  completedAt: number;
  durationMs: number;
  filesChanged: number;
  role: string;
  startedAt: number;
  success: boolean;
  taskId: string;
  tokensUsed: number;
}

/** Metrics for a single wave of parallel execution */
export interface WaveMetric {
  agentCount: number;
  durationMs: number;
  failedCount: number;
  successCount: number;
  waveIndex: number;
}

/** Conflict resolution metrics */
export interface ConflictMetric {
  autoResolved: number;
  filesAffected: number;
  llmAssisted: number;
  manualRequired: number;
  totalConflicts: number;
}

/** Aggregated fleet execution summary */
export interface FleetMetricsSummary {
  /** Per-agent metrics */
  agentMetrics: AgentMetric[];
  /** Conflict resolution metrics */
  conflicts: ConflictMetric;
  /** Estimated sequential time if agents ran one-by-one */
  estimatedSequentialMs: number;
  /** Overall success rate across all agents */
  overallSuccessRate: number;

  // ─── Computed metrics ──────────────────────────────────────────────
  /** Parallel speedup ratio (sequential / parallel) */
  parallelSpeedupRatio: number;
  /** Per-agent success rates by role */
  successRateByRole: Record<string, number>;
  /** Total tokens consumed across all agents */
  totalTokensUsed: number;
  /** Total wall-clock time for fleet execution */
  totalWallClockMs: number;
  /** Number of waves executed */
  waveCount: number;
  /** Per-wave metrics */
  waveMetrics: WaveMetric[];
}

/**
 * FleetMetrics tracks and computes performance metrics for fleet
 * orchestration runs.
 */
export class FleetMetrics {
  private readonly agents: AgentMetric[] = [];
  private readonly waves: WaveMetric[] = [];
  private readonly conflictData: ConflictMetric = {
    totalConflicts: 0,
    autoResolved: 0,
    llmAssisted: 0,
    manualRequired: 0,
    filesAffected: 0,
  };

  private fleetStartedAt = 0;
  private fleetCompletedAt = 0;

  /** Mark the start of fleet execution */
  startFleet(): void {
    this.fleetStartedAt = Date.now();
  }

  /** Mark the end of fleet execution */
  endFleet(): void {
    this.fleetCompletedAt = Date.now();
  }

  /** Record an agent's execution result */
  recordAgent(metric: AgentMetric): void {
    this.agents.push(metric);
    logger.debug(
      {
        agentId: metric.agentId,
        role: metric.role,
        success: metric.success,
        durationMs: metric.durationMs,
      },
      "Agent metric recorded"
    );
  }

  /** Record a wave's execution result */
  recordWave(metric: WaveMetric): void {
    this.waves.push(metric);
  }

  /** Record conflict resolution outcomes */
  recordConflicts(data: Partial<ConflictMetric>): void {
    if (data.totalConflicts !== undefined) {
      this.conflictData.totalConflicts += data.totalConflicts;
    }
    if (data.autoResolved !== undefined) {
      this.conflictData.autoResolved += data.autoResolved;
    }
    if (data.llmAssisted !== undefined) {
      this.conflictData.llmAssisted += data.llmAssisted;
    }
    if (data.manualRequired !== undefined) {
      this.conflictData.manualRequired += data.manualRequired;
    }
    if (data.filesAffected !== undefined) {
      this.conflictData.filesAffected += data.filesAffected;
    }
  }

  /**
   * Compute the full metrics summary.
   */
  getSummary(): FleetMetricsSummary {
    const totalWallClockMs = this.fleetCompletedAt - this.fleetStartedAt;
    const estimatedSequentialMs = this.computeEstimatedSequentialMs();
    const parallelSpeedupRatio =
      totalWallClockMs > 0 ? estimatedSequentialMs / totalWallClockMs : 1;
    const successRateByRole = this.computeSuccessRateByRole();
    const overallSuccessRate = this.computeOverallSuccessRate();
    const totalTokensUsed = this.agents.reduce(
      (sum, a) => sum + a.tokensUsed,
      0
    );

    const summary: FleetMetricsSummary = {
      agentMetrics: this.agents,
      waveMetrics: this.waves,
      waveCount: this.waves.length,
      conflicts: { ...this.conflictData },
      estimatedSequentialMs,
      parallelSpeedupRatio: Math.round(parallelSpeedupRatio * 100) / 100,
      successRateByRole,
      overallSuccessRate,
      totalWallClockMs,
      totalTokensUsed,
    };

    logger.info(
      {
        parallelSpeedupRatio: summary.parallelSpeedupRatio,
        overallSuccessRate: summary.overallSuccessRate,
        waveCount: summary.waveCount,
        totalAgents: this.agents.length,
        totalConflicts: summary.conflicts.totalConflicts,
        totalWallClockMs: summary.totalWallClockMs,
      },
      "Fleet metrics summary computed"
    );

    return summary;
  }

  /**
   * Estimate total sequential execution time by summing all agent durations.
   * This represents how long it would take if agents ran one after another.
   */
  private computeEstimatedSequentialMs(): number {
    return this.agents.reduce((sum, a) => sum + a.durationMs, 0);
  }

  /**
   * Compute success rate for each agent role.
   */
  private computeSuccessRateByRole(): Record<string, number> {
    const roleCounts = new Map<string, { total: number; success: number }>();

    for (const agent of this.agents) {
      const existing = roleCounts.get(agent.role) ?? {
        total: 0,
        success: 0,
      };
      existing.total++;
      if (agent.success) {
        existing.success++;
      }
      roleCounts.set(agent.role, existing);
    }

    const rates: Record<string, number> = {};
    for (const [role, counts] of roleCounts) {
      rates[role] =
        counts.total > 0
          ? Math.round((counts.success / counts.total) * 100)
          : 0;
    }

    return rates;
  }

  /**
   * Compute overall success rate across all agents.
   */
  private computeOverallSuccessRate(): number {
    if (this.agents.length === 0) {
      return 0;
    }
    const successCount = this.agents.filter((a) => a.success).length;
    return Math.round((successCount / this.agents.length) * 100);
  }

  /** Reset all metrics for a new fleet run */
  reset(): void {
    this.agents.length = 0;
    this.waves.length = 0;
    this.conflictData.totalConflicts = 0;
    this.conflictData.autoResolved = 0;
    this.conflictData.llmAssisted = 0;
    this.conflictData.manualRequired = 0;
    this.conflictData.filesAffected = 0;
    this.fleetStartedAt = 0;
    this.fleetCompletedAt = 0;
  }
}
