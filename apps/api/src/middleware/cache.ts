import crypto from "node:crypto";
import { createLogger } from "@prometheus/logger";
import {
  createRedisConnection,
  type redis as sharedRedis,
} from "@prometheus/queue";
import type { MiddlewareHandler } from "hono";

type RedisClient = typeof sharedRedis;

const logger = createLogger("api:cache");

/** TTL presets in seconds */
const TTL = {
  /** Dynamic data: project status, sessions, tasks */
  short: 60,
  /** Semi-static data: settings, team info, plan details */
  long: 300,
} as const;

type TtlPreset = keyof typeof TTL;

/** Procedures that should use longer TTL */
const LONG_TTL_PROCEDURES = new Set([
  "org.getSettings",
  "org.getMembers",
  "org.getPlan",
  "project.getSettings",
  "user.getPreferences",
]);

/** Procedures that should NEVER be cached (mutations, sensitive data) */
const NEVER_CACHE = new Set(["auth.login", "auth.logout", "auth.refresh"]);

let redisClient: RedisClient | null = null;

function getRedis(): RedisClient | null {
  if (!redisClient) {
    try {
      redisClient = createRedisConnection();
    } catch (err) {
      logger.warn({ err }, "Redis unavailable for query cache");
    }
  }
  return redisClient;
}

/**
 * Build a deterministic cache key from org, procedure, and input.
 */
function buildCacheKey(
  orgId: string,
  procedure: string,
  input: unknown
): string {
  const inputHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(input ?? null))
    .digest("hex")
    .slice(0, 16);
  return `cache:${orgId}:${procedure}:${inputHash}`;
}

/**
 * Resolve TTL for a given procedure name.
 */
function resolveTtl(procedure: string): number {
  const preset: TtlPreset = LONG_TTL_PROCEDURES.has(procedure)
    ? "long"
    : "short";
  return TTL[preset];
}

/**
 * Invalidate all cache entries matching a glob pattern.
 *
 * Examples:
 *   invalidateCache("cache:org_123:*")           — all entries for an org
 *   invalidateCache("cache:org_123:project.*")    — project-related entries
 */
export async function invalidateCache(pattern: string): Promise<number> {
  const client = getRedis();
  if (!client) {
    return 0;
  }

  let cursor = "0";
  let deleted = 0;

  do {
    const [nextCursor, keys] = await client.scan(
      cursor,
      "MATCH",
      pattern,
      "COUNT",
      100
    );
    cursor = nextCursor;

    if (keys.length > 0) {
      await client.del(...keys);
      deleted += keys.length;
    }
  } while (cursor !== "0");

  if (deleted > 0) {
    logger.info({ pattern, deleted }, "Cache invalidated");
  }

  return deleted;
}

/**
 * Hono middleware that implements cache-aside for tRPC query results.
 *
 * Only caches GET-like tRPC queries (batch or single). Mutations and
 * subscription requests pass through untouched.
 *
 * Usage:
 *   app.use("/api/trpc/*", queryCacheMiddleware());
 */
/**
 * Extract cacheable procedure info from request, or null if not cacheable.
 */
function extractCacheableRequest(
  method: string,
  url: URL
): { procedure: string; orgId: string; input: unknown } | null {
  if (method !== "GET") {
    return null;
  }

  const trpcSegment = url.pathname.split("/trpc/")[1];
  if (!trpcSegment) {
    return null;
  }

  const procedure = trpcSegment.split(",")[0] ?? trpcSegment;
  if (NEVER_CACHE.has(procedure)) {
    return null;
  }

  const orgId = url.searchParams.get("orgId") ?? "global";
  const inputParam = url.searchParams.get("input");
  let input: unknown = null;
  if (inputParam) {
    try {
      input = JSON.parse(inputParam);
    } catch {
      return null;
    }
  }

  return { procedure, orgId, input };
}

/**
 * Try to retrieve a cached response from Redis.
 */
async function tryCacheLookup(
  client: RedisClient,
  cacheKey: string
): Promise<string | null> {
  try {
    return await client.get(cacheKey);
  } catch (err) {
    logger.warn({ err, cacheKey }, "Cache lookup failed");
    return null;
  }
}

/**
 * Store a successful response in Redis cache.
 */
async function tryCacheStore(
  client: RedisClient,
  cacheKey: string,
  procedure: string,
  orgId: string,
  response: Response
): Promise<void> {
  try {
    const cloned = response.clone();
    const body = await cloned.text();

    if (body?.startsWith("{") || body.startsWith("[")) {
      const ttl = resolveTtl(procedure);
      await client.set(cacheKey, body, "EX", ttl);
      logger.debug({ procedure, orgId, ttl }, "Cache set");
    }
  } catch (err) {
    logger.warn({ err, cacheKey }, "Cache store failed");
  }
}

export function queryCacheMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const url = new URL(c.req.url);
    const orgIdHeader = c.req.header("x-org-id");
    const cacheInfo = extractCacheableRequest(c.req.method, url);

    if (!cacheInfo) {
      return next();
    }

    const orgId = orgIdHeader ?? cacheInfo.orgId;
    const cacheKey = buildCacheKey(orgId, cacheInfo.procedure, cacheInfo.input);
    const client = getRedis();

    if (client) {
      const cached = await tryCacheLookup(client, cacheKey);
      if (cached) {
        logger.debug({ procedure: cacheInfo.procedure, orgId }, "Cache hit");
        return c.json(JSON.parse(cached), 200, { "x-cache": "HIT" });
      }
    }

    await next();

    if (client && c.res.status === 200) {
      await tryCacheStore(client, cacheKey, cacheInfo.procedure, orgId, c.res);
    }

    c.header("x-cache", "MISS");
  };
}
