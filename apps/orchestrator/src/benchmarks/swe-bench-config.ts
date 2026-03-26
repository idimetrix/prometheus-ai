/**
 * SWE-bench Benchmark Configuration
 *
 * Defines benchmark suites, scoring thresholds, and execution parameters
 * for running SWE-bench Lite evaluations against the Prometheus pipeline.
 */

export interface SWEBenchSuiteConfig {
  /** Agent role to use for solving tasks */
  agentRole: string;
  /** Path to the JSONL dataset file */
  datasetPath: string;
  /** Unique suite identifier */
  id: string;
  /** Timeout per instance in milliseconds */
  instanceTimeoutMs: number;
  /** Maximum cost per instance in USD */
  maxCostPerInstanceUsd: number;
  /** Maximum number of instances to evaluate (0 = all) */
  maxInstances: number;
  /** Maximum agent iterations per instance */
  maxIterations: number;
  /** Human-readable suite name */
  name: string;
  /** Target pass rate (0-1) to consider the suite successful */
  targetPassRate: number;
}

export interface SWEBenchConfig {
  /** Git commit hash to tag the benchmark run */
  commitHash: string;
  /** Max parallel instances (only used when parallel=true) */
  concurrency: number;
  /** Orchestrator URL for submitting evaluation tasks */
  orchestratorUrl: string;
  /** Whether to run instances in parallel */
  parallel: boolean;
  /** Directory to store benchmark reports */
  reportDir: string;
  /** Benchmark suites to run */
  suites: SWEBenchSuiteConfig[];
}

/**
 * Default SWE-bench Lite suite: 300 curated instances from the full
 * SWE-bench dataset, filtered for feasibility.
 */
const SWE_BENCH_LITE_SUITE: SWEBenchSuiteConfig = {
  id: "swe-bench-lite",
  name: "SWE-bench Lite",
  datasetPath: "data/swe-bench-lite.jsonl",
  maxInstances: 0,
  instanceTimeoutMs: 300_000,
  targetPassRate: 0.3,
  maxCostPerInstanceUsd: 2.0,
  agentRole: "backend_coder",
  maxIterations: 30,
};

/**
 * Quick smoke test suite: 10 instances for rapid validation during
 * development and CI.
 */
const SWE_BENCH_SMOKE_SUITE: SWEBenchSuiteConfig = {
  id: "swe-bench-smoke",
  name: "SWE-bench Smoke Test",
  datasetPath: "data/swe-bench-lite.jsonl",
  maxInstances: 10,
  instanceTimeoutMs: 120_000,
  targetPassRate: 0.2,
  maxCostPerInstanceUsd: 1.0,
  agentRole: "backend_coder",
  maxIterations: 15,
};

/**
 * Full SWE-bench dataset suite: all 2294 instances. Only used for
 * comprehensive evaluation runs, not CI.
 */
const SWE_BENCH_FULL_SUITE: SWEBenchSuiteConfig = {
  id: "swe-bench-full",
  name: "SWE-bench Full",
  datasetPath: "data/swe-bench-full.jsonl",
  maxInstances: 0,
  instanceTimeoutMs: 600_000,
  targetPassRate: 0.15,
  maxCostPerInstanceUsd: 5.0,
  agentRole: "backend_coder",
  maxIterations: 50,
};

/**
 * Create the default SWE-bench benchmark configuration.
 */
export function createDefaultConfig(
  overrides?: Partial<SWEBenchConfig>
): SWEBenchConfig {
  return {
    suites: [SWE_BENCH_LITE_SUITE],
    orchestratorUrl: process.env.ORCHESTRATOR_URL ?? "http://localhost:4002",
    reportDir: "benchmark-reports",
    parallel: false,
    concurrency: 4,
    commitHash: process.env.GIT_COMMIT_HASH ?? "unknown",
    ...overrides,
  };
}

/**
 * Get a named suite configuration.
 */
export function getSuiteConfig(
  suiteId: string
): SWEBenchSuiteConfig | undefined {
  const suites: Record<string, SWEBenchSuiteConfig> = {
    "swe-bench-lite": SWE_BENCH_LITE_SUITE,
    "swe-bench-smoke": SWE_BENCH_SMOKE_SUITE,
    "swe-bench-full": SWE_BENCH_FULL_SUITE,
  };
  return suites[suiteId];
}

/**
 * Evaluate whether a benchmark run meets its target thresholds.
 */
export function evaluateSuiteResult(
  suite: SWEBenchSuiteConfig,
  passRate: number,
  avgCostUsd: number
): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (passRate < suite.targetPassRate) {
    reasons.push(
      `Pass rate ${(passRate * 100).toFixed(1)}% below target ${(suite.targetPassRate * 100).toFixed(1)}%`
    );
  }

  if (avgCostUsd > suite.maxCostPerInstanceUsd) {
    reasons.push(
      `Avg cost $${avgCostUsd.toFixed(2)} exceeds limit $${suite.maxCostPerInstanceUsd.toFixed(2)}`
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}
