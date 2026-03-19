import { createLogger } from "@prometheus/logger";
import { redis } from "@prometheus/queue";
import type { Context, MiddlewareHandler } from "hono";

const logger = createLogger("api:rate-limit-enhanced");

// ─── Endpoint Tier Classification ─────────────────────────────────────────────

export type EndpointTier = "standard" | "heavy" | "critical";

const TIER_LIMITS: Record<EndpointTier, number> = {
  standard: 100, // 100 requests per minute
  heavy: 20, // 20 requests per minute
  critical: 5, // 5 requests per minute
};

/**
 * Per-user rate limit classification for tRPC procedures.
 * Add procedures to a tier to enforce per-user (not per-org) limits.
 */
const PROCEDURE_TIERS: Record<string, EndpointTier> = {
  // Critical — destructive or expensive operations
  "gdpr.deleteUser": "critical",
  "gdpr.exportData": "critical",
  "audit.requestDataDeletion": "critical",
  "apiKeys.create": "critical",
  "apiKeys.revoke": "critical",

  // Heavy — resource-intensive operations
  "sessions.create": "heavy",
  "sessions.sendMessage": "heavy",
  "tasks.create": "heavy",
  "projects.create": "heavy",
  "blueprintsEnhanced.generate": "heavy",
  "codeAnalysis.analyze": "heavy",
  "brain.query": "heavy",

  // Standard — everything else defaults to standard tier
};

const WINDOW_MS = 60_000; // 1-minute sliding window

// ─── DDoS Protection Patterns ─────────────────────────────────────────────────

/** Burst detection: reject if more than 10 requests in 1 second */
const BURST_LIMIT = 10;
const BURST_WINDOW_MS = 1000;

// ─── Sliding Window Check (Per-User) ──────────────────────────────────────────

interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  tier: EndpointTier;
}

async function perUserSlidingWindowCheck(
  userId: string,
  tier: EndpointTier,
  procedure?: string
): Promise<RateLimitResult> {
  const limit = TIER_LIMITS[tier];
  const keySuffix = procedure ? `:${procedure}` : `:${tier}`;
  const key = `ratelimit:user:${userId}${keySuffix}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    pipeline.zadd(key, now, member);
    pipeline.zcard(key);
    pipeline.pexpire(key, WINDOW_MS);

    const results = await pipeline.exec();
    if (!results) {
      return {
        allowed: true,
        remaining: limit,
        resetMs: now + WINDOW_MS,
        limit,
        tier,
      };
    }

    const count = (results[2]?.[1] as number) ?? 0;
    const remaining = Math.max(0, limit - count);
    const resetMs = now + WINDOW_MS;

    return { allowed: count <= limit, remaining, resetMs, limit, tier };
  } catch (err) {
    logger.warn(
      { userId, tier, error: (err as Error).message },
      "Per-user rate-limit Redis error, allowing request"
    );
    return {
      allowed: true,
      remaining: limit,
      resetMs: now + WINDOW_MS,
      limit,
      tier,
    };
  }
}

// ─── Burst Detection ──────────────────────────────────────────────────────────

async function burstCheck(
  identifier: string
): Promise<{ allowed: boolean; count: number }> {
  const key = `ratelimit:burst:${identifier}`;
  const now = Date.now();
  const windowStart = now - BURST_WINDOW_MS;

  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    pipeline.zadd(key, now, member);
    pipeline.zcard(key);
    pipeline.pexpire(key, BURST_WINDOW_MS);

    const results = await pipeline.exec();
    if (!results) {
      return { allowed: true, count: 0 };
    }

    const count = (results[2]?.[1] as number) ?? 0;
    return { allowed: count <= BURST_LIMIT, count };
  } catch {
    return { allowed: true, count: 0 };
  }
}

// ─── Extract tRPC Procedure Path ──────────────────────────────────────────────

function extractTrpcPath(urlPath: string): string | undefined {
  const trpcIdx = urlPath.indexOf("/trpc/");
  if (trpcIdx === -1) {
    return undefined;
  }
  const procedurePath = urlPath.slice(trpcIdx + 6).split("?")[0];
  return procedurePath || undefined;
}

function resolveTier(procedure: string | undefined): EndpointTier {
  if (!procedure) {
    return "standard";
  }
  return PROCEDURE_TIERS[procedure] ?? "standard";
}

// ─── Middleware ────────────────────────────────────────────────────────────────

/**
 * Per-user rate limiting middleware.
 *
 * Prevents a single user from consuming an organization's entire quota.
 * Uses Redis sorted sets for a sliding-window implementation.
 *
 * Features:
 * - Per-user limits based on endpoint tier (standard/heavy/critical)
 * - Burst detection (DDoS pattern)
 * - Rate limit headers on every response
 */
export function perUserRateLimitMiddleware(): MiddlewareHandler {
  return async (c: Context, next) => {
    const userId = c.get("userId") as string | undefined;

    // No user context — skip per-user rate limiting
    if (!userId) {
      await next();
      return;
    }

    const procedure = extractTrpcPath(c.req.path);
    const tier = resolveTier(procedure);

    // DDoS burst detection — check IP or user for rapid-fire requests
    const clientIp =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? userId;
    const burst = await burstCheck(clientIp);
    if (!burst.allowed) {
      logger.warn(
        { userId, clientIp, burstCount: burst.count },
        "Burst rate limit triggered (DDoS pattern)"
      );
      c.header("Retry-After", "1");
      return c.json(
        {
          error: "Too Many Requests",
          message: "Request rate too high. Slow down.",
          retryAfterMs: BURST_WINDOW_MS,
        },
        429
      );
    }

    // Per-user sliding window check
    const result = await perUserSlidingWindowCheck(userId, tier, procedure);

    // Always set rate limit headers
    c.header("X-RateLimit-Limit", String(result.limit));
    c.header("X-RateLimit-Remaining", String(result.remaining));
    c.header("X-RateLimit-Reset", String(Math.ceil(result.resetMs / 1000)));
    c.header("X-RateLimit-Tier", result.tier);

    if (!result.allowed) {
      logger.warn(
        {
          userId,
          procedure,
          tier,
          limit: result.limit,
        },
        "Per-user rate limit exceeded"
      );
      const retryAfterSec = Math.ceil((result.resetMs - Date.now()) / 1000);
      c.header("Retry-After", String(retryAfterSec));
      return c.json(
        {
          error: "Too Many Requests",
          message: `Per-user rate limit of ${result.limit} requests/min exceeded for ${tier} tier${procedure ? ` (${procedure})` : ""}.`,
          retryAfterMs: result.resetMs - Date.now(),
        },
        429
      );
    }

    await next();
  };
}
