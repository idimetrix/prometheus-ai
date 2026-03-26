import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import type { AuthContext } from "@prometheus/auth";
import { db, modelUsageLogs } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { initSentry, initTelemetry } from "@prometheus/telemetry";
import {
  generateId,
  installShutdownHandlers,
  isProcessShuttingDown,
} from "@prometheus/utils";

await initTelemetry({ serviceName: "api" });
initSentry({ serviceName: "api" });
installShutdownHandlers();

import { traceMiddleware } from "@prometheus/telemetry";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import {
  apiKeyAuthMiddleware,
  orgContextMiddleware,
  rateLimitMiddleware,
  requestIdMiddleware,
  requestLoggingMiddleware,
  securityHeaders,
} from "./middleware";
import { generateOpenAPISpec } from "./openapi";
import { appRouter } from "./routers";
import { fastPathsApp } from "./routes/fast-paths";
import { ideApp } from "./routes/ide";
import { sseApp } from "./routes/sse";
import { alertsWebhookApp } from "./routes/webhooks/alerts";
import { clerkWebhookApp } from "./routes/webhooks/clerk";
import { githubAppWebhookApp } from "./routes/webhooks/github-app";
import { inboundWebhookApp } from "./routes/webhooks/inbound";
import { slackWebhookApp } from "./routes/webhooks/slack";
import { slackCommandsApp } from "./routes/webhooks/slack-commands";
import { stripeWebhookApp } from "./routes/webhooks/stripe";
import { createContext } from "./trpc";

const logger = createLogger("api");
const app = new Hono();

// ---------------------------------------------------------------------------
// 0. Distributed tracing — extract W3C TraceContext from incoming requests
// ---------------------------------------------------------------------------
app.use("/*", traceMiddleware("api"));

// ---------------------------------------------------------------------------
// 0b. Body size limit — reject payloads larger than 1MB
// ---------------------------------------------------------------------------
app.use("*", bodyLimit({ maxSize: 1024 * 1024 }));

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
  if (isProcessShuttingDown()) {
    return c.json({ status: "draining" }, 503);
  }
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
      service: "api",
      version: process.env.APP_VERSION ?? "0.1.0",
      uptime: Math.floor(startTime),
      timestamp: new Date().toISOString(),
      dependencies: {
        db: checks.db ? "ok" : "unavailable",
        redis: checks.redis ? "ok" : "unavailable",
      },
    },
    allHealthy ? 200 : 503
  );
});

// Liveness probe — lightweight, just confirms process is responsive
app.get("/live", (c) => c.json({ status: "ok" }));

// Readiness probe — checks dependencies are connected
app.get("/ready", async (c) => {
  try {
    const { db } = await import("@prometheus/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ready" });
  } catch {
    return c.json({ status: "not ready" }, 503);
  }
});

// ---------------------------------------------------------------------------
// OpenAPI spec — serves the generated spec as JSON
// ---------------------------------------------------------------------------
app.get("/docs", (c) => {
  const spec = generateOpenAPISpec();
  return c.json(spec);
});

// ---------------------------------------------------------------------------
// Fast-path endpoints — bypass orchestrator for simple queries
// ---------------------------------------------------------------------------
app.route("/api/fast", fastPathsApp);

// ---------------------------------------------------------------------------
// IDE endpoints — inline completions, edits, explanations
// ---------------------------------------------------------------------------
app.route("/api", ideApp);

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
app.route("/webhooks/alerts", alertsWebhookApp);
app.route("/webhooks/slack", slackWebhookApp);
app.route("/webhooks/slack/commands", slackCommandsApp);
app.route("/webhooks/inbound", inboundWebhookApp);
app.route("/webhooks/github-app", githubAppWebhookApp);

// ---------------------------------------------------------------------------
// GitHub App marketplace listing (public, no auth required)
// ---------------------------------------------------------------------------
import { githubAppListing } from "./routes/github-app-listing";

app.route("/api/github-app", githubAppListing);

// ---------------------------------------------------------------------------
// Internal: model usage logging (called by model-router, fire-and-forget)
// ---------------------------------------------------------------------------
app.post("/internal/model-usage", async (c) => {
  try {
    const body = await c.req.json();
    if (!(body.orgId && body.modelKey && body.provider && body.slot)) {
      return c.json({ error: "Missing required fields" }, 400);
    }
    await db.insert(modelUsageLogs).values({
      id: generateId("mlog"),
      orgId: body.orgId,
      sessionId: body.sessionId ?? null,
      modelKey: body.modelKey,
      provider: body.provider,
      slot: body.slot,
      promptTokens: body.promptTokens ?? 0,
      completionTokens: body.completionTokens ?? 0,
      totalTokens: body.totalTokens ?? 0,
      costUsd: body.costUsd ?? 0,
    });
    return c.json({ ok: true }, 201);
  } catch (err) {
    logger.error({ err }, "Failed to log model usage");
    return c.json({ error: "Internal error" }, 500);
  }
});

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
// Prometheus Metrics
// ---------------------------------------------------------------------------
app.get("/metrics", async (c) => {
  const { metricsRegistry } = await import("@prometheus/telemetry");
  return c.text(await metricsRegistry.render(), 200, {
    "Content-Type": "text/plain; charset=utf-8",
  });
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, () => {
  logger.info(`API server running on port ${port}`);
});

export type { AppRouter } from "./routers";
