import { MODEL_REGISTRY } from "@prometheus/ai";
import { createLogger } from "@prometheus/logger";
import type { ModelRouterService, RouteRequest, RouteResponse } from "./router";

const logger = createLogger("model-router:cascade");

const HEDGING_PATTERNS =
  /\b(I'm not sure|I don't know|I cannot|unclear|might be|possibly)\b/i;
const REFUSAL_PATTERNS =
  /\b(I can't help|I'm unable|beyond my capabilities)\b/i;
const PLACEHOLDER_PATTERN = /\b(TODO|FIXME|placeholder|not implemented)\b/i;
const ABRUPT_ENDING_PATTERN = /[.!?`)\]}]$/;
const CONTRADICTION_PATTERN =
  /\b(however|but actually|wait|correction|I was wrong)\b/i;

interface CascadeConfig {
  confidenceThreshold: number;
  maxEscalations: number;
}

const DEFAULT_CASCADE_CONFIG: CascadeConfig = {
  confidenceThreshold: 0.3,
  maxEscalations: 2,
};

const SLOT_ESCALATION_CHAIN: Record<string, string[]> = {
  default: ["default", "review", "premium"],
  fastLoop: ["fastLoop", "default", "review"],
  background: ["background", "default"],
  think: ["think", "premium"],
  review: ["review", "premium"],
};

interface CascadeMetrics {
  costSavedUsd: number;
  escalations: number;
  requestsHandledCheap: number;
  totalRequests: number;
}

export class CascadeRouter {
  private readonly inner: ModelRouterService;
  private readonly config: CascadeConfig;
  private readonly metrics: CascadeMetrics = {
    totalRequests: 0,
    requestsHandledCheap: 0,
    escalations: 0,
    costSavedUsd: 0,
  };

  constructor(inner: ModelRouterService, config?: Partial<CascadeConfig>) {
    this.inner = inner;
    this.config = { ...DEFAULT_CASCADE_CONFIG, ...config };
  }

  async route(request: RouteRequest): Promise<RouteResponse> {
    this.metrics.totalRequests++;

    const escalationChain = SLOT_ESCALATION_CHAIN[request.slot] ?? [
      request.slot,
    ];

    for (let i = 0; i < escalationChain.length; i++) {
      const slot = escalationChain[i] as string;
      const escalatedRequest: RouteRequest = { ...request, slot };

      try {
        const response = await this.inner.route(escalatedRequest);

        const quality = this.assessResponseQuality(response);

        if (
          quality >= this.config.confidenceThreshold ||
          i === escalationChain.length - 1
        ) {
          if (i === 0) {
            this.metrics.requestsHandledCheap++;
            const premiumCost = this.estimatePremiumCost(request);
            this.metrics.costSavedUsd += premiumCost - response.usage.cost_usd;
          } else {
            this.metrics.escalations++;
          }

          logger.info(
            {
              originalSlot: request.slot,
              usedSlot: slot,
              escalationLevel: i,
              quality: quality.toFixed(3),
              costUsd: response.usage.cost_usd.toFixed(6),
            },
            "Cascade route completed"
          );

          return {
            ...response,
            routing: {
              ...response.routing,
              wasFallback:
                response.routing.wasFallback || slot !== request.slot,
            },
          };
        }

        logger.info(
          {
            slot,
            quality: quality.toFixed(3),
            threshold: this.config.confidenceThreshold,
            nextSlot: escalationChain[i + 1],
          },
          "Quality below threshold, escalating"
        );
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(
          { slot, error: msg },
          "Cascade slot failed, trying next level"
        );
      }
    }

    return this.inner.route(request);
  }

  /**
   * Multi-signal quality assessment of LLM responses.
   * Evaluates: structural completeness, content quality, hedging/refusal
   * detection, format compliance, and consistency checks.
   */
  private assessResponseQuality(response: RouteResponse): number {
    const content = response.choices[0]?.message?.content ?? "";
    const toolCalls = response.choices[0]?.message?.tool_calls;
    const finishReason = response.choices[0]?.finish_reason;

    // Signal 1: Structural completeness (0.25 weight)
    let structuralScore = 0;
    if (content.length > 50) {
      structuralScore += 0.3;
    }
    if (content.length > 200) {
      structuralScore += 0.3;
    }
    if (finishReason === "stop") {
      structuralScore += 0.2;
    }
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      structuralScore += 0.2;
    }

    // Signal 2: Content quality — symbol density as proxy for code/technical content (0.20 weight)
    let qualityScore = 0.5;
    const codeBlockCount = (content.match(/```/g) ?? []).length / 2;
    if (codeBlockCount >= 1) {
      qualityScore += 0.2;
    }
    const hasStructuredOutput =
      content.includes("##") ||
      content.includes("- ") ||
      content.includes("1.");
    if (hasStructuredOutput) {
      qualityScore += 0.15;
    }
    // Penalize very short non-tool responses
    if (!toolCalls && content.length < 20) {
      qualityScore -= 0.3;
    }

    // Signal 3: Hedging/refusal detection (0.25 weight)
    let confidenceScore = 1.0;
    if (HEDGING_PATTERNS.test(content)) {
      confidenceScore -= 0.3;
    }
    if (REFUSAL_PATTERNS.test(content)) {
      confidenceScore -= 0.5;
    }
    // Detect placeholder/incomplete patterns
    if (PLACEHOLDER_PATTERN.test(content)) {
      confidenceScore -= 0.2;
    }

    // Signal 4: Completeness — check for truncation or contradictions (0.15 weight)
    let completenessScore = 1.0;
    if (finishReason === "length") {
      completenessScore -= 0.5;
    }
    // Detect abrupt endings (last sentence without punctuation)
    const lastLine = content.trim().split("\n").pop() ?? "";
    if (lastLine.length > 20 && !ABRUPT_ENDING_PATTERN.test(lastLine)) {
      completenessScore -= 0.2;
    }

    // Signal 5: Consistency — no internal contradictions (0.15 weight)
    let consistencyScore = 1.0;
    if (CONTRADICTION_PATTERN.test(content)) {
      consistencyScore -= 0.15;
    }

    // Weighted combination
    const finalScore =
      structuralScore * 0.25 +
      Math.min(1, Math.max(0, qualityScore)) * 0.2 +
      Math.max(0, confidenceScore) * 0.25 +
      Math.max(0, completenessScore) * 0.15 +
      Math.max(0, consistencyScore) * 0.15;

    return Math.max(0, Math.min(1, finalScore));
  }

  private estimatePremiumCost(request: RouteRequest): number {
    const premiumModel = MODEL_REGISTRY["anthropic/claude-opus-4-6"];
    if (!premiumModel) {
      return 0;
    }

    const estimatedInputTokens = request.messages.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4),
      0
    );
    const estimatedOutputTokens = 2000;

    return (
      estimatedInputTokens * premiumModel.costPerInputToken +
      estimatedOutputTokens * premiumModel.costPerOutputToken
    );
  }

  getMetrics(): CascadeMetrics & { savingsPercentage: number } {
    const savingsPercentage =
      this.metrics.totalRequests > 0
        ? (this.metrics.requestsHandledCheap / this.metrics.totalRequests) * 100
        : 0;
    return { ...this.metrics, savingsPercentage };
  }
}
