/**
 * Phase 5.1: Multi-Agent Benchmark Proof.
 *
 * Compares single-agent vs multi-agent (fleet) execution for the same task,
 * measuring wall-clock time, total tokens, quality, and parallelism efficiency.
 */
import type { AgentExecutionResult } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { AgentLoop } from "../agent-loop";
import { FleetManager } from "../fleet-manager";
import type { SchedulableTask } from "../parallel/scheduler";

const logger = createLogger("orchestrator:benchmarks:multi-agent");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkTask {
  agentRole: string;
  dependencies: string[];
  description: string;
  effort: "S" | "M" | "L" | "XL";
  id: string;
  title: string;
}

export interface SingleAgentResult {
  results: AgentExecutionResult[];
  totalCredits: number;
  totalTokens: { input: number; output: number };
  wallClockMs: number;
}

export interface MultiAgentResult {
  agentCount: number;
  parallelWaves: number;
  results: AgentExecutionResult[];
  totalCredits: number;
  totalTokens: { input: number; output: number };
  wallClockMs: number;
}

export interface BenchmarkComparison {
  multiAgent: MultiAgentResult;
  qualityDelta: number;
  singleAgent: SingleAgentResult;
  speedupFactor: number;
  summary: string;
  taskCount: number;
  tokenEfficiency: number;
}

// ---------------------------------------------------------------------------
// Multi-Agent Benchmark
// ---------------------------------------------------------------------------

export class MultiAgentBenchmark {
  private readonly sessionId: string;
  private readonly projectId: string;
  private readonly orgId: string;
  private readonly userId: string;

  constructor(params: {
    sessionId: string;
    projectId: string;
    orgId: string;
    userId: string;
  }) {
    this.sessionId = params.sessionId;
    this.projectId = params.projectId;
    this.orgId = params.orgId;
    this.userId = params.userId;
  }

  /**
   * Run a task in single-agent mode (sequential execution).
   */
  async runSingleAgent(
    tasks: BenchmarkTask[],
    blueprint: string
  ): Promise<SingleAgentResult> {
    const startTime = Date.now();
    const loop = new AgentLoop(
      this.sessionId,
      this.projectId,
      this.orgId,
      this.userId
    );

    const results: AgentExecutionResult[] = [];

    for (const task of tasks) {
      const enrichedDesc = `${task.title}\n\n${task.description}\n\nBlueprint:\n${blueprint}`;
      const result = await loop.executeTask(enrichedDesc, task.agentRole);
      results.push(result);
    }

    const wallClockMs = Date.now() - startTime;
    const totalTokens = results.reduce(
      (acc, r) => ({
        input: acc.input + r.tokensUsed.input,
        output: acc.output + r.tokensUsed.output,
      }),
      { input: 0, output: 0 }
    );
    const totalCredits = results.reduce((sum, r) => sum + r.creditsConsumed, 0);

    logger.info(
      {
        taskCount: tasks.length,
        wallClockMs,
        totalTokens,
        successCount: results.filter((r) => r.success).length,
      },
      "Single-agent benchmark complete"
    );

    return { results, wallClockMs, totalTokens, totalCredits };
  }

  /**
   * Run the same tasks in multi-agent (fleet) mode with parallelism.
   */
  async runMultiAgent(
    tasks: BenchmarkTask[],
    blueprint: string,
    planTier = "pro"
  ): Promise<MultiAgentResult> {
    const startTime = Date.now();

    const fleet = new FleetManager({
      sessionId: this.sessionId,
      projectId: this.projectId,
      orgId: this.orgId,
      userId: this.userId,
      planTier,
    });

    const schedulableTasks: SchedulableTask[] = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      agentRole: t.agentRole,
      dependencies: t.dependencies,
      effort: t.effort,
    }));

    const results = await fleet.executeTasks(schedulableTasks, blueprint);
    const wallClockMs = Date.now() - startTime;

    const totalTokens = results.reduce(
      (acc, r) => ({
        input: acc.input + r.tokensUsed.input,
        output: acc.output + r.tokensUsed.output,
      }),
      { input: 0, output: 0 }
    );
    const totalCredits = results.reduce((sum, r) => sum + r.creditsConsumed, 0);

    const status = fleet.getStatus();

    logger.info(
      {
        taskCount: tasks.length,
        wallClockMs,
        totalTokens,
        agentCount: status.totalAgents,
        successCount: results.filter((r) => r.success).length,
      },
      "Multi-agent benchmark complete"
    );

    return {
      results,
      wallClockMs,
      totalTokens,
      totalCredits,
      agentCount: status.totalAgents,
      parallelWaves: Math.ceil(tasks.length / (planTier === "pro" ? 5 : 1)),
    };
  }

  /**
   * Run both modes and produce a comparison report.
   */
  async compare(
    tasks: BenchmarkTask[],
    blueprint: string,
    planTier = "pro"
  ): Promise<BenchmarkComparison> {
    logger.info(
      { taskCount: tasks.length, planTier },
      "Starting multi-agent benchmark comparison"
    );

    const singleAgent = await this.runSingleAgent(tasks, blueprint);
    const multiAgent = await this.runMultiAgent(tasks, blueprint, planTier);

    const speedupFactor =
      multiAgent.wallClockMs > 0
        ? singleAgent.wallClockMs / multiAgent.wallClockMs
        : 1;

    const singleSuccessRate =
      singleAgent.results.length > 0
        ? singleAgent.results.filter((r) => r.success).length /
          singleAgent.results.length
        : 0;
    const multiSuccessRate =
      multiAgent.results.length > 0
        ? multiAgent.results.filter((r) => r.success).length /
          multiAgent.results.length
        : 0;
    const qualityDelta = multiSuccessRate - singleSuccessRate;

    const singleTotalTokens =
      singleAgent.totalTokens.input + singleAgent.totalTokens.output;
    const multiTotalTokens =
      multiAgent.totalTokens.input + multiAgent.totalTokens.output;
    const tokenEfficiency =
      multiTotalTokens > 0 ? singleTotalTokens / multiTotalTokens : 1;

    const summary = [
      `Benchmark: ${tasks.length} tasks`,
      `Single-agent: ${singleAgent.wallClockMs}ms, ${singleSuccessRate * 100}% success`,
      `Multi-agent (${planTier}): ${multiAgent.wallClockMs}ms, ${multiSuccessRate * 100}% success`,
      `Speedup: ${speedupFactor.toFixed(2)}x`,
      `Quality delta: ${qualityDelta >= 0 ? "+" : ""}${(qualityDelta * 100).toFixed(1)}%`,
      `Token efficiency: ${tokenEfficiency.toFixed(2)}x`,
    ].join("\n");

    logger.info(
      {
        speedupFactor: speedupFactor.toFixed(2),
        qualityDelta: qualityDelta.toFixed(3),
        tokenEfficiency: tokenEfficiency.toFixed(2),
      },
      "Benchmark comparison complete"
    );

    return {
      taskCount: tasks.length,
      singleAgent,
      multiAgent,
      speedupFactor,
      qualityDelta,
      tokenEfficiency,
      summary,
    };
  }

  /**
   * Create sample benchmark tasks for testing the comparison.
   */
  static createSampleTasks(count = 5): BenchmarkTask[] {
    const roles = [
      "backend_coder",
      "frontend_coder",
      "test_engineer",
      "integration_coder",
    ];
    const tasks: BenchmarkTask[] = [];

    for (let i = 0; i < count; i++) {
      tasks.push({
        id: `BENCH-${i + 1}`,
        title: `Benchmark task ${i + 1}`,
        description: `Implement feature ${i + 1} for benchmark comparison.`,
        agentRole: roles[i % roles.length] ?? "backend_coder",
        effort: i < 2 ? "S" : "M",
        dependencies: i > 0 && i % 3 === 0 ? [`BENCH-${i}`] : [],
      });
    }

    return tasks;
  }
}
