import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { trpcServer } from "@hono/trpc-server";
import { createLogger } from "@prometheus/logger";
import { appRouter } from "./routers";
import { createContext } from "./trpc";
import { sseApp } from "./routes/sse";
import { stripeWebhookApp } from "./routes/webhooks/stripe";
import { clerkWebhookApp } from "./routes/webhooks/clerk";

const logger = createLogger("api");
const app = new Hono();

app.use("/*", cors({
  origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  credentials: true,
}));

app.get("/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

app.route("/api/sse", sseApp);

app.route("/webhooks/stripe", stripeWebhookApp);
app.route("/webhooks/clerk", clerkWebhookApp);

app.use("/trpc/*", trpcServer({
  router: appRouter,
  createContext: createContext as unknown as Parameters<typeof trpcServer>[0]["createContext"],
}));

const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, () => {
  logger.info(`API server running on port ${port}`);
});

export type { AppRouter } from "./routers";
