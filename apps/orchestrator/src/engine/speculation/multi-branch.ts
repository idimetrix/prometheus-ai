/**
 * MultiBranchSpeculator — When prediction confidence is in the 0.4-0.7 range,
 * speculatively execute the top-2 predicted tools in parallel.
 * The losing branch is discarded when the actual tool call is resolved.
 */
import { TOOL_REGISTRY } from "@prometheus/agent-sdk";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import type { PredictionSignal } from "./stream-analyzer";

const logger = createLogger("orchestrator:speculation:multi-branch");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpeculationBranch {
  /** Predicted arguments */
  args: Record<string, unknown>;
  /** Prediction confidence (0-1) */
  confidence: number;
  /** Unique branch identifier */
  id: string;
  /** Execution result (null if still pending) */
  result: BranchResult | null;
  /** Status of this branch */
  status: "pending" | "executing" | "resolved" | "discarded";
  /** Predicted tool name */
  toolName: string;
}

export interface BranchResult {
  output: string;
  success: boolean;
}

/** Confidence range for multi-branch speculation. */
const MULTI_BRANCH_MIN_CONFIDENCE = 0.4;
const MULTI_BRANCH_MAX_CONFIDENCE = 0.7;

/** Maximum concurrent speculation branches. */
const MAX_BRANCHES = 2;

/** Tools safe for speculative execution (read-only, no side effects). */
const SAFE_TOOLS = new Set([
  "file_read",
  "file_list",
  "search_files",
  "search_content",
  "search_semantic",
  "git_status",
  "git_diff",
  "read_blueprint",
  "read_brain",
]);

// ---------------------------------------------------------------------------
// MultiBranchSpeculator
// ---------------------------------------------------------------------------

export class MultiBranchSpeculator {
  private readonly toolContext: {
    sessionId: string;
    projectId: string;
    sandboxId: string;
    workDir: string;
    orgId: string;
    userId: string;
  };

  private readonly activeBranches = new Map<string, SpeculationBranch>();
  private speculationCount = 0;
  private commitCount = 0;
  private discardCount = 0;

  constructor(toolContext: {
    sessionId: string;
    projectId: string;
    sandboxId: string;
    workDir: string;
    orgId: string;
    userId: string;
  }) {
    this.toolContext = toolContext;
  }

  /**
   * Given multiple predictions sorted by confidence, speculatively
   * execute the top-2 if they fall in the multi-branch confidence range.
   */
  speculate(predictions: PredictionSignal[]): SpeculationBranch[] {
    // Filter to predictions in the multi-branch confidence range
    const candidates = predictions.filter(
      (p) =>
        p.confidence >= MULTI_BRANCH_MIN_CONFIDENCE &&
        p.confidence <= MULTI_BRANCH_MAX_CONFIDENCE &&
        SAFE_TOOLS.has(p.predictedTool)
    );

    if (candidates.length === 0) {
      return [];
    }

    // Take top-N candidates
    const topCandidates = candidates
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, MAX_BRANCHES);

    const branches: SpeculationBranch[] = [];

    for (const candidate of topCandidates) {
      const branchId = generateId("branch");
      const branch: SpeculationBranch = {
        id: branchId,
        toolName: candidate.predictedTool,
        args: candidate.predictedArgs,
        confidence: candidate.confidence,
        status: "pending",
        result: null,
      };

      this.activeBranches.set(branchId, branch);
      branches.push(branch);

      this.speculationCount++;

      // Fire-and-forget execution
      this.executeBranch(branch).catch((error) => {
        logger.debug(
          { branchId, error: String(error) },
          "Branch execution failed silently"
        );
      });
    }

    logger.debug(
      {
        branchCount: branches.length,
        tools: branches.map((b) => b.toolName),
        confidences: branches.map((b) => b.confidence.toFixed(2)),
      },
      "Multi-branch speculation started"
    );

    return branches;
  }

  /**
   * Commit the winning branch (the one matching the actual tool call).
   * Discard all other active branches.
   */
  commit(toolName: string, args: Record<string, unknown>): BranchResult | null {
    let winningResult: BranchResult | null = null;

    for (const [branchId, branch] of this.activeBranches) {
      if (
        branch.toolName === toolName &&
        this.argsMatch(branch.args, args) &&
        branch.result
      ) {
        // This is the winning branch
        branch.status = "resolved";
        winningResult = branch.result;
        this.commitCount++;

        logger.debug(
          { branchId, toolName, confidence: branch.confidence },
          "Branch committed (speculation hit)"
        );
      } else {
        // Discard losing branch
        branch.status = "discarded";
        this.discardCount++;
      }

      this.activeBranches.delete(branchId);
    }

    return winningResult;
  }

  /**
   * Discard all active speculation branches.
   */
  discardAll(): void {
    for (const [branchId, branch] of this.activeBranches) {
      branch.status = "discarded";
      this.discardCount++;
      this.activeBranches.delete(branchId);
    }
  }

  /**
   * Get speculation statistics.
   */
  getStats(): {
    active: number;
    commitCount: number;
    discardCount: number;
    hitRate: string;
    speculationCount: number;
  } {
    const total = this.commitCount + this.discardCount;
    const hitRate =
      total > 0 ? `${((this.commitCount / total) * 100).toFixed(1)}%` : "0%";

    return {
      speculationCount: this.speculationCount,
      commitCount: this.commitCount,
      discardCount: this.discardCount,
      hitRate,
      active: this.activeBranches.size,
    };
  }

  /**
   * Reset all state.
   */
  reset(): void {
    this.activeBranches.clear();
    this.speculationCount = 0;
    this.commitCount = 0;
    this.discardCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async executeBranch(branch: SpeculationBranch): Promise<void> {
    branch.status = "executing";

    const toolDef = TOOL_REGISTRY[branch.toolName];
    if (!toolDef) {
      branch.status = "discarded";
      return;
    }

    try {
      const result = await toolDef.execute(branch.args, this.toolContext);
      branch.result = {
        success: result.success,
        output: result.output,
      };
      // Status remains "executing" until committed or discarded
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.debug(
        { branchId: branch.id, toolName: branch.toolName, error: msg },
        "Speculative branch execution failed"
      );
      branch.result = { success: false, output: msg };
    }
  }

  private argsMatch(
    predicted: Record<string, unknown>,
    actual: Record<string, unknown>
  ): boolean {
    // Simple shallow comparison of key args
    const keys = Object.keys(actual);
    for (const key of keys) {
      if (
        key in predicted &&
        JSON.stringify(predicted[key]) !== JSON.stringify(actual[key])
      ) {
        return false;
      }
    }
    return true;
  }
}
