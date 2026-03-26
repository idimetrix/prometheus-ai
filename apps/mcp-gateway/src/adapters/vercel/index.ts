import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

const _logger = createLogger("mcp-gateway:vercel");

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
  const data = contentType.includes("json")
    ? await response.json()
    : await response.text();

  return { status: response.status, data };
}

function requireToken(
  credentials?: Record<string, string>
): MCPToolResult | string {
  const token = credentials?.vercel_token;
  if (!token) {
    return {
      success: false,
      error: "Vercel token required. Provide credentials.vercel_token.",
    };
  }
  return token;
}

export function registerVercelAdapter(registry: ToolRegistry): void {
  // ---- list_projects ----
  registry.register(
    {
      name: "vercel_list_projects",
      adapter: "vercel",
      description: "List Vercel projects for the authenticated user or team",
      inputSchema: {
        type: "object",
        properties: {
          teamId: { type: "string", description: "Vercel team ID (optional)" },
          limit: { type: "number" },
        },
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { teamId, limit } = input as { teamId?: string; limit?: number };

      const params = new URLSearchParams();
      if (limit) {
        params.set("limit", String(limit));
      }

      const { status, data } = await vercelFetch(
        `/v9/projects?${params.toString()}`,
        tokenOrErr,
        { teamId }
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Vercel API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as Record<string, unknown>;
      const projects = (
        (result.projects as Record<string, unknown>[]) ?? []
      ).map((p) => ({
        id: p.id,
        name: p.name,
        framework: p.framework,
        latestDeployments:
          (p.latestDeployments as Record<string, unknown>[] | undefined)?.map(
            (d: Record<string, unknown>) => ({
              id: d.id,
              url: d.url ? `https://${d.url}` : null,
              state: d.readyState,
              created_at: d.createdAt,
            })
          ) ?? [],
        updatedAt: p.updatedAt,
        createdAt: p.createdAt,
      }));

      return { success: true, data: { projects, count: projects.length } };
    }
  );

  // ---- list_deployments ----
  registry.register(
    {
      name: "vercel_list_deployments",
      adapter: "vercel",
      description: "List recent deployments for a Vercel project",
      inputSchema: {
        type: "object",
        properties: {
          projectId: {
            type: "string",
            description: "Vercel project ID or name",
          },
          teamId: { type: "string" },
          limit: { type: "number" },
          state: {
            type: "string",
            enum: [
              "BUILDING",
              "ERROR",
              "INITIALIZING",
              "QUEUED",
              "READY",
              "CANCELED",
            ],
          },
          target: { type: "string", enum: ["production", "preview"] },
        },
        required: ["projectId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { projectId, teamId, limit, state, target } = input as {
        projectId: string;
        teamId?: string;
        limit?: number;
        state?: string;
        target?: string;
      };

      const params = new URLSearchParams();
      params.set("projectId", projectId);
      if (limit) {
        params.set("limit", String(limit));
      }
      if (state) {
        params.set("state", state);
      }
      if (target) {
        params.set("target", target);
      }

      const { status, data } = await vercelFetch(
        `/v6/deployments?${params.toString()}`,
        tokenOrErr,
        { teamId }
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Vercel API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as Record<string, unknown>;
      const deployments = (
        (result.deployments as Record<string, unknown>[]) ?? []
      ).map((d) => ({
        uid: d.uid,
        name: d.name,
        url: d.url ? `https://${d.url}` : null,
        state: d.readyState ?? d.state,
        target: d.target,
        created_at: d.createdAt,
        creator:
          (d.creator as Record<string, unknown> | undefined)?.username ?? null,
      }));

      return {
        success: true,
        data: { deployments, count: deployments.length },
      };
    }
  );

  // ---- deploy_preview ----
  registry.register(
    {
      name: "vercel_deploy_preview",
      adapter: "vercel",
      description: "Create a new Vercel deployment (preview or production)",
      inputSchema: {
        type: "object",
        properties: {
          projectId: {
            type: "string",
            description: "Vercel project ID or name",
          },
          ref: { type: "string", description: "Git ref (branch, tag, or SHA)" },
          target: {
            type: "string",
            enum: ["production", "preview"],
            description: "Deployment target",
          },
          teamId: { type: "string", description: "Vercel team ID (optional)" },
        },
        required: ["projectId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { projectId, ref, target, teamId } = input as {
        projectId: string;
        ref?: string;
        target?: string;
        teamId?: string;
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

      const { status, data } = await vercelFetch(
        "/v13/deployments",
        tokenOrErr,
        {
          method: "POST",
          body,
          teamId,
        }
      );

      if (status !== 200 && status !== 201) {
        return {
          success: false,
          error: `Vercel API error (${status}): ${JSON.stringify(data)}`,
        };
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
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { deploymentId, teamId } = input as {
        deploymentId: string;
        teamId?: string;
      };

      const { status, data } = await vercelFetch(
        `/v13/deployments/${deploymentId}`,
        tokenOrErr,
        { teamId }
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Vercel API error (${status}): ${JSON.stringify(data)}`,
        };
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
          error:
            deployment.readyState === "ERROR"
              ? deployment.errorMessage
              : undefined,
        },
      };
    }
  );

  // ---- smoke_test ----
  registry.register(
    {
      name: "vercel_smoke_test",
      adapter: "vercel",
      description:
        "Run a smoke test against a deployed Vercel preview URL. Checks that the URL responds with 200, loads within the timeout, and optionally verifies a CSS selector is present.",
      inputSchema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Preview deployment URL to test",
          },
          expectedStatus: {
            type: "number",
            description: "Expected HTTP status code (default: 200)",
          },
          waitForSelector: {
            type: "string",
            description: "CSS selector that must be present on the page",
          },
          timeout: {
            type: "number",
            description: "Timeout in milliseconds (default: 30000)",
          },
        },
        required: ["url"],
      },
      requiresAuth: false,
    },
    async (input) => {
      const { url, expectedStatus, waitForSelector, timeout } = input as {
        url: string;
        expectedStatus?: number;
        waitForSelector?: string;
        timeout?: number;
      };

      const timeoutMs = timeout ?? 30_000;
      const expected = expectedStatus ?? 200;
      const startTime = Date.now();

      try {
        const response = await fetch(url, {
          method: "GET",
          headers: { "User-Agent": "Prometheus-Smoke-Test/1.0" },
          signal: AbortSignal.timeout(timeoutMs),
        });

        const durationMs = Date.now() - startTime;
        const body = await response.text();

        const checks: Array<{
          check: string;
          passed: boolean;
          detail: string;
        }> = [];

        // Check HTTP status
        checks.push({
          check: "http_status",
          passed: response.status === expected,
          detail: `Expected ${expected}, got ${response.status}`,
        });

        // Check response time
        const isWithinTimeout = durationMs < timeoutMs;
        checks.push({
          check: "response_time",
          passed: isWithinTimeout,
          detail: `${durationMs}ms (limit: ${timeoutMs}ms)`,
        });

        // Check for selector if specified
        if (waitForSelector) {
          // Simple HTML check — look for an element matching the selector name
          // (full DOM check requires a browser; this is a lightweight smoke test)
          const selectorTag = waitForSelector.replace(/[.#[\]='"]/g, "");
          const found =
            body.includes(waitForSelector) || body.includes(selectorTag);
          checks.push({
            check: "selector_present",
            passed: found,
            detail: `Selector "${waitForSelector}" ${found ? "found" : "not found"} in HTML`,
          });
        }

        // Check for non-empty body
        checks.push({
          check: "non_empty_body",
          passed: body.length > 0,
          detail: `Response body: ${body.length} bytes`,
        });

        const allPassed = checks.every((c) => c.passed);

        return {
          success: true,
          data: {
            url,
            passed: allPassed,
            durationMs,
            httpStatus: response.status,
            checks,
          },
        };
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: `Smoke test failed for ${url}: ${msg}`,
        };
      }
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
            items: {
              type: "string",
              enum: ["production", "preview", "development"],
            },
            description: "Deployment targets for this env var",
          },
          type: {
            type: "string",
            enum: ["plain", "encrypted", "secret"],
            description: "Variable type",
          },
          teamId: { type: "string" },
        },
        required: ["projectId", "key", "value"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { projectId, key, value, target, type, teamId } = input as {
        projectId: string;
        key: string;
        value: string;
        target?: string[];
        type?: string;
        teamId?: string;
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
            return {
              success: false,
              error: `Failed to update env var (${updateResult.status})`,
            };
          }

          return {
            success: true,
            data: {
              key,
              action: "updated",
              target: target ?? ["production", "preview", "development"],
            },
          };
        }

        return {
          success: false,
          error: `Vercel API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      return {
        success: true,
        data: {
          key,
          action: "created",
          target: target ?? ["production", "preview", "development"],
        },
      };
    }
  );
}
