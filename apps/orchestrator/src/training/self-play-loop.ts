/**
 * GAP-045: Self-Play Training Loop
 *
 * Generates synthetic coding tasks from existing codebase, runs agent
 * on tasks, scores results, and extracts successful patterns for
 * prompt improvement. Tracks improvement over iterations.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:training:self-play");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SyntheticTask {
  context: string;
  description: string;
  difficulty: "easy" | "medium" | "hard";
  expectedOutput?: string;
  id: string;
  sourceFile: string;
  taskType: string;
}

export interface SelfPlayResult {
  agentOutput: string;
  durationMs: number;
  iteration: number;
  qualityScore: number;
  success: boolean;
  taskId: string;
  timestamp: number;
}

export interface ExtractedPattern {
  confidence: number;
  description: string;
  fromIteration: number;
  id: string;
  promptAddition: string;
  taskType: string;
}

export interface IterationSummary {
  avgDuration: number;
  avgQuality: number;
  extractedPatterns: number;
  iteration: number;
  successRate: number;
  tasksRun: number;
}

// ---------------------------------------------------------------------------
// SelfPlayLoop
// ---------------------------------------------------------------------------

export class SelfPlayLoop {
  private readonly results: SelfPlayResult[] = [];
  private readonly patterns: ExtractedPattern[] = [];
  private readonly iterationSummaries: IterationSummary[] = [];
  private currentIteration = 0;

  /**
   * Generate synthetic tasks from a codebase summary.
   * In production, this would use an LLM to create realistic tasks.
   */
  generateTasks(
    sourceFiles: Array<{ path: string; content: string }>,
    count: number
  ): SyntheticTask[] {
    const tasks: SyntheticTask[] = [];
    const taskTypes = [
      "refactor",
      "bug-fix",
      "add-feature",
      "write-test",
      "add-docs",
    ];
    const difficulties: Array<"easy" | "medium" | "hard"> = [
      "easy",
      "medium",
      "hard",
    ];

    for (let i = 0; i < count; i++) {
      const file = sourceFiles[i % sourceFiles.length];
      if (!file) {
        continue;
      }

      const taskType = taskTypes[i % taskTypes.length] ?? "refactor";
      const difficulty = difficulties[i % difficulties.length] ?? "easy";

      tasks.push({
        id: `spt_${Date.now()}_${i}`,
        sourceFile: file.path,
        taskType,
        difficulty,
        description: `${taskType} task for ${file.path}`,
        context: file.content.slice(0, 500),
      });
    }

    logger.info(
      { count: tasks.length, iteration: this.currentIteration },
      "Synthetic tasks generated"
    );

    return tasks;
  }

  /**
   * Record the result of running an agent on a synthetic task.
   */
  recordResult(result: SelfPlayResult): void {
    this.results.push(result);
    if (this.results.length > 10_000) {
      this.results.splice(0, this.results.length - 10_000);
    }
  }

  /**
   * Extract successful patterns from the current iteration's results.
   */
  extractPatterns(iteration: number): ExtractedPattern[] {
    const iterResults = this.results.filter((r) => r.iteration === iteration);
    const successfulResults = iterResults.filter(
      (r) => r.success && r.qualityScore >= 0.8
    );

    if (successfulResults.length === 0) {
      return [];
    }

    // Group successful results by task type
    const byType = new Map<string, SelfPlayResult[]>();
    for (const result of successfulResults) {
      const task = result.taskId;
      // Extract task type from task ID pattern
      const existing = byType.get(task) ?? [];
      existing.push(result);
      byType.set(task, existing);
    }

    const extracted: ExtractedPattern[] = [];
    const successRate =
      iterResults.length > 0
        ? successfulResults.length / iterResults.length
        : 0;

    if (successRate >= 0.6) {
      const pattern: ExtractedPattern = {
        id: `pat_${Date.now()}_${iteration}`,
        taskType: "general",
        description: `Iteration ${iteration}: ${successRate.toFixed(1)} success rate patterns`,
        promptAddition: `Focus on the approach that achieved ${(successRate * 100).toFixed(0)}% success rate in self-play iteration ${iteration}.`,
        confidence: successRate,
        fromIteration: iteration,
      };
      extracted.push(pattern);
      this.patterns.push(pattern);
    }

    logger.info(
      {
        iteration,
        totalResults: iterResults.length,
        successful: successfulResults.length,
        patternsExtracted: extracted.length,
      },
      "Patterns extracted from iteration"
    );

    return extracted;
  }

  /**
   * Complete an iteration and generate summary.
   */
  completeIteration(): IterationSummary {
    const iteration = this.currentIteration;
    const iterResults = this.results.filter((r) => r.iteration === iteration);

    const patternsExtracted = this.extractPatterns(iteration);

    const summary: IterationSummary = {
      iteration,
      tasksRun: iterResults.length,
      successRate:
        iterResults.length > 0
          ? iterResults.filter((r) => r.success).length / iterResults.length
          : 0,
      avgQuality:
        iterResults.length > 0
          ? iterResults.reduce((s, r) => s + r.qualityScore, 0) /
            iterResults.length
          : 0,
      avgDuration:
        iterResults.length > 0
          ? iterResults.reduce((s, r) => s + r.durationMs, 0) /
            iterResults.length
          : 0,
      extractedPatterns: patternsExtracted.length,
    };

    this.iterationSummaries.push(summary);
    this.currentIteration++;

    logger.info(
      {
        iteration: summary.iteration,
        tasksRun: summary.tasksRun,
        successRate: summary.successRate.toFixed(3),
        avgQuality: summary.avgQuality.toFixed(3),
      },
      "Self-play iteration completed"
    );

    return summary;
  }

  /**
   * Get improvement trend across iterations.
   */
  getImprovementTrend(): {
    iterations: IterationSummary[];
    overallImprovement: number;
    totalPatterns: number;
  } {
    const summaries = [...this.iterationSummaries];
    const first = summaries[0];
    const last = summaries.at(-1);
    const overallImprovement =
      first && last ? last.avgQuality - first.avgQuality : 0;

    return {
      iterations: summaries,
      overallImprovement,
      totalPatterns: this.patterns.length,
    };
  }

  /**
   * Get all extracted patterns for prompt injection.
   */
  getPatterns(): ExtractedPattern[] {
    return [...this.patterns].sort((a, b) => b.confidence - a.confidence);
  }

  getCurrentIteration(): number {
    return this.currentIteration;
  }
}
