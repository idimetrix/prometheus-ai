import type { ModelProvider } from "@prometheus/ai";
import {
  createLLMClient,
  MODEL_REGISTRY,
  PROVIDER_ENDPOINTS,
} from "@prometheus/ai";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
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
    primary: "ollama/qwen3-coder-next",
    fallbacks: ["cerebras/qwen3-235b", "groq/llama-3.3-70b-versatile"],
    description: "General coding tasks",
  },
  think: {
    primary: "ollama/deepseek-r1:32b",
    fallbacks: ["ollama/qwen3.5:27b", "anthropic/claude-sonnet-4-6"],
    description: "Deep reasoning and planning",
  },
  longContext: {
    primary: "gemini/gemini-2.5-flash",
    fallbacks: ["anthropic/claude-sonnet-4-6", "ollama/qwen3-coder-next"],
    description: "Long context windows (>32K tokens)",
  },
  background: {
    primary: "ollama/qwen2.5-coder:14b",
    fallbacks: ["ollama/qwen3-coder-next"],
    description: "Background indexing and lightweight tasks",
  },
  vision: {
    primary: "anthropic/claude-sonnet-4-6",
    fallbacks: ["gemini/gemini-2.5-flash"],
    description: "Image and vision understanding",
  },
  review: {
    primary: "anthropic/claude-sonnet-4-6",
    fallbacks: ["ollama/deepseek-r1:32b", "ollama/qwen3.5:27b"],
    description: "Code review and quality analysis",
  },
  fastLoop: {
    primary: "cerebras/qwen3-235b",
    fallbacks: ["groq/llama-3.3-70b-versatile", "ollama/qwen3-coder-next"],
    description: "Fast CI loop iterations",
  },
  premium: {
    primary: "anthropic/claude-opus-4-6",
    fallbacks: ["anthropic/claude-sonnet-4-6", "ollama/deepseek-r1:32b"],
    description: "Premium tier for complex tasks",
  },
};

export interface RouteRequest {
  messages: Array<{ role: string; content: string }>;
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

export class ModelRouterService {
  private readonly logger = createLogger("model-router:service");
  private readonly rateLimiter: RateLimitManager;
  /** Cache provider health status with TTL to avoid hammering providers */
  private readonly providerHealthCache = new Map<
    string,
    { healthy: boolean; checkedAt: number }
  >();
  private readonly healthCacheTtlMs = 30_000; // 30 seconds

  constructor(rateLimiter: RateLimitManager) {
    this.rateLimiter = rateLimiter;
  }

  /**
   * Route a completion request using the slot-based system.
   * This is the primary routing method used by the orchestrator.
   */
  async route(request: RouteRequest): Promise<RouteResponse> {
    const slotConfig = SLOT_CONFIGS[request.slot];
    if (!slotConfig) {
      throw new Error(
        `Unknown slot: ${request.slot}. Valid slots: ${Object.keys(SLOT_CONFIGS).join(", ")}`
      );
    }

    // If a specific model is explicitly requested and it exists, use it directly
    const overrideModel = request.options?.model;
    if (overrideModel && MODEL_REGISTRY[overrideModel]) {
      const result = await this.tryModel(overrideModel, request, 1);
      if (result) {
        return result;
      }
      // Fall through to slot-based routing if override fails
    }

    // Build the candidate chain: primary + fallbacks
    const candidates = [slotConfig.primary, ...slotConfig.fallbacks];
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

      const result = await this.tryModel(modelKey, request, attempts);
      if (result) {
        return result;
      }
    }

    throw new Error(
      `All models exhausted for slot "${request.slot}". Tried: ${candidates.join(", ")}`
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
   * Attempt to call a specific model. Returns null on failure so the
   * caller can try the next candidate in the chain.
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

    const client = createLLMClient({
      provider: config.provider,
      apiKey: userApiKey,
    });

    this.logger.info(
      {
        model: modelKey,
        provider: config.provider,
        slot: request.slot,
        messageCount: request.messages.length,
        attempt: attemptNumber,
      },
      "Routing completion request"
    );

    // Record request against rate limiter
    await this.rateLimiter.recordRequest(config.provider, modelKey);

    try {
      const response = await client.chat.completions.create({
        model: config.id,
        messages: request.messages as Parameters<
          typeof client.chat.completions.create
        >[0]["messages"],
        tools: request.options?.tools as Parameters<
          typeof client.chat.completions.create
        >[0]["tools"],
        temperature: request.options?.temperature ?? 0.1,
        max_tokens: request.options?.maxTokens ?? 4096,
        stream: false,
      });

      const promptTokens = response.usage?.prompt_tokens ?? 0;
      const completionTokens = response.usage?.completion_tokens ?? 0;
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
        "Completion succeeded"
      );

      return {
        id: response.id ?? generateId("cmpl"),
        model: modelKey,
        provider: config.provider,
        slot: request.slot,
        choices: response.choices.map((c) => ({
          message: {
            role: c.message.role,
            content: c.message.content ?? "",
            tool_calls: c.message.tool_calls as unknown[] | undefined,
          },
          finish_reason: c.finish_reason ?? "stop",
        })),
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
        "Completion request failed"
      );
      return null;
    }
  }

  /**
   * Attempt to start a streaming completion with a specific model.
   * Returns null on connection/setup failure so the caller can try fallbacks.
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

    const client = createLLMClient({
      provider: config.provider,
      apiKey: userApiKey,
    });

    this.logger.info(
      {
        model: modelKey,
        provider: config.provider,
        slot: request.slot,
        messageCount: request.messages.length,
        attempt: attemptNumber,
        stream: true,
      },
      "Routing streaming completion request"
    );

    await this.rateLimiter.recordRequest(config.provider, modelKey);

    try {
      const stream = await client.chat.completions.create({
        model: config.id,
        messages: request.messages as Parameters<
          typeof client.chat.completions.create
        >[0]["messages"],
        tools: request.options?.tools as Parameters<
          typeof client.chat.completions.create
        >[0]["tools"],
        temperature: request.options?.temperature ?? 0.1,
        max_tokens: request.options?.maxTokens ?? 4096,
        stream: true,
        stream_options: { include_usage: true },
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

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: complex but well-structured logic
      async function* iterate(): AsyncIterable<StreamChunk> {
        try {
          for await (const chunk of stream) {
            const choice = chunk.choices[0];
            if (!choice) {
              continue;
            }

            const content = choice.delta?.content ?? "";

            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens ?? 0;
              completionTokens = chunk.usage.completion_tokens ?? 0;
            }

            if (content) {
              yield { content, finishReason: choice.finish_reason ?? null };
            }

            if (choice.finish_reason) {
              yield { content: "", finishReason: choice.finish_reason };
            }
          }
        } finally {
          const totalTokens = promptTokens + completionTokens;
          const costUsd =
            promptTokens * (config?.costPerInputToken ?? 0) +
            completionTokens * (config?.costPerOutputToken ?? 0);

          // Record token usage asynchronously
          self.rateLimiter
            .recordTokenUsage(
              config?.provider ?? modelKey,
              modelKey,
              promptTokens,
              completionTokens
            )
            .catch(() => {
              /* fire-and-forget */
            });

          self.logger.info(
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
        "Streaming request failed"
      );
      return null;
    }
  }

  /**
   * Check health of all providers used in slot configs.
   * Uses a cache to avoid hammering provider endpoints.
   */
  async checkProviderHealth(): Promise<Record<string, boolean>> {
    const providers = getActiveProviders();
    const results: Record<string, boolean> = {};
    const now = Date.now();

    const checks = Array.from(providers).map(async (provider) => {
      // Check cache
      const cached = this.providerHealthCache.get(provider);
      if (cached && now - cached.checkedAt < this.healthCacheTtlMs) {
        results[provider] = cached.healthy;
        return;
      }

      try {
        // For ollama, try a simple connectivity check
        if (provider === "ollama") {
          const resp = await fetch("http://localhost:11434/api/version", {
            signal: AbortSignal.timeout(5000),
          }).catch(() => null);
          const healthy = resp?.ok ?? false;
          results[provider] = healthy;
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
          results[provider] = false;
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
          results[provider] = healthy;
          this.providerHealthCache.set(provider, { healthy, checkedAt: now });
        } else {
          results[provider] = false;
          this.providerHealthCache.set(provider, {
            healthy: false,
            checkedAt: now,
          });
        }
      } catch {
        results[provider] = false;
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
   * Select the appropriate slot based on token count and task hints.
   * The orchestrator can use this to auto-select a slot.
   */
  selectSlot(tokenEstimate: number, taskType?: string): string {
    // If task type is specified, prefer its mapping
    if (taskType && TASK_TYPE_TO_SLOT[taskType]) {
      return TASK_TYPE_TO_SLOT[taskType] as string;
    }

    // Auto-select based on token count
    if (tokenEstimate > 32_000) {
      return "longContext";
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
