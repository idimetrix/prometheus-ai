import { createLogger } from "@prometheus/logger";

const logger = createLogger("db:cache");

interface CacheOptions {
  prefix?: string;
  tags?: string[];
  ttlSeconds?: number;
}

interface RedisLike {
  del: (...args: string[]) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  sadd: (key: string, ...members: string[]) => Promise<unknown>;
  scan: (cursor: string, ...args: unknown[]) => Promise<[string, string[]]>;
  set: (...args: unknown[]) => Promise<unknown>;
  smembers: (key: string) => Promise<string[]>;
}

const DEFAULT_TTL = 300;
const L1_TTL_MS = 30_000;
const L1_MAX_SIZE = 1000;

// ---------------------------------------------------------------------------
// L1: In-process LRU cache (Map with maxSize and TTL)
// ---------------------------------------------------------------------------

interface L1Entry {
  expiresAt: number;
  value: string;
}

class L1Cache {
  private readonly cache = new Map<string, L1Entry>();
  private readonly maxSize: number;
  private readonly ttlMs: number;

  constructor(maxSize = L1_MAX_SIZE, ttlMs = L1_TTL_MS) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Move to end for LRU ordering (Map preserves insertion order)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string): void {
    // If key already exists, delete it first so re-insertion moves it to the end
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Evict oldest entries if at capacity
    while (this.cache.size >= this.maxSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  /**
   * Delete all keys matching a simple glob pattern (only trailing `*` supported).
   * Returns the number of entries deleted.
   */
  deletePattern(pattern: string): number {
    let deleted = 0;

    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      for (const key of [...this.cache.keys()]) {
        if (key.startsWith(prefix)) {
          this.cache.delete(key);
          deleted++;
        }
      }
    } else if (this.cache.delete(pattern)) {
      deleted++;
    }

    return deleted;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// Singleton L1 cache instance
const l1 = new L1Cache();

/** Exposed for testing only. */
export function getL1Cache(): L1Cache {
  return l1;
}

// ---------------------------------------------------------------------------
// L2: Redis cache
// ---------------------------------------------------------------------------

let redisClient: RedisLike | null = null;

export function setCacheRedis(client: RedisLike): void {
  redisClient = client;
}

// ---------------------------------------------------------------------------
// Multi-tier getCached: L1 -> L2 -> fetcher (write-through)
// ---------------------------------------------------------------------------

export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const { prefix = "db", ttlSeconds = DEFAULT_TTL, tags } = options;
  const cacheKey = `${prefix}:${key}`;

  // L1 lookup
  const l1Hit = l1.get(cacheKey);
  if (l1Hit !== null) {
    try {
      logger.debug({ key: cacheKey }, "L1 cache hit");
      return JSON.parse(l1Hit) as T;
    } catch {
      l1.delete(cacheKey);
      logger.debug({ key: cacheKey }, "L1 cache entry corrupted, evicted");
    }
  }

  // L2 lookup (Redis)
  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.debug({ key: cacheKey }, "L2 cache hit");
        // Promote to L1
        l1.set(cacheKey, cached);
        return JSON.parse(cached) as T;
      }
    } catch (err) {
      logger.debug({ err, key: cacheKey }, "L2 cache read failed");
    }
  }

  // Cache miss — call the fetcher
  const result = await fetcher();
  const serialized = JSON.stringify(result);

  // Write-through: populate both L1 and L2
  l1.set(cacheKey, serialized);

  if (redisClient) {
    try {
      await redisClient.set(cacheKey, serialized, "EX", ttlSeconds);

      // Register tags for this key so we can invalidate by tag later
      if (tags && tags.length > 0) {
        await setCacheTag(cacheKey, tags);
      }
    } catch (err) {
      logger.debug({ err, key: cacheKey }, "L2 cache write failed");
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Tag-based invalidation
// ---------------------------------------------------------------------------

const TAG_KEY_PREFIX = "cache:tag:";

/**
 * Associate a cache key with one or more tags. Each tag is stored as a Redis
 * set containing all keys that belong to that tag. This enables O(K)
 * invalidation (where K = number of keys per tag) instead of O(N) SCAN.
 */
export async function setCacheTag(key: string, tags: string[]): Promise<void> {
  if (!redisClient || tags.length === 0) {
    return;
  }

  try {
    const promises = tags.map((tag) =>
      redisClient?.sadd(`${TAG_KEY_PREFIX}${tag}`, key)
    );
    await Promise.all(promises);
    logger.debug({ key, tags }, "Cache tags registered");
  } catch (err) {
    logger.debug({ err, key, tags }, "Failed to register cache tags");
  }
}

/**
 * Invalidate all cache keys associated with a tag. Fetches the key set from
 * Redis, deletes every key (both L1 and L2), then removes the tag set itself.
 * Runs in O(K) where K is the number of keys in the tag — no SCAN required.
 */
export async function invalidateByTag(tag: string): Promise<number> {
  const tagKey = `${TAG_KEY_PREFIX}${tag}`;

  // Always clear matching L1 entries by iterating the tag's known keys
  if (!redisClient) {
    logger.debug({ tag }, "No Redis client, tag invalidation skipped");
    return 0;
  }

  try {
    const keys = await redisClient.smembers(tagKey);
    if (keys.length === 0) {
      return 0;
    }

    // Delete all cached keys from L1
    for (const key of keys) {
      l1.delete(key);
    }

    // Delete all cached keys from L2 in a single call
    await redisClient.del(...keys);

    // Delete the tag set itself
    await redisClient.del(tagKey);

    logger.debug(
      { tag, deletedCount: keys.length },
      "Tag-based cache invalidation complete"
    );
    return keys.length;
  } catch (err) {
    logger.debug({ err, tag }, "Tag-based cache invalidation failed");
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Invalidation helpers
// ---------------------------------------------------------------------------

export async function invalidateCacheKey(
  key: string,
  prefix = "db"
): Promise<void> {
  const cacheKey = `${prefix}:${key}`;

  // Invalidate L1
  l1.delete(cacheKey);

  // Invalidate L2
  if (!redisClient) {
    return;
  }
  try {
    await redisClient.del(cacheKey);
  } catch (err) {
    logger.debug({ err, key }, "Cache invalidation failed");
  }
}

export async function invalidateCachePattern(
  pattern: string,
  prefix = "db"
): Promise<number> {
  const fullPattern = `${prefix}:${pattern}`;

  // Invalidate L1 entries matching the pattern
  l1.deletePattern(fullPattern);

  if (!redisClient) {
    return 0;
  }
  try {
    let cursor = "0";
    let deleted = 0;

    do {
      const [nextCursor, keys] = await redisClient.scan(
        cursor,
        "MATCH",
        fullPattern,
        "COUNT",
        100
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await redisClient.del(...keys);
        deleted += keys.length;
      }
    } while (cursor !== "0");

    return deleted;
  } catch (err) {
    logger.debug({ err, pattern }, "Cache pattern invalidation failed");
    return 0;
  }
}
