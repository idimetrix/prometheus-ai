import crypto from "node:crypto";
import { createLogger } from "@prometheus/logger";

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

interface CachedResponse {
  cachedAt: number;
  hits: number;
  response: unknown;
  ttlMs: number;
}

/**
 * ResponseCache provides in-memory LLM response caching keyed by
 * a SHA-256 hash of the request payload. Streaming requests are NOT cached.
 *
 * Uses an in-memory Map with TTL eviction. For production, this could
 * be backed by Redis for cross-instance sharing.
 */
export class ResponseCache {
  private readonly cache = new Map<string, CachedResponse>();
  private readonly maxEntries: number;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(maxEntries = 500) {
    this.maxEntries = maxEntries;
    // Periodic cleanup of expired entries
    this.cleanupInterval = setInterval(() => this.evictExpired(), 60_000);
  }

  /**
   * Generate a cache key from the request parameters.
   * Only the slot, messages content, and tool definitions affect the key.
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
  get(
    slot: string,
    messages: Array<{ role: string; content: string }>,
    tools?: unknown[]
  ): unknown | null {
    const key = this.generateKey(slot, messages, tools);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.cachedAt > entry.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    entry.hits++;
    logger.debug({ slot, hits: entry.hits }, "Cache hit");
    return entry.response;
  }

  /**
   * Store a response in the cache.
   */
  set(
    slot: string,
    messages: Array<{ role: string; content: string }>,
    tools: unknown[] | undefined,
    response: unknown
  ): void {
    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    const key = this.generateKey(slot, messages, tools);
    const ttlSeconds = SLOT_TTL[slot] ?? SLOT_TTL.default ?? 300;

    this.cache.set(key, {
      response,
      cachedAt: Date.now(),
      ttlMs: ttlSeconds * 1000,
      hits: 0,
    });

    logger.debug({ slot, ttlSeconds, cacheSize: this.cache.size }, "Cache set");
  }

  /** Remove all expired entries */
  private evictExpired(): void {
    const now = Date.now();
    let evicted = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.cachedAt > entry.ttlMs) {
        this.cache.delete(key);
        evicted++;
      }
    }
    if (evicted > 0) {
      logger.debug({ evicted, remaining: this.cache.size }, "Cache cleanup");
    }
  }

  /** Evict the oldest 10% of entries when at capacity */
  private evictOldest(): void {
    const entries = Array.from(this.cache.entries()).sort(
      (a, b) => a[1].cachedAt - b[1].cachedAt
    );
    const toEvict = Math.max(1, Math.floor(entries.length * 0.1));
    for (let i = 0; i < toEvict; i++) {
      const entry = entries[i];
      if (entry) {
        this.cache.delete(entry[0]);
      }
    }
  }

  /** Get cache statistics */
  getStats(): { size: number; maxEntries: number } {
    return { size: this.cache.size, maxEntries: this.maxEntries };
  }

  /** Shutdown cleanup interval */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}
