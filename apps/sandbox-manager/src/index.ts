import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createLogger } from "@prometheus/logger";
import { SandboxPool } from "./pool";
import { ContainerManager } from "./container";

const logger = createLogger("sandbox-manager");
const app = new Hono();

const containerManager = new ContainerManager();
const sandboxPool = new SandboxPool(containerManager);

app.get("/health", (c) => c.json({ status: "ok" }));

// Create a new sandbox for a session
app.post("/sandboxes", async (c) => {
  const body = await c.req.json();
  const sandbox = await sandboxPool.acquire(body.sessionId, body.projectId);
  return c.json(sandbox);
});

// Get sandbox status
app.get("/sandboxes/:sandboxId", async (c) => {
  const sandboxId = c.req.param("sandboxId");
  const status = sandboxPool.getStatus(sandboxId);
  return c.json(status ?? { error: "Sandbox not found" }, status ? 200 : 404);
});

// Execute command in sandbox
app.post("/sandboxes/:sandboxId/exec", async (c) => {
  const sandboxId = c.req.param("sandboxId");
  const body = await c.req.json();
  const result = await containerManager.exec(sandboxId, body.command, body.workDir);
  return c.json(result);
});

// Release a sandbox
app.delete("/sandboxes/:sandboxId", async (c) => {
  const sandboxId = c.req.param("sandboxId");
  await sandboxPool.release(sandboxId);
  return c.json({ success: true });
});

// Get pool stats
app.get("/pool/stats", (c) => {
  return c.json(sandboxPool.getStats());
});

const port = Number(process.env.SANDBOX_MANAGER_PORT ?? 4003);

serve({ fetch: app.fetch, port }, () => {
  logger.info(`Sandbox Manager running on port ${port}`);
});
