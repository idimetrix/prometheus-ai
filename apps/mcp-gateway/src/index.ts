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

app.get("/health", (c) => c.json({ status: "ok" }));

// Discover available tools
app.get("/tools", (c) => {
  return c.json({ tools: registry.listTools() });
});

// Discover tools by adapter
app.get("/tools/:adapter", (c) => {
  const adapter = c.req.param("adapter");
  return c.json({ tools: registry.listToolsByAdapter(adapter) });
});

// Execute a tool
app.post("/tools/:toolName/execute", async (c) => {
  const toolName = c.req.param("toolName");
  const body = await c.req.json();

  try {
    const result = await registry.executeTool(toolName, body.input, body.credentials);
    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error({ toolName, error: msg }, "Tool execution failed");
    return c.json({ success: false, error: msg }, 500);
  }
});

const port = Number(process.env.MCP_GATEWAY_PORT ?? 4004);

serve({ fetch: app.fetch, port }, () => {
  logger.info({ toolCount: registry.getToolCount() }, `MCP Gateway running on port ${port}`);
});
