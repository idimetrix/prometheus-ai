/**
 * Phase 3.6: Agent Benchmark Suite.
 *
 * Defines, runs, and reports on benchmark test cases for agent quality,
 * independent of the full BenchmarkRunner / SWE-bench infrastructure.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:benchmarks:agent");

export interface ExpectedOutcome {
  /** Description of what a correct outcome looks like */
  description: string;
  /** Minimum output length */
  minLength?: number;
  /** Keywords that must appear in the output */
  requiredKeywords?: string[];
  /** Custom validator function */
  validator?: (output: string) => boolean;
}

export interface BenchmarkTestCase {
  /** Which agent role to use */
  agentRole: string;
  /** What the expected output looks like */
  expectedOutcome: ExpectedOutcome;
  /** Unique name for this test case */
  name: string;
  /** The task description to give the agent */
  taskDescription: string;
}

export interface BenchmarkTestResult {
  /** Estimated cost */
  cost: number;
  /** Duration in milliseconds */
  duration: number;
  /** Failure reasons if any */
  failureReasons: string[];
  /** Test case name */
  name: string;
  /** Agent output */
  output: string;
  /** Whether the test passed */
  passed: boolean;
  /** Quality score (0-1) */
  qualityScore: number;
}

export interface BenchmarkReport {
  /** Average cost per test */
  avgCost: number;
  /** Average quality score across all tests */
  avgQuality: number;
  /** Average time per test in milliseconds */
  avgTime: number;
  /** Number of passing test cases */
  passedCases: number;
  /** Pass rate (0-1) */
  passRate: number;
  /** Unique report identifier */
  reportId: string;
  /** Individual test results */
  results: BenchmarkTestResult[];
  /** Timestamp of the run */
  timestamp: string;
  /** Total number of test cases */
  totalCases: number;
}

/** Handler type for executing a task (injected to decouple from AgentLoop) */
export type TaskExecutor = (
  taskDescription: string,
  agentRole: string
) => Promise<{ output: string; duration: number; cost: number }>;

export class AgentBenchmark {
  private readonly testCases = new Map<string, BenchmarkTestCase>();
  private readonly executor: TaskExecutor;

  constructor(executor: TaskExecutor) {
    this.executor = executor;
  }

  /**
   * Add a test case to the benchmark suite.
   */
  addTestCase(
    name: string,
    taskDescription: string,
    expectedOutcome: ExpectedOutcome,
    agentRole: string
  ): void {
    if (this.testCases.has(name)) {
      logger.warn({ name }, "Overwriting existing test case");
    }

    this.testCases.set(name, {
      name,
      taskDescription,
      expectedOutcome,
      agentRole,
    });

    logger.debug({ name, agentRole }, "Test case added");
  }

  /**
   * Run a single benchmark test case by name.
   */
  async runBenchmark(testCaseName: string): Promise<BenchmarkTestResult> {
    const testCase = this.testCases.get(testCaseName);
    if (!testCase) {
      throw new Error(`Test case "${testCaseName}" not found`);
    }

    return await this.executeTestCase(testCase);
  }

  /**
   * Run all benchmark test cases.
   */
  async runAll(): Promise<BenchmarkReport> {
    const results: BenchmarkTestResult[] = [];

    logger.info(
      { testCaseCount: this.testCases.size },
      "Starting benchmark suite"
    );

    for (const testCase of this.testCases.values()) {
      const result = await this.executeTestCase(testCase);
      results.push(result);

      logger.info(
        {
          name: testCase.name,
          passed: result.passed,
          qualityScore: result.qualityScore.toFixed(2),
          duration: result.duration,
        },
        "Test case completed"
      );
    }

    return this.getReport(results);
  }

  /**
   * Get a summary report from test results.
   */
  getReport(results?: BenchmarkTestResult[]): BenchmarkReport {
    const allResults = results ?? [];

    const totalCases = allResults.length;
    const passedCases = allResults.filter((r) => r.passed).length;
    const totalQuality = allResults.reduce((s, r) => s + r.qualityScore, 0);
    const totalTime = allResults.reduce((s, r) => s + r.duration, 0);
    const totalCost = allResults.reduce((s, r) => s + r.cost, 0);

    return {
      reportId: generateId("bench-report"),
      timestamp: new Date().toISOString(),
      totalCases,
      passedCases,
      passRate: totalCases > 0 ? passedCases / totalCases : 0,
      avgQuality: totalCases > 0 ? totalQuality / totalCases : 0,
      avgTime: totalCases > 0 ? totalTime / totalCases : 0,
      avgCost: totalCases > 0 ? totalCost / totalCases : 0,
      results: allResults,
    };
  }

  private async executeTestCase(
    testCase: BenchmarkTestCase
  ): Promise<BenchmarkTestResult> {
    const startTime = Date.now();

    try {
      const { output, duration, cost } = await this.executor(
        testCase.taskDescription,
        testCase.agentRole
      );

      const { passed, qualityScore, failureReasons } = this.scoreResult(
        output,
        testCase.expectedOutcome
      );

      return {
        name: testCase.name,
        passed,
        qualityScore,
        duration,
        cost,
        output,
        failureReasons,
      };
    } catch (error) {
      return {
        name: testCase.name,
        passed: false,
        qualityScore: 0,
        duration: Date.now() - startTime,
        cost: 0,
        output: "",
        failureReasons: [
          error instanceof Error ? error.message : String(error),
        ],
      };
    }
  }

  private scoreLengthCheck(
    output: string,
    expected: ExpectedOutcome,
    failureReasons: string[]
  ): number {
    if (!expected.minLength) {
      return 0;
    }
    if (output.length < expected.minLength) {
      failureReasons.push(
        `Output too short: ${output.length} < ${expected.minLength}`
      );
      return -0.2;
    }
    return 0.1;
  }

  private scoreKeywords(
    output: string,
    expected: ExpectedOutcome,
    failureReasons: string[]
  ): number {
    if (!expected.requiredKeywords || expected.requiredKeywords.length === 0) {
      return 0;
    }
    const outputLower = output.toLowerCase();
    let matchedCount = 0;

    for (const keyword of expected.requiredKeywords) {
      if (outputLower.includes(keyword.toLowerCase())) {
        matchedCount++;
      } else {
        failureReasons.push(`Missing required keyword: "${keyword}"`);
      }
    }

    return (matchedCount / expected.requiredKeywords.length) * 0.3;
  }

  private scoreValidator(
    output: string,
    expected: ExpectedOutcome,
    failureReasons: string[]
  ): number {
    if (!expected.validator) {
      return 0;
    }
    try {
      const valid = expected.validator(output);
      if (valid) {
        return 0.2;
      }
      failureReasons.push("Custom validator returned false");
      return -0.2;
    } catch (err) {
      failureReasons.push(
        `Validator error: ${err instanceof Error ? err.message : String(err)}`
      );
      return 0;
    }
  }

  private scoreResult(
    output: string,
    expected: ExpectedOutcome
  ): { passed: boolean; qualityScore: number; failureReasons: string[] } {
    if (!output || output.length === 0) {
      return { passed: false, qualityScore: 0, failureReasons: ["No output"] };
    }

    const failureReasons: string[] = [];
    let score = 0.5; // Base score for producing output

    score += this.scoreLengthCheck(output, expected, failureReasons);
    score += this.scoreKeywords(output, expected, failureReasons);
    score += this.scoreValidator(output, expected, failureReasons);

    const qualityScore = Math.max(0, Math.min(1, score));
    const passed = failureReasons.length === 0 && qualityScore >= 0.5;

    return { passed, qualityScore, failureReasons };
  }
}
