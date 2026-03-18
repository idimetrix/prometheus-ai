import { createLogger } from "@prometheus/logger";
import type { ToolRegistry, MCPToolResult } from "../../registry";

const logger = createLogger("mcp-gateway:gitlab");

const GITLAB_API = "https://gitlab.com/api/v4";

async function gitlabFetch(
  path: string,
  token: string,
  options: { method?: string; body?: unknown; baseUrl?: string } = {}
): Promise<{ status: number; data: unknown }> {
  const base = options.baseUrl ?? GITLAB_API;
  const url = path.startsWith("http") ? path : `${base}${path}`;

  const headers: Record<string, string> = {
    "PRIVATE-TOKEN": token,
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
  const token = credentials?.gitlab_token;
  if (!token) {
    return { success: false, error: "GitLab token required. Provide credentials.gitlab_token." };
  }
  return token;
}

export function registerGitLabAdapter(registry: ToolRegistry): void {
  // ---- clone_repo (get repo info) ----
  registry.register(
    {
      name: "gitlab_clone_repo",
      adapter: "gitlab",
      description: "Get GitLab project information including clone URLs",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string", description: "Project ID or URL-encoded path (e.g., 'group%2Fproject')" },
        },
        required: ["projectId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") return tokenOrErr;

      const { projectId } = input as { projectId: string };
      const encodedId = encodeURIComponent(projectId);
      const { status, data } = await gitlabFetch(`/projects/${encodedId}`, tokenOrErr);

      if (status !== 200) {
        return { success: false, error: `GitLab API error (${status}): ${JSON.stringify(data)}` };
      }

      const project = data as Record<string, unknown>;
      return {
        success: true,
        data: {
          id: project.id,
          name: project.name,
          path_with_namespace: project.path_with_namespace,
          http_url_to_repo: project.http_url_to_repo,
          ssh_url_to_repo: project.ssh_url_to_repo,
          default_branch: project.default_branch,
          visibility: project.visibility,
        },
      };
    }
  );

  // ---- create_mr ----
  registry.register(
    {
      name: "gitlab_create_mr",
      adapter: "gitlab",
      description: "Create a GitLab merge request",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          title: { type: "string" },
          sourceBranch: { type: "string" },
          targetBranch: { type: "string" },
          description: { type: "string" },
          draft: { type: "boolean" },
          labels: { type: "string", description: "Comma-separated labels" },
        },
        required: ["projectId", "title", "sourceBranch", "targetBranch"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") return tokenOrErr;

      const { projectId, title, sourceBranch, targetBranch, description, draft, labels } = input as {
        projectId: string; title: string; sourceBranch: string;
        targetBranch: string; description?: string; draft?: boolean; labels?: string;
      };

      const encodedId = encodeURIComponent(projectId);
      const { status, data } = await gitlabFetch(`/projects/${encodedId}/merge_requests`, tokenOrErr, {
        method: "POST",
        body: {
          title: draft ? `Draft: ${title}` : title,
          source_branch: sourceBranch,
          target_branch: targetBranch,
          description: description ?? "",
          labels: labels ?? "",
        },
      });

      if (status !== 201) {
        return { success: false, error: `Failed to create MR (${status}): ${JSON.stringify(data)}` };
      }

      const mr = data as Record<string, unknown>;
      return {
        success: true,
        data: {
          mr_iid: mr.iid,
          mr_url: mr.web_url,
          state: mr.state,
        },
      };
    }
  );

  // ---- list_issues ----
  registry.register(
    {
      name: "gitlab_list_issues",
      adapter: "gitlab",
      description: "List issues in a GitLab project",
      inputSchema: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          state: { type: "string", enum: ["opened", "closed", "all"] },
          labels: { type: "string" },
          page: { type: "number" },
          per_page: { type: "number" },
        },
        required: ["projectId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") return tokenOrErr;

      const { projectId, state, labels, page, per_page } = input as {
        projectId: string; state?: string; labels?: string;
        page?: number; per_page?: number;
      };

      const encodedId = encodeURIComponent(projectId);
      const params = new URLSearchParams();
      if (state) params.set("state", state);
      if (labels) params.set("labels", labels);
      params.set("page", String(page ?? 1));
      params.set("per_page", String(per_page ?? 20));

      const { status, data } = await gitlabFetch(
        `/projects/${encodedId}/issues?${params.toString()}`,
        tokenOrErr
      );

      if (status !== 200) {
        return { success: false, error: `GitLab API error (${status})` };
      }

      const issues = (data as any[]).map((issue) => ({
        iid: issue.iid,
        title: issue.title,
        state: issue.state,
        labels: issue.labels ?? [],
        assignee: issue.assignee?.username ?? null,
        created_at: issue.created_at,
        web_url: issue.web_url,
      }));

      return { success: true, data: { issues, count: issues.length } };
    }
  );

  // ---- list_projects ----
  registry.register(
    {
      name: "gitlab_list_projects",
      adapter: "gitlab",
      description: "List GitLab projects accessible to the authenticated user",
      inputSchema: {
        type: "object",
        properties: {
          page: { type: "number" },
          per_page: { type: "number" },
          membership: { type: "boolean" },
        },
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") return tokenOrErr;

      const { page, per_page, membership } = input as {
        page?: number; per_page?: number; membership?: boolean;
      };

      const params = new URLSearchParams();
      params.set("page", String(page ?? 1));
      params.set("per_page", String(per_page ?? 20));
      if (membership !== false) params.set("membership", "true");

      const { status, data } = await gitlabFetch(`/projects?${params.toString()}`, tokenOrErr);

      if (status !== 200) {
        return { success: false, error: `GitLab API error (${status})` };
      }

      const projects = (data as any[]).map((p) => ({
        id: p.id,
        name: p.name,
        path_with_namespace: p.path_with_namespace,
        default_branch: p.default_branch,
        web_url: p.web_url,
      }));

      return { success: true, data: { projects, count: projects.length } };
    }
  );
}
