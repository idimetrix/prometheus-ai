import { createHash } from "node:crypto";
import type { AuthContext } from "@prometheus/auth";
import { apiKeys, db, organizations } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { redis } from "@prometheus/queue";
import { and, eq, isNull } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";

const logger = createLogger("api:api-key-auth");

// ---------------------------------------------------------------------------
// Rate limit configuration for API keys (requests per minute)
// ---------------------------------------------------------------------------
const API_KEY_RATE_LIMIT = 60;
const WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Sliding-window rate-limit check per API key.
 * Returns { allowed, remaining } or null on Redis error (fail open).
 */
async function checkApiKeyRateLimit(
  keyId: string
): Promise<{ allowed: boolean; remaining: number } | null> {
  const rateKey = `ratelimit:apikey:${keyId}`;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  try {
    const pipeline = redis.pipeline();
    pipeline.zremrangebyscore(rateKey, 0, windowStart);
    const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
    pipeline.zadd(rateKey, now, member);
    pipeline.zcard(rateKey);
    pipeline.pexpire(rateKey, WINDOW_MS);

    const results = await pipeline.exec();
    if (!results) {
      return null;
    }

    const count = (results[2]?.[1] as number) ?? 0;
    return {
      allowed: count <= API_KEY_RATE_LIMIT,
      remaining: Math.max(0, API_KEY_RATE_LIMIT - count),
    };
  } catch {
    // Fail open on Redis errors
    return null;
  }
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Hono middleware that authenticates requests using API keys as an alternative
 * to Clerk JWTs.
 *
 * API keys use the format `pk_live_<hex>` and are sent as `Authorization: Bearer pk_live_...`.
 *
 * When a valid API key is found:
 *   - Sets `orgId` and `planTier` on the Hono context (for rate limiter).
 *   - Sets `userId`, `apiKeyId` on the context.
 *   - Constructs a synthetic `AuthContext` and sets it as `apiKeyAuth`.
 *
 * If the Bearer token does not start with `pk_live_`, the middleware passes
 * through without modification (Clerk JWT auth will handle it).
 */
export function apiKeyAuthMiddleware(): MiddlewareHandler {
  return async (c: Context, next) => {
    const authHeader = c.req.header("authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7)
      : undefined;

    // Only handle API key tokens
    if (!token?.startsWith("pk_live_")) {
      await next();
      return;
    }

    const keyHash = hashKey(token);

    // Look up the key
    const key = await db.query.apiKeys.findFirst({
      where: and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)),
    });

    if (!key) {
      logger.warn("API key auth failed: unknown or revoked key");
      return c.json({ error: "Invalid or revoked API key" }, 401);
    }

    // Rate limit check
    const rateResult = await checkApiKeyRateLimit(key.id);
    if (rateResult && !rateResult.allowed) {
      c.header("X-RateLimit-Limit", String(API_KEY_RATE_LIMIT));
      c.header("X-RateLimit-Remaining", "0");
      logger.warn({ keyId: key.id }, "API key rate limit exceeded");
      return c.json(
        {
          error: "Too Many Requests",
          message: `API key rate limit of ${API_KEY_RATE_LIMIT} requests per minute exceeded`,
        },
        429
      );
    }

    if (rateResult) {
      c.header("X-RateLimit-Limit", String(API_KEY_RATE_LIMIT));
      c.header("X-RateLimit-Remaining", String(rateResult.remaining));
    }

    // Look up the org for plan tier
    const org = await db.query.organizations.findFirst({
      where: eq(organizations.id, key.orgId),
      columns: { id: true, planTier: true },
    });

    // Update last-used timestamp asynchronously (fire-and-forget)
    db.update(apiKeys)
      .set({ lastUsed: new Date() })
      .where(eq(apiKeys.id, key.id))
      .then(() => {
        /* fire-and-forget */
      })
      .catch(() => {
        /* ignore update errors */
      });

    // Build a synthetic AuthContext for tRPC
    const syntheticAuth: AuthContext = {
      userId: key.userId,
      orgId: key.orgId,
      orgRole: "member", // API keys get member-level access by default
      sessionId: `apikey:${key.id}`,
    };

    // Set Hono context values for downstream middleware
    c.set("orgId", key.orgId);
    c.set("planTier", org?.planTier ?? "hobby");
    c.set("userId", key.userId);
    c.set("apiKeyId", key.id);
    c.set("apiKeyAuth", syntheticAuth);

    await next();
  };
}
