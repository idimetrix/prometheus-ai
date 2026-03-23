// =============================================================================
// @prometheus/ai — Intelligent Model Router
// =============================================================================
// Health-check based routing with cost-aware fallback.
// Walks the slot's fallback chain, skipping unhealthy or rate-limited providers,
// preferring free tiers when possible.
// =============================================================================

import type { ModelProvider } from "./models";
import { getModelConfig, MODEL_REGISTRY, type ModelConfig } from "./models";
import type {
  ChatMessage,
  CompletionResult,
  StreamCompletionResult,
} from "./providers/base";
import { LLMProvider } from "./providers/provider";
import type { RoutingSlot } from "./slots";
import { autoDetectSlot, SLOT_CONFIGS } from "./slots";
import { estimateMessageTokens } from "./tokens";

// ---------------------------------------------------------------------------
// Provider Health Tracking
// ---------------------------------------------------------------------------

interface ProviderHealth {
  consecutiveFailures: number;
  healthy: boolean;
  lastCheck: number;
  /** Timestamp when the provider was marked unhealthy */
  unhealthySince: number | null;
}

/** Health status for each provider */
const healthMap = new Map<ModelProvider, ProviderHealth>();

/** Rate limit tracking: sliding window counters */
interface RateLimitState {
  /** Requests made in the current window */
  requestCount: number;
  /** Tokens used in the current window */
  tokenCount: number;
  /** Window start timestamp */
  windowStart: number;
}

const rateLimitMap = new Map<string, RateLimitState>();

/** How long to wait before retrying an unhealthy provider (ms) */
const HEALTH_RECOVERY_MS = 60_000; // 1 minute
/** How long a rate limit window lasts (ms) */
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
/** Maximum consecutive failures before marking unhealthy */
const MAX_CONSECUTIVE_FAILURES = 3;

// ---------------------------------------------------------------------------
// Health Management
// ---------------------------------------------------------------------------

function getProviderHealth(provider: ModelProvider): ProviderHealth {
  let health = healthMap.get(provider);
  if (!health) {
    health = {
      healthy: true,
      lastCheck: 0,
      consecutiveFailures: 0,
      unhealthySince: null,
    };
    healthMap.set(provider, health);
  }
  return health;
}

/**
 * Report a successful request to a provider.
 */
export function reportSuccess(provider: ModelProvider): void {
  const health = getProviderHealth(provider);
  health.healthy = true;
  health.consecutiveFailures = 0;
  health.unhealthySince = null;
  health.lastCheck = Date.now();
}

/**
 * Report a failed request to a provider.
 */
export function reportFailure(provider: ModelProvider): void {
  const health = getProviderHealth(provider);
  health.consecutiveFailures += 1;
  health.lastCheck = Date.now();

  if (health.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    health.healthy = false;
    health.unhealthySince = Date.now();
  }
}

/**
 * Check if a provider is considered healthy.
 * Unhealthy providers are retried after HEALTH_RECOVERY_MS.
 */
export function isProviderHealthy(provider: ModelProvider): boolean {
  const health = getProviderHealth(provider);

  // If healthy, it's good
  if (health.healthy) {
    return true;
  }

  // Check if recovery period has elapsed
  if (
    health.unhealthySince &&
    Date.now() - health.unhealthySince > HEALTH_RECOVERY_MS
  ) {
    // Allow retry
    health.healthy = true;
    health.consecutiveFailures = 0;
    health.unhealthySince = null;
    return true;
  }

  return false;
}

/**
 * Manually mark a provider as healthy or unhealthy.
 */
export function setProviderHealth(
  provider: ModelProvider,
  healthy: boolean
): void {
  const health = getProviderHealth(provider);
  health.healthy = healthy;
  if (healthy) {
    health.consecutiveFailures = 0;
    health.unhealthySince = null;
  } else {
    health.unhealthySince = Date.now();
  }
}

/**
 * Get health status of all providers.
 */
export function getHealthStatus(): Record<
  ModelProvider,
  { healthy: boolean; failures: number }
> {
  const providers: ModelProvider[] = [
    "ollama",
    "cerebras",
    "groq",
    "gemini",
    "deepseek",
    "anthropic",
    "openai",
    "openrouter",
    "mistral",
  ];

  const result: Record<string, { healthy: boolean; failures: number }> = {};
  for (const p of providers) {
    const h = getProviderHealth(p);
    result[p] = { healthy: h.healthy, failures: h.consecutiveFailures };
  }
  return result as Record<
    ModelProvider,
    { healthy: boolean; failures: number }
  >;
}

// ---------------------------------------------------------------------------
// Rate Limit Tracking
// ---------------------------------------------------------------------------

function getRateLimitState(modelKey: string): RateLimitState {
  const now = Date.now();
  let state = rateLimitMap.get(modelKey);

  if (!state || now - state.windowStart > RATE_LIMIT_WINDOW_MS) {
    state = { requestCount: 0, tokenCount: 0, windowStart: now };
    rateLimitMap.set(modelKey, state);
  }

  return state;
}

/**
 * Check if a model is within its rate limits.
 */
export function isWithinRateLimit(
  modelKey: string,
  estimatedTokens = 0
): boolean {
  const config = getModelConfig(modelKey);
  if (!config) {
    return false;
  }

  // Unlimited rate
  if (config.rpmLimit === null && config.tpmLimit === null) {
    return true;
  }

  const state = getRateLimitState(modelKey);

  if (config.rpmLimit !== null && state.requestCount >= config.rpmLimit) {
    return false;
  }

  if (
    config.tpmLimit !== null &&
    state.tokenCount + estimatedTokens > config.tpmLimit
  ) {
    return false;
  }

  return true;
}

/**
 * Record a request against the rate limit counters.
 */
export function recordRequest(modelKey: string, tokenCount: number): void {
  const state = getRateLimitState(modelKey);
  state.requestCount += 1;
  state.tokenCount += tokenCount;
}

// ---------------------------------------------------------------------------
// Cost-Aware Sorting
// ---------------------------------------------------------------------------

/**
 * Sort model keys by cost (ascending). Free models first.
 */
function sortByCost(modelKeys: string[]): string[] {
  return [...modelKeys].sort((a, b) => {
    const configA = MODEL_REGISTRY[a];
    const configB = MODEL_REGISTRY[b];
    if (!(configA && configB)) {
      return 0;
    }

    const costA = configA.costPerInputToken + configA.costPerOutputToken;
    const costB = configB.costPerInputToken + configB.costPerOutputToken;
    return costA - costB;
  });
}

// ---------------------------------------------------------------------------
// Route Resolution
// ---------------------------------------------------------------------------

export interface RouteRequest {
  /** Whether the request has images */
  hasImages?: boolean;
  /** Max tokens override */
  maxTokens?: number;
  /** Messages to send */
  messages: ChatMessage[];
  /** Prefer cost-aware routing (sort chain by cheapest first) */
  preferCheapest?: boolean;
  /** Explicit slot override (if not provided, auto-detected) */
  slot?: RoutingSlot;
  /** Whether to stream the response */
  stream?: boolean;
  /** Task type for auto-detection */
  taskType?: string;
  /** Temperature override */
  temperature?: number;
}

export interface ResolvedRoute {
  /** Estimated input token count */
  estimatedInputTokens: number;
  /** The position in the fallback chain (0 = primary) */
  fallbackPosition: number;
  /** The selected model registry key */
  modelKey: string;
  /** The resolved slot */
  slot: RoutingSlot;
  /** Whether to stream */
  stream: boolean;
  /** Temperature to use */
  temperature: number;
}

/**
 * Resolve the best available model for a request.
 *
 * Walks the slot's fallback chain, checking:
 * 1. Provider health (skip unhealthy)
 * 2. Rate limits (skip over-limit)
 * 3. Context window (skip if input doesn't fit)
 *
 * If preferCheapest is true, the chain is re-sorted by cost.
 *
 * Returns null if no model is available (all rate-limited/unhealthy).
 */
export function resolveRoute(request: RouteRequest): ResolvedRoute | null {
  // Determine slot
  const estimatedTokens = estimateMessageTokens(request.messages);
  const slot =
    request.slot ??
    autoDetectSlot({
      tokenCount: estimatedTokens,
      taskType: request.taskType,
      hasImages: request.hasImages,
    });

  const slotConfig = SLOT_CONFIGS[slot];
  let chain = [...slotConfig.chain];

  // Cost-aware: re-sort the chain by cheapest
  if (request.preferCheapest) {
    chain = sortByCost(chain);
  }

  for (let i = 0; i < chain.length; i++) {
    const modelKey = chain[i] as string;
    const config = getModelConfig(modelKey);
    if (!config) {
      continue;
    }

    // Check provider health
    if (!isProviderHealthy(config.provider)) {
      continue;
    }

    // Check rate limits
    if (!isWithinRateLimit(modelKey, estimatedTokens)) {
      continue;
    }

    // Check context window (input must fit with room for output)
    const maxOutput = config.maxOutputTokens ?? 4096;
    if (estimatedTokens + maxOutput > config.contextWindow) {
      continue;
    }

    return {
      modelKey,
      slot,
      fallbackPosition: i,
      temperature: request.temperature ?? slotConfig.defaultTemperature,
      stream: request.stream ?? slotConfig.preferStreaming,
      estimatedInputTokens: estimatedTokens,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// High-Level Routing + Execution
// ---------------------------------------------------------------------------

/** Cache of provider instances */
const providerCache = new Map<ModelProvider, LLMProvider>();

function getProvider(provider: ModelProvider): LLMProvider {
  let p = providerCache.get(provider);
  if (!p) {
    p = new LLMProvider(provider);
    providerCache.set(provider, p);
  }
  return p;
}

function isModelEligible(
  modelKey: string,
  estimatedTokens: number,
  requiresStreaming = false
): ModelConfig | null {
  const config = getModelConfig(modelKey);
  if (!config) {
    return null;
  }
  if (!isProviderHealthy(config.provider)) {
    return null;
  }
  if (!isWithinRateLimit(modelKey, estimatedTokens)) {
    return null;
  }
  const maxOutput = config.maxOutputTokens ?? 4096;
  if (estimatedTokens + maxOutput > config.contextWindow) {
    return null;
  }
  if (requiresStreaming && !config.supportsStreaming) {
    return null;
  }
  return config;
}

function resolveChain(request: RouteRequest, estimatedTokens: number) {
  const slot =
    request.slot ??
    autoDetectSlot({
      tokenCount: estimatedTokens,
      taskType: request.taskType,
      hasImages: request.hasImages,
    });

  const slotConfig = SLOT_CONFIGS[slot];
  let chain = [...slotConfig.chain];
  if (request.preferCheapest) {
    chain = sortByCost(chain);
  }
  return { slot, slotConfig, chain };
}

/**
 * Route a request and execute it against the best available model.
 * Automatically handles fallback on failure.
 *
 * Returns the completion result + routing metadata.
 */
export async function routeAndComplete(
  request: RouteRequest
): Promise<{ result: CompletionResult; route: ResolvedRoute }> {
  const estimatedTokens = estimateMessageTokens(request.messages);
  const { slot, slotConfig, chain } = resolveChain(request, estimatedTokens);

  let lastError: Error | null = null;

  for (let i = 0; i < chain.length; i++) {
    const config = isModelEligible(chain[i] as string, estimatedTokens);
    if (!config) {
      continue;
    }

    const route: ResolvedRoute = {
      modelKey: chain[i] as string,
      slot,
      fallbackPosition: i,
      temperature: request.temperature ?? slotConfig.defaultTemperature,
      stream: false,
      estimatedInputTokens: estimatedTokens,
    };

    try {
      const provider = getProvider(config.provider);
      const result = await provider.complete({
        model: config.id,
        messages: request.messages,
        temperature: route.temperature,
        maxTokens: request.maxTokens ?? config.maxOutputTokens ?? undefined,
      });

      reportSuccess(config.provider);
      recordRequest(chain[i] as string, result.usage.totalTokens);

      return { result, route };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      reportFailure(config.provider);
    }
  }

  throw new Error(
    `All models exhausted for slot "${slot}". Last error: ${lastError?.message ?? "unknown"}`
  );
}

/**
 * Route a request and execute it with streaming.
 * Automatically handles fallback on failure.
 */
export async function routeAndStream(
  request: RouteRequest
): Promise<{ result: StreamCompletionResult; route: ResolvedRoute }> {
  const estimatedTokens = estimateMessageTokens(request.messages);
  const { slot, slotConfig, chain } = resolveChain(request, estimatedTokens);

  let lastError: Error | null = null;

  for (let i = 0; i < chain.length; i++) {
    const modelKey = chain[i] as string;
    const config = isModelEligible(modelKey, estimatedTokens, true);
    if (!config) {
      continue;
    }

    const route: ResolvedRoute = {
      modelKey,
      slot,
      fallbackPosition: i,
      temperature: request.temperature ?? slotConfig.defaultTemperature,
      stream: true,
      estimatedInputTokens: estimatedTokens,
    };

    try {
      const provider = getProvider(config.provider);
      const result = await provider.stream({
        model: config.id,
        messages: request.messages,
        temperature: route.temperature,
        maxTokens: request.maxTokens ?? config.maxOutputTokens ?? undefined,
      });

      reportSuccess(config.provider);

      result.done
        .then((done) => {
          recordRequest(modelKey, done.usage.totalTokens);
        })
        .catch(() => {
          reportFailure(config.provider);
        });

      return { result, route };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      reportFailure(config.provider);
    }
  }

  throw new Error(
    `All models exhausted for streaming slot "${slot}". Last error: ${lastError?.message ?? "unknown"}`
  );
}

// ---------------------------------------------------------------------------
// Health Check Utilities
// ---------------------------------------------------------------------------

/**
 * Run health checks on all providers (or a subset).
 * Updates the health map based on results.
 */
export async function runHealthChecks(
  providers?: ModelProvider[]
): Promise<Record<ModelProvider, boolean>> {
  const targets: ModelProvider[] = providers ?? [
    "ollama",
    "cerebras",
    "groq",
    "gemini",
    "deepseek",
    "anthropic",
    "openai",
    "openrouter",
    "mistral",
  ];

  // Pick one model per provider for the health check
  const providerTestModels: Partial<Record<ModelProvider, string>> = {};
  for (const [_key, config] of Object.entries(MODEL_REGISTRY)) {
    if (!providerTestModels[config.provider]) {
      providerTestModels[config.provider] = config.id;
    }
  }

  const results: Record<string, boolean> = {};

  const checks = targets.map(async (provider) => {
    const model = providerTestModels[provider];
    if (!model) {
      results[provider] = false;
      return;
    }

    try {
      const p = getProvider(provider);
      const ok = await p.healthCheck(model, 10_000);
      if (ok) {
        reportSuccess(provider);
      } else {
        reportFailure(provider);
      }
      results[provider] = ok;
    } catch {
      reportFailure(provider);
      results[provider] = false;
    }
  });

  await Promise.allSettled(checks);
  return results as Record<ModelProvider, boolean>;
}

/**
 * Reset all health and rate limit state (useful for tests).
 */
export function resetRoutingState(): void {
  healthMap.clear();
  rateLimitMap.clear();
  providerCache.clear();
}
