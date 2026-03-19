/**
 * ApproachSpeculator — Runs top 2-3 MCTS strategies in parallel using the
 * "fastLoop" model slot, evaluates via quality gate, and commits the winner.
 *
 * This enables speculative multi-approach execution where the system explores
 * multiple solution strategies concurrently and selects the best one.
 */
import { createLogger } from "@prometheus/logger";
import type { ExecutionContext } from "../execution-context";
import type { ExecutionEvent } from "../execution-events";
import { QualityGate } from "../quality-gate";

const logger = createLogger("orchestrator:approach-speculator");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A strategy from MCTS tree search with a score and description. */
export interface MCTSStrategy {
  /** Brief description of the approach */
  description: string;
  /** Expected files to be modified */
  expectedFiles?: string[];
  /** Unique identifier */
  id: string;
  /** MCTS score (higher = more promising) */
  score: number;
  /** The system prompt or instruction variant for this approach */
  systemPrompt: string;
}

/** Result from evaluating a single approach. */
export interface ApproachResult {
  /** Error message if the approach failed */
  error?: string;
  /** Files changed during execution */
  filesChanged: string[];
  /** Final output from the approach */
  output: string;
  /** Quality gate score (0-1) */
  qualityScore: number;
  /** Why this approach was selected or rejected */
  reasoning: string;
  /** The strategy that was executed */
  strategy: MCTSStrategy;
  /** Whether the approach completed successfully */
  success: boolean;
  /** Tokens consumed */
  tokensUsed: { input: number; output: number };
}

/** Final result of the speculation process. */
export interface SpeculationResult {
  /** All approaches that were evaluated */
  allApproaches: ApproachResult[];
  /** The winning approach (highest quality that succeeded) */
  winner: ApproachResult | null;
  /** Reasoning for why the winner was chosen */
  winnerReasoning: string;
}

// ---------------------------------------------------------------------------
// ApproachSpeculator
// ---------------------------------------------------------------------------

/** Maximum number of approaches to run in parallel. */
const MAX_PARALLEL_APPROACHES = 3;

/**
 * Minimum quality gate score to consider an approach viable.
 * Approaches below this threshold are rejected even if they "succeed".
 */
const MIN_QUALITY_THRESHOLD = 0.6;

export class ApproachSpeculator {
  private readonly qualityGate: QualityGate;

  constructor() {
    this.qualityGate = new QualityGate();
  }

  /**
   * Run top strategies in parallel and select the best one.
   *
   * Process:
   * 1. Select top N strategies by MCTS score
   * 2. Launch each in parallel using the "fastLoop" slot for speed
   * 3. Evaluate each result through the quality gate
   * 4. Select the winner based on quality score
   *
   * @param approaches - MCTS strategies to evaluate, sorted by score descending
   * @param ctx - The execution context for the current task
   * @param executeFn - Function that runs a single approach and returns events.
   *   If not provided, speculation returns a stub result indicating the
   *   integration point for the execution engine.
   */
  async speculate(
    approaches: MCTSStrategy[],
    ctx: ExecutionContext,
    executeFn?: (
      strategy: MCTSStrategy,
      ctx: ExecutionContext
    ) => AsyncGenerator<ExecutionEvent, void, undefined>
  ): Promise<SpeculationResult> {
    // Select top N approaches
    const selectedApproaches = approaches
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_PARALLEL_APPROACHES);

    logger.info(
      {
        totalStrategies: approaches.length,
        selected: selectedApproaches.length,
        strategies: selectedApproaches.map((s) => ({
          id: s.id,
          score: s.score,
          description: s.description,
        })),
      },
      "Starting speculative multi-approach execution"
    );

    if (!executeFn) {
      // Stub mode: return a placeholder result indicating where the execution
      // engine should be wired in. This allows the speculation infrastructure
      // to be tested before full integration.
      return this.createStubResult(selectedApproaches, ctx);
    }

    // Run approaches in parallel
    const approachPromises = selectedApproaches.map((strategy) =>
      this.executeApproach(strategy, ctx, executeFn)
    );

    const allApproaches = await Promise.all(approachPromises);

    // Select winner: highest quality score among successful approaches
    const viableApproaches = allApproaches
      .filter((a) => a.success && a.qualityScore >= MIN_QUALITY_THRESHOLD)
      .sort((a, b) => b.qualityScore - a.qualityScore);

    const winner =
      viableApproaches.length > 0
        ? (viableApproaches[0] as ApproachResult)
        : null;

    const winnerReasoning = winner
      ? `Selected approach "${winner.strategy.id}" (${winner.strategy.description}) ` +
        `with quality score ${winner.qualityScore.toFixed(3)}. ` +
        `${viableApproaches.length} viable approach(es) out of ${allApproaches.length} attempted.`
      : `No viable approach found. ${allApproaches.length} approach(es) attempted, ` +
        `none met the minimum quality threshold of ${MIN_QUALITY_THRESHOLD}.`;

    logger.info(
      {
        winnerId: winner?.strategy.id ?? null,
        winnerScore: winner?.qualityScore ?? 0,
        viableCount: viableApproaches.length,
        totalAttempted: allApproaches.length,
      },
      winner
        ? "Speculation winner selected"
        : "Speculation found no viable approach"
    );

    return {
      winner,
      allApproaches,
      winnerReasoning,
    };
  }

  /**
   * Execute a single approach and evaluate it through the quality gate.
   */
  private async executeApproach(
    strategy: MCTSStrategy,
    ctx: ExecutionContext,
    executeFn: (
      strategy: MCTSStrategy,
      ctx: ExecutionContext
    ) => AsyncGenerator<ExecutionEvent, void, undefined>
  ): Promise<ApproachResult> {
    const startTime = Date.now();
    let output = "";
    const filesChanged: string[] = [];
    let tokensUsed = { input: 0, output: 0 };
    let success = false;

    try {
      const eventStream = executeFn(strategy, ctx);

      for await (const event of eventStream) {
        switch (event.type) {
          case "token":
            output += event.content;
            break;
          case "file_change":
            filesChanged.push(event.filePath);
            break;
          case "complete":
            success = event.success;
            tokensUsed = event.tokensUsed;
            if (event.output) {
              output = event.output;
            }
            break;
          case "error":
            if (!event.recoverable) {
              success = false;
            }
            break;
          default:
            break;
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { strategyId: strategy.id, error: msg },
        "Approach execution failed"
      );

      return {
        strategy,
        success: false,
        output: "",
        filesChanged: [],
        qualityScore: 0,
        tokensUsed,
        reasoning: `Execution failed: ${msg}`,
        error: msg,
      };
    }

    // Evaluate quality
    const qualityScore = await this.evaluateQuality(
      strategy,
      output,
      filesChanged,
      ctx
    );
    const elapsed = Date.now() - startTime;

    logger.debug(
      {
        strategyId: strategy.id,
        success,
        qualityScore,
        filesChanged: filesChanged.length,
        elapsedMs: elapsed,
      },
      "Approach evaluation complete"
    );

    return {
      strategy,
      success,
      output,
      filesChanged,
      qualityScore,
      tokensUsed,
      reasoning: success
        ? `Completed with quality ${qualityScore.toFixed(3)} in ${elapsed}ms`
        : "Failed during execution",
    };
  }

  /**
   * Evaluate the quality of an approach's output using the quality gate.
   * Returns a score between 0 and 1.
   */
  private async evaluateQuality(
    strategy: MCTSStrategy,
    output: string,
    filesChanged: string[],
    ctx: ExecutionContext
  ): Promise<number> {
    try {
      // Use the quality gate for each changed file
      let totalScore = 0;
      let fileCount = 0;

      for (const filePath of filesChanged) {
        const result = await this.qualityGate.evaluate({
          filePath,
          content: output,
          taskDescription: `${ctx.taskDescription}\n\nApproach: ${strategy.description}`,
          blueprintContext: ctx.blueprintContent ?? undefined,
        });

        // Map verdict to numeric score
        let verdictScore: number;
        if (result.verdict === "pass") {
          verdictScore = 1.0;
        } else if (result.verdict === "revise") {
          verdictScore = 0.5;
        } else {
          verdictScore = 0.2;
        }
        totalScore += verdictScore;
        fileCount++;
      }

      // If no files were changed, score based on output length and completeness
      if (fileCount === 0) {
        return output.length > 100 ? 0.7 : 0.3;
      }

      return totalScore / fileCount;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { strategyId: strategy.id, error: msg },
        "Quality evaluation failed, using default score"
      );
      return 0.5;
    }
  }

  /**
   * Create a stub result for when no execution function is provided.
   * Used for testing the speculation infrastructure.
   */
  private createStubResult(
    strategies: MCTSStrategy[],
    _ctx: ExecutionContext
  ): SpeculationResult {
    const stubApproaches: ApproachResult[] = strategies.map((strategy) => ({
      strategy,
      success: false,
      output: "",
      filesChanged: [],
      qualityScore: 0,
      tokensUsed: { input: 0, output: 0 },
      reasoning:
        "Stub mode: no execution function provided. Wire in ExecutionEngine.execute() " +
        "with a modified context that uses the fastLoop slot and the strategy's system prompt.",
    }));

    return {
      winner: null,
      allApproaches: stubApproaches,
      winnerReasoning:
        "Stub mode: speculation infrastructure is ready but no execution function was provided. " +
        "To enable full speculation, pass an executeFn that runs the ExecutionEngine with the " +
        "strategy's system prompt injected into the task description.",
    };
  }
}
