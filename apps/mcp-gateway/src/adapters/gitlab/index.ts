import type { ToolRegistry } from "../../registry";

export function registerGitLabAdapter(registry: ToolRegistry): void {
  registry.register(
    {
      name: "gitlab_list_projects",
      adapter: "gitlab",
      description: "List GitLab projects",
      inputSchema: { type: "object", properties: { page: { type: "number" } } },
      requiresAuth: true,
    },
    async (_input, credentials) => {
      return { success: true, data: { projects: [] } };
    }
  );

  registry.register(
    {
      name: "gitlab_create_mr",
      adapter: "gitlab",
      description: "Create a GitLab merge request",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" }, title: { type: "string" },
          sourceBranch: { type: "string" }, targetBranch: { type: "string" },
          description: { type: "string" },
        },
        required: ["projectId", "title", "sourceBranch", "targetBranch"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      return { success: true, data: { mr_url: "", mr_iid: 0 } };
    }
  );
}
