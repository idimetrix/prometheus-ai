import { createLogger } from "@prometheus/logger";
import { redis } from "@prometheus/queue";
import type { PlanTier } from "@prometheus/types";
import type { Context, MiddlewareHandler } from "hono";

const logger = createLogger("api:rate-limit");

// ---------------------------------------------------------------------------
// Plan tier rate limits (requests per minute)
// ---------------------------------------------------------------------------
const TIER_LIMITS: Record<PlanTier, number> = {
  hobby: 60,
  starter: 120,
  pro: 300,
  team: 600,
  studio: 1500,
  enterprise: 3000,
};

// ---------------------------------------------------------------------------
// Endpoint group classification
// ---------------------------------------------------------------------------

type EndpointGroup = "read" | "write" | "ai";

/**
 * Multiplier applied to the tier limit based on the endpoint group.
 * Read-heavy endpoints get a higher budget; AI endpoints get a lower one.
 */
const GROUP_MULTIPLIERS: Record<EndpointGroup, number> = {
  read: 1.5,
  write: 1,
  ai: 0.3,
};

/**
 * Classify a tRPC procedure into an endpoint group.
 * This allows read-heavy endpoints to have higher limits and AI endpoints
 * to have the lowest limits.
 */
function classifyProcedure(procedure: string): EndpointGroup {
  // AI / inference endpoints
  const aiProcedures = [
    "sessions.sendMessage",
    "brain.query",
    "codeAnalysis.analyze",
    "blueprintsEnhanced.generate",
    "generate.",
  ];
  for (const p of aiProcedures) {
    if (procedure.startsWith(p) || procedure === p) {
      return "ai";
    }
  }

  // Write endpoints (create, update, delete, etc.)
  const writeKeywords = [
    ".create",
    ".update",
    ".delete",
    ".revoke",
    ".rotate",
    ".remove",
    ".send",
    ".set",
  ];
  for (const kw of writeKeywords) {
    if (procedure.includes(kw)) {
      return "write";
    }
  }

  return "read";
}

// Per-path overrides -- matched via `startsWith`.
// A multiplier of 3 means the limit is 3x the tier default.
const PATH_OVERRIDES: { prefix: string; multiplier: number }[] = [
  { prefix: "/api/sse/", multiplier: 3 },
];

// ---------------------------------------------------------------------------
// Per-endpoint (tRPC path) rate limits (requests per minute)
// These take precedence over tier-based limits when the tRPC path matches.
// ---------------------------------------------------------------------------
const ENDPOINT_LIMITS: Record<string, number> = {
  "sessions.create": 5,
  "apiKeys.create": 3,
  "projects.create": 10,
  "sessions.sendMessage": 60,
};

const WINDOW_MS = 60_000; // 1-minute sliding window

// ---------------------------------------------------------------------------
// IP-based rate limiting for unauthenticated endpoints
// ---------------------------------------------------------------------------
const IP_RATE_LIMIT = 30; // 30 requests/min for unauthenticated
const IP_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Sliding-window implementation using Redis sorted sets
//
// Key:   ratelimit:{orgId}
// Score: timestamp (ms) of each request
// Member: unique per-request identifier (timestamp + random suffix)
// ---------------------------------------------------------------------------

async function slidingWindowCheck(
  identifier: string,
  limit: number,
  keySuffix?: string,
  windowMs = WINDOW_MS
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  const key = keySuffix
    ? `ratelimit:${identifier}:${keySuffix}`
    : `ratelimit:${identifier}`;
  const now = Date.now();
  const windowStart = now - windowMs;

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
    pipeline.pexpire(key, windowMs);

    const results = await pipeline.exec();
    if (!results) {
      // Pipeline returned null - allow the request
      return { allowed: true, remaining: limit, resetMs: now + windowMs };
    }

    // results[2] is the ZCARD result: [error, count]
    const count = (results[2]?.[1] as number) ?? 0;
    const remaining = Math.max(0, limit - count);
    const resetMs = now + windowMs;

    return { allowed: count <= limit, remaining, resetMs };
  } catch (err) {
    // Redis unavailable - fail open (allow the request)
    logger.warn(
      { identifier, error: (err as Error).message },
      "Rate-limit Redis error, allowing request"
    );
    return { allowed: true, remaining: limit, resetMs: now + windowMs };
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
// Extract tRPC procedure path from the request URL.
// tRPC paths look like `/trpc/sessions.create` or `/api/trpc/projects.create`
// ---------------------------------------------------------------------------
function extractTrpcPath(urlPath: string): string | undefined {
  const trpcIdx = urlPath.indexOf("/trpc/");
  if (trpcIdx === -1) {
    return undefined;
  }
  const procedurePath = urlPath.slice(trpcIdx + 6).split("?")[0];
  return procedurePath || undefined;
}

// ---------------------------------------------------------------------------
// Resolve per-endpoint limit. Returns the endpoint limit and procedure name
// if a match is found, or undefined if no endpoint-specific limit applies.
// ---------------------------------------------------------------------------
function resolveEndpointLimit(
  urlPath: string
): { limit: number; procedure: string } | undefined {
  const procedure = extractTrpcPath(urlPath);
  if (!procedure) {
    return undefined;
  }

  const limit = ENDPOINT_LIMITS[procedure];
  if (limit === undefined) {
    return undefined;
  }

  return { limit, procedure };
}

// ---------------------------------------------------------------------------
// Set standard rate limit headers on the response
// ---------------------------------------------------------------------------
function setRateLimitHeaders(
  c: Context,
  limit: number,
  remaining: number,
  resetMs: number
): void {
  c.header("X-RateLimit-Limit", String(limit));
  c.header("X-RateLimit-Remaining", String(remaining));
  c.header("X-RateLimit-Reset", String(Math.ceil(resetMs / 1000)));
}

// ---------------------------------------------------------------------------
// Build 429 response with Retry-After header
// ---------------------------------------------------------------------------
function buildRateLimitResponse(
  c: Context,
  _limit: number,
  resetMs: number,
  message: string
) {
  const retryAfterMs = Math.max(0, resetMs - Date.now());
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);
  c.header("Retry-After", String(retryAfterSec));
  return c.json(
    {
      error: "Too Many Requests",
      message,
      retryAfterMs,
    },
    429
  );
}

// ---------------------------------------------------------------------------
// Hono middleware
// ---------------------------------------------------------------------------

/**
 * Handle IP-based rate limiting for unauthenticated requests.
 * Returns a 429 Response if rate-limited, or null to continue.
 */
async function handleIpRateLimit(c: Context): Promise<Response | null> {
  const clientIp =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown";

  if (clientIp === "unknown") {
    return null;
  }

  const ipCheck = await slidingWindowCheck(
    `ip:${clientIp}`,
    IP_RATE_LIMIT,
    undefined,
    IP_WINDOW_MS
  );

  setRateLimitHeaders(c, IP_RATE_LIMIT, ipCheck.remaining, ipCheck.resetMs);

  if (!ipCheck.allowed) {
    logger.warn(
      { clientIp, limit: IP_RATE_LIMIT },
      "IP-based rate limit exceeded for unauthenticated request"
    );
    return buildRateLimitResponse(
      c,
      IP_RATE_LIMIT,
      ipCheck.resetMs,
      `Rate limit of ${IP_RATE_LIMIT} requests per minute exceeded. Please authenticate for higher limits.`
    );
  }

  return null;
}

/**
 * Check per-endpoint rate limit (stricter, keyed separately).
 * Returns a 429 Response if rate-limited, or null to continue.
 */
async function handleEndpointRateLimit(
  c: Context,
  orgId: string,
  planTier: PlanTier
): Promise<Response | null> {
  const endpointOverride = resolveEndpointLimit(c.req.path);
  if (!endpointOverride) {
    return null;
  }

  const endpointCheck = await slidingWindowCheck(
    orgId,
    endpointOverride.limit,
    endpointOverride.procedure
  );

  setRateLimitHeaders(
    c,
    endpointOverride.limit,
    endpointCheck.remaining,
    endpointCheck.resetMs
  );

  if (!endpointCheck.allowed) {
    logger.warn(
      {
        orgId,
        planTier,
        procedure: endpointOverride.procedure,
        limit: endpointOverride.limit,
      },
      "Per-endpoint rate limit exceeded"
    );
    return buildRateLimitResponse(
      c,
      endpointOverride.limit,
      endpointCheck.resetMs,
      `Rate limit of ${endpointOverride.limit} requests per minute exceeded for ${endpointOverride.procedure}.`
    );
  }

  return null;
}

/**
 * Rate-limiting middleware using Redis sliding-window sorted sets.
 *
 * Features:
 * - Per-endpoint rate limits (different limits for different routes)
 * - User tier-based limits (hobby: 60/min, pro: 300/min, team: 1000/min, enterprise: unlimited)
 * - Rate limit headers in responses (X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset)
 * - Sliding window algorithm
 * - IP-based rate limiting for unauthenticated endpoints
 * - Endpoint groups: read (higher limits), write (lower limits), AI (lowest limits)
 * - 429 response with Retry-After header when limit exceeded
 */
export function rateLimitMiddleware(): MiddlewareHandler {
  return async (c: Context, next) => {
    const orgId = c.get("orgId") as string | undefined;
    const planTier = (c.get("planTier") as PlanTier | undefined) ?? "hobby";

    // No org context - apply IP-based rate limiting
    if (!orgId) {
      const ipResponse = await handleIpRateLimit(c);
      if (ipResponse) {
        return ipResponse;
      }
      await next();
      return;
    }

    // Enterprise tier gets unlimited access
    if (planTier === "enterprise") {
      c.header("X-RateLimit-Limit", "unlimited");
      c.header("X-RateLimit-Remaining", "unlimited");
      await next();
      return;
    }

    // Check per-endpoint limit first
    const endpointResponse = await handleEndpointRateLimit(c, orgId, planTier);
    if (endpointResponse) {
      return endpointResponse;
    }

    // Compute effective tier-based limit with endpoint group multiplier
    const tierLimit = TIER_LIMITS[planTier] ?? TIER_LIMITS.hobby;
    const procedure = extractTrpcPath(c.req.path);
    let groupMultiplier = 1;
    if (procedure) {
      const group = classifyProcedure(procedure);
      groupMultiplier = GROUP_MULTIPLIERS[group];
    }
    const effectiveLimit = Math.ceil(
      resolveLimit(tierLimit, c.req.path) * groupMultiplier
    );

    // Check global tier-based limit
    const hasEndpointOverride = resolveEndpointLimit(c.req.path) !== undefined;
    const { allowed, remaining, resetMs } = await slidingWindowCheck(
      orgId,
      effectiveLimit
    );

    if (!hasEndpointOverride) {
      setRateLimitHeaders(c, effectiveLimit, remaining, resetMs);
    }

    if (!allowed) {
      logger.warn({ orgId, planTier, effectiveLimit }, "Rate limit exceeded");
      return buildRateLimitResponse(
        c,
        effectiveLimit,
        resetMs,
        `Rate limit of ${effectiveLimit} requests per minute exceeded. Upgrade your plan for higher limits.`
      );
    }

    await next();
  };
}
