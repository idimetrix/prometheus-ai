import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

const logger = createLogger("mcp-gateway:gcp");

interface GcpCredentials {
  projectId: string;
  token: string;
}

function parseGcpCredentials(
  credentials?: Record<string, string>
): MCPToolResult | GcpCredentials {
  const token = credentials?.gcp_token;
  const projectId = credentials?.gcp_project_id;

  if (!(token && projectId)) {
    return {
      success: false,
      error:
        "GCP credentials required. Provide credentials.gcp_token and credentials.gcp_project_id.",
    };
  }

  return { token, projectId };
}

async function gcpFetch(
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
      logger.warn({ url, status: response.status }, "GCP API request failed");
      return {
        ok: false,
        data: null,
        error: `GCP error (${response.status}): ${text.slice(0, 500)}`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("json")
      ? await response.json()
      : await response.text();

    return { ok: true, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ url, error: message }, "GCP fetch failed");
    return { ok: false, data: null, error: message };
  }
}

export function registerGcpAdapter(registry: ToolRegistry): void {
  // ── list_gcs_buckets ──────────────────────────────────────────
  registry.register(
    {
      name: "gcp_list_gcs_buckets",
      adapter: "gcp",
      description: "List all Cloud Storage buckets in the GCP project",
      inputSchema: { type: "object", properties: {} },
      requiresAuth: true,
    },
    async (_input, credentials) => {
      const credsOrErr = parseGcpCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const result = await gcpFetch(
        `https://storage.googleapis.com/storage/v1/b?project=${credsOrErr.projectId}`,
        credsOrErr.token
      );

      if (!result.ok) {
        return { success: false, error: `GCS error: ${result.error}` };
      }

      return { success: true, data: result.data };
    }
  );

  // ── get_gcs_object ─────────────────────────────────────────────
  registry.register(
    {
      name: "gcp_get_gcs_object",
      adapter: "gcp",
      description: "Get an object from a Cloud Storage bucket",
      inputSchema: {
        type: "object",
        properties: {
          bucket: { type: "string", description: "Bucket name" },
          object: { type: "string", description: "Object name (path)" },
        },
        required: ["bucket", "object"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = parseGcpCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const { bucket, object: objectName } = input as {
        bucket: string;
        object: string;
      };
      const encoded = encodeURIComponent(objectName);

      const result = await gcpFetch(
        `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encoded}?alt=media`,
        credsOrErr.token
      );

      if (!result.ok) {
        return { success: false, error: `GCS error: ${result.error}` };
      }

      return {
        success: true,
        data: { bucket, object: objectName, content: result.data },
      };
    }
  );

  // ── list_cloud_functions ───────────────────────────────────────
  registry.register(
    {
      name: "gcp_list_cloud_functions",
      adapter: "gcp",
      description: "List Cloud Functions in the GCP project",
      inputSchema: {
        type: "object",
        properties: {
          region: {
            type: "string",
            description: "Region (default: us-central1)",
          },
        },
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = parseGcpCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const region = (input as { region?: string }).region ?? "us-central1";
      const parent = `projects/${credsOrErr.projectId}/locations/${region}`;

      const result = await gcpFetch(
        `https://cloudfunctions.googleapis.com/v2/${parent}/functions`,
        credsOrErr.token
      );

      if (!result.ok) {
        return {
          success: false,
          error: `Cloud Functions error: ${result.error}`,
        };
      }

      return { success: true, data: result.data };
    }
  );

  // ── list_cloud_run_services ────────────────────────────────────
  registry.register(
    {
      name: "gcp_list_cloud_run_services",
      adapter: "gcp",
      description: "List Cloud Run services in the GCP project",
      inputSchema: {
        type: "object",
        properties: {
          region: {
            type: "string",
            description: "Region (default: us-central1)",
          },
        },
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = parseGcpCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const region = (input as { region?: string }).region ?? "us-central1";
      const parent = `projects/${credsOrErr.projectId}/locations/${region}`;

      const result = await gcpFetch(
        `https://run.googleapis.com/v2/${parent}/services`,
        credsOrErr.token
      );

      if (!result.ok) {
        return {
          success: false,
          error: `Cloud Run error: ${result.error}`,
        };
      }

      return { success: true, data: result.data };
    }
  );

  logger.info("GCP adapter registered (4 tools)");
}
