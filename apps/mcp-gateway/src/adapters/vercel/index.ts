import { createLogger } from "@prometheus/logger";
import type { ToolRegistry, MCPToolResult } from "../../registry";

const logger = createLogger("mcp-gateway:vercel");

const VERCEL_API = "https://api.vercel.com";

async function vercelFetch(
  path: string,
  token: string,
  options: { method?: string; body?: unknown; teamId?: string } = {}
): Promise<{ status: number; data: unknown }> {
  let url = `${VERCEL_API}${path}`;
  if (options.teamId) {
    const separator = url.includes("?") ? "&" : "?";
    url += `${separator}teamId=${options.teamId}`;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "Prometheus-MCP-Gateway/1.0",
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("json") ? await response.json() : await response.text();

  return { status: response.status, data };
}

function requireToken(credentials?: Record<string, string>): MCPToolResult | string {
  const token = credentials?.vercel_token;
  if (!token) {
    return { success: false, error: "Vercel token required. Provide credentials.vercel_token." };
  }
  return token;
}

export function registerVercelAdapter(registry: ToolRegistry): void {
  // ---- deploy_preview ----
  registry.register(
    {
      name: "vercel_deploy_preview",
      adapter: "vercel",
      description: "Create a new Vercel deployment (preview or production)",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Vercel project ID or name" },
          ref: { type: "string", description: "Git ref (branch, tag, or SHA)" },
          target: { type: "string", enum: ["production", "preview"], description: "Deployment target" },
          teamId: { type: "string", description: "Vercel team ID (optional)" },
        },
        required: ["projectId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") return tokenOrErr;

      const { projectId, ref, target, teamId } = input as {
        projectId: string; ref?: string; target?: string; teamId?: string;
      };

      const body: Record<string, unknown> = {
        name: projectId,
        target: target ?? "preview",
      };

      if (ref) {
        body.gitSource = {
          ref,
          type: "branch",
        };
      }

      const { status, data } = await vercelFetch("/v13/deployments", tokenOrErr, {
        method: "POST",
        body,
        teamId,
      });

      if (status !== 200 && status !== 201) {
        return { success: false, error: `Vercel API error (${status}): ${JSON.stringify(data)}` };
      }

      const deployment = data as Record<string, unknown>;
      return {
        success: true,
        data: {
          deployment_id: deployment.id,
          url: deployment.url ? `https://${deployment.url}` : null,
          state: deployment.readyState ?? deployment.status,
          target: deployment.target,
          created_at: deployment.createdAt,
        },
      };
    }
  );

  // ---- get_deployment_status ----
  registry.register(
    {
      name: "vercel_get_deployment_status",
      adapter: "vercel",
      description: "Get the status of a Vercel deployment",
      inputSchema: {
        type: "object",
        properties: {
          deploymentId: { type: "string", description: "Deployment ID or URL" },
          teamId: { type: "string" },
        },
        required: ["deploymentId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") return tokenOrErr;

      const { deploymentId, teamId } = input as { deploymentId: string; teamId?: string };

      const { status, data } = await vercelFetch(
        `/v13/deployments/${deploymentId}`,
        tokenOrErr,
        { teamId }
      );

      if (status !== 200) {
        return { success: false, error: `Vercel API error (${status}): ${JSON.stringify(data)}` };
      }

      const deployment = data as Record<string, unknown>;
      return {
        success: true,
        data: {
          id: deployment.id,
          url: deployment.url ? `https://${deployment.url}` : null,
          state: deployment.readyState ?? deployment.status,
          target: deployment.target,
          created_at: deployment.createdAt,
          ready: deployment.readyState === "READY",
          buildingAt: deployment.buildingAt,
          ready_at: deployment.ready,
          error: (deployment.readyState === "ERROR") ? deployment.errorMessage : undefined,
        },
      };
    }
  );

  // ---- set_env ----
  registry.register(
    {
      name: "vercel_set_env",
      adapter: "vercel",
      description: "Set an environment variable on a Vercel project",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          key: { type: "string", description: "Environment variable name" },
          value: { type: "string", description: "Environment variable value" },
          target: {
            type: "array",
            items: { type: "string", enum: ["production", "preview", "development"] },
            description: "Deployment targets for this env var",
          },
          type: { type: "string", enum: ["plain", "encrypted", "secret"], description: "Variable type" },
          teamId: { type: "string" },
        },
        required: ["projectId", "key", "value"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") return tokenOrErr;

      const { projectId, key, value, target, type, teamId } = input as {
        projectId: string; key: string; value: string;
        target?: string[]; type?: string; teamId?: string;
      };

      const { status, data } = await vercelFetch(
        `/v10/projects/${projectId}/env`,
        tokenOrErr,
        {
          method: "POST",
          body: {
            key,
            value,
            target: target ?? ["production", "preview", "development"],
            type: type ?? "encrypted",
          },
          teamId,
        }
      );

      if (status !== 200 && status !== 201) {
        // If already exists, try to update
        if (status === 400 || status === 409) {
          const updateResult = await vercelFetch(
            `/v10/projects/${projectId}/env/${key}`,
            tokenOrErr,
            {
              method: "PATCH",
              body: {
                value,
                target: target ?? ["production", "preview", "development"],
                type: type ?? "encrypted",
              },
              teamId,
            }
          );

          if (updateResult.status !== 200) {
            return { success: false, error: `Failed to update env var (${updateResult.status})` };
          }

          return {
            success: true,
            data: { key, action: "updated", target: target ?? ["production", "preview", "development"] },
          };
        }

        return { success: false, error: `Vercel API error (${status}): ${JSON.stringify(data)}` };
      }

      return {
        success: true,
        data: { key, action: "created", target: target ?? ["production", "preview", "development"] },
      };
    }
  );
}
