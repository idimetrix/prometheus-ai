/**
 * Deploy Verification (DD05).
 *
 * Verifies deployed services by running health checks, smoke tests,
 * and analyzing error-rate metrics to decide whether to rollback.
 */

import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:deploy-verifier");

const MCP_GATEWAY_URL = process.env.MCP_GATEWAY_URL ?? "http://localhost:4005";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HealthCheck {
  expectedStatus?: number;
  name: string;
  path: string;
  timeoutMs?: number;
}

export interface SmokeTest {
  body?: string;
  expectedBodyContains?: string;
  expectedStatus: number;
  method?: string;
  name: string;
  path: string;
}

export interface VerificationResult {
  checks: CheckResult[];
  durationMs: number;
  overallStatus: "passed" | "failed" | "degraded";
  summary: string;
}

export interface CheckResult {
  durationMs: number;
  error?: string;
  name: string;
  passed: boolean;
  statusCode?: number;
}

export interface RollbackDecision {
  metrics: MetricsSnapshot;
  reason: string;
  shouldRollback: boolean;
}

export interface MetricsSnapshot {
  errorCount: number;
  errorRate: number;
  latencyP50Ms: number;
  latencyP99Ms: number;
  requestCount: number;
}

// ---------------------------------------------------------------------------
// DeployVerifier
// ---------------------------------------------------------------------------

export class DeployVerifier {
  private readonly mcpGatewayUrl: string;

  constructor(opts?: { mcpGatewayUrl?: string }) {
    this.mcpGatewayUrl = opts?.mcpGatewayUrl ?? MCP_GATEWAY_URL;
  }

  /**
   * Run health checks against a deployed URL.
   * Retries each check up to 3 times with exponential backoff.
   */
  async verifyDeployment(
    baseUrl: string,
    checks: HealthCheck[]
  ): Promise<VerificationResult> {
    const start = performance.now();
    const results: CheckResult[] = [];

    logger.info(
      { baseUrl, checkCount: checks.length },
      "Starting deployment verification"
    );

    for (const check of checks) {
      const result = await this.runHealthCheck(baseUrl, check);
      results.push(result);
    }

    const failedCount = results.filter((r) => !r.passed).length;
    const durationMs = Math.round(performance.now() - start);

    let overallStatus: VerificationResult["overallStatus"];
    if (failedCount === 0) {
      overallStatus = "passed";
    } else if (failedCount < results.length) {
      overallStatus = "degraded";
    } else {
      overallStatus = "failed";
    }

    const summary = `${results.length - failedCount}/${results.length} checks passed in ${durationMs}ms`;

    logger.info(
      { overallStatus, failedCount, durationMs },
      "Deployment verification complete"
    );

    return { overallStatus, checks: results, durationMs, summary };
  }

  /**
   * Run a set of smoke tests against a deployed URL.
   * Smoke tests verify specific endpoints return expected responses.
   */
  async runSmokeTests(
    baseUrl: string,
    tests: SmokeTest[]
  ): Promise<VerificationResult> {
    const start = performance.now();
    const results: CheckResult[] = [];

    logger.info({ baseUrl, testCount: tests.length }, "Starting smoke tests");

    for (const test of tests) {
      const result = await this.runSingleSmokeTest(baseUrl, test);
      results.push(result);
    }

    const failedCount = results.filter((r) => !r.passed).length;
    const durationMs = Math.round(performance.now() - start);

    let overallStatus: VerificationResult["overallStatus"];
    if (failedCount === 0) {
      overallStatus = "passed";
    } else if (failedCount < results.length) {
      overallStatus = "degraded";
    } else {
      overallStatus = "failed";
    }

    const summary = `${results.length - failedCount}/${results.length} smoke tests passed in ${durationMs}ms`;

    logger.info(
      { overallStatus, failedCount, durationMs },
      "Smoke tests complete"
    );

    return { overallStatus, checks: results, durationMs, summary };
  }

  /**
   * Analyze metrics to determine if a rollback is needed.
   *
   * Rollback thresholds:
   * - Error rate > 5%
   * - P99 latency > 10s
   * - More than 50 errors in the window
   */
  checkRollbackNeeded(metrics: MetricsSnapshot): RollbackDecision {
    const reasons: string[] = [];

    if (metrics.errorRate > 0.05) {
      reasons.push(
        `Error rate ${(metrics.errorRate * 100).toFixed(1)}% exceeds 5% threshold`
      );
    }

    if (metrics.latencyP99Ms > 10_000) {
      reasons.push(
        `P99 latency ${metrics.latencyP99Ms}ms exceeds 10s threshold`
      );
    }

    if (metrics.errorCount > 50) {
      reasons.push(
        `Error count ${metrics.errorCount} exceeds 50 error threshold`
      );
    }

    const shouldRollback = reasons.length > 0;
    const reason = shouldRollback
      ? `Rollback recommended: ${reasons.join("; ")}`
      : "All metrics within acceptable thresholds";

    logger.info(
      {
        shouldRollback,
        errorRate: metrics.errorRate,
        latencyP99Ms: metrics.latencyP99Ms,
        errorCount: metrics.errorCount,
      },
      shouldRollback ? "Rollback recommended" : "Deployment healthy"
    );

    return { shouldRollback, reason, metrics };
  }

  /**
   * Initiate a rollback for a specific deployment via the MCP gateway.
   */
  async triggerRollback(
    deploymentId: string,
    projectId: string
  ): Promise<{ success: boolean; message: string }> {
    logger.info({ deploymentId, projectId }, "Triggering rollback");

    try {
      const response = await fetch(
        `${this.mcpGatewayUrl}/api/adapters/vercel/rollback`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalAuthHeaders(),
          },
          body: JSON.stringify({ projectId, deploymentId }),
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        }
      );

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        const message = `Rollback failed (${response.status}): ${errorBody.slice(0, 200)}`;
        logger.error(
          { deploymentId, projectId, status: response.status },
          message
        );
        return { success: false, message };
      }

      logger.info(
        { deploymentId, projectId },
        "Rollback triggered successfully"
      );
      return {
        success: true,
        message: `Rollback initiated for deployment ${deploymentId}`,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { deploymentId, projectId, error: msg },
        "Rollback request failed"
      );
      return { success: false, message: `Rollback error: ${msg}` };
    }
  }

  /**
   * Run a full verification pipeline: health checks, smoke tests, metrics check.
   * Returns a combined result and rollback decision.
   */
  async verifyFull(opts: {
    baseUrl: string;
    deploymentId: string;
    healthChecks: HealthCheck[];
    metrics?: MetricsSnapshot;
    projectId: string;
    smokeTests: SmokeTest[];
  }): Promise<{
    healthResult: VerificationResult;
    rollbackDecision: RollbackDecision | null;
    smokeResult: VerificationResult;
  }> {
    const healthResult = await this.verifyDeployment(
      opts.baseUrl,
      opts.healthChecks
    );

    const smokeResult = await this.runSmokeTests(opts.baseUrl, opts.smokeTests);

    let rollbackDecision: RollbackDecision | null = null;

    if (opts.metrics) {
      rollbackDecision = this.checkRollbackNeeded(opts.metrics);
    }

    // Auto-trigger rollback if smoke tests fully fail
    if (
      smokeResult.overallStatus === "failed" &&
      !rollbackDecision?.shouldRollback
    ) {
      rollbackDecision = {
        shouldRollback: true,
        reason: "All smoke tests failed — triggering automatic rollback",
        metrics: opts.metrics ?? {
          requestCount: 0,
          errorCount: 0,
          errorRate: 1,
          latencyP50Ms: 0,
          latencyP99Ms: 0,
        },
      };
    }

    if (rollbackDecision?.shouldRollback) {
      await this.triggerRollback(opts.deploymentId, opts.projectId);
    }

    return { healthResult, smokeResult, rollbackDecision };
  }

  // ── Private helpers ──

  private async runHealthCheck(
    baseUrl: string,
    check: HealthCheck
  ): Promise<CheckResult> {
    const expectedStatus = check.expectedStatus ?? 200;
    const timeoutMs = check.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const start = performance.now();
      try {
        const url = `${baseUrl}${check.path}`;
        const response = await fetch(url, {
          signal: AbortSignal.timeout(timeoutMs),
        });

        const durationMs = Math.round(performance.now() - start);

        if (response.status === expectedStatus) {
          return {
            name: check.name,
            passed: true,
            statusCode: response.status,
            durationMs,
          };
        }

        if (attempt === maxRetries) {
          return {
            name: check.name,
            passed: false,
            statusCode: response.status,
            durationMs,
            error: `Expected status ${expectedStatus}, got ${response.status}`,
          };
        }
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        const durationMs = Math.round(performance.now() - start);

        if (attempt === maxRetries) {
          return {
            name: check.name,
            passed: false,
            durationMs,
            error: `Health check failed after ${maxRetries} attempts: ${msg}`,
          };
        }
      }

      // Exponential backoff between retries
      await this.delay(DEFAULT_RETRY_DELAY_MS * attempt);
    }

    // Unreachable but satisfies TypeScript
    return {
      name: check.name,
      passed: false,
      durationMs: 0,
      error: "Unknown error",
    };
  }

  private async runSingleSmokeTest(
    baseUrl: string,
    test: SmokeTest
  ): Promise<CheckResult> {
    const start = performance.now();
    try {
      const url = `${baseUrl}${test.path}`;
      const response = await fetch(url, {
        method: test.method ?? "GET",
        body: test.body,
        headers: test.body ? { "Content-Type": "application/json" } : undefined,
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      });

      const durationMs = Math.round(performance.now() - start);
      const body = await response.text();

      const statusMatch = response.status === test.expectedStatus;
      const bodyMatch = test.expectedBodyContains
        ? body.includes(test.expectedBodyContains)
        : true;

      if (statusMatch && bodyMatch) {
        return {
          name: test.name,
          passed: true,
          statusCode: response.status,
          durationMs,
        };
      }

      const errors: string[] = [];
      if (!statusMatch) {
        errors.push(
          `Expected status ${test.expectedStatus}, got ${response.status}`
        );
      }
      if (!bodyMatch) {
        errors.push(
          `Response body missing expected content: "${test.expectedBodyContains}"`
        );
      }

      return {
        name: test.name,
        passed: false,
        statusCode: response.status,
        durationMs,
        error: errors.join("; "),
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      const durationMs = Math.round(performance.now() - start);
      return {
        name: test.name,
        passed: false,
        durationMs,
        error: `Smoke test failed: ${msg}`,
      };
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
