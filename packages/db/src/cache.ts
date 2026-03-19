import { createLogger } from "@prometheus/logger";

const logger = createLogger("db:cache");

interface CacheOptions {
  prefix?: string;
  ttlSeconds?: number;
}

interface RedisLike {
  del: (...args: string[]) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  scan: (cursor: string, ...args: unknown[]) => Promise<[string, string[]]>;
  set: (...args: unknown[]) => Promise<unknown>;
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
  const { prefix = "db", ttlSeconds = DEFAULT_TTL } = options;
  const cacheKey = `${prefix}:${key}`;

  // L1 lookup
  const l1Hit = l1.get(cacheKey);
  if (l1Hit !== null) {
    logger.debug({ key: cacheKey }, "L1 cache hit");
    return JSON.parse(l1Hit) as T;
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
    } catch (err) {
      logger.debug({ err, key: cacheKey }, "L2 cache write failed");
    }
  }

  return result;
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
