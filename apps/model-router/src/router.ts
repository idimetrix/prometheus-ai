import type { ModelProvider } from "@prometheus/ai";
import {
  createVercelProvider,
  MODEL_REGISTRY,
  PROVIDER_ENDPOINTS,
} from "@prometheus/ai";
import { createLogger } from "@prometheus/logger";
import { withSpan } from "@prometheus/telemetry";
import { generateId } from "@prometheus/utils";
import { generateText, jsonSchema, streamText, type Tool } from "ai";
import { ResponseCache } from "./cache";
import { recordTrace } from "./langfuse";
import { type CascadeMessage, ModelCascade } from "./model-cascade";
import { ModelScorer } from "./model-scorer";
import type { RateLimitManager } from "./rate-limiter";

/**
 * Slot-based routing configuration. Each slot maps a use-case to a
 * primary model and a chain of fallbacks that are tried in order
 * when the primary is unavailable or rate-limited.
 */
export interface SlotConfig {
  description: string;
  fallbacks: string[];
  primary: string;
}

const SLOT_CONFIGS: Record<string, SlotConfig> = {
  default: {
    primary: "anthropic/claude-sonnet-4-6",
    fallbacks: [
      "ollama/qwen2.5-coder:32b",
      "ollama/qwen2.5-coder:14b",
      "cerebras/qwen3-235b",
      "groq/llama-3.3-70b-versatile",
    ],
    description: "General coding tasks",
  },
  think: {
    primary: "anthropic/claude-sonnet-4-6",
    fallbacks: ["ollama/qwen2.5-coder:32b", "ollama/qwen2.5:14b"],
    description: "Deep reasoning and planning",
  },
  longContext: {
    primary: "anthropic/claude-sonnet-4-6",
    fallbacks: ["gemini/gemini-2.5-flash", "ollama/qwen2.5-coder:32b"],
    description: "Long context windows (>32K tokens)",
  },
  background: {
    primary: "ollama/qwen2.5-coder:7b",
    fallbacks: ["ollama/qwen2.5-coder:14b", "anthropic/claude-sonnet-4-6"],
    description: "Background indexing and lightweight tasks",
  },
  vision: {
    primary: "anthropic/claude-sonnet-4-6",
    fallbacks: ["gemini/gemini-2.5-flash"],
    description: "Image and vision understanding",
  },
  review: {
    primary: "anthropic/claude-sonnet-4-6",
    fallbacks: ["ollama/qwen2.5-coder:32b", "ollama/qwen2.5:14b"],
    description: "Code review and quality analysis",
  },
  fastLoop: {
    primary: "anthropic/claude-sonnet-4-6",
    fallbacks: [
      "cerebras/qwen3-235b",
      "groq/llama-3.3-70b-versatile",
      "ollama/qwen2.5-coder:14b",
    ],
    description: "Fast CI loop iterations",
  },
  premium: {
    primary: "anthropic/claude-opus-4-6",
    fallbacks: ["anthropic/claude-sonnet-4-6", "ollama/qwen2.5-coder:32b"],
    description: "Premium tier for complex tasks",
  },
  speculate: {
    primary: "anthropic/claude-sonnet-4-6",
    fallbacks: ["cerebras/qwen3-235b", "groq/llama-3.3-70b-versatile"],
    description: "Fastest available model for speculative tool pre-execution",
  },
  fast: {
    primary: "anthropic/claude-sonnet-4-6",
    fallbacks: [
      "cerebras/qwen3-235b",
      "groq/llama-3.3-70b-versatile",
      "ollama/qwen2.5-coder:14b",
      "ollama/qwen2.5-coder:7b",
    ],
    description: "Lowest-latency provider for interactive fast-path operations",
  },
  embeddings: {
    primary: "ollama/nomic-embed-text",
    fallbacks: ["voyage/voyage-code-3"],
    description:
      "Text embedding generation for semantic search and classification",
  },
};

/**
 * Per-slot default temperatures. Creative tasks get higher temperature,
 * precise/deterministic tasks get lower.
 */
const SLOT_TEMPERATURES: Record<string, number> = {
  fastLoop: 0.05,
  default: 0.1,
  think: 0.3,
  review: 0.1,
  premium: 0.2,
  background: 0.0,
  speculate: 0.0,
  fast: 0.05,
  longContext: 0.1,
  vision: 0.1,
  embeddings: 0.0,
};

export interface RouteRequest {
  messages: Array<{ role: string; content: string }>;
  /** When true, prefer the cheapest model that meets the minimum quality threshold. */
  optimizeForCost?: boolean;
  options?: {
    model?: string;
    tools?: unknown[];
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    orgId?: string;
    userId?: string;
    taskId?: string;
    userApiKeys?: Record<string, string>;
  };
  slot: string;
}

export interface RouteResponse {
  choices: Array<{
    message: { role: string; content: string; tool_calls?: unknown[] };
    finish_reason: string;
  }>;
  id: string;
  model: string;
  provider: string;
  routing: {
    primaryModel: string;
    modelUsed: string;
    wasFallback: boolean;
    attemptsCount: number;
  };
  slot: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    cost_usd: number;
  };
}

/** Stream chunk emitted during streaming responses */
export interface StreamChunk {
  content: string;
  finishReason: string | null;
}

/** Result returned from routeStream */
export interface StreamRouteResult {
  done: Promise<{
    usage: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      cost_usd: number;
    };
    routing: {
      primaryModel: string;
      modelUsed: string;
      wasFallback: boolean;
      attemptsCount: number;
    };
  }>;
  id: string;
  model: string;
  provider: string;
  slot: string;
  stream: AsyncIterable<StreamChunk>;
}

/**
 * CompletionRequest preserved for backward compatibility with the
 * existing /v1/chat/completions endpoint.
 */
interface CompletionRequest {
  max_tokens?: number;
  messages: Array<{ role: string; content: string }>;
  model?: string;
  org_id?: string;
  prefer_tier?: number;
  stream?: boolean;
  task_type?: string;
  temperature?: number;
  tools?: unknown[];
  user_api_keys?: Record<string, string>;
}

interface CompletionResponse {
  choices: Array<{
    message: { role: string; content: string; tool_calls?: unknown[] };
    finish_reason: string;
  }>;
  id: string;
  model: string;
  provider: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * Convert OpenAI-format tool definitions to AI SDK 6 tool objects.
 * The orchestrator sends tools as { type: "function", function: { name, description, parameters } }.
 * AI SDK 6 expects Record<string, Tool> with { description, parameters: jsonSchema(...) }.
 */
function convertOpenAIToolsToAISDK(
  tools: unknown[] | undefined
): Record<string, Tool> | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  const converted: Record<string, Tool> = {};
  for (const t of tools) {
    const tool = t as {
      type?: string;
      function?: {
        name: string;
        description?: string;
        parameters?: Record<string, unknown>;
      };
    };
    if (tool.type === "function" && tool.function?.name) {
      converted[tool.function.name] = {
        description: tool.function.description ?? "",
        inputSchema: jsonSchema(
          (tool.function.parameters ?? {
            type: "object",
            properties: {},
          }) as Parameters<typeof jsonSchema>[0]
        ),
      };
    }
  }

  return Object.keys(converted).length > 0 ? converted : undefined;
}

/**
 * Task type to slot mapping. Used by the legacy /v1/chat/completions
 * endpoint and as a fallback for unspecified slots.
 */
const TASK_TYPE_TO_SLOT: Record<string, string> = {
  coding: "default",
  "codebase-analysis": "longContext",
  architecture: "think",
  planning: "think",
  "quick-fix": "fastLoop",
  testing: "fastLoop",
  security: "think",
  review: "review",
  complex: "premium",
  vision: "vision",
  indexing: "background",
  embedding: "background",
  "quick-action": "fast",
  chat: "fast",
};

/**
 * Track which providers are used in slot configs so we can health-check
 * only the relevant ones.
 */
function getActiveProviders(): Set<ModelProvider> {
  const providers = new Set<ModelProvider>();
  for (const slotConfig of Object.values(SLOT_CONFIGS)) {
    const allModels = [slotConfig.primary, ...slotConfig.fallbacks];
    for (const modelKey of allModels) {
      const config = MODEL_REGISTRY[modelKey];
      if (config) {
        providers.add(config.provider);
      }
    }
  }
  return providers;
}

interface CircuitBreakerState {
  failureCount: number;
  lastFailureAt: number;
  openedAt: number;
  recoveryProbeScheduled: boolean;
  /** Sliding window of recent request timestamps and their outcomes */
  requestLog: Array<{ timestamp: number; success: boolean; latencyMs: number }>;
  state: "closed" | "open" | "half-open";
  totalRequests: number;
}

/** Maximum number of entries kept in the sliding window */
const CIRCUIT_BREAKER_WINDOW_SIZE = 100;
/** Error rate threshold (0–1) above which the circuit opens */
const CIRCUIT_BREAKER_ERROR_THRESHOLD = 0.3;
/** How long the circuit stays open before allowing a recovery probe */
const CIRCUIT_BREAKER_RECOVERY_TIMEOUT_MS = 60_000;

export class ModelRouterService {
  private readonly logger = createLogger("model-router:service");
  private readonly cache: ResponseCache;
  private readonly cascade: ModelCascade;
  private readonly rateLimiter: RateLimitManager;
  private readonly scorer: ModelScorer;
  /** Cache provider health status with TTL to avoid hammering providers */
  private readonly providerHealthCache = new Map<
    string,
    { healthy: boolean; checkedAt: number }
  >();
  private readonly healthCacheTtlMs = 30_000; // 30 seconds

  /** Per-provider circuit breaker state */
  private readonly circuitBreakers = new Map<string, CircuitBreakerState>();

  constructor(rateLimiter: RateLimitManager) {
    this.rateLimiter = rateLimiter;
    this.cache = new ResponseCache();
    this.scorer = new ModelScorer();
    this.cascade = new ModelCascade(async (model, messages) => {
      const config = MODEL_REGISTRY[model];
      if (!config) {
        throw new Error(`Model not found: ${model}`);
      }

      // Use the Vercel AI SDK for all providers (including Anthropic which
      // does not expose an OpenAI-compatible API). This is the same path
      // used by tryModel() / tryModelStream().
      const vercelModel = createVercelProvider({
        provider: config.provider,
        modelId: config.id,
      });
      const response = await generateText({
        model: vercelModel,
        messages: messages.map((m) => ({
          role: m.role as "system" | "user" | "assistant",
          content: m.content,
        })),
        temperature: 0.1,
        maxOutputTokens: 4096,
      });
      return {
        content: response.text,
        inputTokens: response.usage?.inputTokens ?? 0,
        outputTokens: response.usage?.outputTokens ?? 0,
      };
    });
  }

  // ─── Circuit Breaker Methods ──────────────────────────────────────────

  /**
   * Retrieve or initialize the circuit breaker state for a provider.
   */
  private getCircuitBreaker(provider: string): CircuitBreakerState {
    let cb = this.circuitBreakers.get(provider);
    if (!cb) {
      cb = {
        state: "closed",
        failureCount: 0,
        totalRequests: 0,
        lastFailureAt: 0,
        openedAt: 0,
        recoveryProbeScheduled: false,
        requestLog: [],
      };
      this.circuitBreakers.set(provider, cb);
    }
    return cb;
  }

  /**
   * Record a provider failure. Opens the circuit when the sliding-window
   * error rate exceeds the configured threshold.
   */
  private recordProviderFailure(provider: string, latencyMs = 0): void {
    const cb = this.getCircuitBreaker(provider);
    const now = Date.now();

    cb.failureCount++;
    cb.totalRequests++;
    cb.lastFailureAt = now;
    cb.requestLog.push({ timestamp: now, success: false, latencyMs });

    // Trim to sliding window
    if (cb.requestLog.length > CIRCUIT_BREAKER_WINDOW_SIZE) {
      cb.requestLog = cb.requestLog.slice(-CIRCUIT_BREAKER_WINDOW_SIZE);
    }

    // Calculate error rate over the window
    const failures = cb.requestLog.filter((r) => !r.success).length;
    const errorRate = failures / cb.requestLog.length;

    if (errorRate > CIRCUIT_BREAKER_ERROR_THRESHOLD && cb.state === "closed") {
      cb.state = "open";
      cb.openedAt = now;
      cb.recoveryProbeScheduled = false;
      this.logger.warn(
        {
          provider,
          errorRate: errorRate.toFixed(2),
          failures,
          window: cb.requestLog.length,
        },
        "Circuit breaker opened for provider"
      );
    }

    // If we were in half-open and got another failure, re-open
    if (cb.state === "half-open") {
      cb.state = "open";
      cb.openedAt = now;
      cb.recoveryProbeScheduled = false;
      this.logger.warn(
        { provider },
        "Circuit breaker re-opened after failed recovery probe"
      );
    }
  }

  /**
   * Record a provider success. Closes the circuit when a recovery probe
   * succeeds while in half-open state.
   */
  private recordProviderSuccess(provider: string, latencyMs = 0): void {
    const cb = this.getCircuitBreaker(provider);
    const now = Date.now();

    cb.totalRequests++;
    cb.requestLog.push({ timestamp: now, success: true, latencyMs });

    // Trim to sliding window
    if (cb.requestLog.length > CIRCUIT_BREAKER_WINDOW_SIZE) {
      cb.requestLog = cb.requestLog.slice(-CIRCUIT_BREAKER_WINDOW_SIZE);
    }

    // Successful recovery probe → close the circuit
    if (cb.state === "half-open") {
      cb.state = "closed";
      cb.failureCount = 0;
      cb.recoveryProbeScheduled = false;
      this.logger.info(
        { provider },
        "Circuit breaker closed after successful recovery probe"
      );
    }
  }

  /**
   * Returns false if the circuit is open and the recovery timeout has not
   * yet elapsed. When the timeout has elapsed the circuit transitions to
   * half-open so a single probe request can pass through.
   */
  isProviderAvailable(provider: string): boolean {
    const cb = this.circuitBreakers.get(provider);
    if (!cb || cb.state === "closed") {
      return true;
    }

    if (cb.state === "half-open") {
      // Allow one probe through
      return true;
    }

    // state === "open"
    const now = Date.now();
    const elapsed = now - cb.openedAt;

    if (elapsed >= CIRCUIT_BREAKER_RECOVERY_TIMEOUT_MS) {
      // Transition to half-open, allow a single recovery probe
      cb.state = "half-open";
      cb.recoveryProbeScheduled = true;
      this.logger.info(
        { provider, elapsedMs: elapsed },
        "Circuit breaker transitioning to half-open"
      );
      return true;
    }

    return false;
  }

  /**
   * Route a completion request using the slot-based system.
   * This is the primary routing method used by the orchestrator.
   */
  route(request: RouteRequest): Promise<RouteResponse> {
    return withSpan(`model-router.route.${request.slot}`, (span) => {
      span.setAttribute("slot", request.slot);
      span.setAttribute("message_count", request.messages.length);
      return this._routeInner(request);
    });
  }

  private async _routeInner(request: RouteRequest): Promise<RouteResponse> {
    const slotConfig = SLOT_CONFIGS[request.slot];
    if (!slotConfig) {
      throw new Error(
        `Unknown slot: ${request.slot}. Valid slots: ${Object.keys(SLOT_CONFIGS).join(", ")}`
      );
    }

    // Check cache for non-streaming requests
    const cachedResponse = await this.cache.get(
      request.slot,
      request.messages as Array<{ role: string; content: string }>,
      request.options?.tools as unknown[] | undefined
    );
    if (cachedResponse) {
      this.logger.info({ slot: request.slot }, "Returning cached response");
      return cachedResponse as RouteResponse;
    }

    // If a specific model is explicitly requested and it exists, use it directly
    const overrideModel = request.options?.model;
    if (overrideModel && MODEL_REGISTRY[overrideModel]) {
      const result = await this.tryModel(overrideModel, request, 1);
      if (result) {
        // Cache the successful response
        await this.cache.set(
          request.slot,
          request.messages as Array<{ role: string; content: string }>,
          request.options?.tools as unknown[] | undefined,
          result
        );
        return result;
      }
      // Fall through to slot-based routing if override fails
    }

    // For default and fastLoop slots with non-streaming requests, use the
    // model cascade to start cheap and escalate only when quality is low.
    const isStreamingRequest = request.options?.stream === true;
    if (
      !isStreamingRequest &&
      (request.slot === "default" || request.slot === "fastLoop")
    ) {
      const cascadeResult = await this.tryCascadeRouting(request, slotConfig);
      if (cascadeResult) {
        return cascadeResult;
      }
    }

    // Build the candidate chain: primary + fallbacks
    const candidates = [slotConfig.primary, ...slotConfig.fallbacks];

    // Adaptive model reordering based on historical performance
    this.reorderCandidates(candidates, request);

    let attempts = 0;

    for (const modelKey of candidates) {
      attempts++;
      const config = MODEL_REGISTRY[modelKey];
      if (!config) {
        this.logger.warn({ modelKey }, "Model not found in registry, skipping");
        continue;
      }

      // Check rate limits
      const canProceed = await this.rateLimiter.canMakeRequest(
        config.provider,
        modelKey
      );
      if (!canProceed) {
        this.logger.info(
          { modelKey, provider: config.provider },
          "Rate limited, trying fallback"
        );
        continue;
      }

      const startMs = Date.now();
      const result = await this.tryModel(modelKey, request, attempts);
      const latencyMs = Date.now() - startMs;

      if (!result) {
        this.scorer.recordOutcome({
          modelKey,
          slotName: request.slot,
          success: false,
          latencyMs,
          costUsd: 0,
          taskType: request.options?.taskId,
        });

        // Record Langfuse trace for failed attempt (AM04)
        recordTrace({
          id: generateId("cmpl"),
          model: modelKey,
          provider: config.provider,
          slot: request.slot,
          success: false,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
          costUsd: 0,
          latencyMs,
          timestamp: new Date().toISOString(),
          error: `Model ${modelKey} failed for slot ${request.slot}`,
          metadata: {
            agentRole: (request.options as Record<string, unknown> | undefined)
              ?.agentRole,
            taskType: request.options?.taskId,
          },
        });
        continue;
      }

      // Record success with actual latency and quality signal from options
      this.scorer.recordOutcome({
        modelKey: result.model,
        slotName: request.slot,
        success: true,
        latencyMs,
        costUsd: result.usage.cost_usd,
        qualitySignal: (request.options as Record<string, unknown> | undefined)
          ?.qualitySignal as number | undefined,
        taskType: request.options?.taskId,
      });

      // Record Langfuse trace for LLM observability (AM04)
      recordTrace({
        id: result.id,
        model: result.model,
        provider: result.provider,
        slot: request.slot,
        success: true,
        promptTokens: result.usage.prompt_tokens,
        completionTokens: result.usage.completion_tokens,
        totalTokens: result.usage.total_tokens,
        costUsd: result.usage.cost_usd,
        latencyMs,
        timestamp: new Date().toISOString(),
        metadata: {
          agentRole: (request.options as Record<string, unknown> | undefined)
            ?.agentRole,
          taskType: request.options?.taskId,
          sessionId: (request.options as Record<string, unknown> | undefined)
            ?.sessionId,
        },
      });

      // Cache the successful response
      this.cache.set(
        request.slot,
        request.messages as Array<{ role: string; content: string }>,
        request.options?.tools as unknown[] | undefined,
        result
      );
      return result;
    }

    throw new Error(
      `All models exhausted for slot "${request.slot}". Tried: ${candidates.join(", ")}`
    );
  }

  /**
   * Reorder candidates array in-place based on historical performance.
   */
  /**
   * Attempt cascade routing for cost optimization. Returns null if cascade
   * is not applicable or fails.
   */
  private async tryCascadeRouting(
    request: RouteRequest,
    slotConfig: SlotConfig
  ): Promise<RouteResponse | null> {
    try {
      const cascadeMessages = request.messages.map((m) => ({
        role: m.role as CascadeMessage["role"],
        content: m.content,
      }));
      const cascadeResult = await this.cascade.execute(cascadeMessages);
      this.logger.info(
        {
          slot: request.slot,
          tier: cascadeResult.tier,
          model: cascadeResult.model,
          quality: cascadeResult.quality.toFixed(3),
          savingsUsd: cascadeResult.savingsUsd.toFixed(6),
        },
        "Cascade routing completed"
      );

      const result: RouteResponse = {
        id: generateId("cmpl"),
        model: cascadeResult.model,
        provider: MODEL_REGISTRY[cascadeResult.model]?.provider ?? "unknown",
        slot: request.slot,
        choices: [
          {
            message: {
              role: "assistant",
              content: cascadeResult.content,
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          cost_usd: cascadeResult.costUsd,
        },
        routing: {
          primaryModel: slotConfig.primary,
          modelUsed: cascadeResult.model,
          wasFallback: cascadeResult.escalated,
          attemptsCount: 1,
        },
      };

      await this.cache.set(
        request.slot,
        request.messages as Array<{ role: string; content: string }>,
        request.options?.tools as unknown[] | undefined,
        result
      );
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        { slot: request.slot, error: msg },
        "Cascade routing failed, falling back to standard routing"
      );
      return null;
    }
  }

  private reorderCandidates(candidates: string[], request: RouteRequest): void {
    const rankedModels = request.optimizeForCost
      ? this.scorer.getCostOptimizedRanking(
          request.slot,
          0.5,
          request.options?.taskId
        )
      : this.scorer.getRankedModels(request.slot);

    const minRequired = request.optimizeForCost ? 1 : 2;
    if (rankedModels.length < minRequired) {
      return;
    }

    const rankedKeys = new Set(rankedModels.map((r) => r.modelKey));
    const reordered = [
      ...rankedModels
        .map((r) => r.modelKey)
        .filter((k) => candidates.includes(k)),
      ...candidates.filter((k) => !rankedKeys.has(k)),
    ];
    candidates.length = 0;
    candidates.push(...reordered);
    this.logger.debug(
      { slot: request.slot, reordered: candidates },
      request.optimizeForCost
        ? "Cost-optimized model reordering"
        : "Adaptive model reordering"
    );
  }

  /**
   * Route a streaming completion request. Selects the model the same way
   * as route() but returns an async iterable of chunks instead of waiting
   * for the full response.
   */
  async routeStream(request: RouteRequest): Promise<StreamRouteResult> {
    const slotConfig = SLOT_CONFIGS[request.slot];
    if (!slotConfig) {
      throw new Error(
        `Unknown slot: ${request.slot}. Valid slots: ${Object.keys(SLOT_CONFIGS).join(", ")}`
      );
    }

    // Build candidate chain
    const overrideModel = request.options?.model;
    const candidates: string[] = [];
    if (overrideModel && MODEL_REGISTRY[overrideModel]) {
      candidates.push(overrideModel);
    }
    candidates.push(slotConfig.primary, ...slotConfig.fallbacks);

    let attempts = 0;

    for (const modelKey of candidates) {
      attempts++;
      const config = MODEL_REGISTRY[modelKey];
      if (!config) {
        continue;
      }

      // Check rate limits
      const canProceed = await this.rateLimiter.canMakeRequest(
        config.provider,
        modelKey
      );
      if (!canProceed) {
        this.logger.info(
          { modelKey, provider: config.provider },
          "Rate limited, trying fallback"
        );
        continue;
      }

      const result = await this.tryModelStream(modelKey, request, attempts);
      if (result) {
        return result;
      }
    }

    throw new Error(
      `All models exhausted for slot "${request.slot}" (stream). Tried: ${candidates.join(", ")}`
    );
  }

  /**
   * Attempt to call a specific model via the Vercel AI SDK 6.
   * Uses generateText() for type-safe, unified completions across all
   * providers. Returns null on failure so the caller can try the next
   * candidate in the chain.
   */
  private async tryModel(
    modelKey: string,
    request: RouteRequest,
    attemptNumber: number
  ): Promise<RouteResponse | null> {
    const config = MODEL_REGISTRY[modelKey];
    if (!config) {
      return null;
    }

    const slotConfig = (SLOT_CONFIGS[request.slot] ??
      SLOT_CONFIGS.default) as SlotConfig;
    const userApiKey = request.options?.userApiKeys?.[config.provider];

    this.logger.info(
      {
        model: modelKey,
        provider: config.provider,
        slot: request.slot,
        messageCount: request.messages.length,
        attempt: attemptNumber,
      },
      "Routing completion request via AI SDK"
    );

    // Circuit breaker check — skip providers whose circuit is open
    if (!this.isProviderAvailable(config.provider)) {
      this.logger.info(
        { modelKey, provider: config.provider },
        "Provider circuit breaker open, skipping"
      );
      return null;
    }

    // Record request against rate limiter
    await this.rateLimiter.recordRequest(config.provider, modelKey);

    const requestStartMs = Date.now();
    try {
      // Create a Vercel AI SDK language model instance
      const model = createVercelProvider({
        provider: config.provider,
        modelId: config.id,
        apiKey: userApiKey,
      });

      const temperature =
        request.options?.temperature ?? SLOT_TEMPERATURES[request.slot] ?? 0.1;

      const aiSdkTools = convertOpenAIToolsToAISDK(request.options?.tools);

      const response = await generateText({
        model,
        messages: request.messages.map((m) => ({
          role: m.role as "system" | "user" | "assistant",
          content: m.content,
        })),
        temperature,
        maxOutputTokens: request.options?.maxTokens ?? 4096,
        ...(aiSdkTools ? { tools: aiSdkTools, maxSteps: 1 } : {}),
      });

      const promptTokens = response.usage?.inputTokens ?? 0;
      const completionTokens = response.usage?.outputTokens ?? 0;
      const totalTokens = promptTokens + completionTokens;

      // Record token usage for rate limiting
      await this.rateLimiter.recordTokenUsage(
        config.provider,
        modelKey,
        promptTokens,
        completionTokens
      );

      // Calculate cost
      const costUsd =
        promptTokens * config.costPerInputToken +
        completionTokens * config.costPerOutputToken;

      this.logger.info(
        {
          model: modelKey,
          promptTokens,
          completionTokens,
          costUsd: costUsd.toFixed(6),
        },
        "AI SDK completion succeeded"
      );

      // Record success in circuit breaker
      this.recordProviderSuccess(config.provider, Date.now() - requestStartMs);

      // Fire-and-forget model usage logging
      this.logModelUsage({
        orgId: request.options?.orgId,
        sessionId: request.options?.taskId,
        modelKey,
        provider: config.provider,
        slot: request.slot,
        promptTokens,
        completionTokens,
        totalTokens,
        costUsd,
      }).catch(() => {
        /* fire-and-forget */
      });

      // Extract tool calls from AI SDK response and convert to OpenAI format
      // AI SDK 6 uses { toolCallId, toolName, input } while OpenAI uses { id, function: { name, arguments } }
      const toolCalls = response.toolCalls?.length
        ? response.toolCalls.map((tc) => ({
            id: tc.toolCallId,
            type: "function" as const,
            function: {
              name: tc.toolName,
              arguments:
                typeof tc.input === "string"
                  ? tc.input
                  : JSON.stringify(tc.input),
            },
          }))
        : undefined;

      return {
        id: response.response?.id ?? generateId("cmpl"),
        model: modelKey,
        provider: config.provider,
        slot: request.slot,
        choices: [
          {
            message: {
              role: "assistant",
              content: response.text,
              tool_calls: toolCalls,
            },
            finish_reason: response.finishReason ?? "stop",
          },
        ],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
          cost_usd: costUsd,
        },
        routing: {
          primaryModel: slotConfig.primary,
          modelUsed: modelKey,
          wasFallback: modelKey !== slotConfig.primary,
          attemptsCount: attemptNumber,
        },
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { model: modelKey, error: msg, attempt: attemptNumber },
        "AI SDK completion request failed"
      );
      // Record failure in circuit breaker
      this.recordProviderFailure(config.provider, Date.now() - requestStartMs);
      return null;
    }
  }

  /**
   * Attempt to start a streaming completion with a specific model via
   * Vercel AI SDK 6's streamText(). Returns null on connection/setup
   * failure so the caller can try fallbacks.
   */
  private async tryModelStream(
    modelKey: string,
    request: RouteRequest,
    attemptNumber: number
  ): Promise<StreamRouteResult | null> {
    const config = MODEL_REGISTRY[modelKey];
    if (!config) {
      return null;
    }

    const slotConfig = (SLOT_CONFIGS[request.slot] ??
      SLOT_CONFIGS.default) as SlotConfig;
    const userApiKey = request.options?.userApiKeys?.[config.provider];

    this.logger.info(
      {
        model: modelKey,
        provider: config.provider,
        slot: request.slot,
        messageCount: request.messages.length,
        attempt: attemptNumber,
        stream: true,
      },
      "Routing streaming completion request via AI SDK"
    );

    await this.rateLimiter.recordRequest(config.provider, modelKey);

    try {
      // Create a Vercel AI SDK language model instance
      const model = createVercelProvider({
        provider: config.provider,
        modelId: config.id,
        apiKey: userApiKey,
      });

      const temperature =
        request.options?.temperature ?? SLOT_TEMPERATURES[request.slot] ?? 0.1;

      const result = streamText({
        model,
        messages: request.messages.map((m) => ({
          role: m.role as "system" | "user" | "assistant",
          content: m.content,
        })),
        temperature,
        maxOutputTokens: request.options?.maxTokens ?? 4096,
      });

      const id = generateId("cmpl");
      let promptTokens = 0;
      let completionTokens = 0;

      let resolveDone: (
        value: StreamRouteResult["done"] extends Promise<infer T> ? T : never
      ) => void;
      const done = new Promise<
        StreamRouteResult["done"] extends Promise<infer T> ? T : never
      >((resolve) => {
        resolveDone = resolve;
      });

      const self = this;

      async function* iterate(): AsyncIterable<StreamChunk> {
        try {
          for await (const textPart of result.textStream) {
            if (textPart) {
              yield { content: textPart, finishReason: null };
            }
          }
          // Emit a final chunk with the finish reason
          const usage = await result.usage;
          promptTokens = usage?.inputTokens ?? 0;
          completionTokens = usage?.outputTokens ?? 0;
          const finishReason = await result.finishReason;
          yield { content: "", finishReason: finishReason ?? "stop" };
        } finally {
          self.finalizeStream(
            config,
            modelKey,
            request,
            slotConfig,
            attemptNumber,
            promptTokens,
            completionTokens,
            resolveDone
          );
        }
      }

      return {
        id,
        model: modelKey,
        provider: config.provider,
        slot: request.slot,
        stream: iterate(),
        done,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        { model: modelKey, error: msg, attempt: attemptNumber, stream: true },
        "AI SDK streaming request failed"
      );
      return null;
    }
  }

  /**
   * Finalize a streaming response: record token usage, log model usage,
   * and resolve the done promise.
   */
  private finalizeStream(
    config:
      | {
          provider: string;
          costPerInputToken: number;
          costPerOutputToken: number;
        }
      | undefined,
    modelKey: string,
    request: RouteRequest,
    slotConfig: SlotConfig,
    attemptNumber: number,
    promptTokens: number,
    completionTokens: number,
    resolveDone:
      | ((value: {
          usage: {
            prompt_tokens: number;
            completion_tokens: number;
            total_tokens: number;
            cost_usd: number;
          };
          routing: {
            primaryModel: string;
            modelUsed: string;
            wasFallback: boolean;
            attemptsCount: number;
          };
        }) => void)
      | undefined
  ): void {
    const totalTokens = promptTokens + completionTokens;
    const costUsd =
      promptTokens * (config?.costPerInputToken ?? 0) +
      completionTokens * (config?.costPerOutputToken ?? 0);

    this.rateLimiter
      .recordTokenUsage(
        config?.provider ?? modelKey,
        modelKey,
        promptTokens,
        completionTokens
      )
      .catch(() => {
        /* fire-and-forget */
      });

    this.logModelUsage({
      orgId: request.options?.orgId,
      sessionId: request.options?.taskId,
      modelKey,
      provider: config?.provider ?? modelKey,
      slot: request.slot,
      promptTokens,
      completionTokens,
      totalTokens,
      costUsd,
    }).catch(() => {
      /* fire-and-forget */
    });

    this.logger.info(
      {
        model: modelKey,
        promptTokens,
        completionTokens,
        costUsd: costUsd.toFixed(6),
        stream: true,
      },
      "Streaming completion finished"
    );

    resolveDone?.({
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
        cost_usd: costUsd,
      },
      routing: {
        primaryModel: slotConfig.primary,
        modelUsed: modelKey,
        wasFallback: modelKey !== slotConfig.primary,
        attemptsCount: attemptNumber,
      },
    });
  }

  /**
   * Log model usage to the API for persistent tracking.
   * Fire-and-forget: errors are silently ignored to avoid
   * impacting the LLM response path.
   */
  private async logModelUsage(usage: {
    orgId?: string;
    sessionId?: string;
    modelKey: string;
    provider: string;
    slot: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  }): Promise<void> {
    const apiUrl = process.env.API_URL ?? "http://localhost:4000";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
    if (internalSecret) {
      headers["x-internal-secret"] = internalSecret;
    }
    await fetch(`${apiUrl}/internal/model-usage`, {
      method: "POST",
      headers,
      body: JSON.stringify(usage),
      signal: AbortSignal.timeout(5000),
    });
  }

  /**
   * Check health of all providers used in slot configs.
   * Uses a cache to avoid hammering provider endpoints and incorporates
   * circuit breaker state and sliding-window latency percentiles.
   */
  async checkProviderHealth(): Promise<
    Record<
      string,
      {
        healthy: boolean;
        circuitBreaker: {
          state: "closed" | "open" | "half-open";
          errorRate: number;
          totalRequests: number;
          latencyP50Ms: number;
          latencyP95Ms: number;
          latencyP99Ms: number;
        };
      }
    >
  > {
    const providers = getActiveProviders();
    const results: Record<
      string,
      {
        healthy: boolean;
        circuitBreaker: {
          state: "closed" | "open" | "half-open";
          errorRate: number;
          totalRequests: number;
          latencyP50Ms: number;
          latencyP95Ms: number;
          latencyP99Ms: number;
        };
      }
    > = {};
    const now = Date.now();

    const checks = Array.from(providers).map(async (provider) => {
      // Compute circuit breaker stats for this provider
      const cb = this.getCircuitBreaker(provider);
      const failures = cb.requestLog.filter((r) => !r.success).length;
      const errorRate =
        cb.requestLog.length > 0 ? failures / cb.requestLog.length : 0;

      // Compute latency percentiles from the sliding window
      const latencies = cb.requestLog
        .filter((r) => r.success && r.latencyMs > 0)
        .map((r) => r.latencyMs)
        .sort((a, b) => a - b);

      const percentile = (arr: number[], p: number): number => {
        if (arr.length === 0) {
          return 0;
        }
        const idx = Math.ceil((p / 100) * arr.length) - 1;
        return arr[Math.max(0, idx)] ?? 0;
      };

      const cbStats = {
        state: cb.state,
        errorRate,
        totalRequests: cb.totalRequests,
        latencyP50Ms: percentile(latencies, 50),
        latencyP95Ms: percentile(latencies, 95),
        latencyP99Ms: percentile(latencies, 99),
      };

      // If circuit is open, mark as unhealthy immediately
      if (!this.isProviderAvailable(provider)) {
        results[provider] = { healthy: false, circuitBreaker: cbStats };
        this.providerHealthCache.set(provider, {
          healthy: false,
          checkedAt: now,
        });
        return;
      }

      // Check cache
      const cached = this.providerHealthCache.get(provider);
      if (cached && now - cached.checkedAt < this.healthCacheTtlMs) {
        results[provider] = {
          healthy: cached.healthy,
          circuitBreaker: cbStats,
        };
        return;
      }

      try {
        // For ollama, try a simple connectivity check
        if (provider === "ollama") {
          const resp = await fetch("http://localhost:11434/api/version", {
            signal: AbortSignal.timeout(5000),
          }).catch(() => null);
          const healthy = resp?.ok ?? false;
          results[provider] = { healthy, circuitBreaker: cbStats };
          this.providerHealthCache.set(provider, { healthy, checkedAt: now });
          return;
        }

        // For cloud providers, check if we have an API key configured
        const envKeyMap: Record<string, string> = {
          cerebras: "CEREBRAS_API_KEY",
          groq: "GROQ_API_KEY",
          gemini: "GEMINI_API_KEY",
          openrouter: "OPENROUTER_API_KEY",
          mistral: "MISTRAL_API_KEY",
          deepseek: "DEEPSEEK_API_KEY",
          anthropic: "ANTHROPIC_API_KEY",
          openai: "OPENAI_API_KEY",
        };

        const envKey = envKeyMap[provider];
        const hasKey = envKey ? !!process.env[envKey] : false;

        if (!hasKey) {
          results[provider] = { healthy: false, circuitBreaker: cbStats };
          this.providerHealthCache.set(provider, {
            healthy: false,
            checkedAt: now,
          });
          return;
        }

        // Try to reach the provider's endpoint
        const endpoint = PROVIDER_ENDPOINTS[provider];
        if (endpoint) {
          const resp = await fetch(`${endpoint}/models`, {
            headers: {
              Authorization: `Bearer ${process.env[envKey as string]}`,
            },
            signal: AbortSignal.timeout(5000),
          }).catch(() => null);
          const healthy =
            resp !== null &&
            (resp.ok || resp.status === 401 || resp.status === 403);
          // 401/403 means endpoint is reachable but key may be bad -- still "reachable"
          results[provider] = { healthy, circuitBreaker: cbStats };
          this.providerHealthCache.set(provider, { healthy, checkedAt: now });
        } else {
          results[provider] = { healthy: false, circuitBreaker: cbStats };
          this.providerHealthCache.set(provider, {
            healthy: false,
            checkedAt: now,
          });
        }
      } catch {
        results[provider] = { healthy: false, circuitBreaker: cbStats };
        this.providerHealthCache.set(provider, {
          healthy: false,
          checkedAt: now,
        });
      }
    });

    await Promise.allSettled(checks);
    return results;
  }

  /**
   * Legacy endpoint: route based on task_type using the old interface.
   * Maps task_type to a slot and delegates to the slot-based router.
   */
  async routeCompletion(
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    const taskType = request.task_type ?? "coding";
    const slot = TASK_TYPE_TO_SLOT[taskType] ?? "default";

    const result = await this.route({
      slot,
      messages: request.messages,
      options: {
        model: request.model,
        tools: request.tools,
        temperature: request.temperature,
        maxTokens: request.max_tokens,
        orgId: request.org_id,
        userApiKeys: request.user_api_keys,
      },
    });

    return {
      id: result.id,
      model: result.model,
      provider: result.provider,
      choices: result.choices,
      usage: {
        prompt_tokens: result.usage.prompt_tokens,
        completion_tokens: result.usage.completion_tokens,
        total_tokens: result.usage.total_tokens,
      },
    };
  }

  /**
   * Streaming variant of routeCompletion for the /v1/chat/completions endpoint.
   * Maps task_type to a slot and delegates to routeStream().
   */
  routeCompletionStream(
    request: CompletionRequest
  ): Promise<StreamRouteResult> {
    const taskType = request.task_type ?? "coding";
    const slot = TASK_TYPE_TO_SLOT[taskType] ?? "default";

    return this.routeStream({
      slot,
      messages: request.messages,
      options: {
        model: request.model,
        tools: request.tools,
        temperature: request.temperature,
        maxTokens: request.max_tokens,
        stream: true,
        orgId: request.org_id,
        userApiKeys: request.user_api_keys,
      },
    });
  }

  /**
   * Estimate token count for a set of messages. Simple approximation
   * using character count / 4 (roughly 1 token per 4 chars for English).
   */
  estimateTokenCount(
    messages: Array<{ role: string; content: string }>
  ): number {
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += msg.content.length + msg.role.length + 4; // role + content + formatting overhead
    }
    return Math.ceil(totalChars / 4);
  }

  /**
   * Select the appropriate slot based on token count, task hints, and
   * complexity estimation. Uses the ComplexityEstimator when no explicit
   * slot or task type is provided.
   */
  selectSlot(
    tokenEstimate: number,
    taskType?: string,
    messages?: Array<{ role: string; content: string }>
  ): string {
    // If task type is specified, prefer its mapping
    if (taskType && TASK_TYPE_TO_SLOT[taskType]) {
      return TASK_TYPE_TO_SLOT[taskType] as string;
    }

    // Auto-select based on token count
    if (tokenEstimate > 32_000) {
      return "longContext";
    }

    // Use complexity estimator for intelligent slot selection
    if (messages && messages.length > 0) {
      try {
        const { ComplexityEstimator } = require("./complexity-estimator") as {
          ComplexityEstimator: new () => {
            estimate: (req: {
              messages: Array<{ role: string; content: string }>;
              taskType?: string;
            }) => { recommendedSlot: string };
          };
        };
        const estimator = new ComplexityEstimator();
        const estimate = estimator.estimate({ messages, taskType });
        return estimate.recommendedSlot;
      } catch {
        // Complexity estimator not available, fall through
      }
    }

    return "default";
  }

  getAvailableModels(): Array<{
    id: string;
    provider: string;
    tier: number;
    capabilities: string[];
    contextWindow: number;
    costPerInputToken: number;
    costPerOutputToken: number;
    supportsStreaming: boolean;
    maxOutputTokens: number | null;
  }> {
    return Object.entries(MODEL_REGISTRY).map(([key, config]) => ({
      id: key,
      provider: config.provider,
      tier: config.tier,
      capabilities: config.capabilities,
      contextWindow: config.contextWindow,
      costPerInputToken: config.costPerInputToken,
      costPerOutputToken: config.costPerOutputToken,
      supportsStreaming: config.supportsStreaming,
      maxOutputTokens: config.maxOutputTokens,
    }));
  }

  getSlotConfigs(): Record<string, SlotConfig> {
    return { ...SLOT_CONFIGS };
  }
}

// ─── Embedding Support ────────────────────────────────────────────────

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const VOYAGE_API_BASE = "https://api.voyageai.com/v1";

export interface EmbeddingResponse {
  dimensions: number;
  embedding: number[];
  model: string;
}

interface OllamaEmbeddingResult {
  embedding: number[];
}

const embeddingLogger = createLogger("model-router:embedding");

async function generateVoyageEmbedding(
  model: string,
  input: string
): Promise<EmbeddingResponse | null> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    return null;
  }

  const response = await fetch(`${VOYAGE_API_BASE}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model.replace("voyage/", ""),
      input: [input],
      input_type: "document",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
    model: string;
  };

  const embedding = data.data[0]?.embedding;
  if (!embedding?.length) {
    return null;
  }

  return { embedding, model, dimensions: embedding.length };
}

async function generateOllamaEmbedding(
  model: string,
  input: string
): Promise<EmbeddingResponse | null> {
  const ollamaModel = model.replace("ollama/", "");
  const response = await fetch(`${OLLAMA_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: ollamaModel, prompt: input }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as OllamaEmbeddingResult;
  if (!data.embedding?.length) {
    return null;
  }

  return {
    embedding: data.embedding,
    model,
    dimensions: data.embedding.length,
  };
}

/**
 * Generate an embedding vector for the given text. Tries the primary model
 * from the embeddings slot config (voyage-code-3), then falls back through
 * the fallback chain (Ollama nomic-embed-text).
 */
export async function routeEmbedding(
  text: string | string[]
): Promise<EmbeddingResponse> {
  const slotConfig = SLOT_CONFIGS.embeddings;
  if (!slotConfig) {
    throw new Error("Embeddings slot not configured");
  }

  const candidates = [slotConfig.primary, ...slotConfig.fallbacks];
  const input = Array.isArray(text) ? text.join(" ") : text;

  for (const model of candidates) {
    try {
      let result: EmbeddingResponse | null = null;

      if (model.startsWith("voyage/")) {
        result = await generateVoyageEmbedding(model, input);
      } else {
        result = await generateOllamaEmbedding(model, input);
      }

      if (result) {
        embeddingLogger.debug(
          { model, dimensions: result.dimensions },
          "Embedding generated"
        );
        return result;
      }

      embeddingLogger.warn(
        { model },
        "Embedding model returned empty result, trying fallback"
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      embeddingLogger.warn(
        { model, error: msg },
        "Embedding model failed, trying fallback"
      );
    }
  }

  throw new Error(
    `All embedding models exhausted. Tried: ${candidates.join(", ")}`
  );
}
