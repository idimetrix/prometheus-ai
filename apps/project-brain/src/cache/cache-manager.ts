/**
 * Phase 15.1: Three-tier cache manager.
 * L1: In-process LRU (1000 items, 5min TTL)
 * L2: Redis (15min TTL)
 * L3: PostgreSQL (source of truth)
 *
 * Caches: embeddings, graph traversals, convention prompts, symbol search
 */
import { createLogger } from "@prometheus/logger";

const logger = createLogger("project-brain:cache");

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

const L1_MAX_SIZE = 1000;
const L1_TTL_MS = 5 * 60 * 1000; // 5 minutes
const L2_TTL_SECONDS = 15 * 60; // 15 minutes

export class CacheManager {
  private readonly l1 = new Map<string, CacheEntry<unknown>>();
  private readonly redis: {
    get: (key: string) => Promise<string | null>;
    set: (
      key: string,
      value: string,
      mode: string,
      ttl: number
    ) => Promise<void>;
    del: (key: string) => Promise<void>;
  } | null;

  constructor(redis?: {
    get: (key: string) => Promise<string | null>;
    set: (
      key: string,
      value: string,
      mode: string,
      ttl: number
    ) => Promise<void>;
    del: (key: string) => Promise<void>;
  }) {
    this.redis = redis ?? null;
  }

  /**
   * Get a value from the cache hierarchy.
   * Checks L1 → L2 → returns null if not found.
   */
  async get<T>(key: string): Promise<T | null> {
    // L1: In-process LRU
    const l1Entry = this.l1.get(key) as CacheEntry<T> | undefined;
    if (l1Entry) {
      if (Date.now() < l1Entry.expiresAt) {
        return l1Entry.value;
      }
      this.l1.delete(key);
    }

    // L2: Redis
    if (this.redis) {
      try {
        const l2Value = await this.redis.get(`cache:${key}`);
        if (l2Value) {
          const parsed = JSON.parse(l2Value) as T;
          // Promote to L1
          this.setL1(key, parsed);
          return parsed;
        }
      } catch (err) {
        logger.debug({ key, error: err }, "Redis cache read failed");
      }
    }

    return null;
  }

  /**
   * Set a value in all cache tiers.
   */
  async set<T>(key: string, value: T): Promise<void> {
    // L1
    this.setL1(key, value);

    // L2: Redis
    if (this.redis) {
      try {
        await this.redis.set(
          `cache:${key}`,
          JSON.stringify(value),
          "EX",
          L2_TTL_SECONDS
        );
      } catch (err) {
        logger.debug({ key, error: err }, "Redis cache write failed");
      }
    }
  }

  /**
   * Get from cache or compute and cache the result.
   */
  async getOrCompute<T>(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await compute();
    await this.set(key, value);
    return value;
  }

  /**
   * Invalidate a key from all tiers.
   */
  async invalidate(key: string): Promise<void> {
    this.l1.delete(key);
    if (this.redis) {
      await this.redis.del(`cache:${key}`).catch(() => {
        // Best-effort cache invalidation
      });
    }
  }

  /**
   * Invalidate all keys matching a prefix.
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this.l1.keys()) {
      if (key.startsWith(prefix)) {
        this.l1.delete(key);
      }
    }
  }

  /**
   * Get L1 cache stats.
   */
  getStats(): { l1Size: number; l1MaxSize: number } {
    return { l1Size: this.l1.size, l1MaxSize: L1_MAX_SIZE };
  }

  private setL1<T>(key: string, value: T): void {
    // Evict oldest if at capacity
    if (this.l1.size >= L1_MAX_SIZE) {
      const firstKey = this.l1.keys().next().value;
      if (firstKey !== undefined) {
        this.l1.delete(firstKey);
      }
    }

    this.l1.set(key, {
      value,
      expiresAt: Date.now() + L1_TTL_MS,
    });
  }
}
