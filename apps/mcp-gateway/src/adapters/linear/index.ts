import { createLogger } from "@prometheus/logger";
import type { ToolRegistry, MCPToolResult } from "../../registry";

const logger = createLogger("mcp-gateway:linear");

const LINEAR_API = "https://api.linear.app/graphql";

async function linearGraphQL(
  query: string,
  variables: Record<string, unknown>,
  token: string
): Promise<{ data: unknown; errors?: Array<{ message: string }> }> {
  const response = await fetch(LINEAR_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "User-Agent": "Prometheus-MCP-Gateway/1.0",
    },
    body: JSON.stringify({ query, variables }),
  });

  const result = await response.json() as { data: unknown; errors?: Array<{ message: string }> };
  return result;
}

function requireToken(credentials?: Record<string, string>): MCPToolResult | string {
  const token = credentials?.linear_token;
  if (!token) {
    return { success: false, error: "Linear API key required. Provide credentials.linear_token." };
  }
  return token;
}

export function registerLinearAdapter(registry: ToolRegistry): void {
  // ---- list_issues ----
  registry.register(
    {
      name: "linear_list_issues",
      adapter: "linear",
      description: "List issues from a Linear team",
      inputSchema: {
        type: "object",
        properties: {
          teamId: { type: "string", description: "Linear team ID" },
          status: { type: "string", description: "Filter by status name" },
          first: { type: "number", description: "Number of issues to return (max 50)" },
        },
        required: ["teamId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") return tokenOrErr;

      const { teamId, status, first } = input as {
        teamId: string; status?: string; first?: number;
      };

      const filterParts: string[] = [`team: { id: { eq: "${teamId}" } }`];
      if (status) {
        filterParts.push(`state: { name: { eq: "${status}" } }`);
      }

      const query = `
        query ListIssues($first: Int) {
          issues(
            first: $first,
            filter: { ${filterParts.join(", ")} }
            orderBy: updatedAt
          ) {
            nodes {
              id
              identifier
              title
              description
              priority
              state { name }
              assignee { name email }
              labels { nodes { name } }
              createdAt
              updatedAt
              url
            }
          }
        }
      `;

      const result = await linearGraphQL(query, { first: Math.min(first ?? 25, 50) }, tokenOrErr);

      if (result.errors?.length) {
        return { success: false, error: result.errors.map((e) => e.message).join("; ") };
      }

      const issuesData = (result.data as any)?.issues?.nodes ?? [];
      const issues = issuesData.map((issue: any) => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        status: issue.state?.name ?? null,
        assignee: issue.assignee?.name ?? null,
        labels: issue.labels?.nodes?.map((l: any) => l.name) ?? [],
        created_at: issue.createdAt,
        updated_at: issue.updatedAt,
        url: issue.url,
      }));

      return { success: true, data: { issues, count: issues.length } };
    }
  );

  // ---- create_issue ----
  registry.register(
    {
      name: "linear_create_issue",
      adapter: "linear",
      description: "Create a new Linear issue",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          description: { type: "string" },
          teamId: { type: "string" },
          priority: { type: "number", description: "0=none, 1=urgent, 2=high, 3=medium, 4=low" },
          assigneeId: { type: "string" },
          labelIds: { type: "array", items: { type: "string" } },
        },
        required: ["title", "teamId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") return tokenOrErr;

      const { title, description, teamId, priority, assigneeId, labelIds } = input as {
        title: string; description?: string; teamId: string;
        priority?: number; assigneeId?: string; labelIds?: string[];
      };

      const issueInput: Record<string, unknown> = {
        title,
        teamId,
      };
      if (description) issueInput.description = description;
      if (priority !== undefined) issueInput.priority = priority;
      if (assigneeId) issueInput.assigneeId = assigneeId;
      if (labelIds?.length) issueInput.labelIds = labelIds;

      const query = `
        mutation CreateIssue($input: IssueCreateInput!) {
          issueCreate(input: $input) {
            success
            issue {
              id
              identifier
              title
              url
              state { name }
            }
          }
        }
      `;

      const result = await linearGraphQL(query, { input: issueInput }, tokenOrErr);

      if (result.errors?.length) {
        return { success: false, error: result.errors.map((e) => e.message).join("; ") };
      }

      const created = (result.data as any)?.issueCreate;
      if (!created?.success) {
        return { success: false, error: "Failed to create issue" };
      }

      return {
        success: true,
        data: {
          issue_id: created.issue.id,
          identifier: created.issue.identifier,
          title: created.issue.title,
          status: created.issue.state?.name,
          url: created.issue.url,
        },
      };
    }
  );

  // ---- update_issue ----
  registry.register(
    {
      name: "linear_update_issue",
      adapter: "linear",
      description: "Update a Linear issue (status, assignee, priority, etc.)",
      inputSchema: {
        type: "object",
        properties: {
          issueId: { type: "string" },
          title: { type: "string" },
          description: { type: "string" },
          stateId: { type: "string", description: "Workflow state ID to transition to" },
          priority: { type: "number" },
          assigneeId: { type: "string" },
        },
        required: ["issueId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") return tokenOrErr;

      const { issueId, title, description, stateId, priority, assigneeId } = input as {
        issueId: string; title?: string; description?: string;
        stateId?: string; priority?: number; assigneeId?: string;
      };

      const updateInput: Record<string, unknown> = {};
      if (title) updateInput.title = title;
      if (description) updateInput.description = description;
      if (stateId) updateInput.stateId = stateId;
      if (priority !== undefined) updateInput.priority = priority;
      if (assigneeId) updateInput.assigneeId = assigneeId;

      const query = `
        mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {
          issueUpdate(id: $id, input: $input) {
            success
            issue {
              id
              identifier
              title
              state { name }
              assignee { name }
              url
            }
          }
        }
      `;

      const result = await linearGraphQL(query, { id: issueId, input: updateInput }, tokenOrErr);

      if (result.errors?.length) {
        return { success: false, error: result.errors.map((e) => e.message).join("; ") };
      }

      const updated = (result.data as any)?.issueUpdate;
      if (!updated?.success) {
        return { success: false, error: "Failed to update issue" };
      }

      return {
        success: true,
        data: {
          issue_id: updated.issue.id,
          identifier: updated.issue.identifier,
          title: updated.issue.title,
          status: updated.issue.state?.name,
          assignee: updated.issue.assignee?.name,
          url: updated.issue.url,
        },
      };
    }
  );
}
