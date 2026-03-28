/**
 * GAP-087: Rate Limiting Middleware
 *
 * Redis-based sliding window rate limiting.
 * Configurable per tier: free (60/min), pro (300/min), enterprise (1000/min).
 * Returns 429 with Retry-After header when exceeded.
 *
 * NOTE: The primary rate limiter lives in ./rate-limit.ts and is already
 * applied globally via middleware/index.ts. This module provides a
 * standalone middleware variant that can be applied to specific Hono
 * route groups (e.g. public v1 API routes) independently of the tRPC
 * rate-limit pipeline.
 */

import { createLogger } from "@prometheus/logger";
import { redis } from "@prometheus/queue";
import type { MiddlewareHandler } from "hono";

const logger = createLogger("api:rate-limiter");

export interface RateLimiterConfig {
  /** Requests per window for enterprise users */
  enterpriseLimit?: number;
  /** Requests per window for free/unauthenticated users */
  freeLimit?: number;
  /** Redis key prefix */
  keyPrefix?: string;
  /** Requests per window for pro users */
  proLimit?: number;
  /** Window size in milliseconds (default: 60_000 = 1 minute) */
  windowMs?: number;
}

const DEFAULTS: Required<RateLimiterConfig> = {
  freeLimit: 60,
  proLimit: 300,
  enterpriseLimit: 1000,
  windowMs: 60_000,
  keyPrefix: "rl",
};

function resolveLimit(
  tier: string | undefined,
  config: Required<RateLimiterConfig>
): number {
  switch (tier) {
    case "enterprise":
    case "studio":
      return config.enterpriseLimit;
    case "pro":
    case "team":
      return config.proLimit;
    default:
      return config.freeLimit;
  }
}

async function slidingWindow(
  key: string,
  limit: number,
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  const now = Date.now();
  const windowStart = now - windowMs;

  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    pipeline.zadd(key, now, member);
    pipeline.zcard(key);
    pipeline.pexpire(key, windowMs);

    const results = await pipeline.exec();
    if (!results) {
      return { allowed: true, remaining: limit, resetMs: now + windowMs };
    }

    const count = (results[2]?.[1] as number) ?? 0;
    const remaining = Math.max(0, limit - count);
    return { allowed: count <= limit, remaining, resetMs: now + windowMs };
  } catch (err) {
    logger.warn(
      { key, error: (err as Error).message },
      "Rate-limiter Redis error, failing open"
    );
    return { allowed: true, remaining: limit, resetMs: now + windowMs };
  }
}

/**
 * Create a standalone rate-limiting middleware for Hono route groups.
 *
 * Usage:
 * ```ts
 * app.use("/v1/*", createRateLimiter({ freeLimit: 30 }));
 * ```
 */
export function createRateLimiter(
  userConfig: RateLimiterConfig = {}
): MiddlewareHandler {
  const config: Required<RateLimiterConfig> = { ...DEFAULTS, ...userConfig };

  return async (c, next) => {
    const orgId = c.get("orgId") as string | undefined;
    const planTier = (c.get("planTier") as string | undefined) ?? "hobby";

    // Derive identifier: orgId or IP
    const identifier =
      orgId ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      c.req.header("x-real-ip") ??
      "anon";

    const limit = resolveLimit(planTier, config);
    const key = `${config.keyPrefix}:${identifier}`;
    const { allowed, remaining, resetMs } = await slidingWindow(
      key,
      limit,
      config.windowMs
    );

    c.header("X-RateLimit-Limit", String(limit));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(resetMs / 1000)));

    if (!allowed) {
      const retryAfterSec = Math.ceil(Math.max(0, resetMs - Date.now()) / 1000);
      c.header("Retry-After", String(retryAfterSec));
      logger.warn(
        { identifier, planTier, limit },
        "Rate limit exceeded (standalone limiter)"
      );
      return c.json(
        {
          error: "Too Many Requests",
          message: `Rate limit of ${limit} requests per minute exceeded.`,
          retryAfterMs: Math.max(0, resetMs - Date.now()),
        },
        429
      );
    }

    await next();
  };
}
