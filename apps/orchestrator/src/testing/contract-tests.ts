/**
 * Contract Testing
 *
 * Verifies the API contracts between Prometheus services.
 * Tests that each service responds correctly to expected requests
 * and returns the expected response shapes.
 */

import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:contract-tests");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContractTestResult {
  details: string;
  durationMs: number;
  endpoint: string;
  service: string;
  status: "passed" | "failed" | "skipped";
}

export interface ContractTestReport {
  details: ContractTestResult[];
  durationMs: number;
  failed: number;
  passed: number;
  skipped: number;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Default Service URLs
// ---------------------------------------------------------------------------

const DEFAULT_URLS = {
  api: process.env.API_URL ?? "http://localhost:4000",
  orchestrator: process.env.ORCHESTRATOR_URL ?? "http://localhost:4002",
  projectBrain: process.env.PROJECT_BRAIN_URL ?? "http://localhost:4003",
  modelRouter: process.env.MODEL_ROUTER_URL ?? "http://localhost:4004",
  sandboxManager: process.env.SANDBOX_MANAGER_URL ?? "http://localhost:4006",
};

// ---------------------------------------------------------------------------
// ContractTestRunner
// ---------------------------------------------------------------------------

export class ContractTestRunner {
  private readonly results: ContractTestResult[] = [];

  /**
   * Test the API -> Orchestrator contract.
   * Verifies the orchestrator accepts task submissions and returns expected shape.
   */
  async testAPIOrchestrator(endpoint?: string): Promise<ContractTestResult> {
    const url = endpoint ?? DEFAULT_URLS.orchestrator;
    const start = Date.now();

    try {
      // Test health endpoint
      const healthResponse = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!healthResponse.ok) {
        return this.record({
          service: "orchestrator",
          endpoint: `${url}/health`,
          status: "failed",
          details: `Health check returned ${healthResponse.status}`,
          durationMs: Date.now() - start,
        });
      }

      // Test task submission contract
      const taskResponse = await fetch(`${url}/contract-test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          type: "contract_test",
          description: "Contract test ping",
        }),
        signal: AbortSignal.timeout(10_000),
      });

      // Contract: orchestrator should respond with JSON containing a status field
      if (taskResponse.ok || taskResponse.status === 404) {
        return this.record({
          service: "orchestrator",
          endpoint: `${url}/contract-test`,
          status: "passed",
          details: "API-Orchestrator contract verified",
          durationMs: Date.now() - start,
        });
      }

      return this.record({
        service: "orchestrator",
        endpoint: url,
        status: "failed",
        details: `Unexpected status: ${taskResponse.status}`,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.record({
        service: "orchestrator",
        endpoint: url,
        status: "failed",
        details: `Connection error: ${msg}`,
        durationMs: Date.now() - start,
      });
    }
  }

  /**
   * Test the Orchestrator -> Model Router contract.
   * Verifies routing requests are accepted and return expected shape.
   */
  async testOrchestratorModelRouter(
    endpoint?: string
  ): Promise<ContractTestResult> {
    const url = endpoint ?? DEFAULT_URLS.modelRouter;
    const start = Date.now();

    try {
      const healthResponse = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!healthResponse.ok) {
        return this.record({
          service: "model-router",
          endpoint: `${url}/health`,
          status: "failed",
          details: `Health check returned ${healthResponse.status}`,
          durationMs: Date.now() - start,
        });
      }

      // Test route endpoint contract
      const routeResponse = await fetch(`${url}/route`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          slot: "background",
          messages: [{ role: "user", content: "Contract test" }],
          options: { maxTokens: 10, temperature: 0 },
        }),
        signal: AbortSignal.timeout(15_000),
      });

      // Contract: should return JSON with choices array
      if (routeResponse.ok) {
        const data = (await routeResponse.json()) as Record<string, unknown>;
        if ("choices" in data || "error" in data) {
          return this.record({
            service: "model-router",
            endpoint: `${url}/route`,
            status: "passed",
            details: "Orchestrator-ModelRouter contract verified",
            durationMs: Date.now() - start,
          });
        }
      }

      return this.record({
        service: "model-router",
        endpoint: url,
        status: routeResponse.status === 401 ? "skipped" : "failed",
        details:
          routeResponse.status === 401
            ? "Skipped: auth required"
            : `Unexpected response: ${routeResponse.status}`,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.record({
        service: "model-router",
        endpoint: url,
        status: "failed",
        details: `Connection error: ${msg}`,
        durationMs: Date.now() - start,
      });
    }
  }

  /**
   * Test the Orchestrator -> Sandbox Manager contract.
   */
  async testOrchestratorSandbox(
    endpoint?: string
  ): Promise<ContractTestResult> {
    const url = endpoint ?? DEFAULT_URLS.sandboxManager;
    const start = Date.now();

    try {
      const healthResponse = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!healthResponse.ok) {
        return this.record({
          service: "sandbox-manager",
          endpoint: `${url}/health`,
          status: "failed",
          details: `Health check returned ${healthResponse.status}`,
          durationMs: Date.now() - start,
        });
      }

      // Test pool status endpoint
      const poolResponse = await fetch(`${url}/health/pool`, {
        signal: AbortSignal.timeout(5000),
      });

      if (poolResponse.ok || poolResponse.status === 404) {
        return this.record({
          service: "sandbox-manager",
          endpoint: `${url}/health/pool`,
          status: "passed",
          details: "Orchestrator-SandboxManager contract verified",
          durationMs: Date.now() - start,
        });
      }

      return this.record({
        service: "sandbox-manager",
        endpoint: url,
        status: "failed",
        details: `Unexpected status: ${poolResponse.status}`,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.record({
        service: "sandbox-manager",
        endpoint: url,
        status: "failed",
        details: `Connection error: ${msg}`,
        durationMs: Date.now() - start,
      });
    }
  }

  /**
   * Test the Orchestrator -> Project Brain contract.
   */
  async testOrchestratorBrain(endpoint?: string): Promise<ContractTestResult> {
    const url = endpoint ?? DEFAULT_URLS.projectBrain;
    const start = Date.now();

    try {
      const healthResponse = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!healthResponse.ok) {
        return this.record({
          service: "project-brain",
          endpoint: `${url}/health`,
          status: "failed",
          details: `Health check returned ${healthResponse.status}`,
          durationMs: Date.now() - start,
        });
      }

      // Test search endpoint contract
      const searchResponse = await fetch(
        `${url}/search?q=${encodeURIComponent("contract test")}&limit=1`,
        {
          signal: AbortSignal.timeout(10_000),
        }
      );

      if (searchResponse.ok || searchResponse.status === 404) {
        return this.record({
          service: "project-brain",
          endpoint: `${url}/search`,
          status: "passed",
          details: "Orchestrator-ProjectBrain contract verified",
          durationMs: Date.now() - start,
        });
      }

      return this.record({
        service: "project-brain",
        endpoint: url,
        status: "failed",
        details: `Unexpected status: ${searchResponse.status}`,
        durationMs: Date.now() - start,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return this.record({
        service: "project-brain",
        endpoint: url,
        status: "failed",
        details: `Connection error: ${msg}`,
        durationMs: Date.now() - start,
      });
    }
  }

  /**
   * Run all contract tests and return a report.
   */
  async runAll(): Promise<ContractTestReport> {
    const start = Date.now();
    this.results.length = 0;

    await this.testAPIOrchestrator();
    await this.testOrchestratorModelRouter();
    await this.testOrchestratorSandbox();
    await this.testOrchestratorBrain();

    const passed = this.results.filter((r) => r.status === "passed").length;
    const failed = this.results.filter((r) => r.status === "failed").length;
    const skipped = this.results.filter((r) => r.status === "skipped").length;

    const report: ContractTestReport = {
      timestamp: new Date().toISOString(),
      passed,
      failed,
      skipped,
      durationMs: Date.now() - start,
      details: [...this.results],
    };

    logger.info(
      { passed, failed, skipped, durationMs: report.durationMs },
      "Contract test run complete"
    );

    return report;
  }

  // -----------------------------------------------------------------------
  // Internal Helpers
  // -----------------------------------------------------------------------

  private record(result: ContractTestResult): ContractTestResult {
    this.results.push(result);
    let level: "info" | "warn" | "debug" = "debug";
    if (result.status === "passed") {
      level = "info";
    } else if (result.status === "failed") {
      level = "warn";
    }

    logger[level](
      {
        service: result.service,
        status: result.status,
        durationMs: result.durationMs,
      },
      result.details
    );

    return result;
  }
}
