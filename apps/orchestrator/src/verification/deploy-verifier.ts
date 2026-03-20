import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:deploy-verifier");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  endpoint: string;
  latencyMs: number;
  passed: boolean;
  statusCode: number;
}

export interface SmokeTestResult {
  endpoint: string;
  error?: string;
  latencyMs: number;
  passed: boolean;
  testName: string;
}

export interface RollbackCriteria {
  errorRate: number;
  errorRateThreshold: number;
  latencyP95Ms: number;
  latencyThresholdMs: number;
  shouldRollback: boolean;
}

export interface DeployMetrics {
  errorRate: number;
  latencyP95Ms: number;
  requestsPerSecond: number;
  successRate: number;
}

export interface DeployReport {
  duration: string;
  environment: string;
  generatedAt: string;
  healthChecks: HealthCheckResult[];
  overallStatus: "success" | "degraded" | "failed";
  rollbackCriteria: RollbackCriteria;
  smokeTests: SmokeTestResult[];
}

// ---------------------------------------------------------------------------
// DeployVerifier
// ---------------------------------------------------------------------------

/**
 * Verifies deployments by running health checks, smoke tests,
 * and evaluating rollback criteria based on metrics.
 */
export class DeployVerifier {
  /**
   * Check the health of a service endpoint.
   */
  async verifyHealth(
    endpoint: string,
    expectedStatus = 200
  ): Promise<HealthCheckResult> {
    logger.info(`Verifying health: ${endpoint} (expected ${expectedStatus})`);

    const start = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      });

      const latencyMs = Date.now() - start;

      return {
        endpoint,
        statusCode: response.status,
        passed: response.status === expectedStatus,
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      logger.error(`Health check failed: ${endpoint} — ${String(error)}`);

      return {
        endpoint,
        statusCode: 0,
        passed: false,
        latencyMs,
      };
    }
  }

  /**
   * Run basic smoke tests against a list of endpoints.
   */
  async runSmokeTests(
    endpoints: Array<{ name: string; url: string; expectedStatus?: number }>
  ): Promise<SmokeTestResult[]> {
    logger.info(`Running smoke tests: ${endpoints.length} endpoints`);

    const results: SmokeTestResult[] = [];

    for (const ep of endpoints) {
      const start = Date.now();

      try {
        const response = await fetch(ep.url, {
          method: "GET",
          signal: AbortSignal.timeout(15_000),
        });

        const latencyMs = Date.now() - start;
        const expectedStatus = ep.expectedStatus ?? 200;

        results.push({
          testName: ep.name,
          endpoint: ep.url,
          passed: response.status === expectedStatus,
          latencyMs,
        });
      } catch (error) {
        const latencyMs = Date.now() - start;

        results.push({
          testName: ep.name,
          endpoint: ep.url,
          passed: false,
          latencyMs,
          error: String(error),
        });
      }
    }

    return results;
  }

  /**
   * Determine whether a rollback is needed based on deploy metrics.
   */
  checkRollbackCriteria(
    metrics: DeployMetrics,
    errorRateThreshold = 0.05,
    latencyThresholdMs = 2000
  ): RollbackCriteria {
    logger.info(
      `Checking rollback criteria: errorRate=${metrics.errorRate}, latencyP95=${metrics.latencyP95Ms}`
    );

    const shouldRollback =
      metrics.errorRate > errorRateThreshold ||
      metrics.latencyP95Ms > latencyThresholdMs;

    return {
      shouldRollback,
      errorRate: metrics.errorRate,
      errorRateThreshold,
      latencyP95Ms: metrics.latencyP95Ms,
      latencyThresholdMs,
    };
  }

  /**
   * Generate a comprehensive deployment verification report.
   */
  generateDeployReport(results: {
    duration: string;
    environment: string;
    healthChecks: HealthCheckResult[];
    metrics: DeployMetrics;
    smokeTests: SmokeTestResult[];
  }): DeployReport {
    const rollbackCriteria = this.checkRollbackCriteria(results.metrics);

    const allHealthPassed = results.healthChecks.every((h) => h.passed);
    const allSmokePassed = results.smokeTests.every((s) => s.passed);

    let overallStatus: "success" | "degraded" | "failed";
    if (allHealthPassed && allSmokePassed && !rollbackCriteria.shouldRollback) {
      overallStatus = "success";
    } else if (rollbackCriteria.shouldRollback) {
      overallStatus = "failed";
    } else {
      overallStatus = "degraded";
    }

    const report: DeployReport = {
      environment: results.environment,
      duration: results.duration,
      overallStatus,
      healthChecks: results.healthChecks,
      smokeTests: results.smokeTests,
      rollbackCriteria,
      generatedAt: new Date().toISOString(),
    };

    logger.info(
      `Deploy report generated: ${report.overallStatus} (${report.environment})`
    );

    return report;
  }
}
