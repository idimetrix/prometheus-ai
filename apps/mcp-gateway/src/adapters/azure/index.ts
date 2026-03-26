import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

const logger = createLogger("mcp-gateway:azure");

interface AzureCredentials {
  subscriptionId: string;
  token: string;
}

function parseAzureCredentials(
  credentials?: Record<string, string>
): MCPToolResult | AzureCredentials {
  const token = credentials?.azure_token;
  const subscriptionId = credentials?.azure_subscription_id;

  if (!(token && subscriptionId)) {
    return {
      success: false,
      error:
        "Azure credentials required. Provide credentials.azure_token and credentials.azure_subscription_id.",
    };
  }

  return { token, subscriptionId };
}

const AZURE_API_VERSION = "2023-11-01";

async function azureFetch(
  url: string,
  token: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: string
): Promise<{ ok: boolean; data: unknown; error?: string }> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "User-Agent": "Prometheus-MCP-Gateway/1.0",
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ?? undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn({ url, status: response.status }, "Azure API request failed");
      return {
        ok: false,
        data: null,
        error: `Azure error (${response.status}): ${text.slice(0, 500)}`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("json")
      ? await response.json()
      : await response.text();

    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ url, error: message }, "Azure fetch failed");
    return { ok: false, data: null, error: message };
  }
}

export function registerAzureAdapter(registry: ToolRegistry): void {
  // ── list_resource_groups ───────────────────────────────────────
  registry.register(
    {
      name: "azure_list_resource_groups",
      adapter: "azure",
      description: "List all resource groups in the Azure subscription",
      inputSchema: { type: "object", properties: {} },
      requiresAuth: true,
    },
    async (_input, credentials) => {
      const credsOrErr = parseAzureCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const result = await azureFetch(
        `https://management.azure.com/subscriptions/${credsOrErr.subscriptionId}/resourcegroups?api-version=${AZURE_API_VERSION}`,
        credsOrErr.token
      );

      if (!result.ok) {
        return { success: false, error: `Azure error: ${result.error}` };
      }

      return { success: true, data: result.data };
    }
  );

  // ── list_storage_accounts ──────────────────────────────────────
  registry.register(
    {
      name: "azure_list_storage_accounts",
      adapter: "azure",
      description: "List storage accounts in the Azure subscription",
      inputSchema: { type: "object", properties: {} },
      requiresAuth: true,
    },
    async (_input, credentials) => {
      const credsOrErr = parseAzureCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const result = await azureFetch(
        `https://management.azure.com/subscriptions/${credsOrErr.subscriptionId}/providers/Microsoft.Storage/storageAccounts?api-version=${AZURE_API_VERSION}`,
        credsOrErr.token
      );

      if (!result.ok) {
        return { success: false, error: `Azure error: ${result.error}` };
      }

      return { success: true, data: result.data };
    }
  );

  // ── list_web_apps ──────────────────────────────────────────────
  registry.register(
    {
      name: "azure_list_web_apps",
      adapter: "azure",
      description: "List Azure App Service web apps in the subscription",
      inputSchema: { type: "object", properties: {} },
      requiresAuth: true,
    },
    async (_input, credentials) => {
      const credsOrErr = parseAzureCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const result = await azureFetch(
        `https://management.azure.com/subscriptions/${credsOrErr.subscriptionId}/providers/Microsoft.Web/sites?api-version=${AZURE_API_VERSION}`,
        credsOrErr.token
      );

      if (!result.ok) {
        return { success: false, error: `Azure error: ${result.error}` };
      }

      return { success: true, data: result.data };
    }
  );

  // ── list_aks_clusters ──────────────────────────────────────────
  registry.register(
    {
      name: "azure_list_aks_clusters",
      adapter: "azure",
      description:
        "List Azure Kubernetes Service (AKS) clusters in the subscription",
      inputSchema: { type: "object", properties: {} },
      requiresAuth: true,
    },
    async (_input, credentials) => {
      const credsOrErr = parseAzureCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const result = await azureFetch(
        `https://management.azure.com/subscriptions/${credsOrErr.subscriptionId}/providers/Microsoft.ContainerService/managedClusters?api-version=${AZURE_API_VERSION}`,
        credsOrErr.token
      );

      if (!result.ok) {
        return { success: false, error: `Azure error: ${result.error}` };
      }

      return { success: true, data: result.data };
    }
  );

  logger.info("Azure adapter registered (4 tools)");
}
