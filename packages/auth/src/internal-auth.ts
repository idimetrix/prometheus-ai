import { createLogger } from "@prometheus/logger";
import type { Context, Next } from "hono";

const logger = createLogger("auth:internal");

const HEADER_NAME = "x-internal-secret";

/** Paths that bypass internal auth (health/readiness probes, metrics) */
const BYPASS_PATHS = new Set([
  "/health",
  "/health/ready",
  "/live",
  "/ready",
  "/metrics",
]);

/**
 * Hono middleware that validates the `x-internal-secret` header on incoming
 * service-to-service requests.
 *
 * - In production (NODE_ENV=production) requests without a valid secret are
 *   rejected with 401.
 * - In development the header is optional but a warning is logged when it is
 *   missing so teams notice before shipping to prod.
 * - Health / liveness / readiness / metrics endpoints are always allowed
 *   through so orchestration tools (k8s, Prometheus) keep working.
 */
export function internalAuthMiddleware() {
  return async (c: Context, next: Next) => {
    if (BYPASS_PATHS.has(c.req.path)) {
      return next();
    }

    const secret = process.env.INTERNAL_SERVICE_SECRET;

    if (secret) {
      const provided = c.req.header(HEADER_NAME);
      if (provided !== secret) {
        return c.json({ error: "Unauthorized" }, 401);
      }
    } else if (process.env.NODE_ENV === "production") {
      return c.json({ error: "Unauthorized" }, 401);
    } else {
      logger.warn(
        { path: c.req.path },
        "INTERNAL_SERVICE_SECRET not set — skipping internal auth (dev mode)"
      );
    }

    await next();
    return;
  };
}

/**
 * Validates the `x-internal-secret` header on a raw Node `http.IncomingMessage`.
 *
 * Returns `true` when the request is authorized, `false` otherwise.
 * Health / liveness / readiness / metrics paths always return `true`.
 */
export function validateInternalSecret(
  url: string | undefined,
  headerValue: string | undefined
): boolean {
  if (url && BYPASS_PATHS.has(url)) {
    return true;
  }

  const secret = process.env.INTERNAL_SERVICE_SECRET;

  if (secret) {
    return headerValue === secret;
  }

  if (process.env.NODE_ENV === "production") {
    return false;
  }

  // Development: allow but warn
  logger.warn(
    { url },
    "INTERNAL_SERVICE_SECRET not set — skipping internal auth (dev mode)"
  );
  return true;
}

/**
 * Returns a headers object containing the internal service secret.
 * Used by service clients when making outbound requests to other services.
 */
export function getInternalAuthHeaders(): Record<string, string> {
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (secret) {
    return { [HEADER_NAME]: secret };
  }
  return {};
}
