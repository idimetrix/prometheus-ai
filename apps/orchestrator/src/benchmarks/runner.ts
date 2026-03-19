/**
 * Phase 16.1: Benchmark Runner.
 * Runs task suites against known-good solutions and tracks metrics.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { AgentLoop } from "../agent-loop";

const logger = createLogger("orchestrator:benchmarks");

export interface BenchmarkTask {
  description: string;
  expectedFiles?: string[];
  id: string;
  mode: "task" | "ask" | "plan";
  title: string;
  validationCommand?: string;
}

export interface BenchmarkResult {
  creditsConsumed: number;
  duration: number;
  errors: string[];
  filesChanged: string[];
  passed: boolean;
  score: number;
  taskId: string;
}

export interface BenchmarkSuiteResult {
  averageDuration: number;
  averageScore: number;
  passRate: number;
  results: BenchmarkResult[];
  suiteId: string;
  timestamp: string;
  totalCredits: number;
  totalTasks: number;
}

export class BenchmarkRunner {
  private readonly agentLoop: AgentLoop;

  constructor(agentLoop: AgentLoop) {
    this.agentLoop = agentLoop;
  }

  /**
   * Run a suite of benchmark tasks and collect results.
   */
  async runSuite(tasks: BenchmarkTask[]): Promise<BenchmarkSuiteResult> {
    const suiteId = generateId("bench");
    const results: BenchmarkResult[] = [];

    logger.info(
      { suiteId, taskCount: tasks.length },
      "Starting benchmark suite"
    );

    for (const task of tasks) {
      const result = await this.runTask(task);
      results.push(result);

      logger.info(
        {
          taskId: task.id,
          passed: result.passed,
          score: result.score.toFixed(2),
          duration: result.duration,
        },
        "Benchmark task completed"
      );
    }

    const passed = results.filter((r) => r.passed).length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    const totalScore = results.reduce((sum, r) => sum + r.score, 0);
    const totalCredits = results.reduce((sum, r) => sum + r.creditsConsumed, 0);

    const suiteResult: BenchmarkSuiteResult = {
      suiteId,
      timestamp: new Date().toISOString(),
      totalTasks: tasks.length,
      passRate: tasks.length > 0 ? (passed / tasks.length) * 100 : 0,
      averageDuration: tasks.length > 0 ? totalDuration / tasks.length : 0,
      averageScore: tasks.length > 0 ? totalScore / tasks.length : 0,
      totalCredits,
      results,
    };

    logger.info(
      {
        suiteId,
        passRate: suiteResult.passRate.toFixed(1),
        averageScore: suiteResult.averageScore.toFixed(2),
        totalDuration,
        totalCredits,
      },
      "Benchmark suite completed"
    );

    return suiteResult;
  }

  private async runTask(task: BenchmarkTask): Promise<BenchmarkResult> {
    const startTime = Date.now();

    try {
      const result = await this.agentLoop.executeTask(
        task.description,
        "backend_coder"
      );

      const duration = Date.now() - startTime;

      // Basic scoring
      let score = result.success ? 0.5 : 0;

      // Bonus for expected files
      if (task.expectedFiles && task.expectedFiles.length > 0) {
        const matchedFiles = task.expectedFiles.filter((ef) =>
          result.filesChanged.some((fc) => fc.includes(ef))
        );
        score += 0.3 * (matchedFiles.length / task.expectedFiles.length);
      } else if (result.filesChanged.length > 0) {
        score += 0.3;
      }

      // Bonus for no errors
      if (!result.error) {
        score += 0.2;
      }

      return {
        taskId: task.id,
        passed: result.success && score >= 0.5,
        score: Math.min(1, score),
        duration,
        filesChanged: result.filesChanged,
        creditsConsumed: result.creditsConsumed,
        errors: result.error ? [result.error] : [],
      };
    } catch (error) {
      return {
        taskId: task.id,
        passed: false,
        score: 0,
        duration: Date.now() - startTime,
        filesChanged: [],
        creditsConsumed: 0,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }
}
