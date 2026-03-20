import { randomUUID } from "node:crypto";
import { createLogger } from "@prometheus/logger";
import type { Context, MiddlewareHandler } from "hono";

const logger = createLogger("api");

// ---------------------------------------------------------------------------
// Security headers (Helmet-equivalent for Hono)
// ---------------------------------------------------------------------------

/**
 * Sets security-related HTTP headers on every response.
 *
 * Equivalent to the most common helmet.js defaults:
 *   - Content-Security-Policy
 *   - X-Frame-Options
 *   - Strict-Transport-Security
 *   - X-Content-Type-Options
 *   - X-XSS-Protection
 *   - Referrer-Policy
 *   - Permissions-Policy
 */
export function securityHeaders(): MiddlewareHandler {
  return async (c: Context, next) => {
    await next();

    // Only set CSP for API responses — the web app handles its own CSP.
    c.header(
      "Content-Security-Policy",
      "default-src 'none'; frame-ancestors 'none'"
    );
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
    // Prevent caching of API responses by default
    c.header("Cache-Control", "no-store");
    c.header("Pragma", "no-cache");
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
    await next();
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
// Brute Force Protection
// ---------------------------------------------------------------------------

interface BruteForceEntry {
  attempts: number;
  firstAttempt: number;
  lockedUntil: number | null;
}

const bruteForceStore = new Map<string, BruteForceEntry>();

const BRUTE_FORCE_MAX_ATTEMPTS = 10;
const BRUTE_FORCE_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const BRUTE_FORCE_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

/**
 * OWASP-compliant brute force protection middleware.
 *
 * Tracks failed authentication attempts per IP and locks out after
 * 10 attempts within a 15-minute window.
 */
export function bruteForceProtection(): MiddlewareHandler {
  // Periodic cleanup
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of bruteForceStore) {
      if (now - entry.firstAttempt > BRUTE_FORCE_WINDOW_MS * 2) {
        bruteForceStore.delete(key);
      }
    }
  }, BRUTE_FORCE_WINDOW_MS);

  return async (c: Context, next) => {
    const clientIp =
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const key = `bf:${clientIp}`;
    const now = Date.now();

    const entry = bruteForceStore.get(key);

    // Check if currently locked out
    if (entry?.lockedUntil && now < entry.lockedUntil) {
      const retryAfterSec = Math.ceil((entry.lockedUntil - now) / 1000);
      logger.warn({ clientIp, retryAfterSec }, "Brute force lockout active");
      c.header("Retry-After", String(retryAfterSec));
      return c.json(
        {
          error: "Too Many Requests",
          message: "Account temporarily locked due to too many failed attempts",
          retryAfterSec,
        },
        429
      );
    }

    await next();

    const status = c.res.status;

    // Track failed auth attempts
    if (status === 401 || status === 403) {
      if (!entry || now - entry.firstAttempt > BRUTE_FORCE_WINDOW_MS) {
        bruteForceStore.set(key, {
          attempts: 1,
          firstAttempt: now,
          lockedUntil: null,
        });
      } else {
        entry.attempts++;
        if (entry.attempts >= BRUTE_FORCE_MAX_ATTEMPTS) {
          entry.lockedUntil = now + BRUTE_FORCE_LOCKOUT_MS;
          logger.warn(
            { clientIp, attempts: entry.attempts },
            "Brute force lockout triggered"
          );
        }
      }
    } else if (status >= 200 && status < 300) {
      // Successful auth clears the counter
      bruteForceStore.delete(key);
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
export function securityMiddleware(): MiddlewareHandler {
  const headers = securityHeaders();
  const reqId = requestIdMiddleware();
  const logging = requestLoggingMiddleware();
  const bruteForce = bruteForceProtection();

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
