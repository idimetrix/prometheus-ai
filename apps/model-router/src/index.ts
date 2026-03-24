import { serve } from "@hono/node-server";
import { createLogger } from "@prometheus/logger";
import {
  initSentry,
  initTelemetry,
  traceMiddleware,
} from "@prometheus/telemetry";
import {
  installShutdownHandlers,
  isProcessShuttingDown,
} from "@prometheus/utils";
import { Hono, type Context as HonoContext } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { BYOModelManager } from "./byo-model";
import { CascadeRouter } from "./cascade";
import { CostOptimizer } from "./cost-optimizer";
import { isMockLLMEnabled, mockRoute, mockRouteStream } from "./mock-provider";
import { PromptCacheManager } from "./prompt-cache";
import { RateLimitManager } from "./rate-limiter";
import { NearIdenticalCoalescer } from "./request-coalescer";
import { ModelRouterService, routeEmbedding } from "./router";

await initTelemetry({ serviceName: "model-router" });
initSentry({ serviceName: "model-router" });
installShutdownHandlers();

const logger = createLogger("model-router");
const app = new Hono();

app.use("/*", cors());
app.use("/*", traceMiddleware("model-router"));

const rateLimiter = new RateLimitManager();
const routerService = new ModelRouterService(rateLimiter);
const cascadeRouter = new CascadeRouter(routerService);
const byoManager = new BYOModelManager();
const promptCacheManager = new PromptCacheManager();
const requestCoalescer = new NearIdenticalCoalescer();
const costOptimizer = new CostOptimizer();

// ─── Health Check (verifies connectivity to all configured providers) ──

app.get("/health", async (c) => {
  if (isProcessShuttingDown()) {
    return c.json({ status: "draining" }, 503);
  }

  // In mock mode, always report healthy — no real providers needed
  if (isMockLLMEnabled()) {
    return c.json({
      status: "ok",
      checks: { providers: true, redis: true },
      uptime: Math.floor(process.uptime()),
      version: "0.1.0",
      service: "model-router",
      mode: "mock",
      providers: { mock: { healthy: true, latencyMs: 0 } },
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const checks: Record<string, boolean> = {};

    const providerHealth = await routerService.checkProviderHealth();
    const allHealthy = Object.values(providerHealth).every((h) => h.healthy);
    const anyHealthy = Object.values(providerHealth).some((h) => h.healthy);
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

// Liveness probe — lightweight, just confirms process is responsive
app.get("/live", (c) => c.json({ status: "ok" }));

// Readiness probe — can accept traffic
app.get("/ready", (c) => c.json({ status: "ready" }));

// ─── Models listing ─────────────────────────────────────────────

app.get("/models", (c) => {
  const models = routerService.getAvailableModels();
  return c.json({ data: models });
});

// ─── Mock LLM Handler ───────────────────────────────────────────

/**
 * Handle a mock LLM request — returns canned responses without calling
 * real providers. Used when DEV_MOCK_LLM=true.
 */
function handleMockRoute(
  c: HonoContext,
  slot: string,
  messages: Array<{ role: string; content: string }>,
  wantsStream: boolean | undefined,
  options?: Record<string, unknown>
) {
  const mockReq = { slot, messages, options };

  if (wantsStream && !(options?.tools as unknown[] | undefined)?.length) {
    return streamSSE(c, async (sseStream) => {
      const streamResult = mockRouteStream(mockReq);
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
    });
  }

  return c.json(mockRoute(mockReq));
}

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

    // Mock LLM mode — return canned responses without calling real providers
    if (isMockLLMEnabled()) {
      return handleMockRoute(c, slot, messages, wantsStream, body.options);
    }

    const options = {
      ...body.options,
      maxTokens: maxTokens ?? body.options?.maxTokens,
      stream: wantsStream ?? body.options?.stream,
    };

    // Apply prompt caching headers for system prompts
    const systemMessage = messages.find(
      (m: { role: string }) => m.role === "system"
    );
    if (systemMessage?.content) {
      const provider = body.provider ?? "anthropic";
      const cacheHeaders = promptCacheManager.getCacheHeaders(
        provider,
        typeof systemMessage.content === "string"
          ? systemMessage.content
          : JSON.stringify(systemMessage.content)
      );
      if (Object.keys(cacheHeaders).length > 0) {
        options.cacheHeaders = cacheHeaders;
      }
    }

    // When tools are present, use non-streaming path since SSE streaming
    // doesn't support tool_call deltas. The orchestrator's callModelRouter
    // already handles JSON responses alongside SSE.
    const hasTools = Array.isArray(options.tools) && options.tools.length > 0;

    // Streaming response (SSE format, compatible with OpenAI streaming)
    if (options.stream && !hasTools) {
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

    // Non-streaming response — deduplicate near-identical requests
    const lastUserMsg =
      [...messages].reverse().find((m: { role: string }) => m.role === "user")
        ?.content ?? "";
    const promptKey = `${slot}:${typeof lastUserMsg === "string" ? lastUserMsg : JSON.stringify(lastUserMsg)}`;
    const result = await requestCoalescer.coalesce(promptKey, () =>
      routerService.route({ slot, messages, options })
    );
    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Route request failed");
    return c.json({ error: msg }, 500);
  }
});

// ─── Embeddings Endpoint ─────────────────────────────────────────

app.post("/v1/embeddings", async (c) => {
  try {
    const body = await c.req.json();
    const { input } = body as { input: string | string[]; model?: string };

    if (!input) {
      return c.json(
        { error: "'input' field is required (string or string[])" },
        400
      );
    }

    // Mock embeddings — return a zero vector for dev/testing
    if (isMockLLMEnabled()) {
      const dimensions = 1536;
      const inputs = Array.isArray(input) ? input : [input];
      return c.json({
        data: inputs.map((_, idx) => ({
          embedding: new Array(dimensions)
            .fill(0)
            .map(() => Math.random() * 0.01 - 0.005),
          index: idx,
        })),
        model: "mock/embedding-model",
        usage: { prompt_tokens: 10, total_tokens: 10 },
      });
    }

    const result = await routeEmbedding(input);
    return c.json({
      data: [{ embedding: result.embedding, index: 0 }],
      model: result.model,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Embedding request failed");
    return c.json({ error: msg }, 500);
  }
});

// ─── Legacy Completions Endpoint ────────────────────────────────

app.post("/v1/chat/completions", async (c) => {
  try {
    const body = await c.req.json();

    // Mock mode for legacy completions endpoint
    if (isMockLLMEnabled()) {
      const messages = body.messages ?? [];
      const result = mockRoute({
        slot: "default",
        messages,
        options: { tools: body.tools },
      });
      return c.json({
        id: result.id,
        model: result.model,
        provider: result.provider,
        choices: result.choices,
        usage: result.usage,
      });
    }

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

// ─── Cost Report ────────────────────────────────────────────

/**
 * GET /v1/cost-report - Cost breakdown showing free vs paid model usage
 * and estimated savings compared to an all-premium approach.
 */
app.get("/v1/cost-report", (c) => {
  const dailySpend = costOptimizer.getDailySpend();
  const profiles = costOptimizer.getProfiles();
  const promptCacheStats = promptCacheManager.getCacheHitRates();
  const cascadeMetrics = cascadeRouter.getMetrics();

  // Estimate all-premium cost: assume every request at $9/M tokens (Sonnet pricing)
  const totalRequests =
    Math.round(dailySpend.freePercentage + dailySpend.paidPercentage) || 0;
  const estimatedPremiumCostPerRequest = 0.018; // ~2K tokens at $9/M
  const allPremiumEstimate = totalRequests * estimatedPremiumCostPerRequest;
  const actualCost = dailySpend.totalUsd;
  const savingsUsd = Math.max(0, allPremiumEstimate - actualCost);
  const savingsPercent =
    allPremiumEstimate > 0 ? (savingsUsd / allPremiumEstimate) * 100 : 0;

  return c.json({
    daily: {
      totalCostUsd: Math.round(actualCost * 10_000) / 10_000,
      freePercent: Math.round(dailySpend.freePercentage * 10) / 10,
      freeCloudPercent: 0,
      paidPercent: Math.round(dailySpend.paidPercentage * 10) / 10,
    },
    savings: {
      allPremiumEstimateUsd: Math.round(allPremiumEstimate * 10_000) / 10_000,
      actualCostUsd: Math.round(actualCost * 10_000) / 10_000,
      savingsUsd: Math.round(savingsUsd * 10_000) / 10_000,
      savingsPercent: Math.round(savingsPercent * 10) / 10,
    },
    promptCache: promptCacheStats,
    cascade: cascadeMetrics,
    profiles: profiles.slice(0, 20),
  });
});

// ─── Cascade Routing ─────────────────────────────────────────

app.post("/v1/cascade/route", async (c) => {
  try {
    const body = await c.req.json();
    const { slot, messages } = body;

    if (!(slot && messages && Array.isArray(messages))) {
      return c.json(
        { error: "Request must include 'slot' and 'messages'" },
        400
      );
    }

    const result = await cascadeRouter.route({
      slot,
      messages,
      options: body.options,
    });
    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ error: msg }, "Cascade route request failed");
    return c.json({ error: msg }, 500);
  }
});

app.get("/v1/cascade/metrics", (c) => {
  const metrics = cascadeRouter.getMetrics();
  return c.json({ data: metrics });
});

// ─── Prometheus Metrics ──────────────────────────────────────

app.get("/metrics", async (c) => {
  const { metricsRegistry } = await import("@prometheus/telemetry");
  return c.text(await metricsRegistry.render(), 200, {
    "Content-Type": "text/plain; charset=utf-8",
  });
});

// ─── Start Server ───────────────────────────────────────────────

const port = Number(process.env.MODEL_ROUTER_PORT ?? 4004);

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port }, "Model Router running");
});

export type {
  ExperimentConfig,
  ExperimentMetrics,
  ExperimentResults,
} from "./ab-testing";
export { ABTestManager } from "./ab-testing";
export type {
  BenchmarkResult,
  EndpointValidationResult,
  RegisteredModel,
} from "./byo-model";
export { BYOModelManager } from "./byo-model";
export type { QualityAssessment } from "./cascade";
export { CascadeRouter } from "./cascade";
export type { OptimalModelResult } from "./cost-monitor";
export { CostMonitor } from "./cost-monitor";
export type { CostOptimizationResult, CostProfile } from "./cost-optimizer";
export { CostOptimizer } from "./cost-optimizer";
export { isMockLLMEnabled, mockRoute, mockRouteStream } from "./mock-provider";
export { PromptCacheManager } from "./prompt-cache";
export { RateLimitManager } from "./rate-limiter";
export type { CoalescingStats } from "./request-coalescer";
export { NearIdenticalCoalescer, normalizePrompt } from "./request-coalescer";
export { ModelRouterService } from "./router";
