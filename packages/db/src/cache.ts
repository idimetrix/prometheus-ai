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

let redisClient: RedisLike | null = null;

export function setCacheRedis(client: RedisLike): void {
  redisClient = client;
}

export async function getCached<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: CacheOptions = {}
): Promise<T> {
  const { prefix = "db", ttlSeconds = DEFAULT_TTL } = options;
  const cacheKey = `${prefix}:${key}`;

  if (redisClient) {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as T;
      }
    } catch (err) {
      logger.debug({ err, key: cacheKey }, "Cache read failed");
    }
  }

  const result = await fetcher();

  if (redisClient) {
    try {
      await redisClient.set(cacheKey, JSON.stringify(result), "EX", ttlSeconds);
    } catch (err) {
      logger.debug({ err, key: cacheKey }, "Cache write failed");
    }
  }

  return result;
}

export async function invalidateCacheKey(
  key: string,
  prefix = "db"
): Promise<void> {
  if (!redisClient) {
    return;
  }
  try {
    await redisClient.del(`${prefix}:${key}`);
  } catch (err) {
    logger.debug({ err, key }, "Cache invalidation failed");
  }
}

export async function invalidateCachePattern(
  pattern: string,
  prefix = "db"
): Promise<number> {
  if (!redisClient) {
    return 0;
  }
  try {
    let cursor = "0";
    let deleted = 0;
    const fullPattern = `${prefix}:${pattern}`;

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
