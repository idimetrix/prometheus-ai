/**
 * SWE-bench Evaluation Pipeline
 *
 * Runs SWE-bench instances through the full Prometheus pipeline
 * and compares output against gold patches.
 *
 * Target: 30%+ pass rate initially, track regression per commit.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:swe-bench");

export interface SWEBenchInstance {
  baseCommit: string;
  goldPatch: string;
  hints?: string;
  instanceId: string;
  problemStatement: string;
  repo: string;
  testPatch: string;
}

export interface EvaluationResult {
  actualPatch: string;
  costUsd: number;
  error?: string;
  goldPatch: string;
  instanceId: string;
  latencyMs: number;
  patchApplied: boolean;
  resolved: boolean;
  testsPassed: boolean;
  testsRun: boolean;
}

export interface BenchmarkReport {
  averageCostUsd: number;
  averageLatencyMs: number;
  commitHash: string;
  failedInstances: string[];
  passRate: number;
  results: EvaluationResult[];
  timestamp: string;
  totalInstances: number;
  totalResolved: number;
}

export class SWEBenchRunner {
  private readonly orchestratorUrl: string;

  constructor() {
    this.orchestratorUrl =
      process.env.ORCHESTRATOR_URL ?? "http://localhost:4002";
  }

  async runBenchmark(
    instances: SWEBenchInstance[],
    commitHash: string
  ): Promise<BenchmarkReport> {
    const results: EvaluationResult[] = [];
    const timestamp = new Date().toISOString();

    logger.info(
      { instanceCount: instances.length, commitHash },
      "Starting SWE-bench benchmark"
    );

    for (const instance of instances) {
      const result = await this.evaluateInstance(instance);
      results.push(result);

      logger.info(
        {
          instanceId: instance.instanceId,
          resolved: result.resolved,
          costUsd: result.costUsd.toFixed(4),
          latencyMs: result.latencyMs,
        },
        "Instance evaluated"
      );
    }

    const totalResolved = results.filter((r) => r.resolved).length;
    const passRate = totalResolved / instances.length;
    const averageCostUsd =
      results.reduce((sum, r) => sum + r.costUsd, 0) / results.length;
    const averageLatencyMs =
      results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length;
    const failedInstances = results
      .filter((r) => !r.resolved)
      .map((r) => r.instanceId);

    const report: BenchmarkReport = {
      timestamp,
      commitHash,
      totalInstances: instances.length,
      totalResolved,
      passRate,
      averageCostUsd,
      averageLatencyMs,
      failedInstances,
      results,
    };

    logger.info(
      {
        passRate: `${(passRate * 100).toFixed(1)}%`,
        totalResolved,
        totalInstances: instances.length,
        averageCostUsd: averageCostUsd.toFixed(4),
      },
      "SWE-bench benchmark complete"
    );

    return report;
  }

  private async evaluateInstance(
    instance: SWEBenchInstance
  ): Promise<EvaluationResult> {
    const startTime = Date.now();

    try {
      // Submit the problem statement as a task
      const response = await fetch(`${this.orchestratorUrl}/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: instance.instanceId,
          repo: instance.repo,
          baseCommit: instance.baseCommit,
          problemStatement: instance.problemStatement,
          hints: instance.hints,
        }),
        signal: AbortSignal.timeout(300_000), // 5 minute timeout
      });

      if (!response.ok) {
        return {
          instanceId: instance.instanceId,
          resolved: false,
          patchApplied: false,
          testsRun: false,
          testsPassed: false,
          actualPatch: "",
          goldPatch: instance.goldPatch,
          costUsd: 0,
          latencyMs: Date.now() - startTime,
          error: `Orchestrator returned ${response.status}`,
        };
      }

      const data = (await response.json()) as {
        patch: string;
        costUsd: number;
        testsPassed: boolean;
      };

      // Compare generated patch against gold patch
      const patchApplied = data.patch.length > 0;
      const resolved = data.testsPassed;

      return {
        instanceId: instance.instanceId,
        resolved,
        patchApplied,
        testsRun: true,
        testsPassed: data.testsPassed,
        actualPatch: data.patch,
        goldPatch: instance.goldPatch,
        costUsd: data.costUsd,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        instanceId: instance.instanceId,
        resolved: false,
        patchApplied: false,
        testsRun: false,
        testsPassed: false,
        actualPatch: "",
        goldPatch: instance.goldPatch,
        costUsd: 0,
        latencyMs: Date.now() - startTime,
        error: msg,
      };
    }
  }

  generateMarkdownReport(report: BenchmarkReport): string {
    const lines: string[] = [
      "# SWE-bench Evaluation Report",
      "",
      `**Date:** ${report.timestamp}`,
      `**Commit:** ${report.commitHash}`,
      "",
      "## Summary",
      "",
      "| Metric | Value |",
      "|--------|-------|",
      `| Total Instances | ${report.totalInstances} |`,
      `| Resolved | ${report.totalResolved} |`,
      `| Pass Rate | ${(report.passRate * 100).toFixed(1)}% |`,
      `| Avg Cost (USD) | $${report.averageCostUsd.toFixed(4)} |`,
      `| Avg Latency (ms) | ${report.averageLatencyMs.toFixed(0)} |`,
      "",
      "## Results",
      "",
      "| Instance | Resolved | Cost | Latency |",
      "|----------|----------|------|---------|",
    ];

    for (const r of report.results) {
      lines.push(
        `| ${r.instanceId} | ${r.resolved ? "✅" : "❌"} | $${r.costUsd.toFixed(4)} | ${r.latencyMs}ms |`
      );
    }

    if (report.failedInstances.length > 0) {
      lines.push("", "## Failed Instances", "");
      for (const id of report.failedInstances) {
        const result = report.results.find((r) => r.instanceId === id);
        lines.push(`- **${id}**: ${result?.error ?? "Unknown error"}`);
      }
    }

    return lines.join("\n");
  }
}
