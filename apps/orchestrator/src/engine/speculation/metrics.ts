/**
 * Speculation Metrics — Tracks hit rate, miss rate, and wasted compute
 * for speculative execution. Auto-disables speculation if hit rate drops
 * below 30%.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:speculation:metrics");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpeculationMetricsSummary {
  /** Total milliseconds of compute saved by cache hits */
  computeSavedMs: number;
  /** Total milliseconds of compute wasted on misses */
  computeWastedMs: number;
  /** Whether speculation is currently enabled */
  enabled: boolean;
  /** Number of correct predictions */
  hitCount: number;
  /** Hit rate as a percentage string */
  hitRate: string;
  /** Number of incorrect predictions */
  missCount: number;
  /** Miss rate as a percentage string */
  missRate: string;
  /** Total speculation attempts */
  totalAttempts: number;
}

export interface SpeculationEvent {
  /** Duration of the speculative execution in ms */
  durationMs: number;
  /** Whether the speculation was correct */
  hit: boolean;
  /** When this event occurred */
  timestamp: number;
  /** Tool name that was predicted */
  toolName: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum hit rate before auto-disabling (30%). */
const MIN_HIT_RATE = 0.3;

/** Minimum number of attempts before evaluating hit rate. */
const MIN_ATTEMPTS_FOR_EVALUATION = 10;

/** Window size for rolling hit rate calculation. */
const ROLLING_WINDOW_SIZE = 50;

// ---------------------------------------------------------------------------
// SpeculationMetrics
// ---------------------------------------------------------------------------

export class SpeculationMetrics {
  private events: SpeculationEvent[] = [];
  private enabled = true;
  private totalComputeSavedMs = 0;
  private totalComputeWastedMs = 0;

  /**
   * Record a speculation attempt result.
   */
  record(toolName: string, hit: boolean, durationMs: number): void {
    const event: SpeculationEvent = {
      toolName,
      hit,
      durationMs,
      timestamp: Date.now(),
    };

    this.events.push(event);

    if (hit) {
      this.totalComputeSavedMs += durationMs;
    } else {
      this.totalComputeWastedMs += durationMs;
    }

    // Trim to rolling window
    if (this.events.length > ROLLING_WINDOW_SIZE * 2) {
      this.events = this.events.slice(-ROLLING_WINDOW_SIZE);
    }

    // Check if we should auto-disable
    this.evaluateAutoDisable();
  }

  /**
   * Check if speculation should be enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Manually enable speculation.
   */
  enable(): void {
    this.enabled = true;
    logger.info("Speculation manually enabled");
  }

  /**
   * Manually disable speculation.
   */
  disable(): void {
    this.enabled = false;
    logger.info("Speculation manually disabled");
  }

  /**
   * Get a summary of all metrics.
   */
  getSummary(): SpeculationMetricsSummary {
    const hitCount = this.events.filter((e) => e.hit).length;
    const missCount = this.events.filter((e) => !e.hit).length;
    const total = this.events.length;

    const hitRate =
      total > 0 ? `${((hitCount / total) * 100).toFixed(1)}%` : "0%";
    const missRate =
      total > 0 ? `${((missCount / total) * 100).toFixed(1)}%` : "0%";

    return {
      enabled: this.enabled,
      totalAttempts: total,
      hitCount,
      missCount,
      hitRate,
      missRate,
      computeSavedMs: this.totalComputeSavedMs,
      computeWastedMs: this.totalComputeWastedMs,
    };
  }

  /**
   * Get per-tool hit rates for analysis.
   */
  getPerToolStats(): Record<
    string,
    { hits: number; misses: number; hitRate: string }
  > {
    const stats: Record<string, { hits: number; misses: number }> = {};

    for (const event of this.events) {
      if (!stats[event.toolName]) {
        stats[event.toolName] = { hits: 0, misses: 0 };
      }
      const toolStats = stats[event.toolName];
      if (toolStats) {
        if (event.hit) {
          toolStats.hits++;
        } else {
          toolStats.misses++;
        }
      }
    }

    const result: Record<
      string,
      { hits: number; misses: number; hitRate: string }
    > = {};

    for (const [tool, s] of Object.entries(stats)) {
      const total = s.hits + s.misses;
      result[tool] = {
        ...s,
        hitRate: total > 0 ? `${((s.hits / total) * 100).toFixed(1)}%` : "0%",
      };
    }

    return result;
  }

  /**
   * Get Prometheus-compatible metric values.
   */
  getPrometheusMetrics(): Record<string, number> {
    const summary = this.getSummary();
    const hitCount = summary.hitCount;
    const missCount = summary.missCount;
    const total = summary.totalAttempts;

    return {
      speculation_hit_rate: total > 0 ? hitCount / total : 0,
      speculation_miss_rate: total > 0 ? missCount / total : 0,
      speculation_compute_saved_ms: this.totalComputeSavedMs,
      speculation_compute_wasted_ms: this.totalComputeWastedMs,
      speculation_total_attempts: total,
      speculation_enabled: this.enabled ? 1 : 0,
    };
  }

  /**
   * Reset all metrics.
   */
  reset(): void {
    this.events = [];
    this.enabled = true;
    this.totalComputeSavedMs = 0;
    this.totalComputeWastedMs = 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Evaluate whether to auto-disable speculation based on rolling hit rate.
   */
  private evaluateAutoDisable(): void {
    if (!this.enabled) {
      return;
    }

    if (this.events.length < MIN_ATTEMPTS_FOR_EVALUATION) {
      return;
    }

    // Use rolling window for evaluation
    const window = this.events.slice(-ROLLING_WINDOW_SIZE);
    const hits = window.filter((e) => e.hit).length;
    const hitRate = hits / window.length;

    if (hitRate < MIN_HIT_RATE) {
      this.enabled = false;
      logger.warn(
        {
          hitRate: `${(hitRate * 100).toFixed(1)}%`,
          threshold: `${(MIN_HIT_RATE * 100).toFixed(1)}%`,
          windowSize: window.length,
        },
        "Auto-disabling speculation due to low hit rate"
      );
    }
  }
}
