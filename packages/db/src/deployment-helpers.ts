/**
 * Deployment Strategy Helpers.
 *
 * Provides typed decision-making logic for canary checks, blue-green
 * switching, and rollback determination. These functions return
 * decision objects rather than performing actual deployment actions.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("db:deployment-helpers");

/** Result of a canary health check */
export interface CanaryCheckResult {
  errorRate: number;
  healthy: boolean;
  latencyP99Ms: number;
  reason: string;
  timestamp: Date;
}

/** Result of a blue-green switch decision */
export interface BlueGreenSwitchResult {
  activeColor: "blue" | "green";
  reason: string;
  shouldSwitch: boolean;
  targetColor: "blue" | "green";
  timestamp: Date;
}

/** Result of a rollback decision */
export interface RollbackCheckResult {
  reason: string;
  severity: "none" | "low" | "medium" | "high" | "critical";
  shouldRollback: boolean;
  timestamp: Date;
  triggeredMetrics: string[];
}

/** Metrics to evaluate for rollback decisions */
export interface DeploymentMetrics {
  activeConnections: number;
  errorRate: number; // percentage (0-100)
  failedHealthChecks: number;
  latencyP50Ms: number;
  latencyP99Ms: number;
  successRate: number; // percentage (0-100)
  totalHealthChecks: number;
}

/** Thresholds for rollback determination */
export interface RollbackThresholds {
  maxErrorRate: number;
  maxFailedHealthCheckPercent: number;
  maxLatencyP99Ms: number;
  minSuccessRate: number;
}

const DEFAULT_ROLLBACK_THRESHOLDS: RollbackThresholds = {
  maxErrorRate: 5,
  maxLatencyP99Ms: 5000,
  minSuccessRate: 95,
  maxFailedHealthCheckPercent: 10,
};

export class DeploymentHelper {
  /**
   * Validate canary deployment health.
   * Returns a decision on whether the canary is healthy enough to proceed.
   */
  async canaryCheck(
    healthEndpoint: string,
    errorThreshold: number
  ): Promise<CanaryCheckResult> {
    const timestamp = new Date();

    try {
      const response = await fetch(healthEndpoint, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        return {
          healthy: false,
          errorRate: 100,
          latencyP99Ms: 0,
          timestamp,
          reason: `Health endpoint returned ${response.status}`,
        };
      }

      const body = (await response.json()) as {
        error_rate?: number;
        latency_p99_ms?: number;
        status?: string;
      };

      const errorRate = body.error_rate ?? 0;
      const latencyP99Ms = body.latency_p99_ms ?? 0;
      const healthy = errorRate <= errorThreshold;

      const result: CanaryCheckResult = {
        healthy,
        errorRate,
        latencyP99Ms,
        timestamp,
        reason: healthy
          ? `Error rate ${errorRate}% is within threshold ${errorThreshold}%`
          : `Error rate ${errorRate}% exceeds threshold ${errorThreshold}%`,
      };

      logger.info(
        { healthEndpoint, healthy, errorRate, errorThreshold },
        "Canary check completed"
      );

      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ healthEndpoint, error: msg }, "Canary check failed");

      return {
        healthy: false,
        errorRate: 100,
        latencyP99Ms: 0,
        timestamp,
        reason: `Health check failed: ${msg}`,
      };
    }
  }

  /**
   * Determine whether to switch traffic from one color to another
   * in a blue-green deployment.
   */
  blueGreenSwitch(
    activeColor: "blue" | "green",
    targetColor: "blue" | "green"
  ): BlueGreenSwitchResult {
    const timestamp = new Date();

    if (activeColor === targetColor) {
      return {
        shouldSwitch: false,
        activeColor,
        targetColor,
        reason: `Already on ${activeColor}, no switch needed`,
        timestamp,
      };
    }

    const result: BlueGreenSwitchResult = {
      shouldSwitch: true,
      activeColor,
      targetColor,
      reason: `Switching traffic from ${activeColor} to ${targetColor}`,
      timestamp,
    };

    logger.info(
      { activeColor, targetColor },
      "Blue-green switch decision made"
    );

    return result;
  }

  /**
   * Evaluate deployment metrics to determine if a rollback is needed.
   */
  rollbackCheck(
    metrics: DeploymentMetrics,
    thresholds?: RollbackThresholds
  ): RollbackCheckResult {
    const t = thresholds ?? DEFAULT_ROLLBACK_THRESHOLDS;
    const timestamp = new Date();
    const triggeredMetrics: string[] = [];

    if (metrics.errorRate > t.maxErrorRate) {
      triggeredMetrics.push(
        `errorRate: ${metrics.errorRate}% > ${t.maxErrorRate}%`
      );
    }

    if (metrics.latencyP99Ms > t.maxLatencyP99Ms) {
      triggeredMetrics.push(
        `latencyP99: ${metrics.latencyP99Ms}ms > ${t.maxLatencyP99Ms}ms`
      );
    }

    if (metrics.successRate < t.minSuccessRate) {
      triggeredMetrics.push(
        `successRate: ${metrics.successRate}% < ${t.minSuccessRate}%`
      );
    }

    const failedPercent =
      metrics.totalHealthChecks > 0
        ? (metrics.failedHealthChecks / metrics.totalHealthChecks) * 100
        : 0;

    if (failedPercent > t.maxFailedHealthCheckPercent) {
      triggeredMetrics.push(
        `failedHealthChecks: ${failedPercent.toFixed(1)}% > ${t.maxFailedHealthCheckPercent}%`
      );
    }

    const shouldRollback = triggeredMetrics.length > 0;

    let severity: RollbackCheckResult["severity"] = "none";
    if (triggeredMetrics.length >= 3) {
      severity = "critical";
    } else if (triggeredMetrics.length === 2) {
      severity = "high";
    } else if (triggeredMetrics.length === 1) {
      severity = "medium";
    }

    // Escalate to critical if error rate is extreme
    if (metrics.errorRate > t.maxErrorRate * 5) {
      severity = "critical";
    }

    const result: RollbackCheckResult = {
      shouldRollback,
      severity,
      reason: shouldRollback
        ? `Rollback recommended: ${triggeredMetrics.join("; ")}`
        : "All metrics within acceptable thresholds",
      triggeredMetrics,
      timestamp,
    };

    if (shouldRollback) {
      logger.warn(
        { severity, triggeredMetrics },
        "Rollback recommended based on deployment metrics"
      );
    } else {
      logger.info("Deployment metrics within thresholds, no rollback needed");
    }

    return result;
  }
}
