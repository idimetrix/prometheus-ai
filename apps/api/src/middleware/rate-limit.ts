import { createLogger } from "@prometheus/logger";
import { redis } from "@prometheus/queue";
import type { PlanTier } from "@prometheus/types";
import type { Context, MiddlewareHandler } from "hono";

const logger = createLogger("api:rate-limit");

// ---------------------------------------------------------------------------
// Plan tier rate limits (requests per minute)
// ---------------------------------------------------------------------------
const TIER_LIMITS: Record<PlanTier, number> = {
  hobby: 10,
  starter: 30,
  pro: 60,
  team: 120,
  studio: 300,
  enterprise: 600,
};

// Per-path overrides – matched via `startsWith`.
// A multiplier of 3 means the limit is 3x the tier default.
const PATH_OVERRIDES: { prefix: string; multiplier: number }[] = [
  { prefix: "/api/sse/", multiplier: 3 },
];

const WINDOW_MS = 60_000; // 1-minute sliding window

// ---------------------------------------------------------------------------
// Sliding-window implementation using Redis sorted sets
//
// Key:   ratelimit:{orgId}
// Score: timestamp (ms) of each request
// Member: unique per-request identifier (timestamp + random suffix)
// ---------------------------------------------------------------------------

async function slidingWindowCheck(
  orgId: string,
  limit: number
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  const key = `ratelimit:${orgId}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  try {
    const pipeline = redis.pipeline();
    // Remove entries outside the window
    pipeline.zremrangebyscore(key, 0, windowStart);
    // Add current request (unique member via timestamp + random suffix)
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    pipeline.zadd(key, now, member);
    // Count requests in the current window
    pipeline.zcard(key);
    // Set TTL so the key auto-expires if the org stops making requests
    pipeline.pexpire(key, WINDOW_MS);

    const results = await pipeline.exec();
    if (!results) {
      // Pipeline returned null – allow the request
      return { allowed: true, remaining: limit, resetMs: now + WINDOW_MS };
    }

    // results[2] is the ZCARD result: [error, count]
    const count = (results[2]?.[1] as number) ?? 0;
    const remaining = Math.max(0, limit - count);
    const resetMs = now + WINDOW_MS;

    return { allowed: count <= limit, remaining, resetMs };
  } catch (err) {
    // Redis unavailable – fail open (allow the request)
    logger.warn(
      { orgId, error: (err as Error).message },
      "Rate-limit Redis error, allowing request"
    );
    return { allowed: true, remaining: limit, resetMs: now + WINDOW_MS };
  }
}

// ---------------------------------------------------------------------------
// Resolve the effective limit for the request
// ---------------------------------------------------------------------------
function resolveLimit(tierLimit: number, path: string): number {
  for (const override of PATH_OVERRIDES) {
    if (path.startsWith(override.prefix)) {
      return Math.ceil(tierLimit * override.multiplier);
    }
  }
  return tierLimit;
}

// ---------------------------------------------------------------------------
// Hono middleware
// ---------------------------------------------------------------------------

/**
 * Rate-limiting middleware using Redis sliding-window sorted sets.
 *
 * Expects `c.get("orgId")` and `c.get("planTier")` to be set by an
 * upstream auth middleware. If they are not available the request is
 * allowed through (unauthenticated / public routes).
 */
export function rateLimitMiddleware(): MiddlewareHandler {
  return async (c: Context, next) => {
    const orgId = c.get("orgId") as string | undefined;
    const planTier = (c.get("planTier") as PlanTier | undefined) ?? "hobby";

    // No org context – skip rate limiting (public endpoints, health, etc.)
    if (!orgId) {
      await next();
      return;
    }

    const tierLimit = TIER_LIMITS[planTier] ?? TIER_LIMITS.hobby;
    const effectiveLimit = resolveLimit(tierLimit, c.req.path);

    const { allowed, remaining, resetMs } = await slidingWindowCheck(
      orgId,
      effectiveLimit
    );

    // Always attach rate-limit headers
    c.header("X-RateLimit-Limit", String(effectiveLimit));
    c.header("X-RateLimit-Remaining", String(remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(resetMs / 1000)));

    if (!allowed) {
      logger.warn({ orgId, planTier, effectiveLimit }, "Rate limit exceeded");
      return c.json(
        {
          error: "Too Many Requests",
          message: `Rate limit of ${effectiveLimit} requests per minute exceeded. Upgrade your plan for higher limits.`,
          retryAfterMs: resetMs - Date.now(),
        },
        429
      );
    }

    await next();
  };
}
