// =============================================================================
// @prometheus/ai — LLM Client Factory
// =============================================================================
// Creates OpenAI-compatible clients for all 9 providers.
// =============================================================================

import OpenAI from "openai";
import type { ModelProvider } from "./models";
import { PROVIDER_ENDPOINTS, PROVIDER_ENV_KEYS } from "./models";

export interface LLMClientOptions {
  apiKey?: string;
  baseURL?: string;
  /** Max retries on transient errors (default: 2) */
  maxRetries?: number;
  provider: ModelProvider;
  /** Request timeout in milliseconds (default: 60_000) */
  timeout?: number;
}

/**
 * Map of cached clients keyed by "provider:baseURL"
 */
const clientCache = new Map<string, OpenAI>();

/**
 * Create (or retrieve cached) an OpenAI-compatible client for any provider.
 *
 * All 9 providers expose OpenAI-compatible APIs, so we use the OpenAI SDK
 * uniformly. Provider-specific headers are injected as needed.
 */
export function createLLMClient(options: LLMClientOptions): OpenAI {
  const baseURL = options.baseURL ?? PROVIDER_ENDPOINTS[options.provider];
  if (!baseURL) {
    throw new Error(`Unknown provider: ${options.provider}`);
  }

  const cacheKey = `${options.provider}:${baseURL}`;
  const cached = clientCache.get(cacheKey);
  if (cached && !options.apiKey) {
    return cached;
  }

  const apiKey = options.apiKey ?? getProviderKey(options.provider);

  const defaultHeaders: Record<string, string> = {};

  // OpenRouter requires extra headers
  if (options.provider === "openrouter") {
    defaultHeaders["HTTP-Referer"] = "https://prometheus.dev";
    defaultHeaders["X-Title"] = "Prometheus";
  }

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout: options.timeout ?? 60_000,
    maxRetries: options.maxRetries ?? 2,
    defaultHeaders:
      Object.keys(defaultHeaders).length > 0 ? defaultHeaders : undefined,
  });

  if (!options.apiKey) {
    clientCache.set(cacheKey, client);
  }

  return client;
}

/**
 * Retrieve the API key for a provider from environment variables.
 * Ollama does not require a key and defaults to "ollama".
 */
function getProviderKey(provider: ModelProvider): string {
  if (provider === "ollama") {
    return "ollama";
  }

  const envVar = PROVIDER_ENV_KEYS[provider];
  const key = process.env[envVar];
  if (!key) {
    throw new Error(
      `Missing API key for provider "${provider}": set ${envVar} in your environment`
    );
  }
  return key;
}

/**
 * Clear the client cache (useful for tests).
 */
export function clearClientCache(): void {
  clientCache.clear();
}
