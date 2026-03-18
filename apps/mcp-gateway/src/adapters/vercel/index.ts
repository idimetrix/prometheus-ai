import type { ToolRegistry } from "../../registry";

export function registerVercelAdapter(registry: ToolRegistry): void {
  registry.register(
    {
      name: "vercel_deploy",
      adapter: "vercel",
      description: "Trigger a Vercel deployment",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" }, ref: { type: "string" },
          target: { type: "string", enum: ["production", "preview"] },
        },
        required: ["projectId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { deployment_id: "", url: "" } };
    }
  );

  registry.register(
    {
      name: "vercel_get_deployment",
      adapter: "vercel",
      description: "Get deployment status",
      inputSchema: {
        type: "object",
        properties: { deploymentId: { type: "string" } },
        required: ["deploymentId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { status: "ready", url: "" } };
    }
  );

  registry.register(
    {
      name: "vercel_set_env",
      adapter: "vercel",
      description: "Set environment variable on a Vercel project",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" }, key: { type: "string" },
          value: { type: "string" }, target: { type: "array", items: { type: "string" } },
        },
        required: ["projectId", "key", "value"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { created: true } };
    }
  );
}
