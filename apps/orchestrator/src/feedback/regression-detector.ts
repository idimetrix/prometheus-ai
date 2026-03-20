/**
 * RegressionDetector — Monitors rolling 24h windows of agent success rates,
 * quality gate scores, and token efficiency per role. Fires alerts when
 * metrics drop below baseline thresholds.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:regression-detector");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AgentMetricSnapshot {
  agentRole: string;
  avgQualityScore: number;
  avgTokensPerTask: number;
  successRate: number;
  taskCount: number;
  timestamp: string;
}

export interface RegressionAlert {
  agentRole: string;
  baselineValue: number;
  currentValue: number;
  dropPercentage: number;
  metric: "success_rate" | "quality_score" | "token_efficiency";
  severity: "warning" | "critical";
  timestamp: string;
}

interface RollingWindow {
  baseline: AgentMetricSnapshot | null;
  snapshots: AgentMetricSnapshot[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WINDOW_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours
const MIN_TASKS_FOR_BASELINE = 10;
const SUCCESS_RATE_WARNING_DROP = 0.1; // 10% drop
const SUCCESS_RATE_CRITICAL_DROP = 0.2; // 20% drop
const QUALITY_WARNING_DROP = 0.15;
const QUALITY_CRITICAL_DROP = 0.25;
const TOKEN_EFFICIENCY_WARNING_INCREASE = 0.3; // 30% more tokens
const TOKEN_EFFICIENCY_CRITICAL_INCREASE = 0.5; // 50% more tokens

// ---------------------------------------------------------------------------
// RegressionDetector
// ---------------------------------------------------------------------------

export class RegressionDetector {
  private readonly windows = new Map<string, RollingWindow>();
  private readonly alertCallbacks: Array<(alert: RegressionAlert) => void> = [];

  /**
   * Register a callback to receive regression alerts.
   */
  onAlert(callback: (alert: RegressionAlert) => void): void {
    this.alertCallbacks.push(callback);
  }

  /**
   * Record a completed task's metrics and check for regressions.
   */
  recordAndCheck(snapshot: AgentMetricSnapshot): RegressionAlert[] {
    const window = this.getOrCreateWindow(snapshot.agentRole);

    // Add snapshot and prune old entries
    window.snapshots.push(snapshot);
    this.pruneWindow(window);

    // Update baseline if we have enough data and no baseline exists
    if (!window.baseline && window.snapshots.length >= MIN_TASKS_FOR_BASELINE) {
      window.baseline = this.computeBaseline(window.snapshots);
      logger.info(
        {
          agentRole: snapshot.agentRole,
          baseline: window.baseline,
        },
        "Baseline established for agent role"
      );
    }

    // Check for regressions against baseline
    if (!window.baseline) {
      return [];
    }

    const alerts = this.detectRegressions(snapshot, window.baseline);

    for (const alert of alerts) {
      logger.warn(
        {
          agentRole: alert.agentRole,
          metric: alert.metric,
          current: alert.currentValue,
          baseline: alert.baselineValue,
          drop: `${alert.dropPercentage.toFixed(1)}%`,
          severity: alert.severity,
        },
        "Regression detected"
      );

      for (const cb of this.alertCallbacks) {
        cb(alert);
      }
    }

    return alerts;
  }

  /**
   * Get current metrics summary for a role.
   */
  getMetrics(agentRole: string): {
    baseline: AgentMetricSnapshot | null;
    recent: AgentMetricSnapshot | null;
    windowSize: number;
  } {
    const window = this.windows.get(agentRole);
    if (!window) {
      return { baseline: null, recent: null, windowSize: 0 };
    }

    const recent =
      window.snapshots.length > 0
        ? this.computeBaseline(window.snapshots.slice(-5))
        : null;

    return {
      baseline: window.baseline,
      recent,
      windowSize: window.snapshots.length,
    };
  }

  /**
   * Reset baseline for a role (e.g., after intentional changes).
   */
  resetBaseline(agentRole: string): void {
    const window = this.windows.get(agentRole);
    if (window) {
      window.baseline = null;
      logger.info({ agentRole }, "Baseline reset");
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private getOrCreateWindow(agentRole: string): RollingWindow {
    if (!this.windows.has(agentRole)) {
      this.windows.set(agentRole, { snapshots: [], baseline: null });
    }
    return this.windows.get(agentRole) as RollingWindow;
  }

  private pruneWindow(window: RollingWindow): void {
    const cutoff = Date.now() - WINDOW_DURATION_MS;
    window.snapshots = window.snapshots.filter(
      (s) => new Date(s.timestamp).getTime() > cutoff
    );
  }

  private computeBaseline(
    snapshots: AgentMetricSnapshot[]
  ): AgentMetricSnapshot {
    const count = snapshots.length;
    if (count === 0) {
      return {
        agentRole: "",
        successRate: 0,
        avgQualityScore: 0,
        avgTokensPerTask: 0,
        taskCount: 0,
        timestamp: new Date().toISOString(),
      };
    }

    const totalSuccess = snapshots.reduce((s, x) => s + x.successRate, 0);
    const totalQuality = snapshots.reduce((s, x) => s + x.avgQualityScore, 0);
    const totalTokens = snapshots.reduce((s, x) => s + x.avgTokensPerTask, 0);
    const totalTasks = snapshots.reduce((s, x) => s + x.taskCount, 0);

    return {
      agentRole: snapshots[0]?.agentRole ?? "",
      successRate: totalSuccess / count,
      avgQualityScore: totalQuality / count,
      avgTokensPerTask: totalTokens / count,
      taskCount: totalTasks,
      timestamp: new Date().toISOString(),
    };
  }

  private detectRegressions(
    current: AgentMetricSnapshot,
    baseline: AgentMetricSnapshot
  ): RegressionAlert[] {
    const alerts: RegressionAlert[] = [];
    const now = new Date().toISOString();

    // Check success rate drop
    if (baseline.successRate > 0) {
      const drop = baseline.successRate - current.successRate;
      const dropPct = drop / baseline.successRate;

      if (dropPct >= SUCCESS_RATE_CRITICAL_DROP) {
        alerts.push({
          agentRole: current.agentRole,
          metric: "success_rate",
          currentValue: current.successRate,
          baselineValue: baseline.successRate,
          dropPercentage: dropPct * 100,
          severity: "critical",
          timestamp: now,
        });
      } else if (dropPct >= SUCCESS_RATE_WARNING_DROP) {
        alerts.push({
          agentRole: current.agentRole,
          metric: "success_rate",
          currentValue: current.successRate,
          baselineValue: baseline.successRate,
          dropPercentage: dropPct * 100,
          severity: "warning",
          timestamp: now,
        });
      }
    }

    // Check quality score drop
    if (baseline.avgQualityScore > 0) {
      const drop = baseline.avgQualityScore - current.avgQualityScore;
      const dropPct = drop / baseline.avgQualityScore;

      if (dropPct >= QUALITY_CRITICAL_DROP) {
        alerts.push({
          agentRole: current.agentRole,
          metric: "quality_score",
          currentValue: current.avgQualityScore,
          baselineValue: baseline.avgQualityScore,
          dropPercentage: dropPct * 100,
          severity: "critical",
          timestamp: now,
        });
      } else if (dropPct >= QUALITY_WARNING_DROP) {
        alerts.push({
          agentRole: current.agentRole,
          metric: "quality_score",
          currentValue: current.avgQualityScore,
          baselineValue: baseline.avgQualityScore,
          dropPercentage: dropPct * 100,
          severity: "warning",
          timestamp: now,
        });
      }
    }

    // Check token efficiency regression (tokens going UP is bad)
    if (baseline.avgTokensPerTask > 0) {
      const increase = current.avgTokensPerTask - baseline.avgTokensPerTask;
      const increasePct = increase / baseline.avgTokensPerTask;

      if (increasePct >= TOKEN_EFFICIENCY_CRITICAL_INCREASE) {
        alerts.push({
          agentRole: current.agentRole,
          metric: "token_efficiency",
          currentValue: current.avgTokensPerTask,
          baselineValue: baseline.avgTokensPerTask,
          dropPercentage: increasePct * 100,
          severity: "critical",
          timestamp: now,
        });
      } else if (increasePct >= TOKEN_EFFICIENCY_WARNING_INCREASE) {
        alerts.push({
          agentRole: current.agentRole,
          metric: "token_efficiency",
          currentValue: current.avgTokensPerTask,
          baselineValue: baseline.avgTokensPerTask,
          dropPercentage: increasePct * 100,
          severity: "warning",
          timestamp: now,
        });
      }
    }

    return alerts;
  }
}
