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
