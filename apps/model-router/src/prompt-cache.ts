import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:prompt-cache");

// ─── Types ────────────────────────────────────────────────────────────

interface CacheEntry {
  hitCount: number;
  lastUsedAt: number;
  promptHash: string;
  provider: string;
}

interface CacheStats {
  cacheHits: number;
  hitRate: number;
  provider: string;
  totalRequests: number;
}

/**
 * Minimum system prompt lengths required for caching by provider.
 * Anthropic requires at least 1024 tokens (~4096 chars) for prompt caching.
 * OpenAI requires at least 1024 tokens for their caching feature.
 */
const PROVIDER_CACHE_MIN_CHARS: Record<string, number> = {
  anthropic: 4096,
  openai: 4096,
  gemini: 2048,
};

/**
 * Supported providers for prompt caching.
 */
const CACHEABLE_PROVIDERS = new Set(["anthropic", "openai", "gemini"]);

// ─── Hashing ──────────────────────────────────────────────────────────

/**
 * Simple hash for identifying repeated system prompts.
 * Uses a DJB2-style hash for speed.
 */
function hashPrompt(prompt: string): string {
  let hash = 5381;
  for (let i = 0; i < prompt.length; i++) {
    // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash requires bitwise ops
    hash = ((hash << 5) + hash + prompt.charCodeAt(i)) | 0;
  }
  // biome-ignore lint/suspicious/noBitwiseOperators: FNV-1a hash requires bitwise ops
  return `prompt_${(hash >>> 0).toString(36)}`;
}

// ─── PromptCacheManager ──────────────────────────────────────────────

/**
 * Manages prompt caching for repeated system prompts across LLM providers.
 *
 * Detects frequently-used system prompts and returns appropriate cache
 * control headers for Anthropic (prompt caching) and OpenAI (prompt
 * caching beta), enabling significant cost and latency savings.
 */
export class PromptCacheManager {
  private readonly entries: Map<string, CacheEntry> = new Map();
  private readonly providerStats: Map<
    string,
    { totalRequests: number; cacheHits: number }
  > = new Map();

  /** Maximum number of cached prompt entries before eviction */
  private readonly maxEntries: number;
  /** Minimum number of times a prompt must be seen before caching is enabled */
  private readonly minHitsForCache: number;

  constructor(options?: { maxEntries?: number; minHitsForCache?: number }) {
    this.maxEntries = options?.maxEntries ?? 500;
    this.minHitsForCache = options?.minHitsForCache ?? 2;
  }

  /**
   * Check if a system prompt meets the minimum length for caching
   * with the specified provider.
   */
  isSystemPromptCacheable(prompt: string, provider: string): boolean {
    if (!CACHEABLE_PROVIDERS.has(provider)) {
      return false;
    }

    const minChars = PROVIDER_CACHE_MIN_CHARS[provider] ?? 4096;
    return prompt.length >= minChars;
  }

  /**
   * Get cache control headers for a request based on the system prompt
   * and provider. Returns an empty object if caching is not applicable.
   *
   * For Anthropic: adds `anthropic-beta: prompt-caching-2024-07-31` header
   * and marks the system prompt with cache_control.
   *
   * For OpenAI: prompt caching is automatic for prompts >= 1024 tokens,
   * but we track it for metrics.
   */
  getCacheHeaders(
    provider: string,
    systemPrompt: string
  ): Record<string, string> {
    if (!this.isSystemPromptCacheable(systemPrompt, provider)) {
      return {};
    }

    const promptHash = hashPrompt(systemPrompt);
    this.trackPromptUsage(promptHash, provider);

    // Get or initialize provider stats
    const stats = this.getOrInitStats(provider);
    stats.totalRequests++;

    const entry = this.entries.get(promptHash);
    const isCacheHit =
      entry !== undefined && entry.hitCount >= this.minHitsForCache;

    if (isCacheHit) {
      stats.cacheHits++;
    }

    // Return provider-specific headers
    if (provider === "anthropic" && isCacheHit) {
      logger.debug(
        { provider, promptHash, hitCount: entry?.hitCount },
        "Enabling Anthropic prompt caching"
      );
      return {
        "anthropic-beta": "prompt-caching-2024-07-31",
      };
    }

    if (provider === "openai" && isCacheHit) {
      logger.debug(
        { provider, promptHash, hitCount: entry?.hitCount },
        "OpenAI prompt caching eligible (automatic)"
      );
      // OpenAI handles caching automatically; we just track it
      return {};
    }

    if (provider === "gemini" && isCacheHit) {
      logger.debug(
        { provider, promptHash, hitCount: entry?.hitCount },
        "Enabling Gemini context caching"
      );
      return {
        "x-goog-cache-control": "prompt-cache",
      };
    }

    return {};
  }

  /**
   * Get cache hit rates for each provider.
   */
  getCacheHitRates(): CacheStats[] {
    const results: CacheStats[] = [];

    for (const [provider, stats] of this.providerStats) {
      results.push({
        provider,
        totalRequests: stats.totalRequests,
        cacheHits: stats.cacheHits,
        hitRate:
          stats.totalRequests > 0 ? stats.cacheHits / stats.totalRequests : 0,
      });
    }

    return results;
  }

  /**
   * Get the Anthropic cache_control block to inject into the system
   * message when prompt caching is active for a given prompt.
   * Returns null if caching should not be applied.
   */
  getAnthropicCacheControl(systemPrompt: string): { type: "ephemeral" } | null {
    if (!this.isSystemPromptCacheable(systemPrompt, "anthropic")) {
      return null;
    }

    const promptHash = hashPrompt(systemPrompt);
    const entry = this.entries.get(promptHash);

    if (entry && entry.hitCount >= this.minHitsForCache) {
      return { type: "ephemeral" };
    }

    return null;
  }

  /**
   * Reset all tracking data.
   */
  reset(): void {
    this.entries.clear();
    this.providerStats.clear();
    logger.info("Prompt cache manager reset");
  }

  // ─── Private Helpers ─────────────────────────────────────────────

  private trackPromptUsage(promptHash: string, provider: string): void {
    const existing = this.entries.get(promptHash);

    if (existing) {
      existing.hitCount++;
      existing.lastUsedAt = Date.now();
      return;
    }

    // Evict oldest entries if at capacity
    if (this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.entries.set(promptHash, {
      promptHash,
      provider,
      hitCount: 1,
      lastUsedAt: Date.now(),
    });
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.entries) {
      if (entry.lastUsedAt < oldestTime) {
        oldestTime = entry.lastUsedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.entries.delete(oldestKey);
    }
  }

  private getOrInitStats(provider: string): {
    totalRequests: number;
    cacheHits: number;
  } {
    let stats = this.providerStats.get(provider);
    if (!stats) {
      stats = { totalRequests: 0, cacheHits: 0 };
      this.providerStats.set(provider, stats);
    }
    return stats;
  }
}
