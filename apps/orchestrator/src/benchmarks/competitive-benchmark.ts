/**
 * Competitive Benchmark
 *
 * Runs standardized tasks (bug fix, feature add, refactor, full-stack feature)
 * through Prometheus and compares against competitor baselines.
 */

import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:competitive-benchmark");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkTask {
  category: "bug_fix" | "feature_add" | "refactor" | "full_stack";
  description: string;
  expectedOutcome: string;
  id: string;
  name: string;
}

export interface BenchmarkResult {
  category: string;
  costUsd: number;
  qualityScore: number;
  speedMs: number;
  success: boolean;
  taskId: string;
}

export interface ComparisonDelta {
  costDelta: number;
  qualityDelta: number;
  speedDelta: number;
  taskId: string;
  winner: "prometheus" | "competitor" | "tie";
}

export interface CompetitorBaseline {
  category: string;
  costUsd: number;
  qualityScore: number;
  speedMs: number;
  successRate: number;
}

export interface BenchmarkReport {
  avgCostUsd: number;
  avgQualityScore: number;
  avgSpeedMs: number;
  comparisons: ComparisonDelta[];
  overallSuccessRate: number;
  results: BenchmarkResult[];
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Standard Task Set
// ---------------------------------------------------------------------------

const STANDARD_TASKS: BenchmarkTask[] = [
  {
    id: "bench-bugfix-1",
    name: "Fix off-by-one error",
    category: "bug_fix",
    description:
      "Fix an off-by-one error in a pagination utility that causes the last page to be empty when total items is exactly divisible by page size.",
    expectedOutcome: "Pagination returns correct page count",
  },
  {
    id: "bench-feature-1",
    name: "Add search filtering",
    category: "feature_add",
    description:
      "Add a search filter to an existing list component that filters items by name in real-time as the user types.",
    expectedOutcome: "List filters correctly with debounced input",
  },
  {
    id: "bench-refactor-1",
    name: "Extract utility module",
    category: "refactor",
    description:
      "Refactor duplicated date formatting logic found in 4 different files into a shared utility module with proper exports and tests.",
    expectedOutcome: "Shared module used by all 4 files, tests pass",
  },
  {
    id: "bench-fullstack-1",
    name: "Add user preferences API",
    category: "full_stack",
    description:
      "Implement a complete user preferences feature: database schema, tRPC API endpoints (get/update), and a React settings form with save functionality.",
    expectedOutcome:
      "Preferences persist across sessions, form validates input",
  },
];

// ---------------------------------------------------------------------------
// CompetitiveBenchmark
// ---------------------------------------------------------------------------

export class CompetitiveBenchmark {
  private readonly orchestratorUrl: string;
  private readonly baselines = new Map<string, CompetitorBaseline>();

  constructor() {
    this.orchestratorUrl =
      process.env.ORCHESTRATOR_URL ?? "http://localhost:4002";
  }

  /**
   * Get the standard benchmark task set.
   */
  getStandardTasks(): BenchmarkTask[] {
    return [...STANDARD_TASKS];
  }

  /**
   * Register a competitor baseline for comparison.
   */
  registerBaseline(category: string, baseline: CompetitorBaseline): void {
    this.baselines.set(category, baseline);
  }

  /**
   * Run a single benchmark task.
   */
  async runBenchmark(taskId: string): Promise<BenchmarkResult> {
    const task = STANDARD_TASKS.find((t) => t.id === taskId);
    if (!task) {
      throw new Error(`Benchmark task not found: ${taskId}`);
    }

    const startTime = Date.now();

    try {
      const response = await fetch(`${this.orchestratorUrl}/benchmark`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          taskId: task.id,
          description: task.description,
          expectedOutcome: task.expectedOutcome,
        }),
        signal: AbortSignal.timeout(600_000),
      });

      if (!response.ok) {
        return {
          taskId: task.id,
          category: task.category,
          success: false,
          qualityScore: 0,
          speedMs: Date.now() - startTime,
          costUsd: 0,
        };
      }

      const data = (await response.json()) as {
        success: boolean;
        qualityScore: number;
        costUsd: number;
      };

      return {
        taskId: task.id,
        category: task.category,
        success: data.success,
        qualityScore: data.qualityScore,
        speedMs: Date.now() - startTime,
        costUsd: data.costUsd,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error({ error: msg, taskId }, "Benchmark task failed");

      return {
        taskId: task.id,
        category: task.category,
        success: false,
        qualityScore: 0,
        speedMs: Date.now() - startTime,
        costUsd: 0,
      };
    }
  }

  /**
   * Compare a Prometheus result against a competitor baseline.
   */
  compareResults(
    prometheusResult: BenchmarkResult,
    competitorBaseline: CompetitorBaseline
  ): ComparisonDelta {
    const qualityDelta =
      prometheusResult.qualityScore - competitorBaseline.qualityScore;
    const speedDelta = competitorBaseline.speedMs - prometheusResult.speedMs; // Positive = faster
    const costDelta = competitorBaseline.costUsd - prometheusResult.costUsd; // Positive = cheaper

    // Determine winner based on weighted score
    const prometheusScore =
      prometheusResult.qualityScore * 0.5 +
      (1 / Math.max(1, prometheusResult.speedMs)) * 1000 * 0.3 +
      (1 / Math.max(0.001, prometheusResult.costUsd)) * 0.2;

    const competitorScore =
      competitorBaseline.qualityScore * 0.5 +
      (1 / Math.max(1, competitorBaseline.speedMs)) * 1000 * 0.3 +
      (1 / Math.max(0.001, competitorBaseline.costUsd)) * 0.2;

    const scoreDiff = Math.abs(prometheusScore - competitorScore);
    let winner: "prometheus" | "competitor" | "tie" = "tie";
    if (scoreDiff > 0.05) {
      winner = prometheusScore > competitorScore ? "prometheus" : "competitor";
    }

    return {
      taskId: prometheusResult.taskId,
      qualityDelta,
      speedDelta,
      costDelta,
      winner,
    };
  }

  /**
   * Generate a full comparison report.
   */
  generateReport(results: BenchmarkResult[]): BenchmarkReport {
    const comparisons: ComparisonDelta[] = [];

    for (const result of results) {
      const baseline = this.baselines.get(result.category);
      if (baseline) {
        comparisons.push(this.compareResults(result, baseline));
      }
    }

    const successful = results.filter((r) => r.success);
    const avgQuality =
      successful.length > 0
        ? successful.reduce((s, r) => s + r.qualityScore, 0) / successful.length
        : 0;
    const avgSpeed =
      results.length > 0
        ? results.reduce((s, r) => s + r.speedMs, 0) / results.length
        : 0;
    const avgCost =
      results.length > 0
        ? results.reduce((s, r) => s + r.costUsd, 0) / results.length
        : 0;

    const report: BenchmarkReport = {
      timestamp: new Date().toISOString(),
      results,
      comparisons,
      overallSuccessRate:
        results.length > 0 ? successful.length / results.length : 0,
      avgQualityScore: avgQuality,
      avgSpeedMs: avgSpeed,
      avgCostUsd: avgCost,
    };

    logger.info(
      {
        tasks: results.length,
        successRate: report.overallSuccessRate.toFixed(2),
        avgQuality: avgQuality.toFixed(2),
      },
      "Competitive benchmark complete"
    );

    return report;
  }
}
