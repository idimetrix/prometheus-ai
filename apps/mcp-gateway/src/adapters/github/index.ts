import type { ToolRegistry } from "../../registry";

export function registerGitHubAdapter(registry: ToolRegistry): void {
  registry.register(
    {
      name: "github_list_repos",
      adapter: "github",
      description: "List repositories accessible to the authenticated user",
      inputSchema: { type: "object", properties: { page: { type: "number" }, perPage: { type: "number" } } },
      requiresAuth: true,
    },
    async (_input, credentials) => {
      const token = credentials?.github_token;
      if (!token) return { success: false, error: "GitHub token required" };
      // TODO: Call GitHub API
      return { success: true, data: { repos: [] } };
    }
  );

  registry.register(
    {
      name: "github_get_file",
      adapter: "github",
      description: "Get file contents from a GitHub repository",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" }, repo: { type: "string" },
          path: { type: "string" }, ref: { type: "string" },
        },
        required: ["owner", "repo", "path"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const token = credentials?.github_token;
      if (!token) return { success: false, error: "GitHub token required" };
      return { success: true, data: { content: "", encoding: "utf-8" } };
    }
  );

  registry.register(
    {
      name: "github_create_pr",
      adapter: "github",
      description: "Create a pull request",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" }, repo: { type: "string" },
          title: { type: "string" }, body: { type: "string" },
          head: { type: "string" }, base: { type: "string" },
        },
        required: ["owner", "repo", "title", "head", "base"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const token = credentials?.github_token;
      if (!token) return { success: false, error: "GitHub token required" };
      return { success: true, data: { pr_url: "", pr_number: 0 } };
    }
  );

  registry.register(
    {
      name: "github_create_issue",
      adapter: "github",
      description: "Create a GitHub issue",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" }, repo: { type: "string" },
          title: { type: "string" }, body: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
        },
        required: ["owner", "repo", "title"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const token = credentials?.github_token;
      if (!token) return { success: false, error: "GitHub token required" };
      return { success: true, data: { issue_url: "", issue_number: 0 } };
    }
  );

  registry.register(
    {
      name: "github_push_files",
      adapter: "github",
      description: "Push file changes to a branch",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" }, repo: { type: "string" },
          branch: { type: "string" }, message: { type: "string" },
          files: { type: "array", items: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } } } },
        },
        required: ["owner", "repo", "branch", "message", "files"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const token = credentials?.github_token;
      if (!token) return { success: false, error: "GitHub token required" };
      return { success: true, data: { commit_sha: "" } };
    }
  );
}
