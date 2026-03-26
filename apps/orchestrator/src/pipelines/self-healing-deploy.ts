/**
 * Self-Healing Deployment Pipeline (MOON-010)
 *
 * Monitors deployments and auto-rolls back on failure.
 * Supports canary deployments, health checks, and automatic
 * rollback when error rates exceed thresholds.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:pipeline:self-healing-deploy");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeployOptions {
  /** Percentage of traffic for canary (0-100). If omitted, full rollout. */
  canaryPercent?: number;
  /** Target environment */
  environment: string;
  /** URL to check for health */
  healthCheckUrl: string;
  /** Project to deploy */
  projectId: string;
  /** Error rate percentage to trigger rollback (0-100) */
  rollbackThreshold: number;
}

export interface DeployResult {
  deploymentUrl: string;
  errorRate: number;
  healthChecks: Array<{
    latency: number;
    status: number;
    timestamp: Date;
  }>;
  rollbackReason?: string;
  status: "success" | "rolled_back" | "canary_failed";
}

export interface MonitorResult {
  alerts: Array<{
    message: string;
    severity: "critical" | "warning" | "info";
  }>;
  healthy: boolean;
  metrics: {
    errorRate: number;
    p50Latency: number;
    p99Latency: number;
  };
}

interface DeploymentRecord {
  canaryPercent: number;
  environment: string;
  healthCheckUrl: string;
  id: string;
  projectId: string;
  rollbackThreshold: number;
  startedAt: Date;
  status: "deploying" | "healthy" | "degraded" | "rolled_back";
}

// ---------------------------------------------------------------------------
// SelfHealingDeployment
// ---------------------------------------------------------------------------

export class SelfHealingDeployment {
  private readonly deployments = new Map<string, DeploymentRecord>();
  private readonly healthHistory = new Map<
    string,
    Array<{ latency: number; status: number; timestamp: Date }>
  >();

  /**
   * Deploy with automatic health checking and rollback.
   *
   * 1. Start deployment (optionally as canary)
   * 2. Run health checks
   * 3. Monitor error rate
   * 4. Roll back if threshold is exceeded
   * 5. Promote canary to full rollout on success
   */
  deploy(options: DeployOptions): DeployResult {
    const {
      projectId,
      environment,
      healthCheckUrl,
      rollbackThreshold,
      canaryPercent,
    } = options;

    const deploymentId = generateId("dep");
    const deploymentUrl = `https://${environment}.${projectId}.prometheus.dev`;

    logger.info(
      {
        deploymentId,
        projectId,
        environment,
        canaryPercent,
        rollbackThreshold,
      },
      "Starting self-healing deployment"
    );

    // Register deployment
    const record: DeploymentRecord = {
      id: deploymentId,
      projectId,
      environment,
      healthCheckUrl,
      rollbackThreshold,
      canaryPercent: canaryPercent ?? 100,
      startedAt: new Date(),
      status: "deploying",
    };
    this.deployments.set(deploymentId, record);
    this.healthHistory.set(deploymentId, []);

    // Run initial health checks
    const healthChecks = this.runHealthChecks(deploymentId, healthCheckUrl, 5);

    // Calculate error rate
    const errorRate = this.calculateErrorRate(healthChecks);

    // Decide outcome
    if (errorRate > rollbackThreshold) {
      // Rollback
      record.status = "rolled_back";
      const reason = `Error rate ${errorRate.toFixed(1)}% exceeds threshold ${rollbackThreshold}%`;

      logger.warn(
        { deploymentId, errorRate, rollbackThreshold },
        "Rolling back deployment"
      );

      return {
        status: canaryPercent ? "canary_failed" : "rolled_back",
        deploymentUrl,
        healthChecks,
        errorRate,
        rollbackReason: reason,
      };
    }

    // Canary promotion
    if (canaryPercent && canaryPercent < 100) {
      logger.info(
        { deploymentId, canaryPercent },
        "Canary healthy — promoting to full rollout"
      );
      record.canaryPercent = 100;
    }

    record.status = "healthy";

    logger.info(
      { deploymentId, errorRate, healthChecks: healthChecks.length },
      "Deployment successful"
    );

    return {
      status: "success",
      deploymentUrl,
      healthChecks,
      errorRate,
    };
  }

  /**
   * Monitor an existing deployment for a specified duration.
   * Returns health status and alerts.
   */
  monitor(deploymentId: string, durationMs: number): MonitorResult {
    const record = this.deployments.get(deploymentId);
    if (!record) {
      logger.warn({ deploymentId }, "Deployment not found for monitoring");
      return {
        healthy: false,
        metrics: { errorRate: 100, p50Latency: 0, p99Latency: 0 },
        alerts: [
          {
            severity: "critical",
            message: `Deployment ${deploymentId} not found`,
          },
        ],
      };
    }

    logger.info({ deploymentId, durationMs }, "Starting deployment monitoring");

    // Run health checks over the monitoring window
    const checkCount = Math.max(3, Math.min(20, Math.floor(durationMs / 5000)));
    const healthChecks = this.runHealthChecks(
      deploymentId,
      record.healthCheckUrl,
      checkCount
    );

    // Calculate metrics
    const errorRate = this.calculateErrorRate(healthChecks);
    const latencies = healthChecks
      .filter((h) => h.status >= 200 && h.status < 500)
      .map((h) => h.latency)
      .sort((a, b) => a - b);

    const p50Latency = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p99Latency = latencies[Math.floor(latencies.length * 0.99)] ?? 0;

    // Generate alerts
    const alerts: MonitorResult["alerts"] = [];

    if (errorRate > record.rollbackThreshold) {
      alerts.push({
        severity: "critical",
        message: `Error rate ${errorRate.toFixed(1)}% exceeds rollback threshold ${record.rollbackThreshold}%`,
      });
      record.status = "rolled_back";
    } else if (errorRate > record.rollbackThreshold * 0.7) {
      alerts.push({
        severity: "warning",
        message: `Error rate ${errorRate.toFixed(1)}% approaching rollback threshold ${record.rollbackThreshold}%`,
      });
      record.status = "degraded";
    }

    if (p99Latency > 2000) {
      alerts.push({
        severity: "warning",
        message: `p99 latency ${p99Latency}ms exceeds 2000ms threshold`,
      });
    }

    if (p50Latency > 500) {
      alerts.push({
        severity: "info",
        message: `p50 latency ${p50Latency}ms is elevated — monitor for further degradation`,
      });
    }

    const healthy =
      errorRate <= record.rollbackThreshold &&
      alerts.every((a) => a.severity !== "critical");

    logger.info(
      {
        deploymentId,
        healthy,
        errorRate,
        p50Latency,
        p99Latency,
        alertCount: alerts.length,
      },
      "Deployment monitoring complete"
    );

    return {
      healthy,
      metrics: { errorRate, p50Latency, p99Latency },
      alerts,
    };
  }

  /**
   * Get the current status of a deployment.
   */
  getDeployment(deploymentId: string): DeploymentRecord | undefined {
    return this.deployments.get(deploymentId);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private runHealthChecks(
    deploymentId: string,
    _healthCheckUrl: string,
    count: number
  ): Array<{ latency: number; status: number; timestamp: Date }> {
    const checks: Array<{
      latency: number;
      status: number;
      timestamp: Date;
    }> = [];
    const history = this.healthHistory.get(deploymentId) ?? [];

    for (let i = 0; i < count; i++) {
      // In production: actually fetch healthCheckUrl
      const check = this.simulateHealthCheck();
      checks.push(check);
      history.push(check);
    }

    this.healthHistory.set(deploymentId, history);
    return checks;
  }

  private simulateHealthCheck(): {
    latency: number;
    status: number;
    timestamp: Date;
  } {
    // Simulate realistic health check results
    // In production, this would be a real HTTP request
    const rand = Math.random();
    let status: number;
    let latency: number;

    if (rand < 0.85) {
      status = 200;
      latency = 50 + Math.floor(Math.random() * 150);
    } else if (rand < 0.93) {
      status = 200;
      latency = 200 + Math.floor(Math.random() * 800);
    } else if (rand < 0.97) {
      status = 503;
      latency = 1000 + Math.floor(Math.random() * 2000);
    } else {
      status = 500;
      latency = 500 + Math.floor(Math.random() * 500);
    }

    return { status, latency, timestamp: new Date() };
  }

  private calculateErrorRate(checks: Array<{ status: number }>): number {
    if (checks.length === 0) {
      return 0;
    }
    const errors = checks.filter(
      (c) => c.status >= 500 || c.status === 0
    ).length;
    return (errors / checks.length) * 100;
  }
}
