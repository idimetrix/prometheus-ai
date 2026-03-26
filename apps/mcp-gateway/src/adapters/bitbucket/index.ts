import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

const logger = createLogger("mcp-gateway:bitbucket");
const BITBUCKET_API = "https://api.bitbucket.org/2.0";

/**
 * Helper to make authenticated BitBucket API requests.
 */
async function bitbucketFetch(
  path: string,
  token: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; data: unknown }> {
  const url = path.startsWith("http") ? path : `${BITBUCKET_API}${path}`;
  const method = options.method ?? "GET";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "User-Agent": "Prometheus-MCP-Gateway/1.0",
    ...options.headers,
  };

  if (options.body) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(url, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  let data: unknown;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { status: response.status, data };
}

function requireToken(
  credentials?: Record<string, string>
): MCPToolResult | string {
  const token = credentials?.bitbucket_token;
  if (!token) {
    return {
      success: false,
      error: "BitBucket token required. Provide credentials.bitbucket_token.",
    };
  }
  return token;
}

export function registerBitBucketAdapter(registry: ToolRegistry): void {
  // ---- list_repos ----
  registry.register(
    {
      name: "bitbucket_list_repos",
      adapter: "bitbucket",
      description:
        "List repositories for the authenticated user or a specific workspace",
      inputSchema: {
        type: "object",
        properties: {
          workspace: {
            type: "string",
            description:
              "Workspace slug (omit for all repositories the user has access to)",
          },
          sort: {
            type: "string",
            enum: ["-updated_on", "name", "-created_on"],
            description: "Sort order for results",
          },
          page: { type: "number" },
          pagelen: { type: "number" },
          q: {
            type: "string",
            description: 'BitBucket query filter (e.g., name ~ "myrepo")',
          },
        },
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { workspace, sort, page, pagelen, q } = input as {
        workspace?: string;
        sort?: string;
        page?: number;
        pagelen?: number;
        q?: string;
      };

      const params = new URLSearchParams();
      if (sort) {
        params.set("sort", sort);
      }
      params.set("page", String(page ?? 1));
      params.set("pagelen", String(pagelen ?? 25));
      if (q) {
        params.set("q", q);
      }

      const endpoint = workspace
        ? `/repositories/${workspace}?${params.toString()}`
        : `/repositories?role=member&${params.toString()}`;

      const { status, data } = await bitbucketFetch(endpoint, tokenOrErr);

      if (status !== 200) {
        return {
          success: false,
          error: `BitBucket API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as { values: Record<string, unknown>[] };
      const repos = (result.values ?? []).map((repo) => {
        const mainBranch = repo.mainbranch as
          | Record<string, unknown>
          | undefined;
        const links = repo.links as Record<string, unknown> | undefined;
        const htmlLink = links?.html as Record<string, unknown> | undefined;
        return {
          full_name: repo.full_name,
          name: repo.name,
          owner: (repo.owner as Record<string, unknown> | undefined)?.nickname,
          is_private: repo.is_private,
          description: repo.description,
          default_branch: mainBranch?.name ?? "main",
          language: repo.language,
          updated_on: repo.updated_on,
          html_url: htmlLink?.href,
          uuid: repo.uuid,
        };
      });

      return { success: true, data: { repos, count: repos.length } };
    }
  );

  // ---- clone_repo ----
  registry.register(
    {
      name: "bitbucket_clone_repo",
      adapter: "bitbucket",
      description: "Get repository information including clone URLs",
      inputSchema: {
        type: "object",
        properties: {
          workspace: { type: "string", description: "Workspace slug" },
          repo_slug: { type: "string", description: "Repository slug" },
        },
        required: ["workspace", "repo_slug"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { workspace, repo_slug } = input as {
        workspace: string;
        repo_slug: string;
      };

      const { status, data } = await bitbucketFetch(
        `/repositories/${workspace}/${repo_slug}`,
        tokenOrErr
      );

      if (status !== 200) {
        return {
          success: false,
          error: `BitBucket API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const repoData = data as Record<string, unknown>;
      const links = repoData.links as Record<string, unknown> | undefined;
      const cloneLinks = (links?.clone as Record<string, unknown>[]) ?? [];
      const httpsClone = cloneLinks.find((l) => l.name === "https");
      const sshClone = cloneLinks.find((l) => l.name === "ssh");
      const mainBranch = repoData.mainbranch as
        | Record<string, unknown>
        | undefined;

      return {
        success: true,
        data: {
          clone_url: httpsClone?.href ?? null,
          ssh_url: sshClone?.href ?? null,
          default_branch: mainBranch?.name ?? "main",
          full_name: repoData.full_name,
          is_private: repoData.is_private,
        },
      };
    }
  );

  // ---- create_pr ----
  registry.register(
    {
      name: "bitbucket_create_pr",
      adapter: "bitbucket",
      description: "Create a pull request in a BitBucket repository",
      inputSchema: {
        type: "object",
        properties: {
          workspace: { type: "string" },
          repo_slug: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          source_branch: {
            type: "string",
            description: "Branch containing changes",
          },
          destination_branch: {
            type: "string",
            description: "Branch to merge into",
          },
          close_source_branch: { type: "boolean" },
          reviewers: {
            type: "array",
            items: { type: "string" },
            description: "UUIDs of reviewers",
          },
        },
        required: [
          "workspace",
          "repo_slug",
          "title",
          "source_branch",
          "destination_branch",
        ],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const {
        workspace,
        repo_slug,
        title,
        description,
        source_branch,
        destination_branch,
        close_source_branch,
        reviewers,
      } = input as {
        workspace: string;
        repo_slug: string;
        title: string;
        description?: string;
        source_branch: string;
        destination_branch: string;
        close_source_branch?: boolean;
        reviewers?: string[];
      };

      const body: Record<string, unknown> = {
        title,
        source: { branch: { name: source_branch } },
        destination: { branch: { name: destination_branch } },
        close_source_branch: close_source_branch ?? false,
      };

      if (description) {
        body.description = description;
      }
      if (reviewers?.length) {
        body.reviewers = reviewers.map((uuid) => ({ uuid }));
      }

      const { status, data } = await bitbucketFetch(
        `/repositories/${workspace}/${repo_slug}/pullrequests`,
        tokenOrErr,
        { method: "POST", body }
      );

      if (status !== 201) {
        return {
          success: false,
          error: `Failed to create PR (${status}): ${JSON.stringify(data)}`,
        };
      }

      const prData = data as Record<string, unknown>;
      const prLinks = prData.links as Record<string, unknown> | undefined;
      const htmlLink = prLinks?.html as Record<string, unknown> | undefined;

      return {
        success: true,
        data: {
          pr_id: prData.id,
          pr_url: htmlLink?.href ?? null,
          state: prData.state,
          title: prData.title,
        },
      };
    }
  );

  // ---- list_prs ----
  registry.register(
    {
      name: "bitbucket_list_prs",
      adapter: "bitbucket",
      description: "List pull requests in a BitBucket repository",
      inputSchema: {
        type: "object",
        properties: {
          workspace: { type: "string" },
          repo_slug: { type: "string" },
          state: {
            type: "string",
            enum: ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"],
          },
          page: { type: "number" },
          pagelen: { type: "number" },
        },
        required: ["workspace", "repo_slug"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { workspace, repo_slug, state, page, pagelen } = input as {
        workspace: string;
        repo_slug: string;
        state?: string;
        page?: number;
        pagelen?: number;
      };

      const params = new URLSearchParams();
      if (state) {
        params.set("state", state);
      }
      params.set("page", String(page ?? 1));
      params.set("pagelen", String(pagelen ?? 25));

      const { status, data } = await bitbucketFetch(
        `/repositories/${workspace}/${repo_slug}/pullrequests?${params.toString()}`,
        tokenOrErr
      );

      if (status !== 200) {
        return {
          success: false,
          error: `BitBucket API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as { values: Record<string, unknown>[] };
      const prs = (result.values ?? []).map((pr) => {
        const author = pr.author as Record<string, unknown> | undefined;
        const source = pr.source as Record<string, unknown> | undefined;
        const sourceBranch = source?.branch as
          | Record<string, unknown>
          | undefined;
        const dest = pr.destination as Record<string, unknown> | undefined;
        const destBranch = dest?.branch as Record<string, unknown> | undefined;
        const prLinks = pr.links as Record<string, unknown> | undefined;
        const htmlLink = prLinks?.html as Record<string, unknown> | undefined;

        return {
          id: pr.id,
          title: pr.title,
          state: pr.state,
          author: author?.nickname ?? author?.display_name ?? null,
          source_branch: sourceBranch?.name ?? null,
          destination_branch: destBranch?.name ?? null,
          created_on: pr.created_on,
          updated_on: pr.updated_on,
          html_url: htmlLink?.href ?? null,
        };
      });

      return {
        success: true,
        data: { pull_requests: prs, count: prs.length },
      };
    }
  );

  // ---- create_issue ----
  registry.register(
    {
      name: "bitbucket_create_issue",
      adapter: "bitbucket",
      description: "Create a new issue in a BitBucket repository",
      inputSchema: {
        type: "object",
        properties: {
          workspace: { type: "string" },
          repo_slug: { type: "string" },
          title: { type: "string" },
          content: {
            type: "string",
            description: "Issue body/description (raw text)",
          },
          kind: {
            type: "string",
            enum: ["bug", "enhancement", "proposal", "task"],
          },
          priority: {
            type: "string",
            enum: ["trivial", "minor", "major", "critical", "blocker"],
          },
          assignee: {
            type: "string",
            description: "Account ID of the assignee",
          },
        },
        required: ["workspace", "repo_slug", "title"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { workspace, repo_slug, title, content, kind, priority, assignee } =
        input as {
          workspace: string;
          repo_slug: string;
          title: string;
          content?: string;
          kind?: string;
          priority?: string;
          assignee?: string;
        };

      const body: Record<string, unknown> = { title };

      if (content) {
        body.content = { raw: content };
      }
      if (kind) {
        body.kind = kind;
      }
      if (priority) {
        body.priority = priority;
      }
      if (assignee) {
        body.assignee = { account_id: assignee };
      }

      const { status, data } = await bitbucketFetch(
        `/repositories/${workspace}/${repo_slug}/issues`,
        tokenOrErr,
        { method: "POST", body }
      );

      if (status !== 201) {
        return {
          success: false,
          error: `Failed to create issue (${status}): ${JSON.stringify(data)}`,
        };
      }

      const issue = data as Record<string, unknown>;
      const issueLinks = issue.links as Record<string, unknown> | undefined;
      const htmlLink = issueLinks?.html as Record<string, unknown> | undefined;

      return {
        success: true,
        data: {
          id: issue.id,
          title: issue.title,
          state: issue.state,
          html_url: htmlLink?.href ?? null,
          kind: issue.kind,
          priority: issue.priority,
        },
      };
    }
  );

  // ---- list_issues ----
  registry.register(
    {
      name: "bitbucket_list_issues",
      adapter: "bitbucket",
      description: "List issues in a BitBucket repository",
      inputSchema: {
        type: "object",
        properties: {
          workspace: { type: "string" },
          repo_slug: { type: "string" },
          state: {
            type: "string",
            enum: [
              "new",
              "open",
              "resolved",
              "on hold",
              "invalid",
              "duplicate",
              "wontfix",
              "closed",
            ],
          },
          page: { type: "number" },
          pagelen: { type: "number" },
        },
        required: ["workspace", "repo_slug"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { workspace, repo_slug, state, page, pagelen } = input as {
        workspace: string;
        repo_slug: string;
        state?: string;
        page?: number;
        pagelen?: number;
      };

      const params = new URLSearchParams();
      if (state) {
        params.set("q", `state="${state}"`);
      }
      params.set("page", String(page ?? 1));
      params.set("pagelen", String(pagelen ?? 25));

      const { status, data } = await bitbucketFetch(
        `/repositories/${workspace}/${repo_slug}/issues?${params.toString()}`,
        tokenOrErr
      );

      if (status !== 200) {
        return {
          success: false,
          error: `BitBucket API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as { values: Record<string, unknown>[] };
      const issues = (result.values ?? []).map((issue) => {
        const assignee = issue.assignee as Record<string, unknown> | undefined;
        const issueLinks = issue.links as Record<string, unknown> | undefined;
        const htmlLink = issueLinks?.html as
          | Record<string, unknown>
          | undefined;

        return {
          id: issue.id,
          title: issue.title,
          state: issue.state,
          kind: issue.kind,
          priority: issue.priority,
          assignee: assignee?.nickname ?? assignee?.display_name ?? null,
          created_on: issue.created_on,
          updated_on: issue.updated_on,
          html_url: htmlLink?.href ?? null,
        };
      });

      return { success: true, data: { issues, count: issues.length } };
    }
  );

  // ---- add_comment ----
  registry.register(
    {
      name: "bitbucket_add_comment",
      adapter: "bitbucket",
      description:
        "Add a comment to a pull request or issue in a BitBucket repository",
      inputSchema: {
        type: "object",
        properties: {
          workspace: { type: "string" },
          repo_slug: { type: "string" },
          target_type: {
            type: "string",
            enum: ["pullrequest", "issue"],
            description: "Whether commenting on a PR or issue",
          },
          target_id: {
            type: "number",
            description: "PR number or issue ID",
          },
          body: { type: "string", description: "Comment content (raw text)" },
        },
        required: [
          "workspace",
          "repo_slug",
          "target_type",
          "target_id",
          "body",
        ],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { workspace, repo_slug, target_type, target_id, body } = input as {
        workspace: string;
        repo_slug: string;
        target_type: "pullrequest" | "issue";
        target_id: number;
        body: string;
      };

      const pathSegment =
        target_type === "pullrequest" ? "pullrequests" : "issues";

      const { status, data } = await bitbucketFetch(
        `/repositories/${workspace}/${repo_slug}/${pathSegment}/${target_id}/comments`,
        tokenOrErr,
        { method: "POST", body: { content: { raw: body } } }
      );

      if (status !== 201) {
        return {
          success: false,
          error: `Failed to add comment (${status}): ${JSON.stringify(data)}`,
        };
      }

      const comment = data as Record<string, unknown>;
      const commentLinks = comment.links as Record<string, unknown> | undefined;
      const htmlLink = commentLinks?.html as
        | Record<string, unknown>
        | undefined;

      return {
        success: true,
        data: {
          comment_id: comment.id,
          html_url: htmlLink?.href ?? null,
        },
      };
    }
  );

  logger.info("BitBucket adapter registered");
}
