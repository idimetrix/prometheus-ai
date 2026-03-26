/**
 * MOON-055: Automated Test Generation from Production Traffic
 *
 * Analyzes production API traffic logs and generates test cases that
 * replay real-world request/response patterns. Categorizes tests into
 * happy_path, edge_case, and error_case types based on status codes
 * and response patterns.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:testing:traffic-test-generator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrafficLog {
  headers?: Record<string, string>;
  method: string;
  path: string;
  requestBody?: unknown;
  responseBody?: unknown;
  statusCode: number;
}

export interface GeneratedTest {
  /** Code for the test */
  code: string;
  /** API endpoint being tested */
  endpoint: string;
  /** Test name */
  name: string;
  /** Test type based on the traffic pattern */
  type: "happy_path" | "edge_case" | "error_case";
}

export interface TestGenerationResult {
  /** Coverage statistics */
  coverage: { endpoints: number; methods: number };
  /** Generated test cases */
  tests: GeneratedTest[];
}

export interface TrafficTestGeneratorOptions {
  /** Maximum number of tests to generate */
  maxTests?: number;
  /** Project identifier */
  projectId: string;
  /** API traffic logs to analyze */
  trafficLogs: TrafficLog[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TESTS = 50;

const TRAILING_SLASH_NORMALIZE_RE = /\/+$/;

const EDGE_CASE_INDICATORS = [
  /\bnull\b/i,
  /\bundefined\b/i,
  /\bempty\b/i,
  /\[\]/,
  /\{\}/,
  /"""/,
];

// ---------------------------------------------------------------------------
// TrafficTestGenerator
// ---------------------------------------------------------------------------

export class TrafficTestGenerator {
  /**
   * Generates test cases from production API traffic logs.
   */
  generate(options: TrafficTestGeneratorOptions): TestGenerationResult {
    const { projectId, trafficLogs, maxTests = DEFAULT_MAX_TESTS } = options;

    logger.info(
      { projectId, logCount: trafficLogs.length, maxTests },
      "Generating tests from traffic logs"
    );

    // Group logs by endpoint (method + path)
    const endpointGroups = this.groupByEndpoint(trafficLogs);

    // Track coverage
    const coveredEndpoints = new Set<string>();
    const coveredMethods = new Set<string>();

    const tests: GeneratedTest[] = [];

    for (const [endpoint, logs] of endpointGroups) {
      if (tests.length >= maxTests) {
        break;
      }

      const [method = "GET", path = "/"] = endpoint.split(" ", 2);
      coveredEndpoints.add(path);
      coveredMethods.add(method);

      // Generate tests for this endpoint
      const endpointTests = this.generateEndpointTests(
        method,
        path,
        logs,
        maxTests - tests.length
      );

      for (const test of endpointTests) {
        tests.push(test);
      }
    }

    logger.info(
      {
        projectId,
        testCount: tests.length,
        endpoints: coveredEndpoints.size,
        methods: coveredMethods.size,
      },
      "Test generation complete"
    );

    return {
      tests,
      coverage: {
        endpoints: coveredEndpoints.size,
        methods: coveredMethods.size,
      },
    };
  }

  private groupByEndpoint(logs: TrafficLog[]): Map<string, TrafficLog[]> {
    const groups = new Map<string, TrafficLog[]>();

    for (const log of logs) {
      // Normalize path by removing query params and trailing slashes
      const normalizedPath =
        log.path.split("?")[0]?.replace(TRAILING_SLASH_NORMALIZE_RE, "") ?? "/";
      const key = `${log.method.toUpperCase()} ${normalizedPath}`;
      const existing = groups.get(key) ?? [];
      existing.push(log);
      groups.set(key, existing);
    }

    return groups;
  }

  private generateEndpointTests(
    method: string,
    path: string,
    logs: TrafficLog[],
    remaining: number
  ): GeneratedTest[] {
    const tests: GeneratedTest[] = [];

    // Categorize logs
    const successLogs = logs.filter(
      (l) => l.statusCode >= 200 && l.statusCode < 300
    );
    const errorLogs = logs.filter((l) => l.statusCode >= 400);
    const edgeCaseLogs = logs.filter((l) => this.isEdgeCase(l));

    // Generate happy path test from most common success pattern
    const firstSuccess = successLogs[0];
    if (firstSuccess && remaining > 0) {
      tests.push({
        name: this.buildTestName(method, path, "happy_path"),
        endpoint: `${method} ${path}`,
        type: "happy_path",
        code: this.generateTestCode(method, path, firstSuccess, "happy_path"),
      });
    }

    // Generate error case tests
    const seenStatuses = new Set<number>();
    for (const log of errorLogs) {
      if (tests.length >= remaining) {
        break;
      }
      if (seenStatuses.has(log.statusCode)) {
        continue;
      }
      seenStatuses.add(log.statusCode);

      tests.push({
        name: this.buildTestName(method, path, "error_case", log.statusCode),
        endpoint: `${method} ${path}`,
        type: "error_case",
        code: this.generateTestCode(method, path, log, "error_case"),
      });
    }

    // Generate edge case tests
    for (const log of edgeCaseLogs) {
      if (tests.length >= remaining) {
        break;
      }

      tests.push({
        name: this.buildTestName(method, path, "edge_case"),
        endpoint: `${method} ${path}`,
        type: "edge_case",
        code: this.generateTestCode(method, path, log, "edge_case"),
      });
      break; // One edge case per endpoint
    }

    return tests;
  }

  private isEdgeCase(log: TrafficLog): boolean {
    const bodyStr = JSON.stringify(log.requestBody ?? "");
    return EDGE_CASE_INDICATORS.some((pattern) => pattern.test(bodyStr));
  }

  private buildTestName(
    method: string,
    path: string,
    type: string,
    statusCode?: number
  ): string {
    const sanitizedPath = path
      .replace(/[^a-zA-Z0-9]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");

    const suffix = statusCode ? `_${statusCode}` : "";
    return `${method.toLowerCase()}_${sanitizedPath}_${type}${suffix}`;
  }

  private generateTestCode(
    method: string,
    path: string,
    log: TrafficLog,
    type: "happy_path" | "edge_case" | "error_case"
  ): string {
    const testId = generateId("traffic-test");
    const hasBody = log.requestBody !== undefined && log.requestBody !== null;
    const bodyJson = hasBody
      ? JSON.stringify(log.requestBody, null, 2)
      : undefined;

    const descriptionMap = {
      happy_path: `should handle ${method} ${path} successfully`,
      edge_case: `should handle edge case for ${method} ${path}`,
      error_case: `should return ${log.statusCode} for invalid ${method} ${path}`,
    };

    const lines: string[] = [];

    lines.push(`// Generated from production traffic: ${testId}`);
    lines.push(
      `// Type: ${type} | Status: ${log.statusCode} | Method: ${method}`
    );
    lines.push("");
    lines.push(`import { describe, expect, it } from "vitest";`);
    lines.push("");
    lines.push(`describe("${method} ${path}", () => {`);
    lines.push(`  it("${descriptionMap[type]}", async () => {`);
    lines.push(`    const response = await fetch(\`\${BASE_URL}${path}\`, {`);
    lines.push(`      method: "${method}",`);

    if (hasBody) {
      lines.push(`      headers: { "Content-Type": "application/json" },`);
      lines.push(`      body: JSON.stringify(${bodyJson}),`);
    }

    lines.push("    });");
    lines.push("");

    if (type === "happy_path") {
      lines.push("    expect(response.ok).toBe(true);");
      lines.push(`    expect(response.status).toBe(${log.statusCode});`);

      if (log.responseBody !== undefined) {
        lines.push("    const data = await response.json();");
        lines.push("    expect(data).toBeDefined();");

        // Add shape assertions based on response structure
        if (typeof log.responseBody === "object" && log.responseBody !== null) {
          const keys = Object.keys(log.responseBody as Record<string, unknown>);
          for (const key of keys.slice(0, 5)) {
            lines.push(`    expect(data).toHaveProperty("${key}");`);
          }
        }
      }
    } else if (type === "error_case") {
      lines.push(`    expect(response.status).toBe(${log.statusCode});`);
    } else {
      // edge_case
      lines.push(
        "    // Edge case: verify the API handles unusual input gracefully"
      );
      lines.push("    expect(response.status).toBeGreaterThanOrEqual(200);");
      lines.push("    expect(response.status).toBeLessThan(500);");
    }

    lines.push("  });");
    lines.push("});");

    return lines.join("\n");
  }
}
