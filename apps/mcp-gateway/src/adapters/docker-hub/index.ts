import { createLogger } from "@prometheus/logger";
import type { ToolRegistry } from "../../registry";

const logger = createLogger("mcp-gateway:docker-hub");
const DOCKER_HUB_API = "https://hub.docker.com/v2";

async function dockerHubFetch(
  path: string,
  token: string,
  method = "GET",
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  try {
    const response = await fetch(`${DOCKER_HUB_API}${path}`, {
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
      error: response.ok ? undefined : "Docker Hub API error",
    };
  } catch (err) {
    return {
      ok: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function registerDockerHubAdapter(
  registry: ToolRegistry,
  credentials: { token: string; namespace: string }
): void {
  const { token, namespace } = credentials;

  registry.register(
    {
      name: "dockerhub_list_repos",
      adapter: "docker-hub",
      description: "List Docker Hub repositories",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: { pageSize: { type: "number" } },
      },
    },
    async (input) => {
      const size = input.pageSize ?? 25;
      const result = await dockerHubFetch(
        `/repositories/${namespace}/?page_size=${size}`,
        token
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "dockerhub_get_tags",
      adapter: "docker-hub",
      description: "List tags for a Docker Hub repository",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: {
          repository: { type: "string" },
          pageSize: { type: "number" },
        },
        required: ["repository"],
      },
    },
    async (input) => {
      const result = await dockerHubFetch(
        `/repositories/${namespace}/${input.repository}/tags/?page_size=${input.pageSize ?? 25}`,
        token
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "dockerhub_get_repo",
      adapter: "docker-hub",
      description: "Get Docker Hub repository details",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: { repository: { type: "string" } },
        required: ["repository"],
      },
    },
    async (input) => {
      const result = await dockerHubFetch(
        `/repositories/${namespace}/${input.repository}/`,
        token
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "dockerhub_delete_tag",
      adapter: "docker-hub",
      description: "Delete a tag from a Docker Hub repository",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: {
          repository: { type: "string" },
          tag: { type: "string" },
        },
        required: ["repository", "tag"],
      },
    },
    async (input) => {
      const result = await dockerHubFetch(
        `/repositories/${namespace}/${input.repository}/tags/${input.tag}/`,
        token,
        "DELETE"
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  registry.register(
    {
      name: "dockerhub_get_build_history",
      adapter: "docker-hub",
      description: "Get build history for a Docker Hub repository",
      requiresAuth: true,
      inputSchema: {
        type: "object",
        properties: { repository: { type: "string" } },
        required: ["repository"],
      },
    },
    async (input) => {
      const result = await dockerHubFetch(
        `/repositories/${namespace}/${input.repository}/buildhistory/`,
        token
      );
      return { success: result.ok, data: result.data, error: result.error };
    }
  );

  logger.info("Docker Hub adapter registered (5 tools)");
}
