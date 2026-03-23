import { serve } from "@hono/node-server";
import { createLogger } from "@prometheus/logger";
import { initSentry, traceMiddleware } from "@prometheus/telemetry";
import {
  installShutdownHandlers,
  isProcessShuttingDown,
} from "@prometheus/utils";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { registerConfluenceAdapter } from "./adapters/confluence";
import { registerDatadogAdapter } from "./adapters/datadog";
import { registerDockerHubAdapter } from "./adapters/docker-hub";
import { registerFigmaAdapter } from "./adapters/figma";
import { registerGitHubAdapter } from "./adapters/github";
import { registerGitLabAdapter } from "./adapters/gitlab";
import { registerJiraAdapter } from "./adapters/jira";
import { registerLinearAdapter } from "./adapters/linear";
import { registerSentryAdapter } from "./adapters/sentry";
import { registerSlackAdapter } from "./adapters/slack";
import { registerVercelAdapter } from "./adapters/vercel";
import { CredentialStore } from "./credential-store";
import { ToolRegistry } from "./registry";

initSentry({ serviceName: "mcp-gateway" });
installShutdownHandlers();

const logger = createLogger("mcp-gateway");
const app = new Hono();
const registry = new ToolRegistry();
const credentialStore = new CredentialStore();

// Load persisted credentials from DB on startup
credentialStore.loadAll().catch((err) => {
  logger.error({ err }, "Failed to load credentials from DB on startup");
});

app.use("/*", cors());
app.use("/*", traceMiddleware("mcp-gateway"));

// Register all adapters
registerGitHubAdapter(registry);
registerGitLabAdapter(registry);
registerLinearAdapter(registry);
registerJiraAdapter(registry);
registerSlackAdapter(registry);
registerVercelAdapter(registry);
registerFigmaAdapter(registry);

// Credential-based adapters — available for hot-loading via the plugin system.
// These require explicit credentials at registration time. When credentials are
// provided (e.g. via environment variables or the credential store), uncomment
// the corresponding registration call.
if (process.env.CONFLUENCE_TOKEN && process.env.CONFLUENCE_CLOUD_ID) {
  registerConfluenceAdapter(registry, {
    token: process.env.CONFLUENCE_TOKEN,
    cloudId: process.env.CONFLUENCE_CLOUD_ID,
  });
}

if (process.env.DATADOG_API_KEY && process.env.DATADOG_APP_KEY) {
  registerDatadogAdapter(registry, {
    apiKey: process.env.DATADOG_API_KEY,
    appKey: process.env.DATADOG_APP_KEY,
  });
}

if (process.env.SENTRY_TOKEN && process.env.SENTRY_ORG) {
  registerSentryAdapter(registry, {
    token: process.env.SENTRY_TOKEN,
    org: process.env.SENTRY_ORG,
  });
}

if (process.env.DOCKERHUB_TOKEN && process.env.DOCKERHUB_NAMESPACE) {
  registerDockerHubAdapter(registry, {
    token: process.env.DOCKERHUB_TOKEN,
    namespace: process.env.DOCKERHUB_NAMESPACE,
  });
}

// Start health checks (every 5 minutes)
registry.startHealthChecks(5 * 60 * 1000);

// ---- Health ----

app.get("/health", async (c) => {
  if (isProcessShuttingDown()) {
    return c.json({ status: "draining" }, 503);
  }
  const checks: Record<string, boolean> = {};
  const healthStatuses = registry.getHealthStatuses();

  // Check adapter health (at least one adapter healthy)
  const anyAdapterHealthy =
    healthStatuses.length === 0 || healthStatuses.some((s) => s.healthy);
  checks.adapters = anyAdapterHealthy;

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
      uptime: Math.floor(process.uptime()),
      version: "0.1.0",
      service: "mcp-gateway",
      toolCount: registry.getToolCount(),
      adapters: registry.getAdapters(),
      adapterHealth: healthStatuses,
      timestamp: new Date().toISOString(),
    },
    allHealthy ? 200 : 503
  );
});

// Liveness probe — lightweight, just confirms process is responsive
app.get("/live", (c) => c.json({ status: "ok" }));

// Readiness probe — can accept traffic
app.get("/ready", (c) => c.json({ status: "ready" }));

// ---- Tool Discovery ----

/**
 * GET /tools - List all available tools
 * Query: ?category=github  (optional filter by adapter/category)
 */
app.get("/tools", (c) => {
  const category = c.req.query("category");
  const tools = category ? registry.discover(category) : registry.listTools();
  return c.json({
    tools,
    count: tools.length,
    adapters: registry.getAdapters(),
  });
});

/**
 * GET /tools/grouped - List all tools grouped by adapter/provider
 */
app.get("/tools/grouped", (c) => {
  const grouped = registry.discoverGrouped();
  const summary = Object.entries(grouped).map(([adapter, tools]) => ({
    adapter,
    toolCount: tools.length,
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      requiresAuth: t.requiresAuth,
    })),
  }));

  return c.json({
    providers: summary,
    totalTools: registry.getToolCount(),
    totalAdapters: registry.getAdapters().length,
  });
});

/**
 * GET /tools/:adapter - List tools by adapter
 */
app.get("/tools/:adapter", (c) => {
  const adapter = c.req.param("adapter");
  if (adapter === "grouped") {
    return c.notFound();
  }

  const tools = registry.listToolsByAdapter(adapter);

  if (tools.length === 0) {
    return c.json({ error: `No tools found for adapter: ${adapter}` }, 404);
  }

  return c.json({ adapter, tools, count: tools.length });
});

// ---- Tool Execution ----

/**
 * POST /tools/:toolName/execute
 * Body: { input: Record<string, unknown>, credentials?: Record<string, string>, orgId?: string, projectId?: string }
 */
app.post("/tools/:toolName/execute", async (c) => {
  const toolName = c.req.param("toolName");

  try {
    const body = await c.req.json<{
      input?: Record<string, unknown>;
      credentials?: Record<string, string>;
      orgId?: string;
      projectId?: string;
    }>();

    const toolDef = registry.getTool(toolName);
    if (!toolDef) {
      return c.json(
        { success: false, error: `Tool not found: ${toolName}` },
        404
      );
    }

    // If no explicit credentials provided, try to load from persistent store
    let credentials = body.credentials;
    if (!credentials && body.orgId && toolDef.requiresAuth) {
      credentials = await credentialStore.retrieve(body.orgId, toolDef.adapter);
    }

    const result = await registry.execute(toolName, body.input ?? {}, {
      credentials,
      orgId: body.orgId,
      projectId: body.projectId,
    });

    const statusCode = result.success ? 200 : 400;
    return c.json(result, statusCode);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ toolName, error: msg }, "Tool execution failed");
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---- Credential Management (Persistent + Encrypted) ----

/**
 * POST /credentials/:provider
 * Body: { orgId: string, credentials: Record<string, string> }
 *
 * Credentials are stored encrypted in PostgreSQL via the CredentialStore.
 */
app.post("/credentials/:provider", async (c) => {
  const provider = c.req.param("provider");

  try {
    const body = await c.req.json<{
      orgId: string;
      credentials: Record<string, string>;
    }>();

    if (!body.orgId) {
      return c.json({ error: "orgId is required" }, 400);
    }
    if (!body.credentials || typeof body.credentials !== "object") {
      return c.json({ error: "credentials object is required" }, 400);
    }

    await credentialStore.store(body.orgId, provider, body.credentials);

    logger.info(
      { provider, orgId: body.orgId },
      "Credentials stored (encrypted, persistent)"
    );

    return c.json({
      success: true,
      provider,
      orgId: body.orgId,
      keys: Object.keys(body.credentials),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

/**
 * GET /credentials/:provider?orgId=...
 * Returns stored credential keys (not values) for validation.
 */
app.get("/credentials/:provider", async (c) => {
  const provider = c.req.param("provider");
  const orgId = c.req.query("orgId");

  if (!orgId) {
    return c.json({ error: "orgId query parameter is required" }, 400);
  }

  const creds = await credentialStore.retrieve(orgId, provider);

  if (!creds) {
    return c.json({ configured: false, keys: [] });
  }

  return c.json({
    configured: true,
    keys: Object.keys(creds),
  });
});

/**
 * DELETE /credentials/:provider
 * Body: { orgId: string }
 */
app.delete("/credentials/:provider", async (c) => {
  const provider = c.req.param("provider");

  try {
    const body = await c.req.json<{ orgId: string }>();

    if (!body.orgId) {
      return c.json({ error: "orgId is required" }, 400);
    }

    const deleted = await credentialStore.delete(body.orgId, provider);

    return c.json({
      success: true,
      provider,
      orgId: body.orgId,
      deleted,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

// ---- Per-project tool configuration ----

/**
 * GET /projects/:projectId/tools - List tools available for a project
 */
app.get("/projects/:projectId/tools", (c) => {
  const projectId = c.req.param("projectId");
  const tools = registry.getProjectTools(projectId);
  const configs = registry.getProjectToolConfigs(projectId);

  return c.json({
    projectId,
    tools: tools.map((t) => {
      const config = configs.find((cfg) => cfg.toolName === t.name);
      return {
        ...t,
        enabled: config ? config.enabled : true,
        projectConfig: config?.config ?? null,
      };
    }),
    count: tools.length,
  });
});

/**
 * PUT /projects/:projectId/tools/:toolName - Configure a tool for a project
 * Body: { enabled: boolean, config?: Record<string, unknown> }
 */
app.put("/projects/:projectId/tools/:toolName", async (c) => {
  const projectId = c.req.param("projectId");
  const toolName = c.req.param("toolName");

  try {
    const body = await c.req.json<{
      enabled: boolean;
      config?: Record<string, unknown>;
    }>();

    const toolDef = registry.getTool(toolName);
    if (!toolDef) {
      return c.json({ error: `Tool not found: ${toolName}` }, 404);
    }

    registry.setProjectToolConfig(
      projectId,
      toolName,
      body.enabled,
      body.config
    );

    return c.json({
      success: true,
      projectId,
      toolName,
      enabled: body.enabled,
      config: body.config ?? null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return c.json({ error: msg }, 500);
  }
});

/**
 * GET /projects/:projectId/tools/config - Get all tool configs for a project
 */
app.get("/projects/:projectId/tools/config", (c) => {
  const projectId = c.req.param("projectId");
  const configs = registry.getProjectToolConfigs(projectId);

  return c.json({
    projectId,
    configs,
    count: configs.length,
  });
});

// ---- Adapter Management (Dynamic register/unregister) ----

/**
 * DELETE /adapters/:adapter - Unregister all tools for an adapter
 */
app.delete("/adapters/:adapter", (c) => {
  const adapter = c.req.param("adapter");
  const removedCount = registry.unregisterAdapter(adapter);

  if (removedCount === 0) {
    return c.json({ error: `No tools found for adapter: ${adapter}` }, 404);
  }

  return c.json({
    success: true,
    adapter,
    removedTools: removedCount,
    remainingAdapters: registry.getAdapters(),
    remainingToolCount: registry.getToolCount(),
  });
});

/**
 * GET /adapters/health - Get health status for all adapters
 */
app.get("/adapters/health", (c) => {
  const statuses = registry.getHealthStatuses();
  const adapters = registry.getAdapters();

  return c.json({
    adapters: adapters.map((name) => {
      const health = statuses.find((s) => s.adapter === name);
      return {
        name,
        toolCount: registry.listToolsByAdapter(name).length,
        health: health ?? {
          adapter: name,
          healthy: true,
          lastCheck: "never",
          latencyMs: 0,
        },
      };
    }),
  });
});

// ---- Audit Log ----

app.get("/audit", (c) => {
  const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
  return c.json({ entries: registry.getAuditLog(limit) });
});

// ---- Start ----

const port = Number(process.env.MCP_GATEWAY_PORT ?? 4005);

serve({ fetch: app.fetch, port }, () => {
  logger.info(
    { toolCount: registry.getToolCount(), adapters: registry.getAdapters() },
    `MCP Gateway running on port ${port}`
  );
});
