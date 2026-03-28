/**
 * GAP-062: Self-Improving Agents
 *
 * Runs evaluation benchmarks periodically, extracts successful patterns
 * from high-scoring runs, evolves system prompts, and tracks improvement
 * trajectory over time.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:self-improver");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
  benchmarkName: string;
  id: string;
  maxScore: number;
  patterns: string[];
  promptVersion: number;
  score: number;
  timestamp: number;
}

export interface PromptEvolution {
  avgScore: number;
  createdAt: number;
  sampleCount: number;
  systemPrompt: string;
  version: number;
}

export interface ImprovementTrajectory {
  bestScore: number;
  bestVersion: number;
  currentVersion: number;
  versions: Array<{ version: number; avgScore: number; timestamp: number }>;
}

type EvalFn = (
  prompt: string,
  testCase: string
) => Promise<{ score: number; patterns: string[] }>;

// ─── Self-Improver ───────────────────────────────────────────────────────────

export class SelfImprover {
  private readonly evalFn: EvalFn;
  private readonly results: BenchmarkResult[] = [];
  private readonly prompts: PromptEvolution[] = [];
  private currentVersion = 0;

  constructor(evalFn: EvalFn, initialPrompt: string) {
    this.evalFn = evalFn;
    this.prompts.push({
      version: 0,
      systemPrompt: initialPrompt,
      avgScore: 0,
      sampleCount: 0,
      createdAt: Date.now(),
    });
  }

  /**
   * Run a benchmark evaluation with the current prompt.
   */
  async runBenchmark(
    benchmarkName: string,
    testCases: string[]
  ): Promise<BenchmarkResult> {
    const currentPrompt = this.getCurrentPrompt();
    let totalScore = 0;
    const allPatterns: string[] = [];

    for (const testCase of testCases) {
      const result = await this.evalFn(currentPrompt.systemPrompt, testCase);
      totalScore += result.score;
      allPatterns.push(...result.patterns);
    }

    const avgScore = testCases.length > 0 ? totalScore / testCases.length : 0;

    const benchmarkResult: BenchmarkResult = {
      id: `bench_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      benchmarkName,
      score: avgScore,
      maxScore: 1.0,
      patterns: [...new Set(allPatterns)],
      promptVersion: this.currentVersion,
      timestamp: Date.now(),
    };

    this.results.push(benchmarkResult);

    // Update prompt stats
    currentPrompt.sampleCount++;
    currentPrompt.avgScore =
      (currentPrompt.avgScore * (currentPrompt.sampleCount - 1) + avgScore) /
      currentPrompt.sampleCount;

    logger.info(
      {
        benchmarkName,
        score: avgScore.toFixed(3),
        version: this.currentVersion,
        patternCount: benchmarkResult.patterns.length,
      },
      "Benchmark completed"
    );

    return benchmarkResult;
  }

  /**
   * Evolve the system prompt based on successful patterns from recent benchmarks.
   */
  evolvePrompt(): PromptEvolution {
    const currentPrompt = this.getCurrentPrompt();

    // Extract patterns from high-scoring recent results
    const recentResults = this.results
      .filter((r) => r.promptVersion === this.currentVersion)
      .sort((a, b) => b.score - a.score);

    const topPatterns = recentResults
      .filter((r) => r.score >= 0.8)
      .flatMap((r) => r.patterns);
    const uniquePatterns = [...new Set(topPatterns)].slice(0, 10);

    if (uniquePatterns.length === 0) {
      logger.info("No high-scoring patterns found, keeping current prompt");
      return currentPrompt;
    }

    // Evolve the prompt by appending learned patterns
    const patternSection = uniquePatterns.map((p) => `- ${p}`).join("\n");

    const evolvedPrompt = `${currentPrompt.systemPrompt}\n\n## Learned Best Practices\n${patternSection}`;

    this.currentVersion++;
    const newEvolution: PromptEvolution = {
      version: this.currentVersion,
      systemPrompt: evolvedPrompt,
      avgScore: 0,
      sampleCount: 0,
      createdAt: Date.now(),
    };

    this.prompts.push(newEvolution);

    logger.info(
      {
        newVersion: this.currentVersion,
        patternsApplied: uniquePatterns.length,
      },
      "System prompt evolved"
    );

    return newEvolution;
  }

  /**
   * Get the improvement trajectory over all prompt versions.
   */
  getTrajectory(): ImprovementTrajectory {
    const versions = this.prompts.map((p) => ({
      version: p.version,
      avgScore: p.avgScore,
      timestamp: p.createdAt,
    }));

    let bestVersion = 0;
    let bestScore = 0;
    for (const p of this.prompts) {
      if (p.avgScore > bestScore) {
        bestScore = p.avgScore;
        bestVersion = p.version;
      }
    }

    return {
      versions,
      currentVersion: this.currentVersion,
      bestVersion,
      bestScore,
    };
  }

  /**
   * Get the current system prompt.
   */
  getCurrentPrompt(): PromptEvolution {
    return this.prompts[this.currentVersion] as PromptEvolution;
  }
}
