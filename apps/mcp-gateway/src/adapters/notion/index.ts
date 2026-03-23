import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

const logger = createLogger("mcp-gateway:notion");

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

async function notionFetch(
  path: string,
  token: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
    "User-Agent": "Prometheus-MCP-Gateway/1.0",
  };

  const options: RequestInit = { method, headers };
  if (body && (method === "POST" || method === "PATCH")) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${NOTION_API}${path}`, options);

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after") ?? "30";
    logger.warn({ path, retryAfter }, "Notion rate limit hit");
    return {
      ok: false,
      data: null,
      error: `Rate limited by Notion. Retry after ${retryAfter} seconds.`,
    };
  }

  const data = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const errorMessage = String(
      data.message ?? data.code ?? "Unknown Notion API error"
    );
    return { ok: false, data, error: errorMessage };
  }

  return { ok: true, data };
}

function requireToken(
  credentials?: Record<string, string>
): MCPToolResult | string {
  const token = credentials?.notion_token;
  if (!token) {
    return {
      success: false,
      error:
        "Notion integration token required. Provide credentials.notion_token.",
    };
  }
  return token;
}

export function registerNotionAdapter(registry: ToolRegistry): void {
  // ---- search_pages ----
  registry.register(
    {
      name: "notion_search_pages",
      adapter: "notion",
      description: "Search for pages and databases in Notion",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query text" },
          filter: {
            type: "object",
            description:
              'Filter by object type: { "value": "page" } or { "value": "database" }',
            properties: {
              value: {
                type: "string",
                enum: ["page", "database"],
              },
            },
          },
          page_size: {
            type: "number",
            description: "Number of results to return (max 100)",
          },
          start_cursor: {
            type: "string",
            description: "Pagination cursor",
          },
        },
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { query, filter, page_size, start_cursor } = input as {
        query?: string;
        filter?: { value: string };
        page_size?: number;
        start_cursor?: string;
      };

      const body: Record<string, unknown> = {};
      if (query) {
        body.query = query;
      }
      if (filter) {
        body.filter = filter;
      }
      if (page_size) {
        body.page_size = Math.min(page_size, 100);
      }
      if (start_cursor) {
        body.start_cursor = start_cursor;
      }

      const result = await notionFetch("/search", tokenOrErr, "POST", body);

      if (!result.ok) {
        return {
          success: false,
          error: `Notion API error: ${result.error}`,
        };
      }

      const data = result.data as Record<string, unknown>;
      return {
        success: true,
        data: {
          results: data.results,
          has_more: data.has_more,
          next_cursor: data.next_cursor,
        },
      };
    }
  );

  // ---- get_page ----
  registry.register(
    {
      name: "notion_get_page",
      adapter: "notion",
      description: "Get a Notion page by ID, including its properties",
      inputSchema: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "The ID of the Notion page",
          },
        },
        required: ["page_id"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { page_id } = input as { page_id: string };
      const result = await notionFetch(`/pages/${page_id}`, tokenOrErr);

      if (!result.ok) {
        return {
          success: false,
          error: `Notion API error: ${result.error}`,
        };
      }

      return { success: true, data: result.data };
    }
  );

  // ---- create_page ----
  registry.register(
    {
      name: "notion_create_page",
      adapter: "notion",
      description:
        "Create a new page in Notion under a parent page or database",
      inputSchema: {
        type: "object",
        properties: {
          parent: {
            type: "object",
            description:
              'Parent reference: { "database_id": "..." } or { "page_id": "..." }',
          },
          properties: {
            type: "object",
            description: "Page properties matching the parent database schema",
          },
          children: {
            type: "array",
            description: "Array of block objects for the page content",
          },
          icon: {
            type: "object",
            description: "Page icon (emoji or external URL)",
          },
          cover: {
            type: "object",
            description: "Page cover image (external URL)",
          },
        },
        required: ["parent", "properties"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { parent, properties, children, icon, cover } = input as {
        parent: Record<string, unknown>;
        properties: Record<string, unknown>;
        children?: unknown[];
        icon?: Record<string, unknown>;
        cover?: Record<string, unknown>;
      };

      const body: Record<string, unknown> = { parent, properties };
      if (children) {
        body.children = children;
      }
      if (icon) {
        body.icon = icon;
      }
      if (cover) {
        body.cover = cover;
      }

      const result = await notionFetch("/pages", tokenOrErr, "POST", body);

      if (!result.ok) {
        return {
          success: false,
          error: `Notion API error: ${result.error}`,
        };
      }

      const page = result.data as Record<string, unknown>;
      return {
        success: true,
        data: { id: page.id, url: page.url, created: true },
      };
    }
  );

  // ---- update_page ----
  registry.register(
    {
      name: "notion_update_page",
      adapter: "notion",
      description: "Update properties of an existing Notion page",
      inputSchema: {
        type: "object",
        properties: {
          page_id: {
            type: "string",
            description: "The ID of the page to update",
          },
          properties: {
            type: "object",
            description: "Properties to update",
          },
          archived: {
            type: "boolean",
            description: "Set to true to archive the page",
          },
          icon: {
            type: "object",
            description: "Updated page icon",
          },
          cover: {
            type: "object",
            description: "Updated page cover",
          },
        },
        required: ["page_id"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { page_id, properties, archived, icon, cover } = input as {
        page_id: string;
        properties?: Record<string, unknown>;
        archived?: boolean;
        icon?: Record<string, unknown>;
        cover?: Record<string, unknown>;
      };

      const body: Record<string, unknown> = {};
      if (properties) {
        body.properties = properties;
      }
      if (archived !== undefined) {
        body.archived = archived;
      }
      if (icon) {
        body.icon = icon;
      }
      if (cover) {
        body.cover = cover;
      }

      const result = await notionFetch(
        `/pages/${page_id}`,
        tokenOrErr,
        "PATCH",
        body
      );

      if (!result.ok) {
        return {
          success: false,
          error: `Notion API error: ${result.error}`,
        };
      }

      const page = result.data as Record<string, unknown>;
      return {
        success: true,
        data: { id: page.id, url: page.url, updated: true },
      };
    }
  );

  // ---- query_database ----
  registry.register(
    {
      name: "notion_query_database",
      adapter: "notion",
      description: "Query a Notion database with optional filters and sorts",
      inputSchema: {
        type: "object",
        properties: {
          database_id: {
            type: "string",
            description: "The ID of the database to query",
          },
          filter: {
            type: "object",
            description: "Notion filter object",
          },
          sorts: {
            type: "array",
            description:
              "Array of sort objects: { property, direction } or { timestamp, direction }",
          },
          page_size: {
            type: "number",
            description: "Number of results (max 100)",
          },
          start_cursor: {
            type: "string",
            description: "Pagination cursor",
          },
        },
        required: ["database_id"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { database_id, filter, sorts, page_size, start_cursor } = input as {
        database_id: string;
        filter?: Record<string, unknown>;
        sorts?: unknown[];
        page_size?: number;
        start_cursor?: string;
      };

      const body: Record<string, unknown> = {};
      if (filter) {
        body.filter = filter;
      }
      if (sorts) {
        body.sorts = sorts;
      }
      if (page_size) {
        body.page_size = Math.min(page_size, 100);
      }
      if (start_cursor) {
        body.start_cursor = start_cursor;
      }

      const result = await notionFetch(
        `/databases/${database_id}/query`,
        tokenOrErr,
        "POST",
        body
      );

      if (!result.ok) {
        return {
          success: false,
          error: `Notion API error: ${result.error}`,
        };
      }

      const data = result.data as Record<string, unknown>;
      return {
        success: true,
        data: {
          results: data.results,
          has_more: data.has_more,
          next_cursor: data.next_cursor,
        },
      };
    }
  );
}
