import type { ToolRegistry } from "../../registry";

export function registerLinearAdapter(registry: ToolRegistry): void {
  registry.register(
    {
      name: "linear_create_issue",
      adapter: "linear",
      description: "Create a Linear issue",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" }, description: { type: "string" },
          teamId: { type: "string" }, priority: { type: "number" },
          labels: { type: "array", items: { type: "string" } },
        },
        required: ["title", "teamId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { issue_id: "", issue_url: "" } };
    }
  );

  registry.register(
    {
      name: "linear_update_issue",
      adapter: "linear",
      description: "Update a Linear issue status",
      inputSchema: {
        type: "object",
        properties: {
          issueId: { type: "string" }, status: { type: "string" },
          assigneeId: { type: "string" },
        },
        required: ["issueId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { updated: true } };
    }
  );

  registry.register(
    {
      name: "linear_list_issues",
      adapter: "linear",
      description: "List issues from a Linear project",
      inputSchema: {
        type: "object",
        properties: { teamId: { type: "string" }, status: { type: "string" } },
        required: ["teamId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { issues: [] } };
    }
  );
}
