import { createLogger } from "@prometheus/logger";
import type { ToolRegistry } from "../../registry";

const logger = createLogger("mcp-gateway:datadog");

async function datadogFetch(
  path: string,
  apiKey: string,
  appKey: string,
  method = "GET",
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  try {
    const response = await fetch(`https://api.datadoghq.com/api/v1${path}`, {
      method,
      headers: {
        "DD-API-KEY": apiKey,
        "DD-APPLICATION-KEY": appKey,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    return {
      ok: response.ok,
      data,
      error: response.ok ? undefined : "Datadog API error",
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerDatadogAdapter(
  registry: ToolRegistry,
  credentials: { apiKey: string; appKey: string }
): void {
  const { apiKey, appKey } = credentials;

  registry.register(
    {
      name: "datadog_query_metrics",
      adapter: "datadog",
      description: "Query Datadog metrics",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Metrics query" },
          from: { type: "number", description: "Start timestamp (unix)" },
          to: { type: "number", description: "End timestamp (unix)" },
        },
        required: ["query", "from", "to"],
      },
    },
    async (input) => {
      const result = await datadogFetch(
        `/query?query=${encodeURIComponent(String(input.query))}&from=${input.from}&to=${input.to}`,
        apiKey,
        appKey
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "datadog_list_monitors",
      adapter: "datadog",
      description: "List Datadog monitors",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: { tags: { type: "string" } },
      },
    },
    async (input) => {
      const tags = input.tags
        ? `?tags=${encodeURIComponent(String(input.tags))}`
        : "";
      const result = await datadogFetch(`/monitor${tags}`, apiKey, appKey);
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "datadog_create_event",
      adapter: "datadog",
      description: "Create a Datadog event",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          text: { type: "string" },
          alertType: {
            type: "string",
            description: "info|warning|error|success",
          },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["title", "text"],
      },
    },
    async (input) => {
      const result = await datadogFetch("/events", apiKey, appKey, "POST", {
        title: input.title,
        text: input.text,
        alert_type: input.alertType ?? "info",
        tags: input.tags ?? [],
      });
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "datadog_get_dashboard",
      adapter: "datadog",
      description: "Get a Datadog dashboard",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: { dashboardId: { type: "string" } },
        required: ["dashboardId"],
      },
    },
    async (input) => {
      const result = await datadogFetch(
        `/dashboard/${input.dashboardId}`,
        apiKey,
        appKey
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "datadog_search_logs",
      adapter: "datadog",
      description: "Search Datadog logs",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
          from: { type: "string", description: "ISO timestamp" },
          to: { type: "string", description: "ISO timestamp" },
          limit: { type: "number" },
        },
        required: ["query"],
      },
    },
    async (input) => {
      const result = await datadogFetch(
        "/logs-queries/list",
        apiKey,
        appKey,
        "POST",
        {
          query: input.query,
          time: { from: input.from ?? "now-1h", to: input.to ?? "now" },
          limit: input.limit ?? 50,
        }
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  logger.info("Datadog adapter registered (5 tools)");
}
