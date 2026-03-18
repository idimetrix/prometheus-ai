import { serve } from "@hono/node-server";
import { createLogger } from "@prometheus/logger";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { BYOModelManager } from "./byo-model";
import { RateLimitManager } from "./rate-limiter";
import { ModelRouterService } from "./router";

const logger = createLogger("model-router");
const app = new Hono();

app.use("/*", cors());

const rateLimiter = new RateLimitManager();
const routerService = new ModelRouterService(rateLimiter);
const byoManager = new BYOModelManager();

// ─── Health Check (verifies connectivity to all configured providers) ──

app.get("/health", async (c) => {
  try {
    const checks: Record<string, boolean> = {};

    const providerHealth = await routerService.checkProviderHealth();
    const allHealthy = Object.values(providerHealth).every((h) => h);
    const anyHealthy = Object.values(providerHealth).some((h) => h);
    checks.providers = anyHealthy;

    // Check Redis connectivity
    try {
      const { redis } = await import("@prometheus/queue");
      const pong = await redis.ping();
      checks.redis = pong === "PONG";
    } catch {
      checks.redis = false;
    }

    let status: "ok" | "degraded" | "unhealthy";
    if (allHealthy) {
      status = "ok";
    } else if (anyHealthy) {
      status = "degraded";
    } else {
      status = "unhealthy";
    }
    const statusCode = status === "unhealthy" ? 503 : 200;

    return c.json(
      {
        status,
        checks,
        uptime: Math.floor(process.uptime()),
        version: "0.1.0",
        service: "model-router",
        providers: providerHealth,
        timestamp: new Date().toISOString(),
      },
      statusCode
    );
  } catch (error) {
    return c.json(
      {
        status: "unhealthy",
        checks: { providers: false },
        uptime: Math.floor(process.uptime()),
        version: "0.1.0",
        service: "model-router",
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      },
      503
    );
  }
});

// ─── Models listing ─────────────────────────────────────────────

app.get("/models", (c) => {
  const models = routerService.getAvailableModels();
  return c.json({ data: models });
});

// ─── Slot-Based Route (Primary API) ─────────────────────────────

app.post("/route", async (c) => {
  try {
    const body = await c.req.json();
    const { slot, messages, stream: wantsStream, maxTokens } = body;

    if (!(slot && messages && Array.isArray(messages))) {
      return c.json(
        {
          error: "Request must include 'slot' (string) and 'messages' (array)",
        },
        400
      );
    }

    const options = {
      ...body.options,
      maxTokens: maxTokens ?? body.options?.maxTokens,
      stream: wantsStream ?? body.options?.stream,
    };

    // Streaming response (SSE format, compatible with OpenAI streaming)
    if (options.stream) {
      return streamSSE(c, async (sseStream) => {
        try {
          const streamResult = await routerService.routeStream({
            slot,
            messages,
            options,
          });

          for await (const chunk of streamResult.stream) {
            await sseStream.writeSSE({
              data: JSON.stringify({
                id: streamResult.id,
                model: streamResult.model,
                provider: streamResult.provider,
                choices: [
                  {
                    delta: { content: chunk.content },
                    finish_reason: chunk.finishReason,
                  },
                ],
              }),
            });
          }

          // Send final usage event
          const done = await streamResult.done;
          await sseStream.writeSSE({
            data: JSON.stringify({
              id: streamResult.id,
              model: streamResult.model,
              provider: streamResult.provider,
              choices: [{ delta: {}, finish_reason: "stop" }],
              usage: done.usage,
            }),
          });

          await sseStream.writeSSE({ data: "[DONE]" });
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error({ error: msg }, "Streaming route request failed");
          await sseStream.writeSSE({ data: JSON.stringify({ error: msg }) });
        }
      });
    }

    // Non-streaming response
    const result = await routerService.route({ slot, messages, options });
    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Route request failed");
    return c.json({ error: msg }, 500);
  }
});

// ─── Legacy Completions Endpoint ────────────────────────────────

app.post("/v1/chat/completions", async (c) => {
  try {
    const body = await c.req.json();
    const result = await routerService.routeCompletion(body);
    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Completion request failed");
    return c.json({ error: msg }, 500);
  }
});

// ─── Model Information ──────────────────────────────────────────

app.get("/v1/models", (c) => {
  const models = routerService.getAvailableModels();
  return c.json({ data: models });
});

app.get("/v1/slots", (c) => {
  const slots = routerService.getSlotConfigs();
  return c.json({ data: slots });
});

// ─── Rate Limit Status ──────────────────────────────────────────

app.get("/v1/rate-limits", async (c) => {
  const status = await rateLimiter.getStatus();
  return c.json(status);
});

// ─── Token Estimation ───────────────────────────────────────────

app.post("/v1/estimate-tokens", async (c) => {
  try {
    const body = await c.req.json();
    const { messages } = body;
    if (!(messages && Array.isArray(messages))) {
      return c.json({ error: "'messages' array is required" }, 400);
    }
    const estimate = routerService.estimateTokenCount(messages);
    const recommendedSlot = routerService.selectSlot(estimate, body.task_type);
    return c.json({
      estimated_tokens: estimate,
      recommended_slot: recommendedSlot,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 400);
  }
});

// ─── BYO Model Endpoints ─────────────────────────────────────────

/**
 * POST /v1/byo/keys - Register a user's API key for a model provider
 * Body: { orgId, userId, provider, apiKey, baseUrl?, preferredModels? }
 */
app.post("/v1/byo/keys", async (c) => {
  try {
    const body = await c.req.json();
    const { orgId, userId, provider, apiKey, baseUrl, preferredModels } = body;

    if (!(orgId && provider && apiKey)) {
      return c.json({ error: "orgId, provider, and apiKey are required" }, 400);
    }

    const config = byoManager.addUserKey({
      orgId,
      userId: userId ?? "unknown",
      provider,
      apiKey,
      baseUrl,
      preferredModels,
    });

    return c.json({
      success: true,
      provider: config.provider,
      verified: config.verified,
      createdAt: config.createdAt.toISOString(),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

/**
 * DELETE /v1/byo/keys/:provider - Remove a user's API key
 * Query: ?orgId=...
 */
app.delete("/v1/byo/keys/:provider", (c) => {
  const provider = c.req.param("provider");
  const orgId = c.req.query("orgId");

  if (!orgId) {
    return c.json({ error: "orgId query parameter is required" }, 400);
  }

  const removed = byoManager.removeUserKey(orgId, provider);
  return c.json({ success: true, removed });
});

/**
 * GET /v1/byo/keys - List configured providers for an org
 * Query: ?orgId=...
 */
app.get("/v1/byo/keys", (c) => {
  const orgId = c.req.query("orgId");
  if (!orgId) {
    return c.json({ error: "orgId query parameter is required" }, 400);
  }

  const providers = byoManager.getConfiguredProviders(orgId);
  return c.json({ data: providers });
});

/**
 * POST /v1/byo/test - Test an API key by making a simple completion
 * Body: { provider, apiKey, model?, baseUrl? }
 */
app.post("/v1/byo/test", async (c) => {
  try {
    const body = await c.req.json();
    const { provider, apiKey, model, baseUrl } = body;

    if (!(provider && apiKey)) {
      return c.json({ error: "provider and apiKey are required" }, 400);
    }

    const result = await byoManager.testModel({
      provider,
      apiKey,
      model,
      baseUrl,
    });
    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

/**
 * POST /v1/byo/verify/:provider - Verify a stored key for a provider
 * Body: { orgId }
 */
app.post("/v1/byo/verify/:provider", async (c) => {
  try {
    const provider = c.req.param("provider");
    const body = await c.req.json();

    if (!body.orgId) {
      return c.json({ error: "orgId is required" }, 400);
    }

    const result = await byoManager.verifyUserKey(body.orgId, provider);
    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

/**
 * GET /v1/byo/providers - List supported providers for BYO keys
 */
app.get("/v1/byo/providers", (c) => {
  const providers = byoManager.getSupportedProviders();
  return c.json({ data: providers });
});

// ─── Prometheus Metrics ──────────────────────────────────────

app.get("/metrics", async (c) => {
  const { metricsRegistry } = await import("@prometheus/telemetry");
  return c.text(metricsRegistry.render(), 200, {
    "Content-Type": "text/plain; charset=utf-8",
  });
});

// ─── Start Server ───────────────────────────────────────────────

const port = Number(process.env.MODEL_ROUTER_PORT ?? 4004);

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port }, "Model Router running");
});

export { BYOModelManager } from "./byo-model";
export { RateLimitManager } from "./rate-limiter";
export { ModelRouterService } from "./router";
