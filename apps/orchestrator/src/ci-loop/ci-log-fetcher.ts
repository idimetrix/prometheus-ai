import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:ci-loop:log-fetcher");

const FAILURE_INDICATOR_RE = /(?:error|failed|failure|FAIL|exit code [1-9])/i;
const SUCCESS_INDICATOR_RE = /(?:0 errors|all.*pass|success)/i;

export type CIFailureCategory =
  | "test_failure"
  | "build_error"
  | "lint_error"
  | "type_error"
  | "other";

export interface CIFailureData {
  category: CIFailureCategory;
  details: string[];
  rawOutput: string;
}

export interface ParsedCILog {
  checkName: string;
  failures: CIFailureData[];
  rawLog: string;
  success: boolean;
}

// ─── Top-level regex constants ──────────────────────────────────────────
const TS_ERROR_RE = /error TS\d+:/;
const BUILD_ERROR_RE =
  /(?:Build failed|Compilation error|Module build failed|ELIFECYCLE|exit code [1-9])/i;
const LINT_VIOLATION_RE =
  /(?:lint|eslint|biome|prettier).*(?:error|warning|violation)/i;
const TEST_FAIL_LINE_RE =
  /(?:FAIL|✕|×|FAILED|Error:.*test|AssertionError|expect\()/;
const VITEST_FAIL_RE = /(?:FAIL)\s+.*\.(?:test|spec)\./;
const JEST_FAIL_RE = /(?:FAIL)\s+.*\.(test|spec)\./;
const TYPE_ERROR_DETAILED_RE =
  /(?:error TS\d+|Type error|type.*not assignable|Property.*does not exist)/i;
const BUILD_ERROR_DETAILED_RE =
  /(?:Build failed|Module not found|Cannot find module|SyntaxError.*compil)/i;
const LINT_ERROR_DETAILED_RE =
  /(?:\d+ error|✖ \d+ problem|Found \d+ error|lint.*failed)/i;

/**
 * CILogFetcher retrieves CI logs from GitHub Actions via the GitHub API
 * (or MCP adapter) and parses them into structured failure data.
 */
export class CILogFetcher {
  private readonly githubToken: string;
  private readonly apiBaseUrl: string;

  constructor(githubToken?: string, apiBaseUrl = "https://api.github.com") {
    this.githubToken = githubToken ?? process.env.GITHUB_TOKEN ?? "";
    this.apiBaseUrl = apiBaseUrl;
  }

  /**
   * Fetch CI logs for a check run from the GitHub Actions API.
   */
  async fetchCheckRunLogs(
    fullRepoName: string,
    checkRunId: number
  ): Promise<string> {
    const url = `${this.apiBaseUrl}/repos/${fullRepoName}/check-runs/${checkRunId}`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `Bearer ${this.githubToken}`,
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status, checkRunId },
          "Failed to fetch check run details"
        );
        return "";
      }

      const data = (await response.json()) as {
        output: {
          summary: string | null;
          text: string | null;
        };
      };

      // Combine summary and text for analysis
      const parts: string[] = [];
      if (data.output.summary) {
        parts.push(data.output.summary);
      }
      if (data.output.text) {
        parts.push(data.output.text);
      }

      return parts.join("\n\n");
    } catch (error) {
      logger.error(
        { error: String(error), checkRunId },
        "Error fetching check run logs"
      );
      return "";
    }
  }

  /**
   * Fetch workflow run logs from GitHub Actions API.
   */
  async fetchWorkflowRunLogs(
    fullRepoName: string,
    runId: number
  ): Promise<string> {
    const url = `${this.apiBaseUrl}/repos/${fullRepoName}/actions/runs/${runId}/logs`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `Bearer ${this.githubToken}`,
        },
        signal: AbortSignal.timeout(60_000),
        redirect: "follow",
      });

      if (!response.ok) {
        logger.warn(
          { status: response.status, runId },
          "Failed to fetch workflow run logs"
        );
        return "";
      }

      // Logs come as a zip file — return text for simple parsing
      return await response.text();
    } catch (error) {
      logger.error(
        { error: String(error), runId },
        "Error fetching workflow run logs"
      );
      return "";
    }
  }

  /**
   * Parse raw CI log output into structured failure data.
   * Categorizes failures as: test_failure, build_error, lint_error, type_error, other.
   */
  parseLogs(rawLog: string, checkName: string): ParsedCILog {
    if (!rawLog.trim()) {
      return {
        checkName,
        rawLog,
        success: true,
        failures: [],
      };
    }

    const failures: CIFailureData[] = [];

    // Check for type errors
    const typeErrors = this.extractTypeErrors(rawLog);
    if (typeErrors.length > 0) {
      failures.push({
        category: "type_error",
        details: typeErrors,
        rawOutput: this.extractSection(rawLog, TYPE_ERROR_DETAILED_RE),
      });
    }

    // Check for build errors
    const buildErrors = this.extractBuildErrors(rawLog);
    if (buildErrors.length > 0) {
      failures.push({
        category: "build_error",
        details: buildErrors,
        rawOutput: this.extractSection(rawLog, BUILD_ERROR_DETAILED_RE),
      });
    }

    // Check for lint errors
    const lintErrors = this.extractLintErrors(rawLog);
    if (lintErrors.length > 0) {
      failures.push({
        category: "lint_error",
        details: lintErrors,
        rawOutput: this.extractSection(rawLog, LINT_ERROR_DETAILED_RE),
      });
    }

    // Check for test failures
    const testFailures = this.extractTestFailures(rawLog);
    if (testFailures.length > 0) {
      failures.push({
        category: "test_failure",
        details: testFailures,
        rawOutput: this.extractSection(rawLog, TEST_FAIL_LINE_RE),
      });
    }

    // If no categorized failures but log indicates failure
    if (failures.length === 0 && this.looksLikeFailure(rawLog)) {
      failures.push({
        category: "other",
        details: ["Uncategorized CI failure"],
        rawOutput: rawLog.slice(0, 2000),
      });
    }

    logger.info(
      {
        checkName,
        failureCount: failures.length,
        categories: failures.map((f) => f.category),
      },
      "CI logs parsed"
    );

    return {
      checkName,
      rawLog,
      success: failures.length === 0,
      failures,
    };
  }

  private extractTypeErrors(log: string): string[] {
    const errors: string[] = [];
    const lines = log.split("\n");

    for (const line of lines) {
      if (TS_ERROR_RE.test(line)) {
        errors.push(line.trim());
      }
    }

    return errors;
  }

  private extractBuildErrors(log: string): string[] {
    const errors: string[] = [];
    const lines = log.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (BUILD_ERROR_RE.test(line) && !TS_ERROR_RE.test(line)) {
        // Include surrounding context
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 3);
        errors.push(lines.slice(start, end).join("\n").trim());
      }
    }

    return errors;
  }

  private extractLintErrors(log: string): string[] {
    const errors: string[] = [];
    const lines = log.split("\n");

    for (const line of lines) {
      if (LINT_VIOLATION_RE.test(line)) {
        errors.push(line.trim());
      }
    }

    return errors;
  }

  private extractTestFailures(log: string): string[] {
    const failures: string[] = [];
    const lines = log.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (
        VITEST_FAIL_RE.test(line) ||
        JEST_FAIL_RE.test(line) ||
        TEST_FAIL_LINE_RE.test(line)
      ) {
        const start = Math.max(0, i - 1);
        const end = Math.min(lines.length, i + 5);
        failures.push(lines.slice(start, end).join("\n").trim());
      }
    }

    return failures;
  }

  private extractSection(log: string, pattern: RegExp): string {
    const lines = log.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i] ?? "")) {
        const start = Math.max(0, i - 5);
        const end = Math.min(lines.length, i + 20);
        return lines.slice(start, end).join("\n");
      }
    }

    return log.slice(0, 1000);
  }

  private looksLikeFailure(log: string): boolean {
    return FAILURE_INDICATOR_RE.test(log) && !SUCCESS_INDICATOR_RE.test(log);
  }
}
