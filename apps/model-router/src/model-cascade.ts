import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:model-cascade");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CascadeResult {
  content: string;
  costUsd: number;
  escalated: boolean;
  model: string;
  quality: number;
  savingsUsd: number;
  tier: CascadeTier;
}

export type CascadeTier = "cheap" | "standard" | "premium";

export interface CascadeConfig {
  /** Quality threshold (0-1) below which to escalate (default: 0.5) */
  qualityThreshold: number;
  /** Tier chain: tries from first to last */
  tiers: CascadeTierConfig[];
}

export interface CascadeTierConfig {
  costPerToken: number;
  model: string;
  name: CascadeTier;
}

type CompletionFn = (
  model: string,
  messages: CascadeMessage[]
) => Promise<{
  content: string;
  inputTokens: number;
  outputTokens: number;
}>;

export interface CascadeMessage {
  content: string;
  role: "system" | "user" | "assistant";
}

// ─── Quality Assessment ───────────────────────────────────────────────────────

const HEDGING_PATTERN =
  /\b(I'm not sure|I don't know|I cannot|unclear|might be)\b/i;
const REFUSAL_PATTERN = /\b(I can't help|I'm unable|beyond my capabilities)\b/i;

function assessQuality(content: string): number {
  if (!content || content.length === 0) {
    return 0;
  }

  let score = 0.5;

  // Length bonus
  if (content.length > 100) {
    score += 0.1;
  }
  if (content.length > 500) {
    score += 0.1;
  }

  // Code blocks are a good sign
  const codeBlocks = (content.match(/```/g) ?? []).length / 2;
  if (codeBlocks >= 1) {
    score += 0.15;
  }

  // Structured content
  if (
    content.includes("##") ||
    content.includes("- ") ||
    content.includes("1.")
  ) {
    score += 0.1;
  }

  // Penalties
  if (HEDGING_PATTERN.test(content)) {
    score -= 0.2;
  }
  if (REFUSAL_PATTERN.test(content)) {
    score -= 0.3;
  }

  return Math.max(0, Math.min(1, score));
}

// ─── Cascade Metrics ──────────────────────────────────────────────────────────

interface CascadeMetrics {
  escalations: number;
  handledCheap: number;
  totalRequests: number;
  totalSavingsUsd: number;
}

// ─── Model Cascade ────────────────────────────────────────────────────────────

const DEFAULT_TIERS: CascadeTierConfig[] = [
  {
    name: "cheap",
    model: "ollama/qwen2.5-coder:14b",
    costPerToken: 0.000_000_1,
  },
  {
    name: "standard",
    model: "ollama/qwen3-coder-next",
    costPerToken: 0.000_001,
  },
  {
    name: "premium",
    model: "anthropic/claude-sonnet-4-6",
    costPerToken: 0.000_01,
  },
];

/**
 * Model cascade: starts with the cheapest model, evaluates response quality,
 * and escalates to more expensive models only if quality is insufficient.
 *
 * Tracks cumulative cost savings from using cheaper models.
 */
export class ModelCascade {
  private readonly config: CascadeConfig;
  private readonly completionFn: CompletionFn;
  private readonly metrics: CascadeMetrics = {
    totalRequests: 0,
    handledCheap: 0,
    escalations: 0,
    totalSavingsUsd: 0,
  };

  constructor(completionFn: CompletionFn, config?: Partial<CascadeConfig>) {
    this.completionFn = completionFn;
    this.config = {
      qualityThreshold: config?.qualityThreshold ?? 0.5,
      tiers: config?.tiers ?? DEFAULT_TIERS,
    };
  }

  /**
   * Execute a cascade: start cheap, evaluate quality, escalate if needed.
   */
  async execute(
    messages: CascadeMessage[],
    qualityThreshold?: number
  ): Promise<CascadeResult> {
    this.metrics.totalRequests++;
    const threshold = qualityThreshold ?? this.config.qualityThreshold;
    const tiers = this.config.tiers;

    let lastResult: CascadeResult | null = null;

    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      if (!tier) {
        continue;
      }

      try {
        const response = await this.completionFn(tier.model, messages);
        const quality = assessQuality(response.content);
        const totalTokens = response.inputTokens + response.outputTokens;
        const costUsd = totalTokens * tier.costPerToken;

        lastResult = {
          content: response.content,
          model: tier.model,
          tier: tier.name,
          quality,
          costUsd,
          escalated: i > 0,
          savingsUsd: 0,
        };

        if (quality >= threshold || i === tiers.length - 1) {
          // Calculate savings vs premium
          const premiumTier = tiers.at(-1);
          if (premiumTier && tier.name !== "premium") {
            const premiumCost = totalTokens * premiumTier.costPerToken;
            lastResult.savingsUsd = premiumCost - costUsd;
            this.metrics.totalSavingsUsd += lastResult.savingsUsd;
          }

          if (i === 0) {
            this.metrics.handledCheap++;
          } else {
            this.metrics.escalations++;
          }

          logger.info(
            {
              model: tier.model,
              tier: tier.name,
              quality: quality.toFixed(3),
              costUsd: costUsd.toFixed(6),
              escalated: i > 0,
            },
            "Cascade completed"
          );

          return lastResult;
        }

        logger.info(
          {
            tier: tier.name,
            quality: quality.toFixed(3),
            threshold,
            nextTier: tiers[i + 1]?.name,
          },
          "Quality below threshold, escalating"
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { tier: tier.name, model: tier.model, error: msg },
          "Cascade tier failed, trying next"
        );
      }
    }

    // Should not reach here, but return last result or throw
    if (lastResult) {
      return lastResult;
    }
    throw new Error("All cascade tiers failed");
  }

  /**
   * Get cascade performance metrics.
   */
  getMetrics(): CascadeMetrics & { cheapRate: number } {
    const cheapRate =
      this.metrics.totalRequests > 0
        ? (this.metrics.handledCheap / this.metrics.totalRequests) * 100
        : 0;
    return { ...this.metrics, cheapRate };
  }
}
