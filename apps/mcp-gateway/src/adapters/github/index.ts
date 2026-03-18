import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

const logger = createLogger("mcp-gateway:github");
const GITHUB_API = "https://api.github.com";

/**
 * Helper to make authenticated GitHub API requests with rate limit handling.
 */
async function githubFetch(
  path: string,
  token: string,
  options: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {}
): Promise<{ status: number; data: unknown; rateLimitRemaining: number }> {
  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const method = options.method ?? "GET";

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
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

  const rateLimitRemaining = Number.parseInt(
    response.headers.get("x-ratelimit-remaining") ?? "5000",
    10
  );

  if (rateLimitRemaining < 100) {
    logger.warn({ rateLimitRemaining }, "GitHub rate limit running low");
  }

  if (rateLimitRemaining === 0) {
    const resetAt = response.headers.get("x-ratelimit-reset");
    const resetDate = resetAt
      ? new Date(Number.parseInt(resetAt, 10) * 1000).toISOString()
      : "unknown";
    logger.error({ resetAt: resetDate }, "GitHub rate limit exhausted");
  }

  let data: unknown;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    data = await response.json();
  } else {
    data = await response.text();
  }

  return { status: response.status, data, rateLimitRemaining };
}

function requireToken(
  credentials?: Record<string, string>
): MCPToolResult | string {
  const token = credentials?.github_token;
  if (!token) {
    return {
      success: false,
      error: "GitHub token required. Provide credentials.github_token.",
    };
  }
  return token;
}

export function registerGitHubAdapter(registry: ToolRegistry): void {
  // ---- clone_repo ----
  registry.register(
    {
      name: "github_clone_repo",
      adapter: "github",
      description: "Get repository information including clone URL",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
        },
        required: ["owner", "repo"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { owner, repo } = input as { owner: string; repo: string };
      const { status, data } = await githubFetch(
        `/repos/${owner}/${repo}`,
        tokenOrErr
      );

      if (status !== 200) {
        return {
          success: false,
          error: `GitHub API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const repoData = data as Record<string, unknown>;
      return {
        success: true,
        data: {
          clone_url: repoData.clone_url,
          ssh_url: repoData.ssh_url,
          default_branch: repoData.default_branch,
          full_name: repoData.full_name,
          private: repoData.private,
        },
      };
    }
  );

  // ---- list_repos ----
  registry.register(
    {
      name: "github_list_repos",
      adapter: "github",
      description:
        "List repositories for the authenticated user or a specific owner",
      inputSchema: {
        type: "object",
        properties: {
          owner: {
            type: "string",
            description:
              "User or org name (omit for authenticated user's repos)",
          },
          type: {
            type: "string",
            enum: ["all", "owner", "public", "private", "member"],
            description: "Filter by repo type",
          },
          sort: {
            type: "string",
            enum: ["created", "updated", "pushed", "full_name"],
          },
          page: { type: "number" },
          per_page: { type: "number" },
        },
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { owner, type, sort, page, per_page } = input as {
        owner?: string;
        type?: string;
        sort?: string;
        page?: number;
        per_page?: number;
      };

      const params = new URLSearchParams();
      if (type) {
        params.set("type", type);
      }
      if (sort) {
        params.set("sort", sort);
      }
      params.set("page", String(page ?? 1));
      params.set("per_page", String(per_page ?? 30));

      const endpoint = owner
        ? `/users/${owner}/repos?${params.toString()}`
        : `/user/repos?${params.toString()}`;

      const { status, data } = await githubFetch(endpoint, tokenOrErr);

      if (status !== 200) {
        return {
          success: false,
          error: `GitHub API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const repos = (data as Record<string, unknown>[]).map((repo) => ({
        full_name: repo.full_name,
        name: repo.name,
        owner: (repo.owner as Record<string, unknown> | undefined)?.login,
        private: repo.private,
        description: repo.description,
        default_branch: repo.default_branch,
        language: repo.language,
        stargazers_count: repo.stargazers_count,
        updated_at: repo.updated_at,
        html_url: repo.html_url,
      }));

      return { success: true, data: { repos, count: repos.length } };
    }
  );

  // ---- create_branch ----
  registry.register(
    {
      name: "github_create_branch",
      adapter: "github",
      description: "Create a new branch from a reference",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          branch: { type: "string", description: "New branch name" },
          from_ref: {
            type: "string",
            description: "Source branch or SHA (defaults to default branch)",
          },
        },
        required: ["owner", "repo", "branch"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { owner, repo, branch, from_ref } = input as {
        owner: string;
        repo: string;
        branch: string;
        from_ref?: string;
      };

      // Get the SHA of the source ref
      const refResult = await githubFetch(
        `/repos/${owner}/${repo}/git/ref/heads/${from_ref ?? "main"}`,
        tokenOrErr
      );

      if (refResult.status !== 200) {
        // Try "master" if "main" failed and no specific ref was given
        if (!from_ref) {
          const masterResult = await githubFetch(
            `/repos/${owner}/${repo}/git/ref/heads/master`,
            tokenOrErr
          );
          if (masterResult.status !== 200) {
            return {
              success: false,
              error: "Could not find default branch reference",
            };
          }
          const sha = (
            (masterResult.data as Record<string, unknown>).object as Record<
              string,
              unknown
            >
          ).sha;
          const createResult = await githubFetch(
            `/repos/${owner}/${repo}/git/refs`,
            tokenOrErr,
            {
              method: "POST",
              body: { ref: `refs/heads/${branch}`, sha },
            }
          );
          if (createResult.status !== 201) {
            return {
              success: false,
              error: `Failed to create branch: ${JSON.stringify(createResult.data)}`,
            };
          }
          return {
            success: true,
            data: { branch, sha, ref: `refs/heads/${branch}` },
          };
        }
        return { success: false, error: `Could not find ref: ${from_ref}` };
      }

      const sha = (
        (refResult.data as Record<string, unknown>).object as Record<
          string,
          unknown
        >
      ).sha;

      // Create the new branch
      const createResult = await githubFetch(
        `/repos/${owner}/${repo}/git/refs`,
        tokenOrErr,
        {
          method: "POST",
          body: { ref: `refs/heads/${branch}`, sha },
        }
      );

      if (createResult.status !== 201) {
        return {
          success: false,
          error: `Failed to create branch: ${JSON.stringify(createResult.data)}`,
        };
      }

      return {
        success: true,
        data: { branch, sha, ref: `refs/heads/${branch}` },
      };
    }
  );

  // ---- read_file ----
  registry.register(
    {
      name: "github_read_file",
      adapter: "github",
      description: "Read file contents from a GitHub repository",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          path: { type: "string", description: "File path in the repository" },
          ref: { type: "string", description: "Branch, tag, or commit SHA" },
        },
        required: ["owner", "repo", "path"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { owner, repo, path, ref } = input as {
        owner: string;
        repo: string;
        path: string;
        ref?: string;
      };

      let url = `/repos/${owner}/${repo}/contents/${path}`;
      if (ref) {
        url += `?ref=${encodeURIComponent(ref)}`;
      }

      const { status, data } = await githubFetch(url, tokenOrErr);

      if (status !== 200) {
        return {
          success: false,
          error: `File not found or API error (${status})`,
        };
      }

      const fileData = data as Record<string, unknown>;

      // Decode base64 content
      let content: string;
      if (
        fileData.encoding === "base64" &&
        typeof fileData.content === "string"
      ) {
        content = Buffer.from(fileData.content, "base64").toString("utf-8");
      } else {
        content = String(fileData.content ?? "");
      }

      return {
        success: true,
        data: {
          content,
          sha: fileData.sha,
          size: fileData.size,
          path: fileData.path,
          encoding: "utf-8",
        },
      };
    }
  );

  // ---- write_file ----
  registry.register(
    {
      name: "github_write_file",
      adapter: "github",
      description: "Create or update a file in a GitHub repository",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          path: { type: "string" },
          content: {
            type: "string",
            description: "File content (will be base64-encoded)",
          },
          message: { type: "string", description: "Commit message" },
          branch: { type: "string" },
          sha: {
            type: "string",
            description:
              "SHA of the file being replaced (required for updates)",
          },
        },
        required: ["owner", "repo", "path", "content", "message"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { owner, repo, path, content, message, branch, sha } = input as {
        owner: string;
        repo: string;
        path: string;
        content: string;
        message: string;
        branch?: string;
        sha?: string;
      };

      const body: Record<string, unknown> = {
        message,
        content: Buffer.from(content, "utf-8").toString("base64"),
      };
      if (branch) {
        body.branch = branch;
      }
      if (sha) {
        body.sha = sha;
      }

      const { status, data } = await githubFetch(
        `/repos/${owner}/${repo}/contents/${path}`,
        tokenOrErr,
        { method: "PUT", body }
      );

      if (status !== 200 && status !== 201) {
        return {
          success: false,
          error: `Failed to write file (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as Record<string, unknown>;
      const commitData = result.commit as Record<string, unknown> | undefined;

      return {
        success: true,
        data: {
          path,
          sha: (result.content as Record<string, unknown> | undefined)?.sha,
          commit_sha: commitData?.sha,
        },
      };
    }
  );

  // ---- create_pr ----
  registry.register(
    {
      name: "github_create_pr",
      adapter: "github",
      description: "Create a pull request",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          head: { type: "string", description: "Branch containing changes" },
          base: { type: "string", description: "Branch to merge into" },
          draft: { type: "boolean" },
        },
        required: ["owner", "repo", "title", "head", "base"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { owner, repo, title, body, head, base, draft } = input as {
        owner: string;
        repo: string;
        title: string;
        body?: string;
        head: string;
        base: string;
        draft?: boolean;
      };

      const { status, data } = await githubFetch(
        `/repos/${owner}/${repo}/pulls`,
        tokenOrErr,
        {
          method: "POST",
          body: { title, body: body ?? "", head, base, draft: draft ?? false },
        }
      );

      if (status !== 201) {
        return {
          success: false,
          error: `Failed to create PR (${status}): ${JSON.stringify(data)}`,
        };
      }

      const prData = data as Record<string, unknown>;
      return {
        success: true,
        data: {
          pr_number: prData.number,
          pr_url: prData.html_url,
          state: prData.state,
          mergeable: prData.mergeable,
        },
      };
    }
  );

  // ---- list_prs ----
  registry.register(
    {
      name: "github_list_prs",
      adapter: "github",
      description: "List pull requests in a repository",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          state: { type: "string", enum: ["open", "closed", "all"] },
          head: {
            type: "string",
            description: "Filter by head branch (user:branch)",
          },
          base: { type: "string", description: "Filter by base branch" },
          sort: {
            type: "string",
            enum: ["created", "updated", "popularity", "long-running"],
          },
          direction: { type: "string", enum: ["asc", "desc"] },
          page: { type: "number" },
          per_page: { type: "number" },
        },
        required: ["owner", "repo"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const {
        owner,
        repo,
        state,
        head,
        base,
        sort,
        direction,
        page,
        per_page,
      } = input as {
        owner: string;
        repo: string;
        state?: string;
        head?: string;
        base?: string;
        sort?: string;
        direction?: string;
        page?: number;
        per_page?: number;
      };

      const params = new URLSearchParams();
      params.set("state", state ?? "open");
      if (head) {
        params.set("head", head);
      }
      if (base) {
        params.set("base", base);
      }
      if (sort) {
        params.set("sort", sort);
      }
      if (direction) {
        params.set("direction", direction);
      }
      params.set("page", String(page ?? 1));
      params.set("per_page", String(per_page ?? 30));

      const { status, data } = await githubFetch(
        `/repos/${owner}/${repo}/pulls?${params.toString()}`,
        tokenOrErr
      );

      if (status !== 200) {
        return {
          success: false,
          error: `GitHub API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const prs = (data as Record<string, unknown>[]).map((pr) => ({
        number: pr.number,
        title: pr.title,
        state: pr.state,
        draft: pr.draft,
        user: (pr.user as Record<string, unknown> | undefined)?.login ?? null,
        head_branch:
          (pr.head as Record<string, unknown> | undefined)?.ref ?? null,
        base_branch:
          (pr.base as Record<string, unknown> | undefined)?.ref ?? null,
        labels:
          (pr.labels as Record<string, unknown>[] | undefined)?.map(
            (l: Record<string, unknown>) => l.name
          ) ?? [],
        created_at: pr.created_at,
        updated_at: pr.updated_at,
        html_url: pr.html_url,
        mergeable_state: pr.mergeable_state,
      }));

      return { success: true, data: { pull_requests: prs, count: prs.length } };
    }
  );

  // ---- create_issue ----
  registry.register(
    {
      name: "github_create_issue",
      adapter: "github",
      description: "Create a new issue in a repository",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Label names to assign",
          },
          assignees: {
            type: "array",
            items: { type: "string" },
            description: "Usernames to assign",
          },
          milestone: { type: "number", description: "Milestone number" },
        },
        required: ["owner", "repo", "title"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { owner, repo, title, body, labels, assignees, milestone } =
        input as {
          owner: string;
          repo: string;
          title: string;
          body?: string;
          labels?: string[];
          assignees?: string[];
          milestone?: number;
        };

      const requestBody: Record<string, unknown> = { title };
      if (body) {
        requestBody.body = body;
      }
      if (labels?.length) {
        requestBody.labels = labels;
      }
      if (assignees?.length) {
        requestBody.assignees = assignees;
      }
      if (milestone) {
        requestBody.milestone = milestone;
      }

      const { status, data } = await githubFetch(
        `/repos/${owner}/${repo}/issues`,
        tokenOrErr,
        { method: "POST", body: requestBody }
      );

      if (status !== 201) {
        return {
          success: false,
          error: `Failed to create issue (${status}): ${JSON.stringify(data)}`,
        };
      }

      const issue = data as Record<string, unknown>;
      return {
        success: true,
        data: {
          number: issue.number,
          title: issue.title,
          state: issue.state,
          html_url: issue.html_url,
          labels:
            (issue.labels as Record<string, unknown>[] | undefined)?.map(
              (l: Record<string, unknown>) => l.name
            ) ?? [],
        },
      };
    }
  );

  // ---- update_issue ----
  registry.register(
    {
      name: "github_update_issue",
      adapter: "github",
      description:
        "Update an existing issue (title, body, state, labels, assignees)",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          issue_number: { type: "number" },
          title: { type: "string" },
          body: { type: "string" },
          state: { type: "string", enum: ["open", "closed"] },
          labels: { type: "array", items: { type: "string" } },
          assignees: { type: "array", items: { type: "string" } },
        },
        required: ["owner", "repo", "issue_number"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const {
        owner,
        repo,
        issue_number,
        title,
        body,
        state,
        labels,
        assignees,
      } = input as {
        owner: string;
        repo: string;
        issue_number: number;
        title?: string;
        body?: string;
        state?: string;
        labels?: string[];
        assignees?: string[];
      };

      const requestBody: Record<string, unknown> = {};
      if (title !== undefined) {
        requestBody.title = title;
      }
      if (body !== undefined) {
        requestBody.body = body;
      }
      if (state) {
        requestBody.state = state;
      }
      if (labels) {
        requestBody.labels = labels;
      }
      if (assignees) {
        requestBody.assignees = assignees;
      }

      const { status, data } = await githubFetch(
        `/repos/${owner}/${repo}/issues/${issue_number}`,
        tokenOrErr,
        { method: "PATCH", body: requestBody }
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Failed to update issue (${status}): ${JSON.stringify(data)}`,
        };
      }

      const issue = data as Record<string, unknown>;
      return {
        success: true,
        data: {
          number: issue.number,
          title: issue.title,
          state: issue.state,
          html_url: issue.html_url,
        },
      };
    }
  );

  // ---- list_issues ----
  registry.register(
    {
      name: "github_list_issues",
      adapter: "github",
      description: "List issues in a repository",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          state: { type: "string", enum: ["open", "closed", "all"] },
          labels: {
            type: "string",
            description: "Comma-separated label names",
          },
          page: { type: "number" },
          per_page: { type: "number" },
        },
        required: ["owner", "repo"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { owner, repo, state, labels, page, per_page } = input as {
        owner: string;
        repo: string;
        state?: string;
        labels?: string;
        page?: number;
        per_page?: number;
      };

      const params = new URLSearchParams();
      params.set("state", state ?? "open");
      if (labels) {
        params.set("labels", labels);
      }
      params.set("page", String(page ?? 1));
      params.set("per_page", String(per_page ?? 30));

      const { status, data } = await githubFetch(
        `/repos/${owner}/${repo}/issues?${params.toString()}`,
        tokenOrErr
      );

      if (status !== 200) {
        return { success: false, error: `GitHub API error (${status})` };
      }

      const issues = (data as Record<string, unknown>[]).map((issue) => ({
        number: issue.number,
        title: issue.title,
        state: issue.state,
        labels:
          (issue.labels as Record<string, unknown>[] | undefined)?.map(
            (l: Record<string, unknown>) => l.name
          ) ?? [],
        assignee:
          (issue.assignee as Record<string, unknown> | undefined)?.login ??
          null,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        html_url: issue.html_url,
      }));

      return { success: true, data: { issues, count: issues.length } };
    }
  );

  // ---- code_search ----
  registry.register(
    {
      name: "github_code_search",
      adapter: "github",
      description: "Search for code within a repository",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          query: { type: "string", description: "Search query string" },
          path: {
            type: "string",
            description: "Filter by file path (e.g., 'src/')",
          },
          extension: {
            type: "string",
            description: "Filter by file extension (e.g., 'ts')",
          },
          page: { type: "number" },
          per_page: { type: "number" },
        },
        required: ["owner", "repo", "query"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { owner, repo, query, path, extension, page, per_page } = input as {
        owner: string;
        repo: string;
        query: string;
        path?: string;
        extension?: string;
        page?: number;
        per_page?: number;
      };

      // Build the search query with qualifiers
      let searchQuery = `${query} repo:${owner}/${repo}`;
      if (path) {
        searchQuery += ` path:${path}`;
      }
      if (extension) {
        searchQuery += ` extension:${extension}`;
      }

      const params = new URLSearchParams({
        q: searchQuery,
        page: String(page ?? 1),
        per_page: String(per_page ?? 20),
      });

      const { status, data } = await githubFetch(
        `/search/code?${params.toString()}`,
        tokenOrErr
      );

      if (status !== 200) {
        return {
          success: false,
          error: `GitHub search API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const searchResult = data as Record<string, unknown>;
      const items = (
        (searchResult.items as Record<string, unknown>[]) ?? []
      ).map((item) => ({
        name: item.name,
        path: item.path,
        sha: item.sha,
        html_url: item.html_url,
        repository: (item.repository as Record<string, unknown> | undefined)
          ?.full_name,
        score: item.score,
        text_matches: (
          item.text_matches as Record<string, unknown>[] | undefined
        )?.map((m: Record<string, unknown>) => ({
          fragment: m.fragment,
          matches: (m.matches as Record<string, unknown>[] | undefined)?.map(
            (match: Record<string, unknown>) => ({
              text: match.text,
              indices: match.indices,
            })
          ),
        })),
      }));

      return {
        success: true,
        data: {
          total_count: searchResult.total_count,
          items,
          count: items.length,
        },
      };
    }
  );

  // ---- add_comment ----
  registry.register(
    {
      name: "github_add_comment",
      adapter: "github",
      description: "Add a comment to an issue or pull request",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          issue_number: { type: "number" },
          body: { type: "string" },
        },
        required: ["owner", "repo", "issue_number", "body"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { owner, repo, issue_number, body } = input as {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
      };

      const { status, data } = await githubFetch(
        `/repos/${owner}/${repo}/issues/${issue_number}/comments`,
        tokenOrErr,
        { method: "POST", body: { body } }
      );

      if (status !== 201) {
        return {
          success: false,
          error: `Failed to add comment (${status}): ${JSON.stringify(data)}`,
        };
      }

      const comment = data as Record<string, unknown>;
      return {
        success: true,
        data: {
          comment_id: comment.id,
          html_url: comment.html_url,
        },
      };
    }
  );

  // ---- push_files (create/update multiple files via Git tree API) ----
  registry.register(
    {
      name: "github_push_files",
      adapter: "github",
      description:
        "Push multiple file changes to a branch using the Git Data API",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          branch: { type: "string" },
          message: { type: "string", description: "Commit message" },
          files: {
            type: "array",
            items: {
              type: "object",
              properties: {
                path: { type: "string" },
                content: { type: "string" },
              },
              required: ["path", "content"],
            },
          },
        },
        required: ["owner", "repo", "branch", "message", "files"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { owner, repo, branch, message, files } = input as {
        owner: string;
        repo: string;
        branch: string;
        message: string;
        files: Array<{ path: string; content: string }>;
      };

      // 1. Get the current reference SHA
      const refResult = await githubFetch(
        `/repos/${owner}/${repo}/git/ref/heads/${branch}`,
        tokenOrErr
      );
      if (refResult.status !== 200) {
        return { success: false, error: `Branch '${branch}' not found` };
      }
      const currentSha = (
        (refResult.data as Record<string, unknown>).object as Record<
          string,
          unknown
        >
      ).sha as string;

      // 2. Get the current commit tree
      const commitResult = await githubFetch(
        `/repos/${owner}/${repo}/git/commits/${currentSha}`,
        tokenOrErr
      );
      if (commitResult.status !== 200) {
        return { success: false, error: "Failed to get current commit" };
      }
      const baseTreeSha = (
        (commitResult.data as Record<string, unknown>).tree as Record<
          string,
          unknown
        >
      ).sha as string;

      // 3. Create blobs for each file
      const treeEntries: Array<{
        path: string;
        mode: string;
        type: string;
        sha: string;
      }> = [];
      for (const file of files) {
        const blobResult = await githubFetch(
          `/repos/${owner}/${repo}/git/blobs`,
          tokenOrErr,
          {
            method: "POST",
            body: { content: file.content, encoding: "utf-8" },
          }
        );
        if (blobResult.status !== 201) {
          return {
            success: false,
            error: `Failed to create blob for ${file.path}`,
          };
        }
        treeEntries.push({
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: (blobResult.data as Record<string, unknown>).sha as string,
        });
      }

      // 4. Create a new tree
      const treeResult = await githubFetch(
        `/repos/${owner}/${repo}/git/trees`,
        tokenOrErr,
        {
          method: "POST",
          body: { base_tree: baseTreeSha, tree: treeEntries },
        }
      );
      if (treeResult.status !== 201) {
        return { success: false, error: "Failed to create tree" };
      }
      const newTreeSha = (treeResult.data as Record<string, unknown>)
        .sha as string;

      // 5. Create a new commit
      const newCommitResult = await githubFetch(
        `/repos/${owner}/${repo}/git/commits`,
        tokenOrErr,
        {
          method: "POST",
          body: {
            message,
            tree: newTreeSha,
            parents: [currentSha],
          },
        }
      );
      if (newCommitResult.status !== 201) {
        return { success: false, error: "Failed to create commit" };
      }
      const newCommitSha = (newCommitResult.data as Record<string, unknown>)
        .sha as string;

      // 6. Update the reference
      const updateRefResult = await githubFetch(
        `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
        tokenOrErr,
        {
          method: "PATCH",
          body: { sha: newCommitSha },
        }
      );
      if (updateRefResult.status !== 200) {
        return { success: false, error: "Failed to update branch reference" };
      }

      return {
        success: true,
        data: {
          commit_sha: newCommitSha,
          tree_sha: newTreeSha,
          files_pushed: files.length,
        },
      };
    }
  );
}
