/**
 * Canary Deployment Manager.
 *
 * Manages progressive canary rollouts with configurable ramp-up stages,
 * health monitoring at each stage, and automatic rollback on failure.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:canary-manager");

const MCP_GATEWAY_URL = process.env.MCP_GATEWAY_URL ?? "http://localhost:4005";
const STEP_TIMEOUT_MS = 120_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanaryConfig {
  /** Branch being deployed */
  branch: string;
  /** Health check endpoint to poll at each stage */
  healthCheckUrl?: string;
  /** Max acceptable error rate (0.0 - 1.0) before rollback */
  maxErrorRate: number;
  /** Max acceptable p95 latency in ms before rollback */
  maxLatencyP95Ms: number;
  /** How long to observe metrics at each stage (ms) */
  observationWindowMs: number;
  /** Project ID for the deployment */
  projectId: string;
  /** Traffic percentage stages (e.g., [5, 25, 50, 100]) */
  stages: number[];
}

export interface CanaryStage {
  /** When this stage completed */
  completedAt?: string;
  /** Error rate observed during this stage */
  errorRate: number;
  /** p95 latency observed during this stage */
  latencyP95Ms: number;
  /** Whether the stage passed health criteria */
  passed: boolean;
  /** Traffic percentage at this stage */
  percentage: number;
  /** When this stage started */
  startedAt: string;
  /** Current status of this stage */
  status: "pending" | "running" | "passed" | "failed" | "skipped";
}

export interface CanaryRollout {
  /** Branch being deployed */
  branch: string;
  /** Deployment configuration */
  config: CanaryConfig;
  /** Rollout ID */
  id: string;
  /** Project being deployed */
  projectId: string;
  /** Stages of the canary rollout */
  stages: CanaryStage[];
  /** When the rollout started */
  startedAt: string;
  /** Current status */
  status: "running" | "promoted" | "rolled_back" | "failed";
}

// ---------------------------------------------------------------------------
// CanaryManager
// ---------------------------------------------------------------------------

export class CanaryManager {
  private readonly mcpGatewayUrl: string;

  constructor(mcpGatewayUrl?: string) {
    this.mcpGatewayUrl = mcpGatewayUrl ?? MCP_GATEWAY_URL;
  }

  /**
   * Execute a progressive canary rollout. Ramps traffic through each configured
   * stage, observing health metrics at each one. Rolls back immediately on failure.
   */
  async executeCanaryRollout(config: CanaryConfig): Promise<CanaryRollout> {
    const rollout: CanaryRollout = {
      id: generateId("canary"),
      projectId: config.projectId,
      branch: config.branch,
      config,
      startedAt: new Date().toISOString(),
      status: "running",
      stages: config.stages.map((pct) => ({
        percentage: pct,
        status: "pending",
        passed: false,
        errorRate: 0,
        latencyP95Ms: 0,
        startedAt: "",
      })),
    };

    logger.info(
      {
        rolloutId: rollout.id,
        projectId: config.projectId,
        stages: config.stages,
      },
      "Starting canary rollout"
    );

    for (const stage of rollout.stages) {
      stage.status = "running";
      stage.startedAt = new Date().toISOString();

      try {
        // Set traffic percentage
        await this.setTrafficPercentage(
          config.projectId,
          config.branch,
          stage.percentage
        );

        logger.info(
          { rolloutId: rollout.id, percentage: stage.percentage },
          "Canary stage started"
        );

        // Observe metrics during the observation window
        const metrics = await this.observeMetrics(
          config.healthCheckUrl,
          config.observationWindowMs
        );

        stage.errorRate = metrics.errorRate;
        stage.latencyP95Ms = metrics.latencyP95Ms;
        stage.completedAt = new Date().toISOString();

        // Check health criteria
        const healthy =
          metrics.errorRate <= config.maxErrorRate &&
          metrics.latencyP95Ms <= config.maxLatencyP95Ms;

        if (healthy) {
          stage.status = "passed";
          stage.passed = true;

          logger.info(
            {
              rolloutId: rollout.id,
              percentage: stage.percentage,
              errorRate: metrics.errorRate,
              latencyP95Ms: metrics.latencyP95Ms,
            },
            "Canary stage passed"
          );
        } else {
          stage.status = "failed";
          stage.passed = false;

          logger.warn(
            {
              rolloutId: rollout.id,
              percentage: stage.percentage,
              errorRate: metrics.errorRate,
              latencyP95Ms: metrics.latencyP95Ms,
              maxErrorRate: config.maxErrorRate,
              maxLatencyP95Ms: config.maxLatencyP95Ms,
            },
            "Canary stage failed health check"
          );

          // Skip remaining stages
          for (const remaining of rollout.stages) {
            if (remaining.status === "pending") {
              remaining.status = "skipped";
            }
          }

          // Rollback
          await this.rollback(config.projectId, rollout.id);
          rollout.status = "rolled_back";

          return rollout;
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        stage.status = "failed";
        stage.completedAt = new Date().toISOString();

        logger.error(
          { rolloutId: rollout.id, percentage: stage.percentage, error: msg },
          "Canary stage error"
        );

        // Skip remaining
        for (const remaining of rollout.stages) {
          if (remaining.status === "pending") {
            remaining.status = "skipped";
          }
        }

        await this.rollback(config.projectId, rollout.id).catch(() => {
          // Rollback failure should not mask the original error
        });
        rollout.status = "failed";

        return rollout;
      }
    }

    // All stages passed — promote to full production
    rollout.status = "promoted";

    logger.info(
      { rolloutId: rollout.id, projectId: config.projectId },
      "Canary rollout promoted to production"
    );

    return rollout;
  }

  /**
   * Set the canary traffic percentage via the MCP Vercel adapter.
   */
  private async setTrafficPercentage(
    projectId: string,
    branch: string,
    percentage: number
  ): Promise<void> {
    const response = await fetch(
      `${this.mcpGatewayUrl}/api/adapters/vercel/canary`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, branch, percentage }),
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to set canary traffic to ${percentage}%: ${response.status}`
      );
    }
  }

  /**
   * Observe health metrics during the observation window.
   * In production, this would poll a metrics endpoint.
   */
  private async observeMetrics(
    healthCheckUrl: string | undefined,
    observationWindowMs: number
  ): Promise<{ errorRate: number; latencyP95Ms: number }> {
    if (!healthCheckUrl) {
      // Without a health URL, wait for the observation window
      // and assume healthy (metrics would come from the monitoring stack)
      await sleep(Math.min(observationWindowMs, 5000));
      return { errorRate: 0, latencyP95Ms: 0 };
    }

    const startTime = Date.now();
    let totalChecks = 0;
    let failedChecks = 0;
    const latencies: number[] = [];
    const CHECK_INTERVAL_MS = 5000;

    while (Date.now() - startTime < observationWindowMs) {
      const checkStart = Date.now();

      try {
        const response = await fetch(healthCheckUrl, {
          signal: AbortSignal.timeout(10_000),
        });
        const latencyMs = Date.now() - checkStart;
        latencies.push(latencyMs);
        totalChecks++;

        if (!response.ok) {
          failedChecks++;
        }
      } catch {
        const latencyMs = Date.now() - checkStart;
        latencies.push(latencyMs);
        totalChecks++;
        failedChecks++;
      }

      await sleep(CHECK_INTERVAL_MS);
    }

    const errorRate = totalChecks > 0 ? failedChecks / totalChecks : 0;

    // Compute p95 latency
    latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(latencies.length * 0.95);
    const latencyP95Ms = latencies[p95Index] ?? 0;

    return { errorRate, latencyP95Ms };
  }

  /**
   * Roll back a canary deployment.
   */
  private async rollback(projectId: string, rolloutId: string): Promise<void> {
    logger.info({ projectId, rolloutId }, "Rolling back canary deployment");

    try {
      const response = await fetch(
        `${this.mcpGatewayUrl}/api/adapters/vercel/rollback`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, deploymentId: rolloutId }),
          signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
        }
      );

      if (response.ok) {
        logger.info({ projectId, rolloutId }, "Canary rollback completed");
      } else {
        logger.error(
          { projectId, rolloutId, status: response.status },
          "Canary rollback request failed"
        );
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { projectId, rolloutId, error: msg },
        "Canary rollback failed"
      );
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
