import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import type { AuthContext } from "@prometheus/auth";
import { db, modelUsageLogs } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import {
  createServiceMetrics,
  DEFAULT_SLOS,
  initSentry,
  initTelemetry,
  metricsMiddleware,
  SLOMonitor,
} from "@prometheus/telemetry";
import {
  generateId,
  installShutdownHandlers,
  isProcessShuttingDown,
} from "@prometheus/utils";

await initTelemetry({ serviceName: "api" });
initSentry({ serviceName: "api" });
installShutdownHandlers();

const sloMonitor = new SLOMonitor(DEFAULT_SLOS);
const serviceMetrics = createServiceMetrics("api");

import { traceMiddleware } from "@prometheus/telemetry";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import {
  apiKeyAuthMiddleware,
  orgContextMiddleware,
  perUserRateLimitMiddleware,
  rateLimitMiddleware,
  requestIdMiddleware,
  requestLoggingMiddleware,
  securityHeaders,
} from "./middleware";
import { generateOpenAPISpec } from "./openapi";
import { appRouter } from "./routers";
import { fastPathsApp } from "./routes/fast-paths";
import { bitbucketOAuthApp } from "./routes/oauth/bitbucket";
import { githubOAuthApp } from "./routes/oauth/github";
import { gitlabOAuthApp } from "./routes/oauth/gitlab";
import { slackOAuthApp } from "./routes/oauth/slack";
import { sseApp } from "./routes/sse";
import { v1App } from "./routes/v1";
import { alertsWebhookApp } from "./routes/webhooks/alerts";
import { ciTriggerApp } from "./routes/webhooks/ci-trigger";
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
app.use("/*", metricsMiddleware());

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
// 2b. SLO + service metrics — record latency and error counts per request
// ---------------------------------------------------------------------------
app.use("/*", async (c, next) => {
  const start = performance.now();
  await next();
  const durationMs = performance.now() - start;
  const durationSec = durationMs / 1000;
  const status = String(c.res.status);

  // SLO: record request latency for P99 tracking
  sloMonitor.record("api_p99_latency_ms", durationMs);

  // Prometheus histogram: request latency
  serviceMetrics.api.requestLatencySeconds
    .labels({ router: "http", method: c.req.method, status })
    .observe(durationSec);

  // Prometheus counter: errors
  if (c.res.status >= 500) {
    serviceMetrics.generic.errorRate
      .labels({ error_type: "http_5xx", severity: "error" })
      .inc();
  }

  // Add X-Response-Time header to all responses for latency observability
  c.res.headers.set("X-Response-Time", `${Math.round(durationMs)}ms`);
});

// ---------------------------------------------------------------------------
// 3. CORS — whitelist frontend origin, allow credentials (MUST be before security headers)
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
      "X-Response-Time",
      "X-Model-Latency",
      "X-Queue-Wait",
      "X-Cache",
    ],
    credentials: true,
    maxAge: 600, // Cache preflight for 10 minutes
  })
);

// ---------------------------------------------------------------------------
// 4. Security headers — CSP, HSTS, X-Frame-Options, etc.
// ---------------------------------------------------------------------------
app.use("/*", securityHeaders());

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
// 7b. Per-user rate limiting — DDoS burst detection and per-user quotas.
// ---------------------------------------------------------------------------
app.use("/*", perUserRateLimitMiddleware());

// ---------------------------------------------------------------------------
// Global error handler — catch unhandled errors and return safe responses
// ---------------------------------------------------------------------------
app.onError((err, c) => {
  logger.error({ error: err.message, stack: err.stack }, "Unhandled error");
  return c.json({ error: "Internal server error" }, 500);
});

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
  } catch (err) {
    logger.error(
      { error: (err as Error).message },
      "Health check: DB connectivity failed"
    );
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
      version: process.env.APP_VERSION ?? "0.0.0",
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

// SLO report — returns current SLO burn rates and violation status
app.get("/slo", (c) => c.json(sloMonitor.getSummary()));

// Liveness probe — lightweight, just confirms process is responsive
app.get("/live", (c) => c.json({ status: "ok" }));

// Readiness probe — checks all dependencies are connected
app.get("/ready", async (c) => {
  const checks: Record<string, boolean> = {};

  try {
    const { db } = await import("@prometheus/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    checks.db = true;
  } catch {
    checks.db = false;
  }

  try {
    const { redis } = await import("@prometheus/queue");
    const pong = await redis.ping();
    checks.redis = pong === "PONG";
  } catch {
    checks.redis = false;
  }

  const allReady = Object.values(checks).every(Boolean);

  if (!allReady) {
    return c.json({ status: "not ready", checks }, 503);
  }
  return c.json({ status: "ready", checks });
});

// Readiness probe (alias) — same as /ready
app.get("/health/ready", async (c) => {
  const checks: Record<string, boolean> = {};

  try {
    const { db } = await import("@prometheus/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql`SELECT 1`);
    checks.db = true;
  } catch {
    checks.db = false;
  }

  try {
    const { redis } = await import("@prometheus/queue");
    const pong = await redis.ping();
    checks.redis = pong === "PONG";
  } catch {
    checks.redis = false;
  }

  const allReady = Object.values(checks).every(Boolean);

  if (!allReady) {
    return c.json({ status: "not ready", checks }, 503);
  }
  return c.json({ status: "ready", checks });
});

// ---------------------------------------------------------------------------
// OpenAPI spec — serves the generated spec as JSON
// ---------------------------------------------------------------------------
app.get("/docs", (c) => {
  const spec = generateOpenAPISpec();
  return c.json(spec);
});

// ---------------------------------------------------------------------------
// REST API v1 — public API for headless/automation use
// ---------------------------------------------------------------------------
app.route("/api/v1", v1App);

// ---------------------------------------------------------------------------
// Fast paths — direct LLM chat and quick actions (bypass queue/orchestrator)
// ---------------------------------------------------------------------------
app.route("/api", fastPathsApp);

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
app.route("/webhooks/ci", ciTriggerApp);

// ---------------------------------------------------------------------------
// OAuth callback routes — browser redirects, no Bearer token required
// ---------------------------------------------------------------------------
app.route("/oauth/github", githubOAuthApp);
app.route("/oauth/gitlab", gitlabOAuthApp);
app.route("/oauth/bitbucket", bitbucketOAuthApp);
app.route("/oauth/slack", slackOAuthApp);

// ---------------------------------------------------------------------------
// Internal: model usage logging (called by model-router, fire-and-forget)
// ---------------------------------------------------------------------------
app.post("/internal/model-usage", async (c) => {
  // Verify internal shared secret to prevent unauthorized usage logging
  const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
  if (internalSecret) {
    const provided = c.req.header("x-internal-secret");
    if (provided !== internalSecret) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  } else if (process.env.NODE_ENV === "production") {
    // In production, reject all requests if secret is not configured
    return c.json({ error: "Unauthorized" }, 401);
  }

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
