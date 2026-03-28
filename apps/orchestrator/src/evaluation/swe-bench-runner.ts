/**
 * SWE-bench Benchmark Runner — GAP-021
 *
 * Runs SWE-bench instances against the Prometheus agent system to measure
 * task completion rates. Supports lite, verified, and full splits.
 *
 * SWE-bench is a benchmark of real-world GitHub issues from popular
 * Python repositories. Each instance includes a problem statement,
 * the affected repository, and a test patch to verify the fix.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:evaluation:swe-bench");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchInstance {
  /** Base commit to check out */
  baseCommit: string;
  /** Hints for the agent (optional) */
  hints?: string;
  /** Unique instance identifier (e.g., "django__django-12345") */
  instanceId: string;
  /** Test patch to apply for verification */
  patchTest: string;
  /** The problem statement (GitHub issue body) */
  problemStatement: string;
  /** Repository name (e.g., "django/django") */
  repo: string;
  /** SWE-bench split this instance belongs to */
  split: "lite" | "verified" | "full";
  /** Version of the repository */
  version: string;
}

export interface BenchResult {
  /** Duration in milliseconds */
  duration: number;
  /** Error message if failed */
  error?: string;
  /** Files changed by the agent */
  filesChanged: string[];
  /** The agent's generated patch */
  generatedPatch: string;
  /** The instance that was tested */
  instanceId: string;
  /** Whether the fix was applied successfully */
  resolved: boolean;
  /** Whether the test patch passed after the fix */
  testsPassed: boolean;
  /** Total tokens consumed */
  tokensUsed: number;
}

export interface BenchmarkReport {
  /** Average duration per instance in ms */
  avgDuration: number;
  /** Completion timestamp */
  completedAt: string;
  /** Number of failed instances */
  failed: number;
  /** Unique report identifier */
  id: string;
  /** Number of instances that passed */
  passed: number;
  /** Pass rate as a percentage */
  passRate: number;
  /** Individual results */
  results: BenchResult[];
  /** The split that was benchmarked */
  split: string;
  /** Start timestamp */
  startedAt: string;
  /** Total instances attempted */
  total: number;
  /** Total tokens consumed across all instances */
  totalTokens: number;
}

export interface RegressionReport {
  /** Instances that improved (failed -> passed) */
  improvements: string[];
  /** New pass rate */
  newPassRate: number;
  /** Previous pass rate */
  previousPassRate: number;
  /** Instances that regressed (passed -> failed) */
  regressions: string[];
  /** Instances that stayed the same */
  unchanged: string[];
}

// ---------------------------------------------------------------------------
// SWEBenchRunner
// ---------------------------------------------------------------------------

export class SWEBenchRunner {
  private readonly dataDir: string;

  constructor(dataDir = "/data/swe-bench") {
    this.dataDir = dataDir;
  }

  /**
   * Load SWE-bench instances from the specified split.
   * In a real implementation, this would download or read from a
   * local cache of the SWE-bench dataset.
   */
  loadInstances(split: "lite" | "verified" | "full"): Promise<BenchInstance[]> {
    logger.info(
      { split, dataDir: this.dataDir },
      "Loading SWE-bench instances"
    );

    // In production, this would load from the SWE-bench dataset files.
    // For now, return an empty array that can be populated by the
    // dataset loader.
    const instances: BenchInstance[] = [];

    logger.info(
      { split, count: instances.length },
      "SWE-bench instances loaded"
    );

    return Promise.resolve(instances);
  }

  /**
   * Run a single SWE-bench instance through the agent system.
   * Sets up the repository, runs the agent, and verifies with the test patch.
   */
  runInstance(instance: BenchInstance): Promise<BenchResult> {
    const startTime = Date.now();

    logger.info(
      { instanceId: instance.instanceId, repo: instance.repo },
      "Running SWE-bench instance"
    );

    try {
      // 1. Clone the repository at the base commit
      // 2. Run the agent with the problem statement
      // 3. Capture the agent's patch
      // 4. Apply the test patch
      // 5. Run the tests to verify

      // Placeholder: in production, this orchestrates the full agent loop
      const result: BenchResult = {
        instanceId: instance.instanceId,
        resolved: false,
        testsPassed: false,
        generatedPatch: "",
        filesChanged: [],
        duration: Date.now() - startTime,
        tokensUsed: 0,
      };

      logger.info(
        {
          instanceId: instance.instanceId,
          resolved: result.resolved,
          duration: result.duration,
        },
        "SWE-bench instance completed"
      );

      return Promise.resolve(result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error(
        { instanceId: instance.instanceId, error: errorMessage },
        "SWE-bench instance failed"
      );

      return Promise.resolve({
        instanceId: instance.instanceId,
        resolved: false,
        testsPassed: false,
        generatedPatch: "",
        filesChanged: [],
        duration: Date.now() - startTime,
        tokensUsed: 0,
        error: errorMessage,
      });
    }
  }

  /**
   * Run the full benchmark across all instances in a split.
   * Optionally limit the number of instances for quick evaluation.
   */
  async runBenchmark(
    split: "lite" | "verified" | "full",
    maxInstances?: number
  ): Promise<BenchmarkReport> {
    const startedAt = new Date().toISOString();
    const reportId = generateId("bench");

    logger.info(
      { split, maxInstances, reportId },
      "Starting SWE-bench benchmark run"
    );

    let instances = await this.loadInstances(split);
    if (maxInstances !== undefined && maxInstances > 0) {
      instances = instances.slice(0, maxInstances);
    }

    const results: BenchResult[] = [];

    for (const instance of instances) {
      const result = await this.runInstance(instance);
      results.push(result);
    }

    const passed = results.filter((r) => r.resolved && r.testsPassed).length;
    const failed = results.length - passed;
    const totalTokens = results.reduce((sum, r) => sum + r.tokensUsed, 0);
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

    const report: BenchmarkReport = {
      id: reportId,
      split,
      startedAt,
      completedAt: new Date().toISOString(),
      total: results.length,
      passed,
      failed,
      passRate: results.length > 0 ? (passed / results.length) * 100 : 0,
      avgDuration: results.length > 0 ? totalDuration / results.length : 0,
      totalTokens,
      results,
    };

    logger.info(
      {
        reportId,
        split,
        total: report.total,
        passed: report.passed,
        passRate: report.passRate.toFixed(1),
      },
      "SWE-bench benchmark completed"
    );

    return report;
  }

  /**
   * Compare two benchmark reports to identify regressions and improvements.
   */
  compareResults(
    current: BenchmarkReport,
    previous: BenchmarkReport
  ): RegressionReport {
    const currentMap = new Map(
      current.results.map((r) => [r.instanceId, r.resolved && r.testsPassed])
    );
    const previousMap = new Map(
      previous.results.map((r) => [r.instanceId, r.resolved && r.testsPassed])
    );

    const regressions: string[] = [];
    const improvements: string[] = [];
    const unchanged: string[] = [];

    // Check all instances that appear in both reports
    for (const [instanceId, currentPassed] of currentMap) {
      const previousPassed = previousMap.get(instanceId);

      if (previousPassed === undefined) {
        // New instance, not in previous report
        continue;
      }

      if (previousPassed && !currentPassed) {
        regressions.push(instanceId);
      } else if (!previousPassed && currentPassed) {
        improvements.push(instanceId);
      } else {
        unchanged.push(instanceId);
      }
    }

    return {
      previousPassRate: previous.passRate,
      newPassRate: current.passRate,
      regressions,
      improvements,
      unchanged,
    };
  }
}
