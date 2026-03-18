import { createLogger } from "@prometheus/logger";
import type { ToolRegistry } from "../../registry";

const logger = createLogger("mcp-gateway:confluence");
const CONFLUENCE_API = "https://api.atlassian.com/ex/confluence";

async function confluenceFetch(
  path: string,
  token: string,
  cloudId: string,
  method = "GET",
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  try {
    const response = await fetch(
      `${CONFLUENCE_API}/${cloudId}/wiki/api/v2${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      }
    );
    const data = await response.json();
    return {
      ok: response.ok,
      data,
      error: response.ok
        ? undefined
        : String((data as Record<string, unknown>).message ?? "API error"),
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerConfluenceAdapter(
  registry: ToolRegistry,
  credentials: { token: string; cloudId: string }
): void {
  const { token, cloudId } = credentials;

  registry.register(
    {
      name: "confluence_search",
      adapter: "confluence",
      description: "Search Confluence pages and spaces",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (CQL)" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
    async (input) => {
      const query = String(input.query);
      const limit = Number(input.limit ?? 10);
      const result = await confluenceFetch(
        `/search?cql=${encodeURIComponent(query)}&limit=${limit}`,
        token,
        cloudId
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "confluence_get_page",
      adapter: "confluence",
      description: "Get a Confluence page by ID",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: { pageId: { type: "string" } },
        required: ["pageId"],
      },
    },
    async (input) => {
      const result = await confluenceFetch(
        `/pages/${input.pageId}?body-format=storage`,
        token,
        cloudId
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "confluence_create_page",
      adapter: "confluence",
      description: "Create a new Confluence page",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: {
          spaceId: { type: "string" },
          title: { type: "string" },
          body: {
            type: "string",
            description: "Page content in storage format",
          },
          parentId: { type: "string" },
        },
        required: ["spaceId", "title", "body"],
      },
    },
    async (input) => {
      const result = await confluenceFetch("/pages", token, cloudId, "POST", {
        spaceId: input.spaceId,
        title: input.title,
        body: { representation: "storage", value: input.body },
        parentId: input.parentId,
        status: "current",
      });
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "confluence_update_page",
      adapter: "confluence",
      description: "Update an existing Confluence page",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: {
          pageId: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          version: { type: "number" },
        },
        required: ["pageId", "title", "body", "version"],
      },
    },
    async (input) => {
      const result = await confluenceFetch(
        `/pages/${input.pageId}`,
        token,
        cloudId,
        "PUT",
        {
          title: input.title,
          body: { representation: "storage", value: input.body },
          version: { number: input.version },
          status: "current",
        }
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "confluence_list_spaces",
      adapter: "confluence",
      description: "List Confluence spaces",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number" } },
      },
    },
    async (input) => {
      const limit = Number(input.limit ?? 25);
      const result = await confluenceFetch(
        `/spaces?limit=${limit}`,
        token,
        cloudId
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  logger.info("Confluence adapter registered (5 tools)");
}
