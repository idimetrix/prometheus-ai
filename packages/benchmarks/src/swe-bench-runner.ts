import { readFile } from "node:fs/promises";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("benchmarks:swe-bench");

export interface SWEBenchProblem {
  baseCommit: string;
  hints: string;
  instanceId: string;
  problem: string;
  repo: string;
  testPatch: string;
}

export interface SWEBenchResult {
  error?: string;
  executionTimeMs: number;
  instanceId: string;
  passed: boolean;
  patchGenerated: string;
}

export interface SWEBenchRunnerConfig {
  apiKey: string;
  apiUrl: string;
  concurrency?: number;
}

interface TaskResponse {
  id: string;
  result?: {
    patch?: string;
    passed?: boolean;
  };
  status: string;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 300;

export class SWEBenchRunner {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly concurrency: number;

  constructor(config: SWEBenchRunnerConfig) {
    this.apiUrl = config.apiUrl;
    this.apiKey = config.apiKey;
    this.concurrency = config.concurrency ?? 1;
  }

  async loadDataset(path: string): Promise<SWEBenchProblem[]> {
    const content = await readFile(path, "utf-8");
    const lines = content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const problems: SWEBenchProblem[] = [];

    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      problems.push({
        instanceId: String(parsed.instance_id ?? parsed.instanceId ?? ""),
        repo: String(parsed.repo ?? ""),
        baseCommit: String(parsed.base_commit ?? parsed.baseCommit ?? ""),
        problem: String(parsed.problem_statement ?? parsed.problem ?? ""),
        hints: String(parsed.hints_text ?? parsed.hints ?? ""),
        testPatch: String(parsed.test_patch ?? parsed.testPatch ?? ""),
      });
    }

    logger.info({ count: problems.length, path }, "Loaded SWE-bench dataset");
    return problems;
  }

  async runSingle(problem: SWEBenchProblem): Promise<SWEBenchResult> {
    const startTime = Date.now();

    try {
      // Submit task to Prometheus API
      const submitResponse = await fetch(`${this.apiUrl}/api/tasks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          type: "swe-bench",
          instanceId: problem.instanceId,
          repo: problem.repo,
          baseCommit: problem.baseCommit,
          problem: problem.problem,
          hints: problem.hints,
          testPatch: problem.testPatch,
        }),
      });

      if (!submitResponse.ok) {
        const errorText = await submitResponse.text();
        throw new Error(
          `Failed to submit task: ${submitResponse.status} ${errorText}`
        );
      }

      const task = (await submitResponse.json()) as TaskResponse;
      const taskId = task.id;

      logger.info(
        { instanceId: problem.instanceId, taskId },
        "Submitted SWE-bench task"
      );

      // Poll for completion
      let attempts = 0;
      while (attempts < MAX_POLL_ATTEMPTS) {
        await this.sleep(POLL_INTERVAL_MS);
        attempts++;

        const statusResponse = await fetch(
          `${this.apiUrl}/api/tasks/${taskId}`,
          {
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
            },
          }
        );

        if (!statusResponse.ok) {
          continue;
        }

        const status = (await statusResponse.json()) as TaskResponse;

        if (status.status === "completed") {
          const executionTimeMs = Date.now() - startTime;
          const patch = status.result?.patch ?? "";
          const passed = status.result?.passed ?? false;

          logger.info(
            { instanceId: problem.instanceId, passed, executionTimeMs },
            "SWE-bench task completed"
          );

          return {
            instanceId: problem.instanceId,
            passed,
            patchGenerated: patch,
            executionTimeMs,
          };
        }

        if (status.status === "failed" || status.status === "error") {
          return {
            instanceId: problem.instanceId,
            passed: false,
            patchGenerated: "",
            executionTimeMs: Date.now() - startTime,
            error: `Task failed with status: ${status.status}`,
          };
        }
      }

      return {
        instanceId: problem.instanceId,
        passed: false,
        patchGenerated: "",
        executionTimeMs: Date.now() - startTime,
        error: "Task timed out waiting for completion",
      };
    } catch (error) {
      return {
        instanceId: problem.instanceId,
        passed: false,
        patchGenerated: "",
        executionTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async runAll(problems: SWEBenchProblem[]): Promise<SWEBenchResult[]> {
    const results: SWEBenchResult[] = [];
    const queue = [...problems];

    logger.info(
      { total: problems.length, concurrency: this.concurrency },
      "Starting SWE-bench run"
    );

    const workers = Array.from(
      { length: Math.min(this.concurrency, queue.length) },
      async () => {
        while (queue.length > 0) {
          const problem = queue.shift();
          if (!problem) {
            break;
          }
          const result = await this.runSingle(problem);
          results.push(result);

          logger.info(
            {
              completed: results.length,
              total: problems.length,
              instanceId: problem.instanceId,
              passed: result.passed,
            },
            "Progress update"
          );
        }
      }
    );

    await Promise.all(workers);

    logger.info(
      {
        total: results.length,
        passed: results.filter((r) => r.passed).length,
      },
      "SWE-bench run complete"
    );

    return results;
  }

  generateReport(results: SWEBenchResult[]): string {
    const total = results.length;
    const passed = results.filter((r) => r.passed).length;
    const failed = total - passed;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : "0.0";

    const executionTimes = results.map((r) => r.executionTimeMs);
    const avgTime =
      executionTimes.length > 0
        ? executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length
        : 0;
    const minTime = executionTimes.length > 0 ? Math.min(...executionTimes) : 0;
    const maxTime = executionTimes.length > 0 ? Math.max(...executionTimes) : 0;

    const errors = results.filter((r) => r.error);

    const lines: string[] = [
      "# SWE-Bench Results Report",
      "",
      "## Summary",
      "",
      "| Metric | Value |",
      "|--------|-------|",
      `| Total Problems | ${total} |`,
      `| Passed | ${passed} |`,
      `| Failed | ${failed} |`,
      `| Pass Rate | ${passRate}% |`,
      `| Avg Execution Time | ${(avgTime / 1000).toFixed(1)}s |`,
      `| Min Execution Time | ${(minTime / 1000).toFixed(1)}s |`,
      `| Max Execution Time | ${(maxTime / 1000).toFixed(1)}s |`,
      "",
      "## Results",
      "",
      "| Instance ID | Status | Time (s) | Error |",
      "|-------------|--------|----------|-------|",
    ];

    for (const result of results) {
      const status = result.passed ? "PASS" : "FAIL";
      const time = (result.executionTimeMs / 1000).toFixed(1);
      const error = result.error ?? "-";
      lines.push(`| ${result.instanceId} | ${status} | ${time} | ${error} |`);
    }

    if (errors.length > 0) {
      lines.push("");
      lines.push("## Errors");
      lines.push("");
      for (const result of errors) {
        lines.push(`- **${result.instanceId}**: ${result.error}`);
      }
    }

    lines.push("");

    return lines.join("\n");
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
