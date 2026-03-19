import { MODEL_REGISTRY } from "@prometheus/ai";
import { createLogger } from "@prometheus/logger";
import type { ModelRouterService, RouteRequest, RouteResponse } from "./router";

const logger = createLogger("model-router:cascade");

const HEDGING_PATTERNS =
  /\b(I'm not sure|I don't know|I cannot|unclear|might be|possibly)\b/i;
const REFUSAL_PATTERNS =
  /\b(I can't help|I'm unable|beyond my capabilities)\b/i;

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

  private assessResponseQuality(response: RouteResponse): number {
    let score = 0.5;

    const content = response.choices[0]?.message?.content ?? "";

    if (content.length > 100) {
      score += 0.15;
    }
    if (content.length > 500) {
      score += 0.1;
    }

    if (response.choices[0]?.finish_reason === "stop") {
      score += 0.1;
    }

    const toolCalls = response.choices[0]?.message?.tool_calls;
    if (toolCalls && Array.isArray(toolCalls) && toolCalls.length > 0) {
      score += 0.15;
    }

    if (HEDGING_PATTERNS.test(content)) {
      score -= 0.2;
    }

    if (REFUSAL_PATTERNS.test(content)) {
      score -= 0.3;
    }

    return Math.max(0, Math.min(1, score));
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
