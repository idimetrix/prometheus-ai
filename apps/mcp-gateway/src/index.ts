import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createLogger } from "@prometheus/logger";
import { ToolRegistry } from "./registry";
import { registerGitHubAdapter } from "./adapters/github";
import { registerGitLabAdapter } from "./adapters/gitlab";
import { registerLinearAdapter } from "./adapters/linear";
import { registerJiraAdapter } from "./adapters/jira";
import { registerSlackAdapter } from "./adapters/slack";
import { registerVercelAdapter } from "./adapters/vercel";
import { registerFigmaAdapter } from "./adapters/figma";

const logger = createLogger("mcp-gateway");
const app = new Hono();
const registry = new ToolRegistry();

app.use("/*", cors());

// Register all adapters
registerGitHubAdapter(registry);
registerGitLabAdapter(registry);
registerLinearAdapter(registry);
registerJiraAdapter(registry);
registerSlackAdapter(registry);
registerVercelAdapter(registry);
registerFigmaAdapter(registry);

// ---- Health ----

app.get("/health", (c) => {
  return c.json({
    status: "ok",
    toolCount: registry.getToolCount(),
    adapters: registry.getAdapters(),
    timestamp: new Date().toISOString(),
  });
});

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
 * GET /tools/:adapter - List tools by adapter
 */
app.get("/tools/:adapter", (c) => {
  const adapter = c.req.param("adapter");
  const tools = registry.listToolsByAdapter(adapter);

  if (tools.length === 0) {
    return c.json({ error: `No tools found for adapter: ${adapter}` }, 404);
  }

  return c.json({ adapter, tools, count: tools.length });
});

// ---- Tool Execution ----

/**
 * POST /tools/:toolName/execute
 * Body: { input: Record<string, unknown>, credentials?: Record<string, string>, orgId?: string }
 */
app.post("/tools/:toolName/execute", async (c) => {
  const toolName = c.req.param("toolName");

  try {
    const body = await c.req.json<{
      input?: Record<string, unknown>;
      credentials?: Record<string, string>;
      orgId?: string;
    }>();

    const toolDef = registry.getTool(toolName);
    if (!toolDef) {
      return c.json({ success: false, error: `Tool not found: ${toolName}` }, 404);
    }

    const result = await registry.execute(toolName, body.input ?? {}, {
      credentials: body.credentials,
      orgId: body.orgId,
    });

    const statusCode = result.success ? 200 : 400;
    return c.json(result, statusCode);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ toolName, error: msg }, "Tool execution failed");
    return c.json({ success: false, error: msg }, 500);
  }
});

// ---- Credential Management ----

/**
 * In-memory credential store (in production, use encrypted DB storage).
 */
const credentialStore = new Map<string, Record<string, string>>();

/**
 * POST /credentials/:provider
 * Body: { orgId: string, credentials: Record<string, string> }
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

    const key = `${body.orgId}:${provider}`;
    const existing = credentialStore.get(key) ?? {};
    credentialStore.set(key, { ...existing, ...body.credentials });

    logger.info({ provider, orgId: body.orgId }, "Credentials stored");

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
app.get("/credentials/:provider", (c) => {
  const provider = c.req.param("provider");
  const orgId = c.req.query("orgId");

  if (!orgId) {
    return c.json({ error: "orgId query parameter is required" }, 400);
  }

  const key = `${orgId}:${provider}`;
  const creds = credentialStore.get(key);

  if (!creds) {
    return c.json({ configured: false, keys: [] });
  }

  return c.json({
    configured: true,
    keys: Object.keys(creds),
  });
});

// ---- Audit Log ----

app.get("/audit", (c) => {
  const limit = parseInt(c.req.query("limit") ?? "100", 10);
  return c.json({ entries: registry.getAuditLog(limit) });
});

// ---- Start ----

const port = Number(process.env.MCP_GATEWAY_PORT ?? 4004);

serve({ fetch: app.fetch, port }, () => {
  logger.info(
    { toolCount: registry.getToolCount(), adapters: registry.getAdapters() },
    `MCP Gateway running on port ${port}`
  );
});
