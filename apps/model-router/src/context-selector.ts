/**
 * MOON-053: Context-Aware Model Selection
 *
 * Automatically selects the optimal model based on task characteristics,
 * required capabilities, budget constraints, and latency targets.
 * Extends the existing ComplexityEstimator with capability-aware routing
 * and cost/latency estimation.
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:context-selector");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModelCapability =
  | "code"
  | "reasoning"
  | "vision"
  | "speed"
  | "long_context";

export interface ModelSelectionOptions {
  /** Budget constraint in USD (optional) */
  budget?: number;
  /** Code context to analyze for complexity */
  codeContext?: string;
  /** Target latency in milliseconds (optional) */
  latencyTarget?: number;
  /** Required model capabilities */
  requiredCapabilities: ModelCapability[];
  /** Task description */
  task: string;
}

export interface ModelAlternative {
  /** Model identifier */
  model: string;
  /** Reason this model was not selected */
  tradeoff: string;
}

export interface ModelSelectionResult {
  /** Other models that could work, with tradeoffs */
  alternatives: ModelAlternative[];
  /** Estimated cost in USD */
  estimatedCost: number;
  /** Estimated latency in milliseconds */
  estimatedLatency: number;
  /** Selected model identifier */
  model: string;
  /** Model provider (e.g., "anthropic", "openai") */
  provider: string;
  /** Human-readable explanation of the selection */
  reasoning: string;
}

// ---------------------------------------------------------------------------
// Model catalog
// ---------------------------------------------------------------------------

interface ModelProfile {
  capabilities: Set<ModelCapability>;
  costPer1kTokens: number;
  id: string;
  maxContextTokens: number;
  medianLatencyMs: number;
  provider: string;
  qualityScore: number;
}

const MODEL_CATALOG: ModelProfile[] = [
  {
    id: "anthropic/claude-sonnet-4-6",
    provider: "anthropic",
    capabilities: new Set(["code", "reasoning", "long_context"]),
    qualityScore: 0.92,
    costPer1kTokens: 0.003,
    medianLatencyMs: 2000,
    maxContextTokens: 200_000,
  },
  {
    id: "anthropic/claude-opus-4-6",
    provider: "anthropic",
    capabilities: new Set(["code", "reasoning", "vision", "long_context"]),
    qualityScore: 0.98,
    costPer1kTokens: 0.015,
    medianLatencyMs: 5000,
    maxContextTokens: 200_000,
  },
  {
    id: "anthropic/claude-haiku-3.5",
    provider: "anthropic",
    capabilities: new Set(["code", "speed"]),
    qualityScore: 0.78,
    costPer1kTokens: 0.000_25,
    medianLatencyMs: 500,
    maxContextTokens: 200_000,
  },
  {
    id: "openai/gpt-4.1",
    provider: "openai",
    capabilities: new Set(["code", "reasoning", "vision", "long_context"]),
    qualityScore: 0.93,
    costPer1kTokens: 0.005,
    medianLatencyMs: 3000,
    maxContextTokens: 1_048_576,
  },
  {
    id: "openai/gpt-4.1-mini",
    provider: "openai",
    capabilities: new Set(["code", "speed"]),
    qualityScore: 0.82,
    costPer1kTokens: 0.0004,
    medianLatencyMs: 800,
    maxContextTokens: 1_048_576,
  },
  {
    id: "openai/o3",
    provider: "openai",
    capabilities: new Set(["reasoning", "code"]),
    qualityScore: 0.96,
    costPer1kTokens: 0.01,
    medianLatencyMs: 8000,
    maxContextTokens: 200_000,
  },
  {
    id: "google/gemini-2.5-pro",
    provider: "google",
    capabilities: new Set([
      "code",
      "reasoning",
      "vision",
      "long_context",
      "speed",
    ]),
    qualityScore: 0.91,
    costPer1kTokens: 0.001_25,
    medianLatencyMs: 1500,
    maxContextTokens: 1_048_576,
  },
  {
    id: "cerebras/qwen3-235b",
    provider: "cerebras",
    capabilities: new Set(["code", "speed"]),
    qualityScore: 0.75,
    costPer1kTokens: 0.0002,
    medianLatencyMs: 300,
    maxContextTokens: 8192,
  },
];

// ---------------------------------------------------------------------------
// Complexity estimation helpers
// ---------------------------------------------------------------------------

const COMPLEX_PATTERNS = [
  /\b(refactor|migrate|architect|optimize|debug)\b/i,
  /\b(distributed|concurrent|async|parallel)\b/i,
  /\b(security|authentication|authorization|encryption)\b/i,
  /\b(database|schema|migration|transaction)\b/i,
];

function estimateTaskComplexity(task: string, codeContext?: string): number {
  let complexity = 0.3; // Base

  // Check for complex task patterns
  for (const pattern of COMPLEX_PATTERNS) {
    if (pattern.test(task)) {
      complexity += 0.1;
    }
  }

  // Code context size indicates complexity
  if (codeContext) {
    const estimatedTokens = Math.ceil(codeContext.length / 4);
    complexity += Math.min(estimatedTokens / 10_000, 0.3);
  }

  // Task length is a signal
  const taskTokens = Math.ceil(task.length / 4);
  complexity += Math.min(taskTokens / 2000, 0.2);

  return Math.min(1, complexity);
}

function estimateRequiredTokens(task: string, codeContext?: string): number {
  const taskTokens = Math.ceil(task.length / 4);
  const contextTokens = codeContext ? Math.ceil(codeContext.length / 4) : 0;
  // Estimate output tokens as roughly proportional to input
  return taskTokens + contextTokens + 2000;
}

// ---------------------------------------------------------------------------
// ContextAwareModelSelector
// ---------------------------------------------------------------------------

export class ContextAwareModelSelector {
  /**
   * Automatically picks the best model based on task characteristics,
   * required capabilities, budget, and latency constraints.
   */
  select(options: ModelSelectionOptions): ModelSelectionResult {
    const { task, codeContext, requiredCapabilities, budget, latencyTarget } =
      options;

    logger.info(
      {
        task: task.slice(0, 100),
        capabilities: requiredCapabilities,
        budget,
        latencyTarget,
      },
      "Selecting model"
    );

    const complexity = estimateTaskComplexity(task, codeContext);
    const estimatedTokens = estimateRequiredTokens(task, codeContext);

    // Filter models by required capabilities
    const capableModels = MODEL_CATALOG.filter((model) =>
      requiredCapabilities.every((cap) => model.capabilities.has(cap))
    );

    if (capableModels.length === 0) {
      // Fallback to the model with the most matching capabilities
      const fallback = this.findBestFallback(requiredCapabilities);
      return {
        model: fallback.id,
        provider: fallback.provider,
        reasoning: `No model matches all capabilities [${requiredCapabilities.join(", ")}]. Using best available: ${fallback.id}`,
        estimatedCost: this.estimateCost(fallback, estimatedTokens),
        estimatedLatency: fallback.medianLatencyMs,
        alternatives: [],
      };
    }

    // Score each model
    const scored = capableModels.map((model) => ({
      model,
      score: this.scoreModel(
        model,
        complexity,
        estimatedTokens,
        budget,
        latencyTarget
      ),
      cost: this.estimateCost(model, estimatedTokens),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];
    if (!best) {
      const fallback = MODEL_CATALOG[0] as ModelProfile;
      return {
        model: fallback.id,
        provider: fallback.provider,
        reasoning: "Fallback: no models scored",
        estimatedCost: 0,
        estimatedLatency: fallback.medianLatencyMs,
        alternatives: [],
      };
    }
    const alternatives: ModelAlternative[] = scored.slice(1, 4).map((s) => ({
      model: s.model.id,
      tradeoff: this.describeTradeoff(s.model, best.model),
    }));

    const reasoning = this.buildReasoning(
      best.model,
      complexity,
      requiredCapabilities,
      budget,
      latencyTarget
    );

    logger.info(
      {
        selected: best.model.id,
        score: best.score.toFixed(3),
        complexity: complexity.toFixed(2),
        estimatedCost: best.cost.toFixed(6),
      },
      "Model selected"
    );

    return {
      model: best.model.id,
      provider: best.model.provider,
      reasoning,
      estimatedCost: best.cost,
      estimatedLatency: best.model.medianLatencyMs,
      alternatives,
    };
  }

  private scoreModel(
    model: ModelProfile,
    complexity: number,
    estimatedTokens: number,
    budget?: number,
    latencyTarget?: number
  ): number {
    let score = 0;

    // Quality score weighted by complexity (higher complexity = quality matters more)
    score += model.qualityScore * (0.3 + complexity * 0.3);

    // Speed score (inverse latency, normalized)
    const maxLatency = 10_000;
    const speedScore = 1 - Math.min(model.medianLatencyMs / maxLatency, 1);
    score += speedScore * (1 - complexity) * 0.2;

    // Cost efficiency
    const cost = this.estimateCost(model, estimatedTokens);
    const maxReasonableCost = 0.1;
    const costScore = 1 - Math.min(cost / maxReasonableCost, 1);
    score += costScore * 0.15;

    // Context window check
    if (estimatedTokens > model.maxContextTokens) {
      score -= 0.5; // Heavy penalty for context overflow
    }

    // Budget constraint
    if (budget !== undefined && cost > budget) {
      score -= 0.4;
    }

    // Latency constraint
    if (latencyTarget !== undefined && model.medianLatencyMs > latencyTarget) {
      const overshoot = model.medianLatencyMs / latencyTarget;
      score -= Math.min(overshoot * 0.1, 0.3);
    }

    return score;
  }

  private estimateCost(model: ModelProfile, tokens: number): number {
    return (tokens / 1000) * model.costPer1kTokens;
  }

  private findBestFallback(
    requiredCapabilities: ModelCapability[]
  ): ModelProfile {
    let bestMatch: ModelProfile | undefined;
    let bestOverlap = -1;

    for (const model of MODEL_CATALOG) {
      const overlap = requiredCapabilities.filter((cap) =>
        model.capabilities.has(cap)
      ).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestMatch = model;
      }
    }

    return bestMatch ?? (MODEL_CATALOG[0] as ModelProfile);
  }

  private describeTradeoff(
    model: ModelProfile,
    selected: ModelProfile
  ): string {
    const parts: string[] = [];

    if (model.qualityScore > selected.qualityScore) {
      parts.push("higher quality");
    } else if (model.qualityScore < selected.qualityScore) {
      parts.push("lower quality");
    }

    if (model.medianLatencyMs < selected.medianLatencyMs) {
      parts.push("faster");
    } else if (model.medianLatencyMs > selected.medianLatencyMs) {
      parts.push("slower");
    }

    if (model.costPer1kTokens < selected.costPer1kTokens) {
      parts.push("cheaper");
    } else if (model.costPer1kTokens > selected.costPer1kTokens) {
      parts.push("more expensive");
    }

    return parts.length > 0 ? parts.join(", ") : "similar performance";
  }

  private buildReasoning(
    model: ModelProfile,
    complexity: number,
    capabilities: ModelCapability[],
    budget?: number,
    latencyTarget?: number
  ): string {
    const parts: string[] = [];

    parts.push(
      `Selected ${model.id} (quality: ${model.qualityScore}, latency: ${model.medianLatencyMs}ms).`
    );

    if (complexity > 0.7) {
      parts.push("High task complexity favors quality over speed.");
    } else if (complexity < 0.3) {
      parts.push("Low task complexity allows faster, cheaper models.");
    }

    parts.push(`Required capabilities: [${capabilities.join(", ")}].`);

    if (budget !== undefined) {
      parts.push(`Budget constraint: $${budget.toFixed(4)}.`);
    }

    if (latencyTarget !== undefined) {
      parts.push(`Latency target: ${latencyTarget}ms.`);
    }

    return parts.join(" ");
  }
}
