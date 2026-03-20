import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import type IORedis from "ioredis";

const logger = createLogger("model-router:prompt-cache");

// ─── Types ────────────────────────────────────────────────────────────

interface CacheEntry {
  fingerprint: Set<string>;
  hitCount: number;
  lastUsedAt: number;
  prompt: string;
  promptHash: string;
  provider: string;
}

interface CacheStats {
  cacheHits: number;
  cacheSavingsUsd: number;
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

/** Estimated cost per cached token read (avg across providers) in USD */
const CACHE_COST_SAVINGS_PER_TOKEN = 0.000_001_5; // ~$1.50/M tokens saved
/** Approximate chars per token for savings estimation */
const CHARS_PER_TOKEN = 4;

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

// ─── N-gram Fingerprinting ──────────────────────────────────────────

/**
 * Generate a set of character-level trigrams from a prompt.
 * Used for approximate similarity matching when exact hash misses.
 */
function createTrigramFingerprint(prompt: string): Set<string> {
  const normalized = prompt.toLowerCase().replace(/\s+/g, " ").trim();
  const trigrams = new Set<string>();
  for (let i = 0; i <= normalized.length - 3; i++) {
    trigrams.add(normalized.slice(i, i + 3));
  }
  return trigrams;
}

/**
 * Compute Jaccard similarity between two fingerprint sets.
 * Returns a value between 0 (no overlap) and 1 (identical).
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  let intersection = 0;
  for (const trigram of a) {
    if (b.has(trigram)) {
      intersection++;
    }
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ─── PromptCacheManager ──────────────────────────────────────────────

/**
 * Manages prompt caching for repeated system prompts across LLM providers.
 *
 * Detects frequently-used system prompts and returns appropriate cache
 * control headers for Anthropic (prompt caching) and OpenAI (prompt
 * caching beta), enabling significant cost and latency savings.
 */
/** Serializable subset of CacheEntry for Redis storage (no Set) */
interface RedisCacheEntry {
  hitCount: number;
  lastUsedAt: number;
  promptHash: string;
  provider: string;
}

export class PromptCacheManager {
  private readonly entries: Map<string, CacheEntry> = new Map();
  private readonly providerStats: Map<
    string,
    { totalRequests: number; cacheHits: number; savingsUsd: number }
  > = new Map();

  /** Maximum number of cached prompt entries before eviction */
  private readonly maxEntries: number;
  /** Minimum number of times a prompt must be seen before caching is enabled */
  private readonly minHitsForCache: number;
  /** Similarity threshold for fingerprint matching (>95%) */
  private readonly similarityThreshold: number;

  /** Redis L2 cache connection */
  private redis: IORedis | null = null;
  private readonly redisKeyPrefix = "prompt-cache:";
  private readonly redisTtlSeconds = 3600; // 1 hour TTL for Redis entries

  constructor(options?: {
    maxEntries?: number;
    minHitsForCache?: number;
    similarityThreshold?: number;
    enableRedis?: boolean;
  }) {
    this.maxEntries = options?.maxEntries ?? 500;
    this.minHitsForCache = options?.minHitsForCache ?? 2;
    this.similarityThreshold = options?.similarityThreshold ?? 0.95;

    if (options?.enableRedis !== false) {
      try {
        this.redis = createRedisConnection();
        this.redis.on("error", (err) => {
          logger.warn({ err: String(err) }, "Redis L2 cache connection error");
          this.redis = null;
        });
      } catch {
        logger.debug("Redis L2 cache not available, using in-memory only");
      }
    }
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
    this.trackPromptUsage(promptHash, provider, systemPrompt);

    // Get or initialize provider stats
    const stats = this.getOrInitStats(provider);
    stats.totalRequests++;

    // Try exact hash match first, then fall back to fingerprint similarity
    let entry = this.entries.get(promptHash);
    if (!entry) {
      entry = this.findSimilarEntry(systemPrompt, provider) ?? undefined;
      if (entry) {
        logger.debug(
          { provider, originalHash: promptHash, matchedHash: entry.promptHash },
          "Matched prompt via n-gram fingerprint similarity"
        );
      }
    }
    const isCacheHit =
      entry !== undefined && entry.hitCount >= this.minHitsForCache;

    if (isCacheHit) {
      stats.cacheHits++;
      // Track estimated savings from prompt caching
      const estimatedTokens = Math.ceil(systemPrompt.length / CHARS_PER_TOKEN);
      stats.savingsUsd += estimatedTokens * CACHE_COST_SAVINGS_PER_TOKEN;
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
        cacheSavingsUsd: stats.savingsUsd,
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
   * Perform an embedding-based similarity lookup on cached prompts.
   * Returns a cached response/entry if a semantically similar prompt
   * was previously cached above the given similarity threshold.
   *
   * Uses trigram fingerprinting as a lightweight embedding approximation.
   * For production, this could be replaced with actual vector embeddings.
   */
  semanticLookup(
    prompt: string,
    similarityThreshold = 0.85
  ): { entry: CacheEntry; similarity: number } | null {
    const fingerprint = createTrigramFingerprint(prompt);
    let bestMatch: CacheEntry | null = null;
    let bestSimilarity = 0;

    for (const entry of this.entries.values()) {
      const similarity = jaccardSimilarity(fingerprint, entry.fingerprint);
      if (similarity >= similarityThreshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    if (bestMatch) {
      // Track the semantic cache hit
      const stats = this.getOrInitStats(bestMatch.provider);
      stats.cacheHits++;

      const estimatedTokens = Math.ceil(prompt.length / CHARS_PER_TOKEN);
      stats.savingsUsd += estimatedTokens * CACHE_COST_SAVINGS_PER_TOKEN;

      logger.info(
        {
          similarity: bestSimilarity.toFixed(4),
          matchedHash: bestMatch.promptHash,
          provider: bestMatch.provider,
        },
        "Semantic cache hit via fingerprint similarity"
      );

      return { entry: bestMatch, similarity: bestSimilarity };
    }

    return null;
  }

  /**
   * Get comprehensive cache metrics including semantic hit rates.
   */
  getMetrics(): {
    entryCount: number;
    hitRates: CacheStats[];
    totalHits: number;
    totalRequests: number;
  } {
    const hitRates = this.getCacheHitRates();
    let totalHits = 0;
    let totalRequests = 0;

    for (const rate of hitRates) {
      totalHits += rate.cacheHits;
      totalRequests += rate.totalRequests;
    }

    return {
      entryCount: this.entries.size,
      hitRates,
      totalHits,
      totalRequests,
    };
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

  private trackPromptUsage(
    promptHash: string,
    provider: string,
    prompt: string
  ): void {
    const existing = this.entries.get(promptHash);

    if (existing) {
      existing.hitCount++;
      existing.lastUsedAt = Date.now();
      this.writeToRedis(promptHash, existing);
      return;
    }

    // Try to hydrate from Redis L2 cache
    this.readFromRedis(promptHash)
      .then((redisEntry) => {
        if (redisEntry && !this.entries.has(promptHash)) {
          this.entries.set(promptHash, {
            promptHash: redisEntry.promptHash,
            provider: redisEntry.provider,
            prompt,
            fingerprint: createTrigramFingerprint(prompt),
            hitCount: redisEntry.hitCount + 1,
            lastUsedAt: Date.now(),
          });
          this.writeToRedis(
            promptHash,
            this.entries.get(promptHash) as CacheEntry
          );
        }
      })
      .catch(() => {
        /* Redis read failed, ignore */
      });

    // Evict oldest entries if at capacity
    if (this.entries.size >= this.maxEntries) {
      this.evictOldest();
    }

    const newEntry: CacheEntry = {
      promptHash,
      provider,
      prompt,
      fingerprint: createTrigramFingerprint(prompt),
      hitCount: 1,
      lastUsedAt: Date.now(),
    };

    this.entries.set(promptHash, newEntry);
    this.writeToRedis(promptHash, newEntry);
  }

  /** Write-through to Redis L2 cache */
  private writeToRedis(promptHash: string, entry: CacheEntry): void {
    if (!this.redis) {
      return;
    }
    const redisEntry: RedisCacheEntry = {
      promptHash: entry.promptHash,
      provider: entry.provider,
      hitCount: entry.hitCount,
      lastUsedAt: entry.lastUsedAt,
    };
    const key = `${this.redisKeyPrefix}${promptHash}`;
    this.redis
      .set(key, JSON.stringify(redisEntry), "EX", this.redisTtlSeconds)
      .catch((err) => {
        logger.debug({ err: String(err), promptHash }, "Redis L2 write failed");
      });
  }

  /** Read from Redis L2 cache */
  private async readFromRedis(
    promptHash: string
  ): Promise<RedisCacheEntry | null> {
    if (!this.redis) {
      return null;
    }
    try {
      const key = `${this.redisKeyPrefix}${promptHash}`;
      const data = await this.redis.get(key);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as RedisCacheEntry;
    } catch {
      return null;
    }
  }

  /**
   * Search for a cached entry with >95% trigram similarity to the given prompt.
   * Used as fallback when exact hash match misses (e.g., minor whitespace or
   * punctuation differences between otherwise identical prompts).
   */
  private findSimilarEntry(
    prompt: string,
    provider: string
  ): CacheEntry | null {
    const fingerprint = createTrigramFingerprint(prompt);
    let bestMatch: CacheEntry | null = null;
    let bestSimilarity = 0;

    for (const entry of this.entries.values()) {
      if (entry.provider !== provider) {
        continue;
      }
      const similarity = jaccardSimilarity(fingerprint, entry.fingerprint);
      if (
        similarity >= this.similarityThreshold &&
        similarity > bestSimilarity
      ) {
        bestSimilarity = similarity;
        bestMatch = entry;
      }
    }

    if (bestMatch) {
      logger.debug(
        {
          similarity: bestSimilarity.toFixed(4),
          matchedHash: bestMatch.promptHash,
        },
        "Found similar cached prompt via fingerprint"
      );
    }

    return bestMatch;
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
    savingsUsd: number;
  } {
    let stats = this.providerStats.get(provider);
    if (!stats) {
      stats = { totalRequests: 0, cacheHits: 0, savingsUsd: 0 };
      this.providerStats.set(provider, stats);
    }
    return stats;
  }
}
