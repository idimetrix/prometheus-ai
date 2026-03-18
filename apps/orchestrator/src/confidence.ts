/**
 * Phase 9.4: Agent Confidence Scoring.
 *
 * After each iteration in the agent loop, estimates confidence (0-1) based on:
 *  - Tool success rate
 *  - Output quality signals
 *  - Error count
 *
 * Confidence thresholds drive execution decisions:
 *  - >0.7: continue normally
 *  - 0.3-0.7: request help / add more context
 *  - <0.3: escalate to human / upgrade model tier
 *
 * Confidence also affects model tier selection:
 *  - Low confidence -> upgrade to think/premium slot
 *  - High confidence -> stay on default/fastLoop slot
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:confidence");

export interface IterationSignals {
  /** Whether the LLM mentioned uncertainty keywords. */
  expressedUncertainty: boolean;
  /** Number of files changed in this iteration. */
  filesChanged: number;
  /** Whether the LLM produced any text output. */
  hasOutput: boolean;
  /** Whether the agent produced structured output (JSON, code blocks). */
  hasStructuredOutput: boolean;
  /** Length of the LLM output in characters. */
  outputLength: number;
  /** Whether the LLM requested human input. */
  requestedHelp: boolean;
  /** Consecutive iterations without progress. */
  staleIterations: number;
  /** Total tool calls in this iteration. */
  toolCallCount: number;
  /** Number of tool calls that returned errors. */
  toolErrorCount: number;
  /** Number of tool calls that succeeded. */
  toolSuccessCount: number;
}

export type ConfidenceAction = "continue" | "request_help" | "escalate";

export interface ConfidenceResult {
  /** Recommended action based on confidence thresholds. */
  action: ConfidenceAction;
  /** Reasoning for the score. */
  factors: ConfidenceFactor[];
  /** Recommended model slot override (if confidence is low). */
  recommendedSlot: string | null;
  /** Overall confidence score (0-1). */
  score: number;
}

interface ConfidenceFactor {
  contribution: number;
  name: string;
  value: number;
  weight: number;
}

/** Thresholds for confidence-based decisions. */
const CONFIDENCE_THRESHOLDS = {
  continue: 0.7,
  requestHelp: 0.3,
} as const;

/** Keywords that indicate the LLM is uncertain. */
const UNCERTAINTY_KEYWORDS = [
  "i'm not sure",
  "i am not sure",
  "i'm uncertain",
  "unclear",
  "might not work",
  "i don't know",
  "i cannot determine",
  "need more information",
  "need clarification",
  "ambiguous",
  "not enough context",
  "best guess",
];

/**
 * ConfidenceScorer evaluates how confident the agent is in its current
 * execution trajectory. Used by the AgentLoop to make adaptive decisions.
 */
export class ConfidenceScorer {
  private iterationHistory: IterationSignals[] = [];
  private runningScore = 0.5; // Start neutral

  /**
   * Score a single iteration and return the updated confidence result.
   */
  scoreIteration(signals: IterationSignals): ConfidenceResult {
    this.iterationHistory.push(signals);

    const factors: ConfidenceFactor[] = [];

    // Factor 1: Tool success rate (weight: 0.30)
    const toolSuccessRate =
      signals.toolCallCount > 0
        ? signals.toolSuccessCount / signals.toolCallCount
        : 1.0; // No tools used is neutral
    factors.push({
      name: "tool_success_rate",
      value: toolSuccessRate,
      weight: 0.3,
      contribution: toolSuccessRate * 0.3,
    });

    // Factor 2: Output quality (weight: 0.20)
    let outputQuality = 0.5;
    if (signals.hasOutput) {
      // Longer, structured output = higher quality signal
      const lengthScore = Math.min(signals.outputLength / 500, 1.0);
      const structureBonus = signals.hasStructuredOutput ? 0.2 : 0;
      outputQuality = Math.min(lengthScore + structureBonus, 1.0);
    } else {
      outputQuality = 0.2; // No output is a bad sign
    }
    factors.push({
      name: "output_quality",
      value: outputQuality,
      weight: 0.2,
      contribution: outputQuality * 0.2,
    });

    // Factor 3: Error penalty (weight: 0.20)
    const errorPenalty =
      signals.toolErrorCount > 0
        ? Math.max(0, 1.0 - signals.toolErrorCount * 0.25)
        : 1.0;
    factors.push({
      name: "error_penalty",
      value: errorPenalty,
      weight: 0.2,
      contribution: errorPenalty * 0.2,
    });

    // Factor 4: Progress indicator (weight: 0.15)
    let progressScore = 1.0;
    if (signals.staleIterations > 0) {
      progressScore = Math.max(0, 1.0 - signals.staleIterations * 0.2);
    }
    if (signals.filesChanged > 0) {
      progressScore = Math.min(progressScore + 0.1, 1.0);
    }
    factors.push({
      name: "progress",
      value: progressScore,
      weight: 0.15,
      contribution: progressScore * 0.15,
    });

    // Factor 5: Uncertainty signals (weight: 0.15)
    let certaintyScore = 1.0;
    if (signals.expressedUncertainty) {
      certaintyScore -= 0.4;
    }
    if (signals.requestedHelp) {
      certaintyScore -= 0.3;
    }
    certaintyScore = Math.max(0, certaintyScore);
    factors.push({
      name: "certainty",
      value: certaintyScore,
      weight: 0.15,
      contribution: certaintyScore * 0.15,
    });

    // Calculate weighted score
    const rawScore = factors.reduce((sum, f) => sum + f.contribution, 0);

    // Apply exponential moving average with history for smoothing
    const alpha = 0.6; // Weight of current iteration vs history
    this.runningScore = alpha * rawScore + (1 - alpha) * this.runningScore;

    // Clamp to [0, 1]
    const score = Math.max(0, Math.min(1, this.runningScore));

    // Determine action
    let action: ConfidenceAction;
    if (score >= CONFIDENCE_THRESHOLDS.continue) {
      action = "continue";
    } else if (score >= CONFIDENCE_THRESHOLDS.requestHelp) {
      action = "request_help";
    } else {
      action = "escalate";
    }

    // Determine model slot override
    let recommendedSlot: string | null = null;
    if (score < 0.5) {
      recommendedSlot = "think"; // Upgrade to reasoning model
    } else if (score < 0.3) {
      recommendedSlot = "premium"; // Upgrade to most capable model
    }

    const result: ConfidenceResult = {
      score,
      action,
      factors,
      recommendedSlot,
    };

    logger.debug(
      {
        score: score.toFixed(3),
        action,
        toolSuccess: toolSuccessRate.toFixed(2),
        outputQuality: outputQuality.toFixed(2),
        errorPenalty: errorPenalty.toFixed(2),
        progress: progressScore.toFixed(2),
        certainty: certaintyScore.toFixed(2),
        iteration: this.iterationHistory.length,
      },
      "Confidence scored"
    );

    return result;
  }

  /**
   * Extract iteration signals from LLM output and tool results.
   */
  static extractSignals(
    output: string,
    toolResults: Array<{ success: boolean; name: string }>,
    filesChanged: number,
    previousIterationCount: number,
    _lastOutputLength: number
  ): IterationSignals {
    const toolCallCount = toolResults.length;
    const toolSuccessCount = toolResults.filter((r) => r.success).length;
    const toolErrorCount = toolResults.filter((r) => !r.success).length;

    const outputLower = output.toLowerCase();
    const expressedUncertainty = UNCERTAINTY_KEYWORDS.some((kw) =>
      outputLower.includes(kw)
    );
    const requestedHelp =
      (outputLower.includes("human") && outputLower.includes("input")) ||
      outputLower.includes("need help") ||
      outputLower.includes("please clarify");

    // Detect structured output (JSON, code blocks, markdown headers)
    const hasStructuredOutput =
      /```[\s\S]+```/.test(output) ||
      /^\s*\{[\s\S]*\}\s*$/m.test(output) ||
      /^#{1,3}\s/m.test(output);

    // Detect stale iterations (no meaningful progress)
    const isStale =
      toolCallCount === 0 && output.length < 100 && filesChanged === 0;

    return {
      toolCallCount,
      toolSuccessCount,
      toolErrorCount,
      hasOutput: output.length > 0,
      outputLength: output.length,
      filesChanged,
      hasStructuredOutput,
      staleIterations: isStale ? previousIterationCount + 1 : 0,
      expressedUncertainty,
      requestedHelp,
    };
  }

  /**
   * Get the recommended model slot based on the current confidence score
   * and the default slot for the agent role.
   */
  static getModelSlot(
    defaultSlot: string,
    confidence: ConfidenceResult
  ): string {
    if (confidence.recommendedSlot) {
      logger.info(
        {
          defaultSlot,
          overrideSlot: confidence.recommendedSlot,
          confidence: confidence.score.toFixed(3),
        },
        "Upgrading model slot due to low confidence"
      );
      return confidence.recommendedSlot;
    }
    return defaultSlot;
  }

  /**
   * Reset the scorer state (e.g., for a new task).
   */
  reset(): void {
    this.iterationHistory = [];
    this.runningScore = 0.5;
  }

  /**
   * Get summary statistics for the current task execution.
   */
  getSummary(): {
    iterations: number;
    averageConfidence: number;
    minConfidence: number;
    maxConfidence: number;
    escalationCount: number;
  } {
    if (this.iterationHistory.length === 0) {
      return {
        iterations: 0,
        averageConfidence: 0,
        minConfidence: 0,
        maxConfidence: 0,
        escalationCount: 0,
      };
    }

    // Recompute scores from history
    const scorer = new ConfidenceScorer();
    let total = 0;
    let min = 1;
    let max = 0;
    let escalations = 0;

    for (const signals of this.iterationHistory) {
      const result = scorer.scoreIteration(signals);
      total += result.score;
      if (result.score < min) {
        min = result.score;
      }
      if (result.score > max) {
        max = result.score;
      }
      if (result.action === "escalate") {
        escalations++;
      }
    }

    return {
      iterations: this.iterationHistory.length,
      averageConfidence: total / this.iterationHistory.length,
      minConfidence: min,
      maxConfidence: max,
      escalationCount: escalations,
    };
  }
}
