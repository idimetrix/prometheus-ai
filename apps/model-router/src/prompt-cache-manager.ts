/**
 * GAP-095: Prompt Caching Manager
 *
 * Caches prompt prefixes (system prompts, project context) to reduce
 * LLM costs and latency. Tracks cache hit rate and cost savings,
 * invalidates on context changes, and reports caching effectiveness.
 */

import { createLogger } from "@prometheus/logger";

const logger = createLogger("model-router:prompt-cache-manager");

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CachedPrefix {
  createdAt: number;
  estimatedTokens: number;
  hash: string;
  hitCount: number;
  id: string;
  lastAccessedAt: number;
  prefix: string;
  provider: string;
}

export interface CacheEffectivenessReport {
  activeEntries: number;
  cacheHits: number;
  estimatedLatencySavedMs: number;
  estimatedSavingsUsd: number;
  hitRate: number;
  topPrefixes: Array<{ hash: string; hitCount: number; provider: string }>;
  totalRequests: number;
}

export interface PromptCacheConfig {
  /** Estimated cost savings per cached token (USD) */
  costSavingsPerToken: number;
  /** Estimated latency savings per cached request (ms) */
  latencySavingsPerHitMs: number;
  /** Maximum cached prefixes (default: 200) */
  maxEntries: number;
  /** Minimum prefix length in chars to cache (default: 1000) */
  minPrefixLength: number;
  /** Cache TTL in ms (default: 1 hour) */
  ttlMs: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: PromptCacheConfig = {
  maxEntries: 200,
  minPrefixLength: 1000,
  ttlMs: 3_600_000,
  costSavingsPerToken: 0.000_001_5,
  latencySavingsPerHitMs: 200,
};

const CHARS_PER_TOKEN = 4;

// ─── Hashing ─────────────────────────────────────────────────────────────────

function hashPrefix(prefix: string): string {
  let hash = 5381;
  for (let i = 0; i < prefix.length; i++) {
    hash = ((hash << 5) + hash + prefix.charCodeAt(i)) | 0;
  }
  return `pcache_${(hash >>> 0).toString(36)}`;
}

// ─── Prompt Cache Manager ─────────────────────────────────────────────────────

export class PromptCacheManagerV2 {
  private readonly entries = new Map<string, CachedPrefix>();
  private readonly config: PromptCacheConfig;
  private totalRequests = 0;
  private totalHits = 0;
  private totalSavingsUsd = 0;

  constructor(config?: Partial<PromptCacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if a prompt prefix is cached. If so, returns the cache entry
   * and increments hit count. If not, caches it for future use.
   */
  lookup(
    prefix: string,
    provider: string
  ): { cached: boolean; entry: CachedPrefix } {
    this.totalRequests++;
    const hash = hashPrefix(prefix);
    const existing = this.entries.get(hash);

    if (existing && Date.now() - existing.createdAt < this.config.ttlMs) {
      // Cache hit
      existing.hitCount++;
      existing.lastAccessedAt = Date.now();
      this.totalHits++;

      const tokensSaved = existing.estimatedTokens;
      this.totalSavingsUsd += tokensSaved * this.config.costSavingsPerToken;

      logger.debug(
        { hash, provider, hitCount: existing.hitCount },
        "Prompt cache hit"
      );

      return { cached: true, entry: existing };
    }

    // Cache miss - store prefix if long enough
    if (prefix.length >= this.config.minPrefixLength) {
      this.evictIfNeeded();

      const entry: CachedPrefix = {
        id: hash,
        prefix: prefix.slice(0, 500), // Store summary only
        hash,
        provider,
        hitCount: 0,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        estimatedTokens: Math.ceil(prefix.length / CHARS_PER_TOKEN),
      };

      this.entries.set(hash, entry);

      logger.debug(
        { hash, provider, estimatedTokens: entry.estimatedTokens },
        "Prompt prefix cached"
      );

      return { cached: false, entry };
    }

    // Too short to cache
    return {
      cached: false,
      entry: {
        id: hash,
        prefix: "",
        hash,
        provider,
        hitCount: 0,
        createdAt: Date.now(),
        lastAccessedAt: Date.now(),
        estimatedTokens: 0,
      },
    };
  }

  /**
   * Invalidate a cached prefix (e.g., when project context changes).
   */
  invalidate(prefix: string): boolean {
    const hash = hashPrefix(prefix);
    const deleted = this.entries.delete(hash);
    if (deleted) {
      logger.info({ hash }, "Prompt cache entry invalidated");
    }
    return deleted;
  }

  /**
   * Invalidate all entries for a provider.
   */
  invalidateByProvider(provider: string): number {
    let count = 0;
    for (const [key, entry] of this.entries) {
      if (entry.provider === provider) {
        this.entries.delete(key);
        count++;
      }
    }
    if (count > 0) {
      logger.info({ provider, count }, "Provider cache entries invalidated");
    }
    return count;
  }

  /**
   * Get a report on cache effectiveness.
   */
  getEffectivenessReport(): CacheEffectivenessReport {
    const topPrefixes = [...this.entries.values()]
      .sort((a, b) => b.hitCount - a.hitCount)
      .slice(0, 10)
      .map((e) => ({
        hash: e.hash,
        hitCount: e.hitCount,
        provider: e.provider,
      }));

    return {
      totalRequests: this.totalRequests,
      cacheHits: this.totalHits,
      hitRate: this.totalRequests > 0 ? this.totalHits / this.totalRequests : 0,
      estimatedSavingsUsd: this.totalSavingsUsd,
      estimatedLatencySavedMs:
        this.totalHits * this.config.latencySavingsPerHitMs,
      activeEntries: this.entries.size,
      topPrefixes,
    };
  }

  /**
   * Reset all cache state.
   */
  reset(): void {
    this.entries.clear();
    this.totalRequests = 0;
    this.totalHits = 0;
    this.totalSavingsUsd = 0;
    logger.info("Prompt cache manager reset");
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private evictIfNeeded(): void {
    if (this.entries.size < this.config.maxEntries) {
      return;
    }

    // Evict least recently accessed
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;

    for (const [key, entry] of this.entries) {
      if (entry.lastAccessedAt < oldestTime) {
        oldestTime = entry.lastAccessedAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.entries.delete(oldestKey);
    }
  }
}
