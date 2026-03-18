import { createLogger } from "@prometheus/logger";
import type { Context, MiddlewareHandler } from "hono";

const logger = createLogger("api:sentry");

/**
 * Lightweight Sentry wrapper that only initializes when SENTRY_DSN is set.
 * Avoids a hard dependency on @sentry/node — the package is dynamically imported.
 */

interface SentryLike {
  addBreadcrumb: (breadcrumb: Record<string, unknown>) => void;
  captureException: (err: unknown, ctx?: Record<string, unknown>) => string;
  captureMessage: (msg: string, level?: string) => string;
  init: (opts: Record<string, unknown>) => void;
  setUser: (user: Record<string, unknown> | null) => void;
  startSpan: <T>(opts: Record<string, unknown>, fn: () => T) => T;
  withScope: (fn: (scope: Scopelike) => void) => void;
}

interface Scopelike {
  setExtra: (key: string, value: unknown) => void;
  setTag: (key: string, value: string) => void;
  setUser: (user: Record<string, unknown> | null) => void;
}

let sentry: SentryLike | null = null;
let initialized = false;

/**
 * Initialize Sentry. Safe to call multiple times — only the first call takes effect.
 * Does nothing if SENTRY_DSN is not set.
 */
export async function initSentry(): Promise<void> {
  if (initialized) {
    return;
  }
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info("SENTRY_DSN not set — Sentry error tracking disabled");
    return;
  }

  try {
    const mod = (await import("@sentry/node")) as unknown as SentryLike;
    mod.init({
      dsn,
      environment: process.env.NODE_ENV ?? "development",
      release: process.env.APP_VERSION ?? "0.1.0",
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
      ignoreTransactions: ["/health"],
    });
    sentry = mod;
    logger.info("Sentry initialized");
  } catch (err) {
    logger.warn(
      { error: String(err) },
      "Failed to load @sentry/node — error tracking disabled"
    );
  }
}

/**
 * Capture an exception in Sentry (no-op when Sentry is not initialized).
 */
export function captureException(
  err: unknown,
  context?: Record<string, unknown>
): void {
  if (!sentry) {
    return;
  }
  sentry.captureException(err, context);
}

/**
 * Capture a message in Sentry.
 */
export function captureMessage(msg: string, level?: string): void {
  if (!sentry) {
    return;
  }
  sentry.captureMessage(msg, level);
}

/**
 * Add a breadcrumb to the current Sentry scope.
 */
export function addBreadcrumb(breadcrumb: {
  category?: string;
  message?: string;
  level?: string;
  data?: Record<string, unknown>;
}): void {
  if (!sentry) {
    return;
  }
  sentry.addBreadcrumb(breadcrumb);
}

/**
 * Hono middleware that:
 * 1. Sets Sentry user context from auth (orgId, userId)
 * 2. Adds request breadcrumbs
 * 3. Captures unhandled errors with request context
 */
export function sentryMiddleware(): MiddlewareHandler {
  return async (c: Context, next) => {
    if (!sentry) {
      await next();
      return;
    }

    // Add request breadcrumb
    addBreadcrumb({
      category: "http",
      message: `${c.req.method} ${c.req.path}`,
      level: "info",
      data: {
        method: c.req.method,
        url: c.req.url,
        path: c.req.path,
      },
    });

    // Set user context from request (populated by orgContextMiddleware)
    const orgId = c.get("orgId") as string | undefined;
    const userId = c.get("userId") as string | undefined;

    if (orgId || userId) {
      sentry.withScope((scope) => {
        scope.setUser({
          id: userId,
          ...(orgId ? { orgId } : {}),
        });
        if (orgId) {
          scope.setTag("orgId", orgId);
        }
      });
    }

    try {
      await next();
    } catch (err) {
      // Capture the error with request context
      sentry.withScope((scope) => {
        scope.setTag("method", c.req.method);
        scope.setTag("path", c.req.path);
        scope.setExtra("url", c.req.url);
        if (orgId) {
          scope.setTag("orgId", orgId);
        }
        if (userId) {
          scope.setTag("userId", userId);
        }
      });

      captureException(err);
      throw err; // Re-throw so Hono's error handler can process it
    }
  };
}
