import { createLogger } from "@prometheus/logger";

const logger = createLogger("telemetry:slo");

// ─── SLO Definitions ──────────────────────────────────────────────────────────

export interface SLODefinition {
  /** Comparison direction: "below" = value should be below threshold, "above" = above */
  direction: "above" | "below";
  /** Metric identifier */
  metric: string;
  /** Human-readable name */
  name: string;
  /** Target percentage (e.g., 99.5 means 99.5% of requests must meet threshold) */
  targetPercentage: number;
  /** Target threshold value (e.g., 200 for 200ms latency) */
  threshold: number;
  /** Window size in seconds for burn rate calculation */
  windowSeconds: number;
}

export const DEFAULT_SLOS: SLODefinition[] = [
  {
    name: "API P99 Latency",
    metric: "api_p99_latency_ms",
    threshold: 200,
    targetPercentage: 99.5,
    direction: "below",
    windowSeconds: 3600, // 1 hour
  },
  {
    name: "Agent Completion Rate",
    metric: "agent_completion_rate",
    threshold: 80,
    targetPercentage: 80,
    direction: "above",
    windowSeconds: 3600,
  },
  {
    name: "Event Delivery Latency",
    metric: "event_delivery_latency_ms",
    threshold: 100,
    targetPercentage: 99.9,
    direction: "below",
    windowSeconds: 3600,
  },
];

// ─── Rolling Window ───────────────────────────────────────────────────────────

interface DataPoint {
  timestamp: number;
  value: number;
}

interface SLOState {
  dataPoints: DataPoint[];
  definition: SLODefinition;
}

// ─── SLO Monitor ──────────────────────────────────────────────────────────────

export class SLOMonitor {
  private readonly slos = new Map<string, SLOState>();

  constructor(definitions: SLODefinition[] = DEFAULT_SLOS) {
    for (const def of definitions) {
      this.slos.set(def.metric, {
        definition: def,
        dataPoints: [],
      });
    }
  }

  /**
   * Record a metric value for SLO tracking.
   */
  record(metric: string, value: number): void {
    const state = this.slos.get(metric);
    if (!state) {
      return;
    }

    const now = Date.now();
    state.dataPoints.push({ timestamp: now, value });

    // Prune old data points outside the window
    const cutoff = now - state.definition.windowSeconds * 1000;
    state.dataPoints = state.dataPoints.filter((dp) => dp.timestamp >= cutoff);
  }

  /**
   * Calculate the burn rate for an SLO.
   *
   * Burn rate = (actual error rate) / (error budget rate).
   * A burn rate of 1.0 means you are consuming your error budget at exactly the
   * expected rate. >1.0 means you are burning faster than sustainable.
   */
  getBurnRate(metric: string): number {
    const state = this.slos.get(metric);
    if (!state || state.dataPoints.length === 0) {
      return 0;
    }

    const { definition, dataPoints } = state;
    const errorBudgetFraction = (100 - definition.targetPercentage) / 100;

    // Calculate fraction of data points that violate the SLO
    let violations = 0;
    for (const dp of dataPoints) {
      const violated =
        definition.direction === "below"
          ? dp.value > definition.threshold
          : dp.value < definition.threshold;
      if (violated) {
        violations++;
      }
    }

    const actualErrorRate = violations / dataPoints.length;

    if (errorBudgetFraction === 0) {
      return actualErrorRate > 0 ? Number.POSITIVE_INFINITY : 0;
    }

    return actualErrorRate / errorBudgetFraction;
  }

  /**
   * Check if an SLO is currently violated (burn rate > 1.0).
   */
  isViolated(metric: string): boolean {
    const burnRate = this.getBurnRate(metric);
    const violated = burnRate > 1.0;

    if (violated) {
      const state = this.slos.get(metric);
      logger.warn(
        {
          metric,
          burnRate: burnRate.toFixed(2),
          sloName: state?.definition.name,
          target: state?.definition.targetPercentage,
        },
        "SLO violated: burn rate exceeds budget"
      );
    }

    return violated;
  }

  /**
   * Get a summary of all SLO states.
   */
  getSummary(): Array<{
    burnRate: number;
    dataPoints: number;
    metric: string;
    name: string;
    targetPercentage: number;
    violated: boolean;
  }> {
    const results: Array<{
      burnRate: number;
      dataPoints: number;
      metric: string;
      name: string;
      targetPercentage: number;
      violated: boolean;
    }> = [];

    for (const [metric, state] of this.slos) {
      const burnRate = this.getBurnRate(metric);
      results.push({
        metric,
        name: state.definition.name,
        targetPercentage: state.definition.targetPercentage,
        burnRate,
        violated: burnRate > 1.0,
        dataPoints: state.dataPoints.length,
      });
    }

    return results;
  }
}
