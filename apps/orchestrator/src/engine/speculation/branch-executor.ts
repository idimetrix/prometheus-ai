/**
 * Phase 3.4: Speculative Multi-Branch Execution.
 *
 * Runs 2-3 different strategy approaches in parallel for a given task,
 * scores each branch independently, and selects the best result.
 */
import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:speculation:branch-executor");

const JSON_OBJECT_RE = /\{[\s\S]*\}/;
const CODE_FENCE_RE = /```/;

export interface BranchStrategy {
  /** Unique name for this strategy */
  name: string;
  /** Prompt prefix that sets the strategy context */
  promptPrefix: string;
}

export interface BranchExecutionResult {
  /** Unique branch identifier */
  branchId: string;
  /** Duration in milliseconds */
  duration: number;
  /** Error message if execution failed */
  error?: string;
  /** The generated output */
  output: string;
  /** Quality score (0-1) */
  qualityScore: number;
  /** The strategy used */
  strategy: string;
  /** Whether execution succeeded */
  success: boolean;
}

export interface MultiBranchResult {
  /** All branch results for analysis */
  allBranches: BranchExecutionResult[];
  /** The winning branch result */
  best: BranchExecutionResult;
  /** Why this branch was selected */
  selectionReason: string;
  /** Total execution time */
  totalDuration: number;
}

export class BranchExecutor {
  private readonly modelRouterUrl: string;

  constructor(modelRouterUrl?: string) {
    this.modelRouterUrl =
      modelRouterUrl ?? process.env.MODEL_ROUTER_URL ?? "http://localhost:4004";
  }

  /**
   * Execute a task using multiple strategy approaches in parallel.
   * Each branch gets a different strategy prompt prefix.
   */
  async executeBranches(
    task: string,
    strategies: string[]
  ): Promise<MultiBranchResult> {
    const startTime = Date.now();

    logger.info(
      { task: task.slice(0, 100), strategyCount: strategies.length },
      "Starting multi-branch execution"
    );

    // Execute all branches in parallel
    const branchPromises = strategies.map((strategy) =>
      this.executeSingleBranch(task, strategy)
    );

    const branches = await Promise.all(branchPromises);

    const totalDuration = Date.now() - startTime;

    return this.selectBest(branches, totalDuration);
  }

  /**
   * Select the best branch based on quality scoring.
   */
  selectBest(
    branches: BranchExecutionResult[],
    totalDuration?: number
  ): MultiBranchResult {
    // Filter to successful branches
    const successful = branches.filter((b) => b.success);

    if (successful.length === 0) {
      // All branches failed - return the one with the least severe error
      const fallback = branches[0] ?? {
        branchId: generateId("branch"),
        strategy: "none",
        output: "",
        qualityScore: 0,
        success: false,
        duration: 0,
        error: "All branches failed",
      };

      return {
        best: fallback,
        allBranches: branches,
        selectionReason: "All branches failed, returning first as fallback",
        totalDuration: totalDuration ?? 0,
      };
    }

    // Sort by quality score descending
    const ranked = [...successful].sort(
      (a, b) => b.qualityScore - a.qualityScore
    );

    const best = ranked[0] as BranchExecutionResult;

    const selectionReason =
      ranked.length === 1
        ? `Only successful branch: ${best.strategy} (score: ${best.qualityScore.toFixed(2)})`
        : `Selected "${best.strategy}" (score: ${best.qualityScore.toFixed(2)}) over ${ranked
            .slice(1)
            .map((b) => `"${b.strategy}" (${b.qualityScore.toFixed(2)})`)
            .join(", ")}`;

    logger.info(
      {
        selectedStrategy: best.strategy,
        qualityScore: best.qualityScore.toFixed(2),
        branchCount: branches.length,
        successfulCount: successful.length,
      },
      "Branch selection complete"
    );

    return {
      best,
      allBranches: branches,
      selectionReason,
      totalDuration: totalDuration ?? 0,
    };
  }

  private async executeSingleBranch(
    task: string,
    strategy: string
  ): Promise<BranchExecutionResult> {
    const branchId = generateId("branch");
    const startTime = Date.now();

    try {
      const res = await fetch(`${this.modelRouterUrl}/route`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          slot: "default",
          messages: [
            {
              role: "system",
              content: strategy,
            },
            {
              role: "user",
              content: task,
            },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });

      const duration = Date.now() - startTime;

      if (!res.ok) {
        return {
          branchId,
          strategy,
          output: "",
          qualityScore: 0,
          success: false,
          duration,
          error: `HTTP ${res.status}: ${res.statusText}`,
        };
      }

      const data = (await res.json()) as { content: string };
      const output = data.content ?? "";

      // Score the output quality
      const qualityScore = await this.scoreOutput(task, output);

      return {
        branchId,
        strategy,
        output,
        qualityScore,
        success: true,
        duration,
      };
    } catch (error) {
      return {
        branchId,
        strategy,
        output: "",
        qualityScore: 0,
        success: false,
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async scoreOutput(task: string, output: string): Promise<number> {
    if (!output) {
      return 0;
    }

    try {
      const res = await fetch(`${this.modelRouterUrl}/route`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getInternalAuthHeaders(),
        },
        body: JSON.stringify({
          slot: "review",
          messages: [
            {
              role: "system",
              content:
                'Score the quality of this solution from 0.0 to 1.0. Respond ONLY with JSON: { "score": 0.85 }',
            },
            {
              role: "user",
              content: `Task: ${task}\n\nSolution:\n${output}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(30_000),
      });

      if (res.ok) {
        const data = (await res.json()) as { content: string };
        const content = data.content ?? "";
        const jsonMatch = content.match(JSON_OBJECT_RE);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const score = Number(parsed.score);
          if (!Number.isNaN(score) && score >= 0 && score <= 1) {
            return score;
          }
        }
      }
    } catch {
      // Fall through to heuristic
    }

    // Heuristic fallback
    let score = 0.5;
    if (output.length > 200) {
      score += 0.1;
    }
    if (output.length > 500) {
      score += 0.1;
    }
    if (CODE_FENCE_RE.test(output)) {
      score += 0.1;
    }
    return Math.min(score, 1);
  }
}
