import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:cost-estimator");

/** Complexity levels for cost estimation */
export type TaskComplexity = "trivial" | "low" | "medium" | "high" | "extreme";

/** Cost estimate for a single phase */
export interface PhaseEstimate {
  estimatedCredits: number;
  estimatedTokens: number;
  phase: string;
}

/** Complete cost estimate for a task */
export interface CostEstimate {
  /** Per-phase breakdown */
  breakdown: PhaseEstimate[];
  /** Confidence in this estimate (0-1) */
  confidence: number;
  /** Total estimated credits to consume */
  estimatedCredits: number;
  /** Total estimated tokens (input + output) */
  estimatedTokens: number;
}

/** Base token estimates per phase at medium complexity */
const BASE_PHASE_TOKENS: Record<string, number> = {
  discovery: 3000,
  architecture: 5000,
  planning: 4000,
  coding: 15_000,
  testing: 8000,
  ci: 2000,
  security: 3000,
  review: 4000,
  deploy: 1000,
};

/** Complexity multipliers */
const COMPLEXITY_MULTIPLIERS: Record<TaskComplexity, number> = {
  trivial: 0.3,
  low: 0.6,
  medium: 1.0,
  high: 1.8,
  extreme: 3.0,
};

/** Credits per 1000 tokens (approximate) */
const CREDITS_PER_1K_TOKENS = 0.5;

/** Confidence scores by complexity */
const COMPLEXITY_CONFIDENCE: Record<TaskComplexity, number> = {
  trivial: 0.9,
  low: 0.85,
  medium: 0.75,
  high: 0.6,
  extreme: 0.4,
};

/**
 * Estimate the cost of executing a task based on its complexity
 * and historical data patterns.
 *
 * Uses base token estimates per phase scaled by complexity multipliers.
 * Confidence decreases for higher-complexity tasks due to uncertainty.
 */
export function estimateCost(
  taskDescription: string,
  complexity: TaskComplexity
): CostEstimate {
  const multiplier = COMPLEXITY_MULTIPLIERS[complexity];
  const confidence = COMPLEXITY_CONFIDENCE[complexity];

  // Adjust for description length (longer descriptions tend to need more tokens)
  const descLengthFactor = Math.min(taskDescription.length / 500, 1.5);
  const adjustedMultiplier = multiplier * (0.8 + descLengthFactor * 0.2);

  const breakdown: PhaseEstimate[] = [];
  let totalTokens = 0;
  let totalCredits = 0;

  for (const [phase, baseTokens] of Object.entries(BASE_PHASE_TOKENS)) {
    const estimatedTokens = Math.round(baseTokens * adjustedMultiplier);
    const estimatedCredits =
      Math.round((estimatedTokens / 1000) * CREDITS_PER_1K_TOKENS * 100) / 100;

    breakdown.push({
      phase,
      estimatedTokens,
      estimatedCredits,
    });

    totalTokens += estimatedTokens;
    totalCredits += estimatedCredits;
  }

  const estimate: CostEstimate = {
    estimatedTokens: totalTokens,
    estimatedCredits: Math.round(totalCredits * 100) / 100,
    confidence,
    breakdown,
  };

  logger.info(
    {
      complexity,
      totalTokens: estimate.estimatedTokens,
      totalCredits: estimate.estimatedCredits,
      confidence: estimate.confidence,
    },
    "Cost estimate generated"
  );

  return estimate;
}

/**
 * Infer task complexity from the description text.
 * Uses heuristics based on keywords, length, and scope indicators.
 */
const WORD_SPLIT_RE = /\s+/;

export function inferComplexity(taskDescription: string): TaskComplexity {
  const lower = taskDescription.toLowerCase();
  const wordCount = taskDescription.split(WORD_SPLIT_RE).length;

  // Extreme: large-scale changes
  if (
    lower.includes("rewrite") ||
    lower.includes("migrate") ||
    lower.includes("redesign") ||
    wordCount > 200
  ) {
    return "extreme";
  }

  // High: multi-file or architectural changes
  if (
    lower.includes("refactor") ||
    lower.includes("multiple files") ||
    lower.includes("architecture") ||
    lower.includes("system") ||
    wordCount > 100
  ) {
    return "high";
  }

  // Low: small, focused changes
  if (
    lower.includes("typo") ||
    lower.includes("rename") ||
    lower.includes("update text") ||
    wordCount < 20
  ) {
    return "low";
  }

  // Trivial: one-liner fixes
  if (
    lower.includes("fix import") ||
    lower.includes("add comma") ||
    lower.includes("remove unused") ||
    wordCount < 10
  ) {
    return "trivial";
  }

  // Default: medium
  return "medium";
}
