/**
 * Model Router Client with Circuit Breaker.
 *
 * Wraps model-router HTTP calls with a circuit breaker from @prometheus/utils.
 * On circuit open: returns cached response if available, or escalates to fallback model.
 */
import { getInternalAuthHeaders } from "@prometheus/auth";
import { createLogger } from "@prometheus/logger";
import { CircuitBreaker } from "@prometheus/utils";

const logger = createLogger("orchestrator:model-router-client");

export interface ModelRouterRequest {
  messages: Array<{ role: string; content: string }>;
  options?: {
    maxTokens?: number;
    stream?: boolean;
    temperature?: number;
    tools?: unknown[];
  };
  slot: string;
}

export interface ModelRouterResponse {
  choices: Array<{
    finish_reason: string;
    message: {
      content: string;
      role: string;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
  }>;
  costUsd: number;
  id: string;
  latencyMs: number;
  model: string;
  slot: string;
  usage: {
    completionTokens: number;
    promptTokens: number;
    totalTokens: number;
  };
}

/** Model escalation order for fallback */
const MODEL_SLOT_FALLBACK: Record<string, string> = {
  default: "think",
  think: "review",
  review: "premium",
  premium: "premium",
};

export class ModelRouterClient {
  private readonly baseUrl: string;
  private readonly breaker: CircuitBreaker;
  private readonly responseCache = new Map<string, ModelRouterResponse>();
  private readonly timeout: number;

  constructor(options?: {
    baseUrl?: string;
    failureThreshold?: number;
    resetTimeout?: number;
    timeout?: number;
  }) {
    this.baseUrl =
      options?.baseUrl ??
      process.env.MODEL_ROUTER_URL ??
      "http://localhost:4004";
    this.timeout = options?.timeout ?? 120_000;

    this.breaker = new CircuitBreaker({
      name: "model-router",
      failureThreshold: options?.failureThreshold ?? 3,
      recoveryWindowMs: options?.resetTimeout ?? 30_000,
      failureWindowMs: 60_000,
      successThreshold: 2,
      onStateChange: (from, to) => {
        logger.warn({ from, to }, "Model router circuit breaker state changed");
      },
    });
  }

  /**
   * Send a completion request to model-router, protected by circuit breaker.
   * On circuit open: returns cached response or escalates to fallback slot.
   */
  async complete(request: ModelRouterRequest): Promise<ModelRouterResponse> {
    const cacheKey = this.getCacheKey(request);

    try {
      return await this.breaker.execute(async () => {
        const response = await fetch(`${this.baseUrl}/route`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getInternalAuthHeaders(),
          },
          body: JSON.stringify({
            slot: request.slot,
            messages: request.messages,
            options: request.options,
          }),
          signal: AbortSignal.timeout(this.timeout),
        });

        if (!response.ok) {
          throw new Error(
            `Model router returned ${response.status}: ${await response.text()}`
          );
        }

        const data = (await response.json()) as ModelRouterResponse;

        // Cache successful response
        this.responseCache.set(cacheKey, data);

        // Limit cache size
        if (this.responseCache.size > 100) {
          const firstKey = this.responseCache.keys().next().value;
          if (firstKey) {
            this.responseCache.delete(firstKey);
          }
        }

        return data;
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);

      // Circuit is open — try cached response
      if (this.breaker.getState() === "open") {
        const cached = this.responseCache.get(cacheKey);
        if (cached) {
          logger.info(
            { slot: request.slot },
            "Circuit open: returning cached response"
          );
          return cached;
        }

        // No cache — escalate to fallback slot
        const fallbackSlot = MODEL_SLOT_FALLBACK[request.slot] ?? request.slot;
        if (fallbackSlot !== request.slot) {
          logger.warn(
            { originalSlot: request.slot, fallbackSlot },
            "Circuit open: escalating to fallback model slot"
          );
          // Return a minimal error response indicating escalation is needed
          throw new ModelRouterCircuitOpenError(
            `Circuit breaker open for model-router. Escalate from ${request.slot} to ${fallbackSlot}.`,
            fallbackSlot
          );
        }
      }

      logger.error(
        { error: msg, slot: request.slot },
        "Model router call failed"
      );
      throw error;
    }
  }

  /** Get current circuit breaker state */
  getCircuitState(): "closed" | "half-open" | "open" {
    return this.breaker.getState();
  }

  /** Get circuit breaker metrics */
  getMetrics() {
    return this.breaker.getMetrics();
  }

  /** Reset the circuit breaker (e.g., after manual intervention) */
  reset(): void {
    this.breaker.reset();
    this.responseCache.clear();
  }

  private getCacheKey(request: ModelRouterRequest): string {
    const lastMessage = request.messages.at(-1);
    return `${request.slot}:${lastMessage?.content?.slice(0, 100) ?? "empty"}`;
  }
}

/**
 * Error thrown when the circuit breaker is open and no cached response is available.
 * Includes the recommended fallback slot for callers to handle.
 */
export class ModelRouterCircuitOpenError extends Error {
  readonly fallbackSlot: string;

  constructor(message: string, fallbackSlot: string) {
    super(message);
    this.name = "ModelRouterCircuitOpenError";
    this.fallbackSlot = fallbackSlot;
  }
}
