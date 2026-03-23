import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

const _logger = createLogger("mcp-gateway:jira");

const TRAILING_SLASHES_RE = /\/+$/;

async function jiraFetch(
  path: string,
  credentials: { baseUrl: string; email: string; token: string },
  options: { method?: string; body?: unknown } = {}
): Promise<{ status: number; data: unknown }> {
  const url = `${credentials.baseUrl}/rest/api/3${path}`;
  const auth = Buffer.from(
    `${credentials.email}:${credentials.token}`
  ).toString("base64");

  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
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

function extractJiraCredentials(
  credentials?: Record<string, string>
): MCPToolResult | { baseUrl: string; email: string; token: string } {
  const baseUrl = credentials?.jira_base_url;
  const email = credentials?.jira_email;
  const token = credentials?.jira_token;

  if (!(baseUrl && email && token)) {
    return {
      success: false,
      error: "Jira credentials required: jira_base_url, jira_email, jira_token",
    };
  }

  // Normalize base URL (remove trailing slash)
  return { baseUrl: baseUrl.replace(TRAILING_SLASHES_RE, ""), email, token };
}

function buildFieldsToUpdate(
  summary?: string,
  description?: string,
  assigneeAccountId?: string,
  labels?: string[]
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (summary) {
    fields.summary = summary;
  }
  if (assigneeAccountId) {
    fields.assignee = { accountId: assigneeAccountId };
  }
  if (labels) {
    fields.labels = labels;
  }
  if (description) {
    fields.description = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: description }] },
      ],
    };
  }
  return fields;
}

async function applyTransition(
  issueKey: string,
  transitionId: string | undefined,
  creds: { baseUrl: string; email: string; token: string }
): Promise<MCPToolResult | null> {
  if (!transitionId) {
    return null;
  }
  const { status } = await jiraFetch(`/issue/${issueKey}/transitions`, creds, {
    method: "POST",
    body: { transition: { id: transitionId } },
  });
  if (status !== 204 && status !== 200) {
    return { success: false, error: `Failed to transition issue (${status})` };
  }
  return null;
}

async function applyComment(
  issueKey: string,
  comment: string | undefined,
  creds: { baseUrl: string; email: string; token: string }
): Promise<MCPToolResult | null> {
  if (!comment) {
    return null;
  }
  const { status } = await jiraFetch(`/issue/${issueKey}/comment`, creds, {
    method: "POST",
    body: {
      body: {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: comment }] },
        ],
      },
    },
  });
  if (status !== 201 && status !== 200) {
    return { success: false, error: `Failed to add comment (${status})` };
  }
  return null;
}

export function registerJiraAdapter(registry: ToolRegistry): void {
  // ---- list_projects ----
  registry.register(
    {
      name: "jira_list_projects",
      adapter: "jira",
      description: "List Jira projects accessible to the authenticated user",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: { type: "number" },
          startAt: { type: "number" },
        },
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const creds = extractJiraCredentials(credentials);
      if ("success" in creds) {
        return creds;
      }

      const { maxResults, startAt } = input as {
        maxResults?: number;
        startAt?: number;
      };

      const params = new URLSearchParams({
        maxResults: String(maxResults ?? 50),
        startAt: String(startAt ?? 0),
      });

      const { status, data } = await jiraFetch(
        `/project/search?${params.toString()}`,
        creds
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Jira API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as Record<string, unknown>;
      const projects = ((result.values as Record<string, unknown>[]) ?? []).map(
        (p) => ({
          id: p.id,
          key: p.key,
          name: p.name,
          projectTypeKey: p.projectTypeKey,
          lead:
            (p.lead as Record<string, unknown> | undefined)?.displayName ??
            null,
          url: `${creds.baseUrl}/browse/${p.key}`,
        })
      );

      return { success: true, data: { projects, count: projects.length } };
    }
  );

  // ---- list_transitions ----
  registry.register(
    {
      name: "jira_list_transitions",
      adapter: "jira",
      description: "List available status transitions for a Jira issue",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Issue key (e.g., PROJ-123)",
          },
        },
        required: ["issueKey"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const creds = extractJiraCredentials(credentials);
      if ("success" in creds) {
        return creds;
      }

      const { issueKey } = input as { issueKey: string };

      const { status, data } = await jiraFetch(
        `/issue/${issueKey}/transitions`,
        creds
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Jira API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as Record<string, unknown>;
      const transitions = (
        (result.transitions as Record<string, unknown>[]) ?? []
      ).map((t) => {
        const to = t.to as Record<string, unknown> | undefined;
        return {
          id: t.id,
          name: t.name,
          to: {
            id: to?.id,
            name: to?.name,
            statusCategory: (
              to?.statusCategory as Record<string, unknown> | undefined
            )?.name,
          },
        };
      });

      return {
        success: true,
        data: { transitions, count: transitions.length },
      };
    }
  );

  // ---- list_issues ----
  registry.register(
    {
      name: "jira_list_issues",
      adapter: "jira",
      description: "Search for Jira issues using JQL",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: {
            type: "string",
            description: "Jira project key (e.g., 'PROJ')",
          },
          jql: {
            type: "string",
            description: "JQL query (overrides projectKey filter)",
          },
          status: { type: "string", description: "Filter by status name" },
          maxResults: { type: "number" },
          startAt: { type: "number" },
        },
        required: ["projectKey"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const creds = extractJiraCredentials(credentials);
      if ("success" in creds) {
        return creds;
      }

      const { projectKey, jql, status, maxResults, startAt } = input as {
        projectKey: string;
        jql?: string;
        status?: string;
        maxResults?: number;
        startAt?: number;
      };

      let query = jql;
      if (!query) {
        const parts = [`project = "${projectKey}"`];
        if (status) {
          parts.push(`status = "${status}"`);
        }
        parts.push("ORDER BY updated DESC");
        query = parts.join(" AND ");
      }

      const params = new URLSearchParams({
        jql: query,
        maxResults: String(maxResults ?? 25),
        startAt: String(startAt ?? 0),
        fields:
          "summary,status,assignee,priority,issuetype,created,updated,labels",
      });

      const { status: httpStatus, data } = await jiraFetch(
        `/search?${params.toString()}`,
        creds
      );

      if (httpStatus !== 200) {
        return {
          success: false,
          error: `Jira API error (${httpStatus}): ${JSON.stringify(data)}`,
        };
      }

      const searchResult = data as Record<string, unknown>;
      const issues = (
        (searchResult.issues as Record<string, unknown>[]) ?? []
      ).map((issue) => {
        const fields = issue.fields as Record<string, unknown> | undefined;
        return {
          key: issue.key,
          summary: fields?.summary,
          status: (fields?.status as Record<string, unknown> | undefined)?.name,
          assignee:
            (fields?.assignee as Record<string, unknown> | undefined)
              ?.displayName ?? null,
          priority: (fields?.priority as Record<string, unknown> | undefined)
            ?.name,
          issueType: (fields?.issuetype as Record<string, unknown> | undefined)
            ?.name,
          labels: fields?.labels ?? [],
          created: fields?.created,
          updated: fields?.updated,
          url: `${creds.baseUrl}/browse/${issue.key}`,
        };
      });

      return {
        success: true,
        data: {
          issues,
          total: searchResult.total,
          count: issues.length,
        },
      };
    }
  );

  // ---- create_issue ----
  registry.register(
    {
      name: "jira_create_issue",
      adapter: "jira",
      description: "Create a new Jira issue",
      inputSchema: {
        type: "object",
        properties: {
          projectKey: { type: "string" },
          summary: { type: "string" },
          description: { type: "string" },
          issueType: {
            type: "string",
            description: "Issue type name (e.g., Task, Bug, Story)",
          },
          priority: {
            type: "string",
            description: "Priority name (e.g., High, Medium, Low)",
          },
          assigneeAccountId: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
        },
        required: ["projectKey", "summary", "issueType"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const creds = extractJiraCredentials(credentials);
      if ("success" in creds) {
        return creds;
      }

      const {
        projectKey,
        summary,
        description,
        issueType,
        priority,
        assigneeAccountId,
        labels,
      } = input as {
        projectKey: string;
        summary: string;
        description?: string;
        issueType: string;
        priority?: string;
        assigneeAccountId?: string;
        labels?: string[];
      };

      const fields: Record<string, unknown> = {
        project: { key: projectKey },
        summary,
        issuetype: { name: issueType },
      };

      if (description) {
        // Jira Cloud uses Atlassian Document Format (ADF) for descriptions
        fields.description = {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: description }],
            },
          ],
        };
      }

      if (priority) {
        fields.priority = { name: priority };
      }
      if (assigneeAccountId) {
        fields.assignee = { accountId: assigneeAccountId };
      }
      if (labels?.length) {
        fields.labels = labels;
      }

      const { status, data } = await jiraFetch("/issue", creds, {
        method: "POST",
        body: { fields },
      });

      if (status !== 201) {
        return {
          success: false,
          error: `Failed to create issue (${status}): ${JSON.stringify(data)}`,
        };
      }

      const created = data as Record<string, unknown>;
      return {
        success: true,
        data: {
          key: created.key,
          id: created.id,
          url: `${creds.baseUrl}/browse/${created.key}`,
        },
      };
    }
  );

  // ---- update_issue (transition) ----
  registry.register(
    {
      name: "jira_update_issue",
      adapter: "jira",
      description: "Update a Jira issue or transition it to a new status",
      inputSchema: {
        type: "object",
        properties: {
          issueKey: {
            type: "string",
            description: "Issue key (e.g., PROJ-123)",
          },
          summary: { type: "string" },
          description: { type: "string" },
          transitionId: {
            type: "string",
            description:
              "Transition ID to change status (use jira_list_transitions to find IDs)",
          },
          assigneeAccountId: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          comment: {
            type: "string",
            description: "Add a comment to the issue",
          },
        },
        required: ["issueKey"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const creds = extractJiraCredentials(credentials);
      if ("success" in creds) {
        return creds;
      }

      const {
        issueKey,
        summary,
        description,
        transitionId,
        assigneeAccountId,
        labels,
        comment,
      } = input as {
        issueKey: string;
        summary?: string;
        description?: string;
        transitionId?: string;
        assigneeAccountId?: string;
        labels?: string[];
        comment?: string;
      };

      // Update fields if provided
      const fieldsToUpdate = buildFieldsToUpdate(
        summary,
        description,
        assigneeAccountId,
        labels
      );

      if (Object.keys(fieldsToUpdate).length > 0) {
        const { status } = await jiraFetch(`/issue/${issueKey}`, creds, {
          method: "PUT",
          body: { fields: fieldsToUpdate },
        });
        if (status !== 204 && status !== 200) {
          return {
            success: false,
            error: `Failed to update issue fields (${status})`,
          };
        }
      }

      // Perform transition if requested
      const transitionError = await applyTransition(
        issueKey,
        transitionId,
        creds
      );
      if (transitionError) {
        return transitionError;
      }

      // Add comment if provided
      const commentError = await applyComment(issueKey, comment, creds);
      if (commentError) {
        return commentError;
      }

      return {
        success: true,
        data: {
          key: issueKey,
          updated: true,
          transitioned: !!transitionId,
          commented: !!comment,
          url: `${creds.baseUrl}/browse/${issueKey}`,
        },
      };
    }
  );
}
