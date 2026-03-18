import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createLogger } from "@prometheus/logger";
import { ModelRouterService } from "./router";
import { RateLimitManager } from "./rate-limiter";

const logger = createLogger("model-router");
const app = new Hono();

app.use("/*", cors());

const rateLimiter = new RateLimitManager();
const routerService = new ModelRouterService(rateLimiter);

// ─── Health Check ────────────────────────────────────────────────

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "model-router",
    timestamp: new Date().toISOString(),
  })
);

// ─── Slot-Based Route (Primary API) ─────────────────────────────

app.post("/route", async (c) => {
  try {
    const body = await c.req.json();
    const { slot, messages, options } = body;

    if (!slot || !messages || !Array.isArray(messages)) {
      return c.json(
        { error: "Request must include 'slot' (string) and 'messages' (array)" },
        400
      );
    }

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
    if (!messages || !Array.isArray(messages)) {
      return c.json({ error: "'messages' array is required" }, 400);
    }
    const estimate = routerService.estimateTokenCount(messages);
    const recommendedSlot = routerService.selectSlot(estimate, body.task_type);
    return c.json({ estimated_tokens: estimate, recommended_slot: recommendedSlot });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 400);
  }
});

// ─── Start Server ───────────────────────────────────────────────

const port = Number(process.env.MODEL_ROUTER_PORT ?? 4002);

serve({ fetch: app.fetch, port }, () => {
  logger.info({ port }, "Model Router running");
});

export { ModelRouterService, RateLimitManager };
