import crypto from "node:crypto";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import type IORedis from "ioredis";

const logger = createLogger("model-router:cache");

/** Per-slot TTL configuration in seconds */
const SLOT_TTL: Record<string, number> = {
  review: 3600, // 1 hour — review results are stable
  think: 1800, // 30 minutes — reasoning can be reused
  longContext: 1800, // 30 minutes
  default: 300, // 5 minutes
  fastLoop: 120, // 2 minutes — CI iterations change fast
  background: 600, // 10 minutes
  vision: 300, // 5 minutes
  premium: 600, // 10 minutes
};

/**
 * ResponseCache provides Redis-backed LLM response caching keyed by
 * a SHA-256 hash of the request payload. Streaming requests are NOT cached.
 *
 * Shares cache across model-router instances via Redis GET/SET with EX TTL.
 * Falls back to in-memory Map if Redis is unavailable.
 */
export class ResponseCache {
  private redis: IORedis | null = null;
  private readonly fallbackCache = new Map<
    string,
    { response: unknown; cachedAt: number; ttlMs: number }
  >();
  private readonly maxFallbackEntries: number;
  private readonly keyPrefix = "prometheus:cache:llm:";

  constructor(maxFallbackEntries = 500) {
    this.maxFallbackEntries = maxFallbackEntries;
    try {
      this.redis = createRedisConnection();
    } catch (err) {
      logger.warn(
        { err },
        "Redis unavailable for cache, using in-memory fallback"
      );
    }
  }

  /**
   * Generate a cache key from the request parameters.
   */
  private generateKey(
    slot: string,
    messages: Array<{ role: string; content: string }>,
    tools?: unknown[]
  ): string {
    const payload = JSON.stringify({ slot, messages, tools: tools ?? null });
    return crypto.createHash("sha256").update(payload).digest("hex");
  }

  /**
   * Look up a cached response. Returns null on cache miss or expiry.
   */
  async get(
    slot: string,
    messages: Array<{ role: string; content: string }>,
    tools?: unknown[]
  ): Promise<unknown | null> {
    const key = this.generateKey(slot, messages, tools);

    if (this.redis) {
      try {
        const cached = await this.redis.get(`${this.keyPrefix}${key}`);
        if (cached) {
          logger.debug({ slot }, "Cache hit (Redis)");
          return JSON.parse(cached);
        }
        return null;
      } catch (err) {
        logger.warn({ err }, "Redis cache get failed, trying fallback");
      }
    }

    // Fallback to in-memory
    const entry = this.fallbackCache.get(key);
    if (!entry) {
      return null;
    }
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.fallbackCache.delete(key);
      return null;
    }
    logger.debug({ slot }, "Cache hit (in-memory fallback)");
    return entry.response;
  }

  /**
   * Store a response in the cache.
   */
  async set(
    slot: string,
    messages: Array<{ role: string; content: string }>,
    tools: unknown[] | undefined,
    response: unknown
  ): Promise<void> {
    const key = this.generateKey(slot, messages, tools);
    const ttlSeconds = SLOT_TTL[slot] ?? SLOT_TTL.default ?? 300;

    if (this.redis) {
      try {
        await this.redis.set(
          `${this.keyPrefix}${key}`,
          JSON.stringify(response),
          "EX",
          ttlSeconds
        );
        logger.debug({ slot, ttlSeconds }, "Cache set (Redis)");
        return;
      } catch (err) {
        logger.warn({ err }, "Redis cache set failed, using fallback");
      }
    }

    // Fallback to in-memory
    if (this.fallbackCache.size >= this.maxFallbackEntries) {
      // Evict oldest 10%
      const entries = Array.from(this.fallbackCache.entries()).sort(
        (a, b) => a[1].cachedAt - b[1].cachedAt
      );
      const toEvict = Math.max(1, Math.floor(entries.length * 0.1));
      for (let i = 0; i < toEvict; i++) {
        const entry = entries[i];
        if (entry) {
          this.fallbackCache.delete(entry[0]);
        }
      }
    }

    this.fallbackCache.set(key, {
      response,
      cachedAt: Date.now(),
      ttlMs: ttlSeconds * 1000,
    });
    logger.debug({ slot, ttlSeconds }, "Cache set (in-memory fallback)");
  }

  /** Get cache statistics */
  getStats(): {
    fallbackSize: number;
    maxFallbackEntries: number;
    redisConnected: boolean;
  } {
    return {
      fallbackSize: this.fallbackCache.size,
      maxFallbackEntries: this.maxFallbackEntries,
      redisConnected: this.redis !== null,
    };
  }

  /** Shutdown Redis connection */
  destroy(): void {
    if (this.redis) {
      this.redis.disconnect();
      this.redis = null;
    }
    this.fallbackCache.clear();
  }
}
