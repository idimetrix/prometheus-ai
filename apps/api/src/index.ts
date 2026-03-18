import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import type { AuthContext } from "@prometheus/auth";
import { db } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  apiKeyAuthMiddleware,
  orgContextMiddleware,
  rateLimitMiddleware,
  requestIdMiddleware,
  requestLoggingMiddleware,
  securityHeaders,
} from "./middleware";
import { appRouter } from "./routers";
import { sseApp } from "./routes/sse";
import { clerkWebhookApp } from "./routes/webhooks/clerk";
import { stripeWebhookApp } from "./routes/webhooks/stripe";
import { createContext } from "./trpc";

const logger = createLogger("api");
const app = new Hono();

// ---------------------------------------------------------------------------
// 1. Request ID — generates a unique ID for every request (before all others)
// ---------------------------------------------------------------------------
app.use("/*", requestIdMiddleware());

// ---------------------------------------------------------------------------
// 2. Request logging — logs method, path, status, duration
// ---------------------------------------------------------------------------
app.use("/*", requestLoggingMiddleware());

// ---------------------------------------------------------------------------
// 3. Security headers — CSP, HSTS, X-Frame-Options, etc.
// ---------------------------------------------------------------------------
app.use("/*", securityHeaders());

// ---------------------------------------------------------------------------
// 4. CORS — whitelist frontend origin, allow credentials
// ---------------------------------------------------------------------------
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
app.use(
  "/*",
  cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-Id",
      "X-Trpc-Source",
    ],
    exposeHeaders: [
      "X-Request-Id",
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "X-RateLimit-Reset",
    ],
    credentials: true,
    maxAge: 600, // Cache preflight for 10 minutes
  })
);

// ---------------------------------------------------------------------------
// 5. API key auth — alternative to Clerk JWT for programmatic access
// ---------------------------------------------------------------------------
app.use("/*", apiKeyAuthMiddleware());

// ---------------------------------------------------------------------------
// 6. Org context resolution (orgId + planTier) for rate limiting.
//    Runs before rate limiter but after CORS so preflight is not affected.
//    API key middleware may have already set orgId — this is additive.
// ---------------------------------------------------------------------------
app.use("/*", orgContextMiddleware());

// ---------------------------------------------------------------------------
// 7. Rate limiting — applied globally. Skips requests without orgId.
// ---------------------------------------------------------------------------
app.use("/*", rateLimitMiddleware());

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", async (c) => {
  const startTime = process.uptime();
  const checks: Record<string, boolean> = {};

  // Check database connectivity
  try {
    const { db } = await import("@prometheus/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    checks.db = true;
  } catch {
    checks.db = false;
  }

  // Check Redis connectivity
  try {
    const { redis } = await import("@prometheus/queue");
    const pong = await redis.ping();
    checks.redis = pong === "PONG";
  } catch {
    checks.redis = false;
  }

  const allHealthy = Object.values(checks).every(Boolean);
  const status = allHealthy ? "ok" : "degraded";

  return c.json(
    {
      status,
      checks,
      uptime: Math.floor(startTime),
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    },
    allHealthy ? 200 : 503
  );
});

// ---------------------------------------------------------------------------
// SSE endpoint
// ---------------------------------------------------------------------------
app.route("/api/sse", sseApp);

// ---------------------------------------------------------------------------
// Webhooks — placed after rate-limit middleware but pass through because
// they have no orgId in the context (no Bearer token).
// ---------------------------------------------------------------------------
app.route("/webhooks/stripe", stripeWebhookApp);
app.route("/webhooks/clerk", clerkWebhookApp);

// ---------------------------------------------------------------------------
// tRPC — with API key auth context injection
// ---------------------------------------------------------------------------
app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: ((opts: unknown, honoC: unknown) => {
      // If the API key middleware already authenticated the request, inject
      // the synthetic auth context into tRPC context.
      const c = honoC as { get: (key: string) => unknown } | undefined;
      const apiKeyAuth = c?.get?.("apiKeyAuth") as AuthContext | undefined;
      const apiKeyId = c?.get?.("apiKeyId") as string | undefined;

      if (apiKeyAuth) {
        return Promise.resolve({
          auth: apiKeyAuth,
          db,
          apiKeyId: apiKeyId ?? null,
        });
      }

      return createContext(opts as Parameters<typeof createContext>[0]);
    }) as unknown as Parameters<typeof trpcServer>[0]["createContext"],
  })
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, () => {
  logger.info(`API server running on port ${port}`);
});

export type { AppRouter } from "./routers";
