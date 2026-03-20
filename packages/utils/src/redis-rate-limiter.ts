import { createLogger } from "@prometheus/logger";

const logger = createLogger("utils:redis-rate-limiter");

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal Redis interface compatible with ioredis.
 * Uses the standard Redis EVAL command for Lua script execution.
 */
export interface RedisLike {
  eval(...args: Array<string | number>): Promise<unknown>;
}

export type RateLimitDimension = "ip" | "user" | "org" | "endpoint";

export type RateLimitTier = "hobby" | "pro" | "enterprise";

export interface RedisRateLimitConfig {
  /** Key prefix in Redis (default: "ratelimit") */
  keyPrefix?: string;
  /** Window size in seconds (default: 60) */
  windowSizeSeconds?: number;
}

export interface RedisRateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Unix timestamp (seconds) when the window resets */
  resetAt: number;
}

// ─── Tier Limits ──────────────────────────────────────────────────────────────

/** Default requests per window per tier */
const TIER_LIMITS: Record<RateLimitTier, number> = {
  hobby: 100,
  pro: 500,
  enterprise: 2000,
};

// ─── Lua Script ───────────────────────────────────────────────────────────────

/**
 * Atomic sliding window rate limit using Redis sorted sets.
 *
 * Algorithm:
 * 1. Remove expired entries (ZREMRANGEBYSCORE)
 * 2. Count current entries (ZCARD)
 * 3. If under limit, add new entry (ZADD)
 * 4. Set TTL on the key to auto-cleanup (EXPIRE)
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = current timestamp in ms
 * ARGV[2] = window start timestamp in ms (now - windowMs)
 * ARGV[3] = max allowed requests
 * ARGV[4] = unique request ID (timestamp + random for uniqueness)
 * ARGV[5] = TTL in seconds for the key
 *
 * Returns: [allowed (0|1), current_count, limit]
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local max_requests = tonumber(ARGV[3])
local request_id = ARGV[4]
local ttl_seconds = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

local current_count = redis.call('ZCARD', key)

if current_count < max_requests then
  redis.call('ZADD', key, now, request_id)
  redis.call('EXPIRE', key, ttl_seconds)
  return {1, current_count + 1, max_requests}
else
  redis.call('EXPIRE', key, ttl_seconds)
  return {0, current_count, max_requests}
end
`;

/**
 * Read-only Lua script to count current entries without adding.
 */
const COUNT_ONLY_LUA = `
local key = KEYS[1]
local window_start = tonumber(ARGV[1])
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)
return redis.call('ZCARD', key)
`;

// ─── Rate Limiter Class ──────────────────────────────────────────────────────

let requestCounter = 0;

/**
 * Redis-backed sliding window rate limiter using sorted sets.
 *
 * Provides atomic rate limiting across distributed instances using a Lua script
 * that performs ZADD + ZREMRANGEBYSCORE + ZCARD in a single round trip.
 *
 * Supports multiple dimensions (per-IP, per-user, per-org, per-endpoint)
 * and tier-based limits (hobby: 100/min, pro: 500/min, enterprise: 2000/min).
 *
 * Usage:
 * ```ts
 * const limiter = new RedisRateLimiter(redisClient);
 * const result = await limiter.check("ip", "1.2.3.4", "pro");
 * if (!result.allowed) {
 *   // Return 429
 * }
 * ```
 */
export class RedisRateLimiter {
  private readonly redis: RedisLike;
  private readonly keyPrefix: string;
  private readonly windowSizeSeconds: number;

  constructor(redis: RedisLike, config?: RedisRateLimitConfig) {
    this.redis = redis;
    this.keyPrefix = config?.keyPrefix ?? "ratelimit";
    this.windowSizeSeconds = config?.windowSizeSeconds ?? 60;
  }

  /**
   * Check if a request should be allowed under the rate limit.
   *
   * @param dimension - The rate limit dimension (ip, user, org, endpoint)
   * @param identifier - The value for the dimension (e.g., "1.2.3.4", "user_abc")
   * @param tier - The subscription tier (determines the limit)
   * @param customLimit - Override the tier-based limit with a custom value
   */
  async check(
    dimension: RateLimitDimension,
    identifier: string,
    tier: RateLimitTier = "hobby",
    customLimit?: number
  ): Promise<RedisRateLimitResult> {
    const limit = customLimit ?? TIER_LIMITS[tier];
    const key = this.buildKey(dimension, identifier);
    const now = Date.now();
    const windowStartMs = now - this.windowSizeSeconds * 1000;
    const requestId = `${now}:${++requestCounter}`;
    const ttlSeconds = this.windowSizeSeconds * 2;

    try {
      const result = (await this.redis.eval(
        SLIDING_WINDOW_LUA,
        1,
        key,
        String(now),
        String(windowStartMs),
        String(limit),
        requestId,
        String(ttlSeconds)
      )) as [number, number, number];

      const [allowed, currentCount, maxRequests] = result;
      const resetAt = Math.ceil((now + this.windowSizeSeconds * 1000) / 1000);

      return {
        allowed: allowed === 1,
        limit: maxRequests,
        remaining: Math.max(0, maxRequests - currentCount),
        resetAt,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { dimension, identifier, tier, error: msg },
        "Redis rate limit check failed, allowing request"
      );

      // Fail open: allow the request if Redis is unavailable
      return {
        allowed: true,
        limit,
        remaining: limit,
        resetAt: Math.ceil((now + this.windowSizeSeconds * 1000) / 1000),
      };
    }
  }

  /**
   * Check rate limit across multiple dimensions at once.
   * All dimensions must pass for the request to be allowed.
   *
   * Example: check per-IP AND per-user simultaneously.
   */
  async checkMultiple(
    checks: Array<{
      customLimit?: number;
      dimension: RateLimitDimension;
      identifier: string;
      tier?: RateLimitTier;
    }>
  ): Promise<{
    allowed: boolean;
    results: Map<string, RedisRateLimitResult>;
  }> {
    const results = new Map<string, RedisRateLimitResult>();
    let allAllowed = true;

    const promises = checks.map(async (check) => {
      const result = await this.check(
        check.dimension,
        check.identifier,
        check.tier ?? "hobby",
        check.customLimit
      );
      const resultKey = `${check.dimension}:${check.identifier}`;
      results.set(resultKey, result);
      if (!result.allowed) {
        allAllowed = false;
      }
    });

    await Promise.all(promises);

    return { allowed: allAllowed, results };
  }

  /**
   * Get the current rate limit status without consuming a token.
   */
  async getStatus(
    dimension: RateLimitDimension,
    identifier: string,
    tier: RateLimitTier = "hobby"
  ): Promise<{ count: number; limit: number; remaining: number }> {
    const limit = TIER_LIMITS[tier];
    const key = this.buildKey(dimension, identifier);
    const now = Date.now();
    const windowStartMs = now - this.windowSizeSeconds * 1000;

    try {
      const count = (await this.redis.eval(
        COUNT_ONLY_LUA,
        1,
        key,
        String(windowStartMs)
      )) as number;

      return {
        count,
        limit,
        remaining: Math.max(0, limit - count),
      };
    } catch {
      return { count: 0, limit, remaining: limit };
    }
  }

  /**
   * Get rate limit response headers suitable for HTTP responses.
   */
  getHeaders(result: RedisRateLimitResult): Record<string, string> {
    return {
      "X-RateLimit-Limit": String(result.limit),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(result.resetAt),
      ...(result.allowed
        ? {}
        : {
            "Retry-After": String(
              Math.max(1, result.resetAt - Math.ceil(Date.now() / 1000))
            ),
          }),
    };
  }

  /**
   * Get the tier limits configuration.
   */
  static getTierLimits(): Record<RateLimitTier, number> {
    return { ...TIER_LIMITS };
  }

  // ─── Private ────────────────────────────────────────────────────────

  private buildKey(dimension: RateLimitDimension, identifier: string): string {
    return `${this.keyPrefix}:${dimension}:${identifier}`;
  }
}
