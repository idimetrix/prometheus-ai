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

app.get("/health", (c) => c.json({ status: "ok" }));

// Route a completion request to the best available model
app.post("/v1/chat/completions", async (c) => {
  const body = await c.req.json();
  const result = await routerService.routeCompletion(body);
  return c.json(result);
});

// Get available models and their status
app.get("/v1/models", (c) => {
  const models = routerService.getAvailableModels();
  return c.json({ data: models });
});

// Get rate limit status for all providers
app.get("/v1/rate-limits", (c) => {
  const status = rateLimiter.getStatus();
  return c.json(status);
});

const port = Number(process.env.MODEL_ROUTER_PORT ?? 4002);

serve({ fetch: app.fetch, port }, () => {
  logger.info(`Model Router running on port ${port}`);
});
