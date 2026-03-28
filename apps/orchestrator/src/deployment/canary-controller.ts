/**
 * GAP-060: Canary Deployment and Rollback Controller
 *
 * Deploys canary (small % of traffic), monitors error rates during
 * canary period, auto-promotes if healthy, auto-rollbacks if errors
 * spike, and reports deployment outcome.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:deployment:canary-controller");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanaryDeploymentConfig {
  /** Branch or version being deployed */
  branch: string;
  /** Canary traffic stages as percentages (e.g., [5, 25, 50, 100]) */
  canaryStages: number[];
  /** Error rate threshold for auto-rollback (0.0-1.0) */
  errorRateThreshold: number;
  /** Health check URL to poll */
  healthCheckUrl?: string;
  /** Observation window per stage in ms */
  observationWindowMs: number;
  /** Project identifier */
  projectId: string;
}

export type CanaryStageStatus =
  | "pending"
  | "active"
  | "passed"
  | "failed"
  | "rolled-back";

export interface CanaryStageResult {
  completedAt?: string;
  errorRate: number;
  percentage: number;
  requestCount: number;
  startedAt: string;
  status: CanaryStageStatus;
}

export type DeploymentOutcome =
  | "promoted"
  | "rolled-back"
  | "in-progress"
  | "cancelled";

export interface CanaryDeployment {
  completedAt?: string;
  config: CanaryDeploymentConfig;
  currentStageIndex: number;
  id: string;
  outcome: DeploymentOutcome;
  stages: CanaryStageResult[];
  startedAt: string;
}

export interface DeploymentReport {
  deployment: CanaryDeployment;
  finalErrorRate: number;
  promotedSuccessfully: boolean;
  rollbackReason?: string;
  totalDurationMs: number;
  totalRequests: number;
}

// ---------------------------------------------------------------------------
// CanaryController
// ---------------------------------------------------------------------------

export class CanaryController {
  private readonly deployments = new Map<string, CanaryDeployment>();

  /**
   * Start a new canary deployment.
   */
  startDeployment(config: CanaryDeploymentConfig): CanaryDeployment {
    const id = `canary_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();

    const stages: CanaryStageResult[] = config.canaryStages.map(
      (percentage) => ({
        percentage,
        status: "pending" as CanaryStageStatus,
        errorRate: 0,
        requestCount: 0,
        startedAt: now,
      })
    );

    // Activate the first stage
    if (stages[0]) {
      stages[0].status = "active";
      stages[0].startedAt = now;
    }

    const deployment: CanaryDeployment = {
      id,
      config,
      stages,
      currentStageIndex: 0,
      outcome: "in-progress",
      startedAt: now,
    };

    this.deployments.set(id, deployment);

    logger.info(
      {
        deploymentId: id,
        projectId: config.projectId,
        branch: config.branch,
        stages: config.canaryStages,
      },
      "Canary deployment started"
    );

    return deployment;
  }

  /**
   * Report observed metrics for the current canary stage.
   * Automatically promotes or rolls back based on error rate.
   */
  reportMetrics(
    deploymentId: string,
    errorRate: number,
    requestCount: number
  ): CanaryDeployment {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment || deployment.outcome !== "in-progress") {
      throw new Error(
        `Deployment ${deploymentId} not found or not in progress`
      );
    }

    const currentStage = deployment.stages[deployment.currentStageIndex];
    if (!currentStage) {
      throw new Error("No current stage found");
    }

    currentStage.errorRate = errorRate;
    currentStage.requestCount += requestCount;

    // Check if error rate exceeds threshold: rollback
    if (errorRate > deployment.config.errorRateThreshold) {
      return this.rollback(
        deploymentId,
        `Error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(deployment.config.errorRateThreshold * 100).toFixed(1)}%`
      );
    }

    // Stage passed, promote to next stage or complete
    currentStage.status = "passed";
    currentStage.completedAt = new Date().toISOString();

    const nextIndex = deployment.currentStageIndex + 1;
    if (nextIndex >= deployment.stages.length) {
      // All stages passed, promote
      return this.promote(deploymentId);
    }

    // Advance to next stage
    deployment.currentStageIndex = nextIndex;
    const nextStage = deployment.stages[nextIndex];
    if (nextStage) {
      nextStage.status = "active";
      nextStage.startedAt = new Date().toISOString();
    }

    logger.info(
      {
        deploymentId,
        stage: nextIndex,
        percentage: nextStage?.percentage,
      },
      "Advanced to next canary stage"
    );

    return deployment;
  }

  /**
   * Promote the canary to full traffic (deployment successful).
   */
  promote(deploymentId: string): CanaryDeployment {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    deployment.outcome = "promoted";
    deployment.completedAt = new Date().toISOString();

    logger.info(
      {
        deploymentId,
        projectId: deployment.config.projectId,
        branch: deployment.config.branch,
      },
      "Canary deployment promoted to full traffic"
    );

    return deployment;
  }

  /**
   * Rollback the canary deployment.
   */
  rollback(deploymentId: string, reason: string): CanaryDeployment {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    deployment.outcome = "rolled-back";
    deployment.completedAt = new Date().toISOString();

    // Mark remaining stages as rolled-back
    for (const stage of deployment.stages) {
      if (stage.status === "active" || stage.status === "pending") {
        stage.status = "rolled-back";
        stage.completedAt = new Date().toISOString();
      }
    }

    logger.warn(
      {
        deploymentId,
        reason,
        projectId: deployment.config.projectId,
      },
      "Canary deployment rolled back"
    );

    return deployment;
  }

  /**
   * Get a deployment report.
   */
  getReport(deploymentId: string): DeploymentReport {
    const deployment = this.deployments.get(deploymentId);
    if (!deployment) {
      throw new Error(`Deployment ${deploymentId} not found`);
    }

    const totalRequests = deployment.stages.reduce(
      (s, st) => s + st.requestCount,
      0
    );
    const nonPending = deployment.stages.filter((s) => s.status !== "pending");
    const lastStage = nonPending.at(-1) ?? deployment.stages[0];

    const startTime = new Date(deployment.startedAt).getTime();
    const endTime = deployment.completedAt
      ? new Date(deployment.completedAt).getTime()
      : Date.now();

    return {
      deployment,
      promotedSuccessfully: deployment.outcome === "promoted",
      totalDurationMs: endTime - startTime,
      totalRequests,
      finalErrorRate: lastStage?.errorRate ?? 0,
      rollbackReason:
        deployment.outcome === "rolled-back"
          ? "Error rate threshold exceeded"
          : undefined,
    };
  }

  /**
   * List all deployments.
   */
  listDeployments(): CanaryDeployment[] {
    return [...this.deployments.values()].sort(
      (a, b) =>
        new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }

  /**
   * Get a deployment by ID.
   */
  getDeployment(deploymentId: string): CanaryDeployment | undefined {
    return this.deployments.get(deploymentId);
  }
}
