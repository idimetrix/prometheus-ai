import { createLogger } from "@prometheus/logger";
import type { ToolRegistry } from "../../registry";

const logger = createLogger("mcp-gateway:sentry");
const SENTRY_API = "https://sentry.io/api/0";

async function sentryFetch(
  path: string,
  token: string,
  method = "GET",
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  try {
    const response = await fetch(`${SENTRY_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    return {
      ok: response.ok,
      data,
      error: response.ok ? undefined : "Sentry API error",
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerSentryAdapter(
  registry: ToolRegistry,
  credentials: { token: string; org: string }
): void {
  const { token, org } = credentials;

  registry.register(
    {
      name: "sentry_list_issues",
      adapter: "sentry",
      description: "List Sentry issues for a project",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          query: { type: "string" },
          limit: { type: "number" },
        },
        required: ["project"],
      },
    },
    async (input) => {
      const query = input.query
        ? `&query=${encodeURIComponent(String(input.query))}`
        : "";
      const result = await sentryFetch(
        `/projects/${org}/${input.project}/issues/?limit=${input.limit ?? 25}${query}`,
        token
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "sentry_get_issue",
      adapter: "sentry",
      description: "Get details of a Sentry issue",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: { issueId: { type: "string" } },
        required: ["issueId"],
      },
    },
    async (input) => {
      const result = await sentryFetch(`/issues/${input.issueId}/`, token);
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "sentry_get_issue_events",
      adapter: "sentry",
      description: "Get events for a Sentry issue",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: {
          issueId: { type: "string" },
          limit: { type: "number" },
        },
        required: ["issueId"],
      },
    },
    async (input) => {
      const result = await sentryFetch(
        `/issues/${input.issueId}/events/?limit=${input.limit ?? 10}`,
        token
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "sentry_resolve_issue",
      adapter: "sentry",
      description: "Resolve a Sentry issue",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: { issueId: { type: "string" } },
        required: ["issueId"],
      },
    },
    async (input) => {
      const result = await sentryFetch(
        `/issues/${input.issueId}/`,
        token,
        "PUT",
        { status: "resolved" }
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "sentry_list_projects",
      adapter: "sentry",
      description: "List Sentry projects",
      requiresAuth: true,
      inputSchema: { type: "object", properties: {} },
    },
    async () => {
      const result = await sentryFetch(
        `/organizations/${org}/projects/`,
        token
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  logger.info("Sentry adapter registered (5 tools)");
}
