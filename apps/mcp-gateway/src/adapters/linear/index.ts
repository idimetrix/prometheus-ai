import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

const _logger = createLogger("mcp-gateway:linear");

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

  if (!response.ok) {
    const text = await response.text();
    return {
      data: null,
      errors: [{ message: `Linear API HTTP ${response.status}: ${text}` }],
    };
  }

  const result = (await response.json()) as {
    data: unknown;
    errors?: Array<{ message: string }>;
  };
  return result;
}

function requireToken(
  credentials?: Record<string, string>
): MCPToolResult | string {
  const token = credentials?.linear_token;
  if (!token) {
    return {
      success: false,
      error: "Linear API key required. Provide credentials.linear_token.",
    };
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
          assigneeId: { type: "string", description: "Filter by assignee ID" },
          labelName: { type: "string", description: "Filter by label name" },
          first: {
            type: "number",
            description: "Number of issues to return (max 50)",
          },
        },
        required: ["teamId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const { teamId, status, assigneeId, labelName, first } = input as {
        teamId: string;
        status?: string;
        assigneeId?: string;
        labelName?: string;
        first?: number;
      };

      const filterParts: string[] = [`team: { id: { eq: "${teamId}" } }`];
      if (status) {
        filterParts.push(`state: { name: { eq: "${status}" } }`);
      }
      if (assigneeId) {
        filterParts.push(`assignee: { id: { eq: "${assigneeId}" } }`);
      }
      if (labelName) {
        filterParts.push(`labels: { name: { eq: "${labelName}" } }`);
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

      const result = await linearGraphQL(
        query,
        { first: Math.min(first ?? 25, 50) },
        tokenOrErr
      );

      if (result.errors?.length) {
        return {
          success: false,
          error: result.errors.map((e) => e.message).join("; "),
        };
      }

      const issuesData = (result.data as Record<string, unknown>)?.issues as
        | Record<string, unknown>
        | undefined;
      const issueNodes = (issuesData?.nodes as Record<string, unknown>[]) ?? [];
      const issues = issueNodes.map((issue: Record<string, unknown>) => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        priority: issue.priority,
        status:
          (issue.state as Record<string, unknown> | undefined)?.name ?? null,
        assignee:
          (issue.assignee as Record<string, unknown> | undefined)?.name ?? null,
        labels:
          (
            (issue.labels as Record<string, unknown> | undefined)?.nodes as
              | Record<string, unknown>[]
              | undefined
          )?.map((l: Record<string, unknown>) => l.name) ?? [],
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
          priority: {
            type: "number",
            description: "0=none, 1=urgent, 2=high, 3=medium, 4=low",
          },
          assigneeId: { type: "string" },
          labelIds: { type: "array", items: { type: "string" } },
          stateId: { type: "string", description: "Workflow state ID" },
          parentId: {
            type: "string",
            description: "Parent issue ID for sub-issues",
          },
        },
        required: ["title", "teamId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const {
        title,
        description,
        teamId,
        priority,
        assigneeId,
        labelIds,
        stateId,
        parentId,
      } = input as {
        title: string;
        description?: string;
        teamId: string;
        priority?: number;
        assigneeId?: string;
        labelIds?: string[];
        stateId?: string;
        parentId?: string;
      };

      const issueInput: Record<string, unknown> = {
        title,
        teamId,
      };
      if (description) {
        issueInput.description = description;
      }
      if (priority !== undefined) {
        issueInput.priority = priority;
      }
      if (assigneeId) {
        issueInput.assigneeId = assigneeId;
      }
      if (labelIds?.length) {
        issueInput.labelIds = labelIds;
      }
      if (stateId) {
        issueInput.stateId = stateId;
      }
      if (parentId) {
        issueInput.parentId = parentId;
      }

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

      const result = await linearGraphQL(
        query,
        { input: issueInput },
        tokenOrErr
      );

      if (result.errors?.length) {
        return {
          success: false,
          error: result.errors.map((e) => e.message).join("; "),
        };
      }

      const created = (result.data as Record<string, unknown>)?.issueCreate as
        | Record<string, unknown>
        | undefined;
      if (!created?.success) {
        return { success: false, error: "Failed to create issue" };
      }

      const createdIssue = created.issue as Record<string, unknown>;
      return {
        success: true,
        data: {
          issue_id: createdIssue.id,
          identifier: createdIssue.identifier,
          title: createdIssue.title,
          status: (createdIssue.state as Record<string, unknown> | undefined)
            ?.name,
          url: createdIssue.url,
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
          stateId: {
            type: "string",
            description: "Workflow state ID to transition to",
          },
          priority: { type: "number" },
          assigneeId: { type: "string" },
          labelIds: { type: "array", items: { type: "string" } },
        },
        required: ["issueId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const tokenOrErr = requireToken(credentials);
      if (typeof tokenOrErr !== "string") {
        return tokenOrErr;
      }

      const {
        issueId,
        title,
        description,
        stateId,
        priority,
        assigneeId,
        labelIds,
      } = input as {
        issueId: string;
        title?: string;
        description?: string;
        stateId?: string;
        priority?: number;
        assigneeId?: string;
        labelIds?: string[];
      };

      const updateInput: Record<string, unknown> = {};
      if (title) {
        updateInput.title = title;
      }
      if (description) {
        updateInput.description = description;
      }
      if (stateId) {
        updateInput.stateId = stateId;
      }
      if (priority !== undefined) {
        updateInput.priority = priority;
      }
      if (assigneeId) {
        updateInput.assigneeId = assigneeId;
      }
      if (labelIds) {
        updateInput.labelIds = labelIds;
      }

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

      const result = await linearGraphQL(
        query,
        { id: issueId, input: updateInput },
        tokenOrErr
      );

      if (result.errors?.length) {
        return {
          success: false,
          error: result.errors.map((e) => e.message).join("; "),
        };
      }

      const updated = (result.data as Record<string, unknown>)?.issueUpdate as
        | Record<string, unknown>
        | undefined;
      if (!updated?.success) {
        return { success: false, error: "Failed to update issue" };
      }

      const updatedIssue = updated.issue as Record<string, unknown>;
      return {
        success: true,
        data: {
          issue_id: updatedIssue.id,
          identifier: updatedIssue.identifier,
          title: updatedIssue.title,
          status: (updatedIssue.state as Record<string, unknown> | undefined)
            ?.name,
          assignee: (
            updatedIssue.assignee as Record<string, unknown> | undefined
          )?.name,
          url: updatedIssue.url,
        },
      };
    }
  );

  // ---- list_projects ----
  registry.register(
    {
      name: "linear_list_projects",
      adapter: "linear",
      description: "List all projects in the Linear workspace",
      inputSchema: {
        type: "object",
        properties: {
          first: {
            type: "number",
            description: "Number of projects to return (max 50)",
          },
          includeArchived: {
            type: "boolean",
            description: "Include archived projects",
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

      const { first, includeArchived } = input as {
        first?: number;
        includeArchived?: boolean;
      };

      const filterStr = includeArchived
        ? ""
        : `filter: { state: { eq: "started" } }`;

      const query = `
        query ListProjects($first: Int) {
          projects(first: $first ${filterStr ? `, ${filterStr}` : ""}) {
            nodes {
              id
              name
              description
              state
              progress
              startDate
              targetDate
              lead { name email }
              teams { nodes { id name } }
              url
              createdAt
              updatedAt
            }
          }
        }
      `;

      const result = await linearGraphQL(
        query,
        { first: Math.min(first ?? 25, 50) },
        tokenOrErr
      );

      if (result.errors?.length) {
        return {
          success: false,
          error: result.errors.map((e) => e.message).join("; "),
        };
      }

      const projectsRoot = (result.data as Record<string, unknown>)?.projects as
        | Record<string, unknown>
        | undefined;
      const projectsData =
        (projectsRoot?.nodes as Record<string, unknown>[]) ?? [];
      const projects = projectsData.map((p: Record<string, unknown>) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        state: p.state,
        progress: p.progress,
        start_date: p.startDate,
        target_date: p.targetDate,
        lead: (p.lead as Record<string, unknown> | undefined)?.name ?? null,
        teams:
          (
            (p.teams as Record<string, unknown> | undefined)?.nodes as
              | Record<string, unknown>[]
              | undefined
          )?.map((t: Record<string, unknown>) => ({
            id: t.id,
            name: t.name,
          })) ?? [],
        url: p.url,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      }));

      return { success: true, data: { projects, count: projects.length } };
    }
  );

  // ---- list_teams ----
  registry.register(
    {
      name: "linear_list_teams",
      adapter: "linear",
      description: "List all teams in the Linear workspace",
      inputSchema: {
        type: "object",
        properties: {
          first: {
            type: "number",
            description: "Number of teams to return (max 50)",
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

      const { first } = input as { first?: number };

      const query = `
        query ListTeams($first: Int) {
          teams(first: $first) {
            nodes {
              id
              name
              key
              description
              issueCount
              members { nodes { id name email } }
              states { nodes { id name type position } }
              labels { nodes { id name color } }
              createdAt
            }
          }
        }
      `;

      const result = await linearGraphQL(
        query,
        { first: Math.min(first ?? 25, 50) },
        tokenOrErr
      );

      if (result.errors?.length) {
        return {
          success: false,
          error: result.errors.map((e) => e.message).join("; "),
        };
      }

      const teamsRoot = (result.data as Record<string, unknown>)?.teams as
        | Record<string, unknown>
        | undefined;
      const teamsData = (teamsRoot?.nodes as Record<string, unknown>[]) ?? [];
      const teams = teamsData.map((t: Record<string, unknown>) => ({
        id: t.id,
        name: t.name,
        key: t.key,
        description: t.description,
        issue_count: t.issueCount,
        members:
          (
            (t.members as Record<string, unknown> | undefined)?.nodes as
              | Record<string, unknown>[]
              | undefined
          )?.map((m: Record<string, unknown>) => ({
            id: m.id,
            name: m.name,
            email: m.email,
          })) ?? [],
        states:
          (
            (t.states as Record<string, unknown> | undefined)?.nodes as
              | Record<string, unknown>[]
              | undefined
          )?.map((s: Record<string, unknown>) => ({
            id: s.id,
            name: s.name,
            type: s.type,
            position: s.position,
          })) ?? [],
        labels:
          (
            (t.labels as Record<string, unknown> | undefined)?.nodes as
              | Record<string, unknown>[]
              | undefined
          )?.map((l: Record<string, unknown>) => ({
            id: l.id,
            name: l.name,
            color: l.color,
          })) ?? [],
        created_at: t.createdAt,
      }));

      return { success: true, data: { teams, count: teams.length } };
    }
  );
}
