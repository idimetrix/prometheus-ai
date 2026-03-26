/**
 * MOON-060: Agent Capability Benchmarking
 *
 * Benchmarks agent capabilities across standard benchmark suites
 * (SWE-bench, HumanEval, MBPP, custom). Measures pass rate, quality,
 * latency distribution, cost, and compares across models.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:benchmarks:capability");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BenchmarkSuite = "swe-bench" | "humaneval" | "mbpp" | "custom";

export interface CapabilityBenchmarkOptions {
  /** Agent role to benchmark */
  agentRole: string;
  /** Which benchmark suite to use */
  benchmarkSuite: BenchmarkSuite;
  /** Number of test cases to sample (default: all available) */
  sampleSize?: number;
}

export interface CategoryResult {
  /** Number of tests that passed */
  passed: number;
  /** Score for this category (0-1) */
  score: number;
  /** Total tests in this category */
  total: number;
}

export interface ModelComparison {
  /** Model identifier */
  model: string;
  /** Score on this benchmark */
  score: number;
}

export interface LatencyStats {
  /** 50th percentile latency in ms */
  p50: number;
  /** 90th percentile latency in ms */
  p90: number;
  /** 99th percentile latency in ms */
  p99: number;
}

export interface CapabilityBenchmarkResult {
  /** Category-level breakdown */
  categories: Record<string, CategoryResult>;
  /** Comparison against known model baselines */
  comparison: ModelComparison[];
  /** Average cost per task in USD */
  costPerTask: number;
  /** Latency distribution */
  latencyStats: LatencyStats;
  /** Overall score (0-1) */
  overallScore: number;
  /** Proportion of tests that passed */
  passRate: number;
}

// ---------------------------------------------------------------------------
// Test case definitions
// ---------------------------------------------------------------------------

interface BenchmarkTask {
  category: string;
  description: string;
  expectedOutput: {
    minLength?: number;
    requiredKeywords?: string[];
    validator?: (output: string) => boolean;
  };
  id: string;
}

/** Injected executor for running benchmark tasks */
export type BenchmarkExecutor = (
  taskDescription: string,
  agentRole: string
) => Promise<{ cost: number; duration: number; output: string }>;

// ---------------------------------------------------------------------------
// Built-in benchmark suites
// ---------------------------------------------------------------------------

function getHumanEvalTasks(sampleSize?: number): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [
    {
      id: "humaneval-001",
      category: "string_manipulation",
      description:
        "Write a function that takes a string and returns it reversed.",
      expectedOutput: {
        requiredKeywords: ["function", "return"],
        minLength: 30,
      },
    },
    {
      id: "humaneval-002",
      category: "array_operations",
      description:
        "Write a function that takes an array of numbers and returns the sum of all even numbers.",
      expectedOutput: {
        requiredKeywords: ["function", "return"],
        minLength: 40,
      },
    },
    {
      id: "humaneval-003",
      category: "math",
      description:
        "Write a function that computes the nth Fibonacci number recursively.",
      expectedOutput: {
        requiredKeywords: ["function", "return"],
        minLength: 30,
      },
    },
    {
      id: "humaneval-004",
      category: "data_structures",
      description:
        "Implement a stack data structure with push, pop, and peek methods.",
      expectedOutput: {
        requiredKeywords: ["push", "pop"],
        minLength: 60,
      },
    },
    {
      id: "humaneval-005",
      category: "string_manipulation",
      description:
        "Write a function that checks if a given string is a palindrome.",
      expectedOutput: {
        requiredKeywords: ["function", "return"],
        minLength: 30,
      },
    },
    {
      id: "humaneval-006",
      category: "sorting",
      description: "Implement merge sort for an array of numbers.",
      expectedOutput: {
        requiredKeywords: ["function", "merge"],
        minLength: 80,
      },
    },
    {
      id: "humaneval-007",
      category: "tree_algorithms",
      description:
        "Write a function to perform BFS (breadth-first search) on a binary tree.",
      expectedOutput: {
        requiredKeywords: ["function", "queue"],
        minLength: 60,
      },
    },
    {
      id: "humaneval-008",
      category: "math",
      description: "Write a function to check if a number is prime.",
      expectedOutput: {
        requiredKeywords: ["function", "return"],
        minLength: 30,
      },
    },
    {
      id: "humaneval-009",
      category: "array_operations",
      description:
        "Write a function that removes duplicates from an array while preserving order.",
      expectedOutput: {
        requiredKeywords: ["function", "return"],
        minLength: 30,
      },
    },
    {
      id: "humaneval-010",
      category: "data_structures",
      description: "Implement a simple LRU cache with get and put methods.",
      expectedOutput: {
        requiredKeywords: ["get", "put"],
        minLength: 80,
      },
    },
  ];

  return sampleSize ? tasks.slice(0, sampleSize) : tasks;
}

function getMBPPTasks(sampleSize?: number): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [
    {
      id: "mbpp-001",
      category: "basic_python",
      description:
        "Write a function to find the maximum element in a nested list.",
      expectedOutput: { requiredKeywords: ["function", "max"], minLength: 20 },
    },
    {
      id: "mbpp-002",
      category: "string_processing",
      description:
        "Write a function that counts the number of vowels in a string.",
      expectedOutput: {
        requiredKeywords: ["function", "return"],
        minLength: 20,
      },
    },
    {
      id: "mbpp-003",
      category: "list_operations",
      description:
        "Write a function to flatten a deeply nested list into a single level.",
      expectedOutput: {
        requiredKeywords: ["function", "return"],
        minLength: 30,
      },
    },
    {
      id: "mbpp-004",
      category: "math",
      description: "Write a function to compute the GCD of two numbers.",
      expectedOutput: {
        requiredKeywords: ["function", "return"],
        minLength: 20,
      },
    },
    {
      id: "mbpp-005",
      category: "string_processing",
      description:
        "Write a function that converts a camelCase string to snake_case.",
      expectedOutput: {
        requiredKeywords: ["function", "return"],
        minLength: 30,
      },
    },
  ];

  return sampleSize ? tasks.slice(0, sampleSize) : tasks;
}

function getSWEBenchTasks(sampleSize?: number): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [
    {
      id: "swe-001",
      category: "bug_fix",
      description:
        "Fix a bug where an off-by-one error causes array index out of bounds in a pagination function.",
      expectedOutput: {
        requiredKeywords: ["fix", "index"],
        minLength: 50,
      },
    },
    {
      id: "swe-002",
      category: "feature",
      description:
        "Add input validation to an API endpoint that currently accepts any string for an email field.",
      expectedOutput: {
        requiredKeywords: ["validate", "email"],
        minLength: 50,
      },
    },
    {
      id: "swe-003",
      category: "refactor",
      description:
        "Refactor a function with cyclomatic complexity of 15 into smaller, testable units.",
      expectedOutput: {
        requiredKeywords: ["function"],
        minLength: 80,
      },
    },
    {
      id: "swe-004",
      category: "test",
      description:
        "Write unit tests for a user authentication module covering login, logout, and token refresh.",
      expectedOutput: {
        requiredKeywords: ["test", "expect"],
        minLength: 100,
      },
    },
    {
      id: "swe-005",
      category: "bug_fix",
      description:
        "Fix a race condition in a caching layer where stale data is served after invalidation.",
      expectedOutput: {
        requiredKeywords: ["fix", "cache"],
        minLength: 60,
      },
    },
  ];

  return sampleSize ? tasks.slice(0, sampleSize) : tasks;
}

function getCustomTasks(sampleSize?: number): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [
    {
      id: "custom-001",
      category: "code_generation",
      description:
        "Generate a TypeScript REST API endpoint with Zod validation.",
      expectedOutput: {
        requiredKeywords: ["import", "export"],
        minLength: 50,
      },
    },
    {
      id: "custom-002",
      category: "code_review",
      description:
        "Review this code for security issues: `app.get('/user/:id', (req, res) => { const user = db.query('SELECT * FROM users WHERE id = ' + req.params.id); res.json(user); })`",
      expectedOutput: {
        requiredKeywords: ["injection", "sql"],
        minLength: 30,
      },
    },
    {
      id: "custom-003",
      category: "documentation",
      description:
        "Write JSDoc documentation for a function that merges two sorted arrays.",
      expectedOutput: {
        requiredKeywords: ["param", "return"],
        minLength: 40,
      },
    },
  ];

  return sampleSize ? tasks.slice(0, sampleSize) : tasks;
}

// ---------------------------------------------------------------------------
// Known baselines for comparison
// ---------------------------------------------------------------------------

const MODEL_BASELINES: Record<BenchmarkSuite, ModelComparison[]> = {
  humaneval: [
    { model: "claude-sonnet-4-6", score: 0.88 },
    { model: "gpt-4.1", score: 0.87 },
    { model: "claude-haiku-3.5", score: 0.75 },
  ],
  mbpp: [
    { model: "claude-sonnet-4-6", score: 0.85 },
    { model: "gpt-4.1", score: 0.84 },
    { model: "claude-haiku-3.5", score: 0.72 },
  ],
  "swe-bench": [
    { model: "claude-sonnet-4-6", score: 0.49 },
    { model: "gpt-4.1", score: 0.55 },
    { model: "claude-haiku-3.5", score: 0.3 },
  ],
  custom: [],
};

// ---------------------------------------------------------------------------
// CapabilityBenchmark
// ---------------------------------------------------------------------------

export class CapabilityBenchmark {
  private readonly executor: BenchmarkExecutor;

  constructor(executor: BenchmarkExecutor) {
    this.executor = executor;
  }

  /**
   * Run the specified benchmark suite and return detailed results.
   */
  async run(
    options: CapabilityBenchmarkOptions
  ): Promise<CapabilityBenchmarkResult> {
    const { agentRole, benchmarkSuite, sampleSize } = options;

    logger.info(
      { agentRole, benchmarkSuite, sampleSize },
      "Starting capability benchmark"
    );

    const tasks = this.getTasks(benchmarkSuite, sampleSize);

    if (tasks.length === 0) {
      return {
        overallScore: 0,
        passRate: 0,
        categories: {},
        latencyStats: { p50: 0, p90: 0, p99: 0 },
        costPerTask: 0,
        comparison: MODEL_BASELINES[benchmarkSuite] ?? [],
      };
    }

    // Execute all tasks
    const results: Array<{
      category: string;
      cost: number;
      duration: number;
      passed: boolean;
      score: number;
      taskId: string;
    }> = [];

    for (const task of tasks) {
      const result = await this.executeTask(task, agentRole);
      results.push(result);

      logger.debug(
        {
          taskId: task.id,
          passed: result.passed,
          score: result.score.toFixed(2),
          duration: result.duration,
        },
        "Benchmark task complete"
      );
    }

    // Compute statistics
    const overallScore = this.computeOverallScore(results);
    const passRate = this.computePassRate(results);
    const categories = this.computeCategories(results);
    const latencyStats = this.computeLatencyStats(
      results.map((r) => r.duration)
    );
    const costPerTask = this.computeAverageCost(results);
    const comparison = MODEL_BASELINES[benchmarkSuite] ?? [];

    logger.info(
      {
        agentRole,
        benchmarkSuite,
        overallScore: overallScore.toFixed(3),
        passRate: passRate.toFixed(3),
        tasksRun: results.length,
      },
      "Capability benchmark complete"
    );

    return {
      overallScore,
      passRate,
      categories,
      latencyStats,
      costPerTask,
      comparison,
    };
  }

  private getTasks(
    suite: BenchmarkSuite,
    sampleSize?: number
  ): BenchmarkTask[] {
    switch (suite) {
      case "humaneval":
        return getHumanEvalTasks(sampleSize);
      case "mbpp":
        return getMBPPTasks(sampleSize);
      case "swe-bench":
        return getSWEBenchTasks(sampleSize);
      case "custom":
        return getCustomTasks(sampleSize);
      default:
        return getHumanEvalTasks(sampleSize);
    }
  }

  private async executeTask(
    task: BenchmarkTask,
    agentRole: string
  ): Promise<{
    category: string;
    cost: number;
    duration: number;
    passed: boolean;
    score: number;
    taskId: string;
  }> {
    try {
      const { output, duration, cost } = await this.executor(
        task.description,
        agentRole
      );

      const { passed, score } = this.evaluateOutput(
        output,
        task.expectedOutput
      );

      return {
        taskId: task.id,
        category: task.category,
        passed,
        score,
        duration,
        cost,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ taskId: task.id, error: msg }, "Benchmark task failed");

      return {
        taskId: task.id,
        category: task.category,
        passed: false,
        score: 0,
        duration: 0,
        cost: 0,
      };
    }
  }

  private evaluateOutput(
    output: string,
    expected: BenchmarkTask["expectedOutput"]
  ): { passed: boolean; score: number } {
    if (!output || output.length === 0) {
      return { passed: false, score: 0 };
    }

    let score = 0.4; // Base score for producing output
    let pass = true;

    // Length check
    if (expected.minLength && output.length < expected.minLength) {
      score -= 0.2;
      pass = false;
    } else {
      score += 0.1;
    }

    // Keyword check
    if (expected.requiredKeywords && expected.requiredKeywords.length > 0) {
      const outputLower = output.toLowerCase();
      let matched = 0;
      for (const kw of expected.requiredKeywords) {
        if (outputLower.includes(kw.toLowerCase())) {
          matched++;
        } else {
          pass = false;
        }
      }
      score += (matched / expected.requiredKeywords.length) * 0.3;
    }

    // Custom validator
    if (expected.validator) {
      try {
        if (expected.validator(output)) {
          score += 0.2;
        } else {
          pass = false;
        }
      } catch {
        pass = false;
      }
    }

    return { passed: pass, score: Math.max(0, Math.min(1, score)) };
  }

  private computeOverallScore(results: Array<{ score: number }>): number {
    if (results.length === 0) {
      return 0;
    }
    const sum = results.reduce((s, r) => s + r.score, 0);
    return sum / results.length;
  }

  private computePassRate(results: Array<{ passed: boolean }>): number {
    if (results.length === 0) {
      return 0;
    }
    const passed = results.filter((r) => r.passed).length;
    return passed / results.length;
  }

  private computeCategories(
    results: Array<{ category: string; passed: boolean; score: number }>
  ): Record<string, CategoryResult> {
    const categories: Record<
      string,
      { passed: number; scores: number[]; total: number }
    > = {};

    for (const result of results) {
      const cat = categories[result.category] ?? {
        total: 0,
        passed: 0,
        scores: [],
      };
      cat.total++;
      if (result.passed) {
        cat.passed++;
      }
      cat.scores.push(result.score);
      categories[result.category] = cat;
    }

    const final: Record<string, CategoryResult> = {};
    for (const [name, data] of Object.entries(categories)) {
      const avgScore =
        data.scores.length > 0
          ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length
          : 0;

      final[name] = {
        score: avgScore,
        passed: data.passed,
        total: data.total,
      };
    }

    return final;
  }

  private computeLatencyStats(durations: number[]): LatencyStats {
    if (durations.length === 0) {
      return { p50: 0, p90: 0, p99: 0 };
    }

    const sorted = [...durations].sort((a, b) => a - b);
    return {
      p50: this.percentile(sorted, 0.5),
      p90: this.percentile(sorted, 0.9),
      p99: this.percentile(sorted, 0.99),
    };
  }

  private percentile(sorted: number[], p: number): number {
    const idx = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.max(0, idx)] ?? 0;
  }

  private computeAverageCost(results: Array<{ cost: number }>): number {
    if (results.length === 0) {
      return 0;
    }
    const total = results.reduce((s, r) => s + r.cost, 0);
    return total / results.length;
  }
}
