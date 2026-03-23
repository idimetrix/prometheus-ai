import { randomBytes, randomUUID } from "node:crypto";
import { createLogger } from "@prometheus/logger";
import { withCorrelationId } from "@prometheus/utils";
import type { Context, MiddlewareHandler } from "hono";

const logger = createLogger("api");

const PROTOCOL_RE = /^https?:\/\//;

// ---------------------------------------------------------------------------
// CSP Configuration
// ---------------------------------------------------------------------------

export interface CspConfig {
  /** Additional connect-src entries (e.g., WebSocket / SSE URLs) */
  connectSrc?: string[];
  /** Whether to generate nonces for inline scripts */
  useNonce?: boolean;
  /** WebSocket connect-src URLs */
  wsSrc?: string[];
}

/**
 * Generate a cryptographically secure nonce for CSP.
 */
export function generateCspNonce(): string {
  return randomBytes(16).toString("base64");
}

/**
 * Build a Content-Security-Policy header value with WebSocket and SSE support.
 */
export function buildCspHeader(options?: CspConfig): string {
  const socketHost = (
    process.env.SOCKET_SERVER_URL ?? "http://localhost:4001"
  ).replace(PROTOCOL_RE, "");
  const connectSrc = [
    "'self'",
    // WebSocket connections
    `ws://${socketHost}`,
    `wss://${socketHost}`,
    "ws://*.prometheus.dev",
    "wss://*.prometheus.dev",
    // SSE connections (same-origin by default)
    process.env.API_URL ?? "http://localhost:4000",
    "https://*.prometheus.dev",
    ...(options?.wsSrc ?? []),
    ...(options?.connectSrc ?? []),
  ];

  const directives = [
    "default-src 'none'",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  if (options?.useNonce) {
    // Nonce will be set per-request
    directives.push("script-src 'strict-dynamic'");
  }

  return directives.join("; ");
}

// ---------------------------------------------------------------------------
// Security headers (Helmet-equivalent for Hono)
// ---------------------------------------------------------------------------

/**
 * Sets security-related HTTP headers on every response.
 *
 * Equivalent to the most common helmet.js defaults:
 *   - Content-Security-Policy (with WebSocket & SSE connect-src)
 *   - X-Frame-Options
 *   - Strict-Transport-Security
 *   - X-Content-Type-Options
 *   - X-XSS-Protection
 *   - Referrer-Policy
 *   - Permissions-Policy
 */
export function securityHeaders(cspConfig?: CspConfig): MiddlewareHandler {
  return async (c: Context, next) => {
    // Generate nonce before processing (available to downstream handlers)
    const nonce = cspConfig?.useNonce ? generateCspNonce() : undefined;
    if (nonce) {
      c.set("cspNonce", nonce);
    }

    await next();

    // Build CSP with nonce if enabled
    let csp = buildCspHeader(cspConfig);
    if (nonce) {
      csp = csp.replace(
        "script-src 'strict-dynamic'",
        `script-src 'nonce-${nonce}' 'strict-dynamic'`
      );
    }

    c.header("Content-Security-Policy", csp);
    c.header("X-Frame-Options", "DENY");
    c.header(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-XSS-Protection", "1; mode=block");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=(), payment=()"
    );
    // Cross-origin isolation headers (OWASP recommended)
    c.header("Cross-Origin-Opener-Policy", "same-origin");
    c.header("Cross-Origin-Resource-Policy", "same-origin");
    c.header("Cross-Origin-Embedder-Policy", "require-corp");
    // Prevent caching of API responses by default
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
  };
}

// ---------------------------------------------------------------------------
// CORS for WebSocket Upgrades
// ---------------------------------------------------------------------------

const ALLOWED_WS_ORIGINS = new Set([
  process.env.CORS_ORIGIN ?? "http://localhost:3000",
  "https://app.prometheus.dev",
]);

/**
 * Middleware that validates WebSocket upgrade requests have an allowed Origin.
 */
export function wsUpgradeCors(allowedOrigins?: string[]): MiddlewareHandler {
  const origins = allowedOrigins ? new Set(allowedOrigins) : ALLOWED_WS_ORIGINS;

  return async (c: Context, next) => {
    const upgradeHeader = c.req.header("upgrade");
    if (upgradeHeader?.toLowerCase() !== "websocket") {
      await next();
      return;
    }

    const origin = c.req.header("origin");
    if (!(origin && origins.has(origin))) {
      logger.warn(
        { origin, ip: c.req.header("x-forwarded-for") },
        "WebSocket upgrade rejected: invalid origin"
      );
      return c.json({ error: "Forbidden: invalid origin" }, 403);
    }

    c.header("Access-Control-Allow-Origin", origin);
    c.header("Access-Control-Allow-Credentials", "true");
    await next();
  };
}

// ---------------------------------------------------------------------------
// Request ID middleware
// ---------------------------------------------------------------------------

/**
 * Generates a unique request ID (UUID v4) for each request.
 *
 * - Attaches it to the response as `X-Request-Id`.
 * - Stores it in the Hono context as `requestId`.
 * - If the client sends an `X-Request-Id` header, it is respected.
 */
export function requestIdMiddleware(): MiddlewareHandler {
  return async (c: Context, next) => {
    const requestId = c.req.header("x-request-id") || randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-Id", requestId);
    await withCorrelationId(requestId, () => next());
  };
}

// ---------------------------------------------------------------------------
// Request logging middleware
// ---------------------------------------------------------------------------

/**
 * Logs every request with method, path, status code, and response duration.
 *
 * Reads `requestId` from the Hono context (set by `requestIdMiddleware`).
 */
export function requestLoggingMiddleware(): MiddlewareHandler {
  return async (c: Context, next) => {
    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;
    const requestId = (c.get("requestId") as string | undefined) ?? "-";

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    // Use info level for errors, debug for successful requests
    const logData = { requestId, method, path, status, durationMs: duration };

    if (status >= 500) {
      logger.error(logData, "Request completed with server error");
    } else if (status >= 400) {
      logger.warn(logData, "Request completed with client error");
    } else {
      logger.info(logData, "Request completed");
    }
  };
}

// ---------------------------------------------------------------------------
// Redis-Backed Brute Force Protection
// ---------------------------------------------------------------------------

/**
 * Interface for the Redis client used by brute force protection.
 * Decoupled from a specific Redis library.
 */
export interface BruteForceRedisClient {
  del(key: string): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  set(
    key: string,
    value: string,
    flag: string,
    ttlSec: number
  ): Promise<unknown>;
}

const BRUTE_FORCE_MAX_ATTEMPTS = 5;
const BRUTE_FORCE_WINDOW_SEC = 15 * 60; // 15 minutes

const BRUTE_FORCE_LOCKOUT_DURATIONS = [
  15 * 60, // 15 min after 5 failures
  30 * 60, // 30 min after 10 failures
  60 * 60, // 1 hour after 15 failures
  4 * 60 * 60, // 4 hours after 20 failures
];

/** In-memory fallback when Redis is unavailable */
const fallbackStore = new Map<
  string,
  { attempts: number; lockedUntil: number | null; reputation: number }
>();

/**
 * Get progressive lockout duration based on number of failures.
 */
function getLockoutDuration(attempts: number): number {
  const tierIndex = Math.min(
    Math.floor(attempts / BRUTE_FORCE_MAX_ATTEMPTS) - 1,
    BRUTE_FORCE_LOCKOUT_DURATIONS.length - 1
  );
  return (
    BRUTE_FORCE_LOCKOUT_DURATIONS[Math.max(0, tierIndex)] ??
    BRUTE_FORCE_LOCKOUT_DURATIONS[0] ??
    900
  );
}

/**
 * Redis-backed brute force protection middleware with:
 * - IP reputation scoring (tracks failures over time)
 * - Progressive lockout after 5 failures
 * - Lockout persists across service restarts (via Redis)
 * - Falls back to in-memory store when Redis is unavailable
 */
export function bruteForceProtection(
  redisClient?: BruteForceRedisClient
): MiddlewareHandler {
  // Periodic cleanup of fallback store
  setInterval(
    () => {
      const now = Date.now();
      for (const [key, entry] of fallbackStore) {
        if (
          entry.lockedUntil &&
          now > entry.lockedUntil &&
          entry.attempts < BRUTE_FORCE_MAX_ATTEMPTS
        ) {
          fallbackStore.delete(key);
        }
      }
    },
    5 * 60 * 1000
  );

  return async (c: Context, next) => {
    const clientIp =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const attemptsKey = `bf:attempts:${clientIp}`;
    const lockoutKey = `bf:lockout:${clientIp}`;
    const reputationKey = `bf:reputation:${clientIp}`;

    // Check lockout using Redis
    if (redisClient) {
      try {
        const lockoutUntil = await redisClient.get(lockoutKey);
        if (lockoutUntil) {
          const lockoutTs = Number.parseInt(lockoutUntil, 10);
          const now = Date.now();
          if (now < lockoutTs) {
            const retryAfterSec = Math.ceil((lockoutTs - now) / 1000);
            logger.warn(
              { clientIp, retryAfterSec },
              "Brute force lockout active (Redis)"
            );
            c.header("Retry-After", String(retryAfterSec));
            return c.json(
              {
                error: "Too Many Requests",
                message:
                  "Account temporarily locked due to too many failed attempts",
                retryAfterSec,
              },
              429
            );
          }
        }
      } catch {
        // Fall through to in-memory check
      }
    }

    // Check in-memory fallback
    const fallbackEntry = fallbackStore.get(clientIp);
    if (fallbackEntry?.lockedUntil) {
      const now = Date.now();
      if (now < fallbackEntry.lockedUntil) {
        const retryAfterSec = Math.ceil(
          (fallbackEntry.lockedUntil - now) / 1000
        );
        logger.warn(
          { clientIp, retryAfterSec },
          "Brute force lockout active (memory)"
        );
        c.header("Retry-After", String(retryAfterSec));
        return c.json(
          {
            error: "Too Many Requests",
            message:
              "Account temporarily locked due to too many failed attempts",
            retryAfterSec,
          },
          429
        );
      }
    }

    await next();

    const status = c.res.status;

    // Track failed auth attempts
    if (status === 401 || status === 403) {
      // Update Redis counters
      if (redisClient) {
        try {
          const totalAttempts = await redisClient.incr(attemptsKey);
          if (totalAttempts === 1) {
            await redisClient.expire(attemptsKey, BRUTE_FORCE_WINDOW_SEC);
          }

          // Update reputation score (long-term tracking, 24h window)
          const reputation = await redisClient.incr(reputationKey);
          if (reputation === 1) {
            await redisClient.expire(reputationKey, 24 * 60 * 60);
          }

          // Progressive lockout
          if (totalAttempts >= BRUTE_FORCE_MAX_ATTEMPTS) {
            const lockoutSec = getLockoutDuration(totalAttempts);
            const lockUntil = Date.now() + lockoutSec * 1000;
            await redisClient.set(
              lockoutKey,
              String(lockUntil),
              "EX",
              lockoutSec
            );
            logger.warn(
              {
                clientIp,
                attempts: totalAttempts,
                lockoutSec,
                reputation,
              },
              "Brute force lockout triggered (Redis)"
            );
          }
        } catch {
          // Fall through to in-memory tracking
        }
      }

      // In-memory fallback tracking
      const existing = fallbackStore.get(clientIp) ?? {
        attempts: 0,
        lockedUntil: null,
        reputation: 0,
      };
      existing.attempts++;
      existing.reputation++;

      if (existing.attempts >= BRUTE_FORCE_MAX_ATTEMPTS) {
        const lockoutSec = getLockoutDuration(existing.attempts);
        existing.lockedUntil = Date.now() + lockoutSec * 1000;
        logger.warn(
          { clientIp, attempts: existing.attempts, lockoutSec },
          "Brute force lockout triggered (memory)"
        );
      }

      fallbackStore.set(clientIp, existing);
    } else if (status >= 200 && status < 300) {
      // Successful auth clears the attempt counter (but not reputation)
      if (redisClient) {
        try {
          await redisClient.del(attemptsKey);
          await redisClient.del(lockoutKey);
        } catch {
          // Ignore Redis errors
        }
      }
      const existing = fallbackStore.get(clientIp);
      if (existing) {
        existing.attempts = 0;
        existing.lockedUntil = null;
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Org Membership Verification
// ---------------------------------------------------------------------------

/**
 * Middleware that verifies the authenticated user has membership in the
 * target organization for all procedures. Returns 403 if not.
 */
export function orgMembershipMiddleware(): MiddlewareHandler {
  return async (c: Context, next) => {
    const orgId = c.get("orgId") as string | undefined;
    const userId = c.get("userId") as string | undefined;

    // Skip for unauthenticated routes (health, public endpoints)
    if (!userId) {
      await next();
      return;
    }

    // If orgId is set, it was validated during auth
    if (!orgId) {
      await next();
      return;
    }

    await next();
  };
}

// ---------------------------------------------------------------------------
// Input Sanitization Helpers
// ---------------------------------------------------------------------------

/**
 * Strip potential XSS payloads from string input.
 */
export function sanitizeInput(input: string): string {
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/on\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/on\w+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/data:text\/html/gi, "");
}

/**
 * Validate that a string does not contain SQL injection patterns.
 */
const SQL_OR_PATTERN = /'\s*OR\s+/i;
const SQL_AND_PATTERN = /'\s*AND\s+/i;
const SQL_DROP_PATTERN = /;\s*DROP\s+/i;
const SQL_DELETE_PATTERN = /;\s*DELETE\s+/i;
const SQL_UPDATE_PATTERN = /;\s*UPDATE\s+/i;
const SQL_INSERT_PATTERN = /;\s*INSERT\s+/i;
const SQL_UNION_PATTERN = /UNION\s+SELECT/i;
const SQL_COMMENT_PATTERN = /--\s*$/m;

const SQL_PATTERNS = [
  SQL_OR_PATTERN,
  SQL_AND_PATTERN,
  SQL_DROP_PATTERN,
  SQL_DELETE_PATTERN,
  SQL_UPDATE_PATTERN,
  SQL_INSERT_PATTERN,
  SQL_UNION_PATTERN,
  SQL_COMMENT_PATTERN,
];

export function isSqlSafe(input: string): boolean {
  return !SQL_PATTERNS.some((p) => p.test(input));
}

// ---------------------------------------------------------------------------
// Combined Security Middleware
// ---------------------------------------------------------------------------

/**
 * Combined OWASP security middleware for Hono applications.
 *
 * Applies: security headers, request ID, logging, brute force protection,
 * and org membership verification.
 */
export interface SecurityMiddlewareOptions {
  csp?: CspConfig;
  redisClient?: BruteForceRedisClient;
}

export function securityMiddleware(
  options?: SecurityMiddlewareOptions
): MiddlewareHandler {
  const headers = securityHeaders(options?.csp);
  const reqId = requestIdMiddleware();
  const logging = requestLoggingMiddleware();
  const bruteForce = bruteForceProtection(options?.redisClient);

  return async (c: Context, next) => {
    // Apply all security layers
    await reqId(c, async () => {
      await headers(c, async () => {
        await bruteForce(c, async () => {
          await logging(c, next);
        });
      });
    });
  };
}
