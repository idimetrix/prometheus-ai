/**
 * MOON-051: Multi-Approach Speculative Execution
 *
 * Runs multiple implementation approaches in parallel and selects the
 * best one based on configurable evaluation criteria. Unlike the
 * existing SpeculativeExecutor (which pre-executes predicted tool calls),
 * this executor explores different solution strategies simultaneously
 * and picks the winner after evaluation.
 */
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:speculation:multi-approach");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Approach {
  /** Human-readable name for this approach */
  name: string;
  /** Strategy description (e.g., "simple implementation", "design pattern") */
  strategy: string;
}

export interface ApproachResult {
  /** Which approach was used */
  approach: string;
  /** Why this approach was discarded (only on non-selected results) */
  discardReason?: string;
  /** Generated output */
  output: string;
  /** Quality score (0-1) */
  score: number;
}

export interface SpeculativeExecutionResult {
  /** Non-selected approaches and their results */
  alternatives: ApproachResult[];
  /** Human-readable summary of the evaluation */
  evaluationSummary: string;
  /** The winning approach */
  selected: ApproachResult;
}

export interface MultiApproachOptions {
  /** Different approaches to try */
  approaches: Approach[];
  /** Criteria to evaluate results against */
  evaluationCriteria: string[];
  /** Maximum parallel executions (default: approaches.length) */
  maxParallel?: number;
  /** The task to execute */
  task: string;
}

/** Injected handler that executes a task with a specific strategy */
export type StrategyExecutor = (
  task: string,
  strategy: string
) => Promise<{ output: string }>;

// ---------------------------------------------------------------------------
// Evaluation helpers
// ---------------------------------------------------------------------------

const CODE_BLOCK_RE = /```[\s\S]*?```/g;
const ERROR_RE = /\b(error|exception|fail|bug|broken|crash)\b/i;
const TEST_RE = /\b(test|spec|expect|assert|should|describe|it)\b/gi;
const PATTERN_RE =
  /\b(factory|singleton|observer|strategy|adapter|decorator|builder|repository|service)\b/gi;

function evaluateOutput(
  output: string,
  criteria: string[]
): { reasons: string[]; score: number } {
  if (!output || output.length === 0) {
    return { score: 0, reasons: ["Empty output"] };
  }

  let score = 0.3; // Base score for producing output
  const reasons: string[] = [];

  // Code quality: presence of code blocks
  const codeBlocks = (output.match(CODE_BLOCK_RE) ?? []).length;
  if (codeBlocks > 0) {
    score += Math.min(codeBlocks * 0.05, 0.15);
    reasons.push(`Contains ${codeBlocks} code block(s)`);
  }

  // Check for error indicators (negative signal)
  if (ERROR_RE.test(output)) {
    score -= 0.05;
    reasons.push("Contains error-related keywords");
  }

  // Check for test coverage mentions
  const testMentions = (output.match(TEST_RE) ?? []).length;
  if (testMentions > 0) {
    score += Math.min(testMentions * 0.02, 0.1);
    reasons.push(`References testing (${testMentions} mentions)`);
  }

  // Check for design patterns
  const patternMentions = (output.match(PATTERN_RE) ?? []).length;
  if (patternMentions > 0) {
    score += Math.min(patternMentions * 0.03, 0.1);
    reasons.push(`Uses design patterns (${patternMentions} mentions)`);
  }

  // Evaluate against provided criteria
  for (const criterion of criteria) {
    const criterionLower = criterion.toLowerCase();
    if (output.toLowerCase().includes(criterionLower)) {
      score += 0.05;
      reasons.push(`Meets criterion: "${criterion}"`);
    }
  }

  // Length signal (more detail is generally better, capped)
  const lengthScore = Math.min(output.length / 3000, 1.0) * 0.15;
  score += lengthScore;

  return { score: Math.min(1, Math.max(0, score)), reasons };
}

// ---------------------------------------------------------------------------
// MultiApproachExecutor
// ---------------------------------------------------------------------------

export class MultiApproachExecutor {
  private readonly executor: StrategyExecutor;

  constructor(executor: StrategyExecutor) {
    this.executor = executor;
  }

  /**
   * Runs multiple approaches in parallel and picks the best one
   * based on evaluation criteria.
   */
  async execute(
    options: MultiApproachOptions
  ): Promise<SpeculativeExecutionResult> {
    const { task, approaches, evaluationCriteria, maxParallel } = options;
    const parallelLimit = maxParallel ?? approaches.length;

    logger.info(
      {
        task: task.slice(0, 100),
        approachCount: approaches.length,
        parallelLimit,
        criteria: evaluationCriteria,
      },
      "Starting multi-approach speculative execution"
    );

    // Execute approaches with concurrency limit
    const results = await this.executeWithLimit(
      task,
      approaches,
      evaluationCriteria,
      parallelLimit
    );

    // Sort by score descending
    const sorted = [...results].sort((a, b) => b.score - a.score);

    if (sorted.length === 0 || !sorted[0]) {
      return {
        selected: {
          approach: "none",
          output: "",
          score: 0,
        },
        alternatives: [],
        evaluationSummary: "No approaches produced results",
      };
    }

    const selected = sorted[0];
    const alternatives = sorted.slice(1).map((result) => ({
      ...result,
      discardReason: this.getDiscardReason(result, selected),
    }));

    const evaluationSummary = this.buildSummary(
      selected,
      alternatives,
      evaluationCriteria
    );

    logger.info(
      {
        selectedApproach: selected.approach,
        selectedScore: selected.score.toFixed(3),
        alternativeCount: alternatives.length,
      },
      "Multi-approach execution complete"
    );

    return { selected, alternatives, evaluationSummary };
  }

  private async executeWithLimit(
    task: string,
    approaches: Approach[],
    criteria: string[],
    limit: number
  ): Promise<ApproachResult[]> {
    const results: ApproachResult[] = [];

    // Process in batches of `limit`
    for (let i = 0; i < approaches.length; i += limit) {
      const batch = approaches.slice(i, i + limit);
      const batchResults = await Promise.all(
        batch.map(async (approach) => {
          const executionId = generateId("spec-exec");
          try {
            logger.debug(
              { executionId, approach: approach.name },
              "Executing approach"
            );

            const { output } = await this.executor(
              `${task}\n\nApproach: ${approach.strategy}`,
              approach.strategy
            );

            const { score } = evaluateOutput(output, criteria);

            return {
              approach: approach.name,
              output,
              score,
            };
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.warn(
              { executionId, approach: approach.name, error: msg },
              "Approach execution failed"
            );
            return {
              approach: approach.name,
              output: "",
              score: 0,
              discardReason: `Execution failed: ${msg}`,
            };
          }
        })
      );

      for (const result of batchResults) {
        results.push(result);
      }
    }

    return results;
  }

  private getDiscardReason(
    result: ApproachResult,
    winner: ApproachResult
  ): string {
    if (result.output.length === 0) {
      return "Produced no output";
    }

    const scoreDiff = winner.score - result.score;
    if (scoreDiff > 0.3) {
      return `Significantly lower quality (score gap: ${scoreDiff.toFixed(2)})`;
    }
    if (scoreDiff > 0.1) {
      return `Lower quality than selected approach (score gap: ${scoreDiff.toFixed(2)})`;
    }
    return `Marginally lower score than winner (gap: ${scoreDiff.toFixed(2)})`;
  }

  private buildSummary(
    selected: ApproachResult,
    alternatives: ApproachResult[],
    criteria: string[]
  ): string {
    const parts: string[] = [];

    parts.push(
      `Selected approach "${selected.approach}" with score ${selected.score.toFixed(3)}.`
    );

    if (alternatives.length > 0) {
      const altSummary = alternatives
        .map((a) => `"${a.approach}" (${a.score.toFixed(3)})`)
        .join(", ");
      parts.push(`Alternatives evaluated: ${altSummary}.`);
    }

    if (criteria.length > 0) {
      parts.push(`Evaluation criteria: ${criteria.join(", ")}.`);
    }

    return parts.join(" ");
  }
}
