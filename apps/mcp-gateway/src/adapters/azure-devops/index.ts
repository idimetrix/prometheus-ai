import { createLogger } from "@prometheus/logger";
import type { MCPToolResult, ToolRegistry } from "../../registry";

const logger = createLogger("mcp-gateway:azure-devops");

/**
 * Helper to make authenticated Azure DevOps REST API requests.
 */
async function azdoFetch(
  org: string,
  path: string,
  token: string,
  options: {
    method?: string;
    body?: unknown;
    apiVersion?: string;
  } = {}
): Promise<{ status: number; data: unknown }> {
  const apiVersion = options.apiVersion ?? "7.1";
  const separator = path.includes("?") ? "&" : "?";
  const url = `https://dev.azure.com/${org}/${path}${separator}api-version=${apiVersion}`;
  const method = options.method ?? "GET";

  const headers: Record<string, string> = {
    Authorization: `Basic ${Buffer.from(`:${token}`).toString("base64")}`,
    Accept: "application/json",
    "User-Agent": "Prometheus-MCP-Gateway/1.0",
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

function requireCredentials(
  credentials?: Record<string, string>
): MCPToolResult | { org: string; token: string } {
  const token = credentials?.azdo_token;
  const org = credentials?.azdo_org;
  if (!(token && org)) {
    return {
      success: false,
      error:
        "Azure DevOps credentials required. Provide credentials.azdo_token and credentials.azdo_org.",
    };
  }
  return { org, token };
}

export function registerAzureDevOpsAdapter(registry: ToolRegistry): void {
  // ---- azdo_list_repos ----
  registry.register(
    {
      name: "azdo_list_repos",
      adapter: "azure-devops",
      description: "List repositories in an Azure DevOps project",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description: "Azure DevOps project name",
          },
        },
        required: ["project"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = requireCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const { project } = input as { project: string };
      const { status, data } = await azdoFetch(
        credsOrErr.org,
        `${project}/_apis/git/repositories`,
        credsOrErr.token
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Azure DevOps API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as { value: Record<string, unknown>[] };
      const repos = (result.value ?? []).map((repo) => ({
        id: repo.id,
        name: repo.name,
        defaultBranch: repo.defaultBranch,
        remoteUrl: repo.remoteUrl,
        webUrl: repo.webUrl,
        size: repo.size,
      }));

      return { success: true, data: { repos, count: repos.length } };
    }
  );

  // ---- azdo_clone_repo ----
  registry.register(
    {
      name: "azdo_clone_repo",
      adapter: "azure-devops",
      description: "Get repository clone information from Azure DevOps",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string", description: "Project name" },
          repositoryId: {
            type: "string",
            description: "Repository ID or name",
          },
        },
        required: ["project", "repositoryId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = requireCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const { project, repositoryId } = input as {
        project: string;
        repositoryId: string;
      };
      const { status, data } = await azdoFetch(
        credsOrErr.org,
        `${project}/_apis/git/repositories/${repositoryId}`,
        credsOrErr.token
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Azure DevOps API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const repo = data as Record<string, unknown>;
      return {
        success: true,
        data: {
          id: repo.id,
          name: repo.name,
          remoteUrl: repo.remoteUrl,
          sshUrl: repo.sshUrl,
          webUrl: repo.webUrl,
          defaultBranch: repo.defaultBranch,
        },
      };
    }
  );

  // ---- azdo_create_pr ----
  registry.register(
    {
      name: "azdo_create_pr",
      adapter: "azure-devops",
      description: "Create a pull request in Azure DevOps",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          repositoryId: { type: "string" },
          title: { type: "string", description: "PR title" },
          description: { type: "string", description: "PR description" },
          sourceRefName: {
            type: "string",
            description: "Source branch (refs/heads/...)",
          },
          targetRefName: {
            type: "string",
            description: "Target branch (refs/heads/...)",
          },
          isDraft: { type: "boolean" },
          reviewers: {
            type: "array",
            items: { type: "string" },
            description: "Reviewer IDs",
          },
        },
        required: [
          "project",
          "repositoryId",
          "title",
          "sourceRefName",
          "targetRefName",
        ],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = requireCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const {
        project,
        repositoryId,
        title,
        description,
        sourceRefName,
        targetRefName,
        isDraft,
        reviewers,
      } = input as {
        project: string;
        repositoryId: string;
        title: string;
        description?: string;
        sourceRefName: string;
        targetRefName: string;
        isDraft?: boolean;
        reviewers?: string[];
      };

      const body: Record<string, unknown> = {
        title,
        description: description ?? "",
        sourceRefName,
        targetRefName,
        isDraft: isDraft ?? false,
      };

      if (reviewers?.length) {
        body.reviewers = reviewers.map((id) => ({ id }));
      }

      const { status, data } = await azdoFetch(
        credsOrErr.org,
        `${project}/_apis/git/repositories/${repositoryId}/pullrequests`,
        credsOrErr.token,
        { method: "POST", body }
      );

      if (status !== 201) {
        return {
          success: false,
          error: `Failed to create PR (${status}): ${JSON.stringify(data)}`,
        };
      }

      const pr = data as Record<string, unknown>;
      return {
        success: true,
        data: {
          pullRequestId: pr.pullRequestId,
          title: pr.title,
          status: pr.status,
          url: pr.url,
          createdBy: (pr.createdBy as Record<string, unknown> | undefined)
            ?.displayName,
        },
      };
    }
  );

  // ---- azdo_list_prs ----
  registry.register(
    {
      name: "azdo_list_prs",
      adapter: "azure-devops",
      description: "List pull requests in an Azure DevOps repository",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          repositoryId: { type: "string" },
          status: {
            type: "string",
            enum: ["active", "abandoned", "completed", "all"],
          },
          top: { type: "number", description: "Max results to return" },
        },
        required: ["project", "repositoryId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = requireCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const { project, repositoryId, status, top } = input as {
        project: string;
        repositoryId: string;
        status?: string;
        top?: number;
      };

      const params = new URLSearchParams();
      if (status && status !== "all") {
        params.set("searchCriteria.status", status);
      }
      if (top) {
        params.set("$top", String(top));
      }

      const query = params.toString();
      const path = `${project}/_apis/git/repositories/${repositoryId}/pullrequests${query ? `?${query}` : ""}`;

      const { status: httpStatus, data } = await azdoFetch(
        credsOrErr.org,
        path,
        credsOrErr.token
      );

      if (httpStatus !== 200) {
        return {
          success: false,
          error: `Azure DevOps API error (${httpStatus}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as { value: Record<string, unknown>[] };
      const prs = (result.value ?? []).map((pr) => ({
        pullRequestId: pr.pullRequestId,
        title: pr.title,
        status: pr.status,
        createdBy: (pr.createdBy as Record<string, unknown> | undefined)
          ?.displayName,
        sourceRefName: pr.sourceRefName,
        targetRefName: pr.targetRefName,
        creationDate: pr.creationDate,
        url: pr.url,
      }));

      return { success: true, data: { pullRequests: prs, count: prs.length } };
    }
  );

  // ---- azdo_create_work_item ----
  registry.register(
    {
      name: "azdo_create_work_item",
      adapter: "azure-devops",
      description: "Create a work item (bug, task, user story) in Azure DevOps",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          type: {
            type: "string",
            description: "Work item type (Bug, Task, User Story, etc.)",
          },
          title: { type: "string" },
          description: { type: "string" },
          assignedTo: { type: "string", description: "User email or name" },
          state: { type: "string", description: "Initial state" },
          areaPath: { type: "string" },
          iterationPath: { type: "string" },
          priority: { type: "number" },
          tags: { type: "string", description: "Semicolon-separated tags" },
        },
        required: ["project", "type", "title"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = requireCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const {
        project,
        type,
        title,
        description,
        assignedTo,
        state,
        areaPath,
        iterationPath,
        priority,
        tags,
      } = input as {
        project: string;
        type: string;
        title: string;
        description?: string;
        assignedTo?: string;
        state?: string;
        areaPath?: string;
        iterationPath?: string;
        priority?: number;
        tags?: string;
      };

      // Azure DevOps uses JSON Patch for work item creation
      const patchOps: Array<{
        op: string;
        path: string;
        value: unknown;
      }> = [{ op: "add", path: "/fields/System.Title", value: title }];

      if (description) {
        patchOps.push({
          op: "add",
          path: "/fields/System.Description",
          value: description,
        });
      }
      if (assignedTo) {
        patchOps.push({
          op: "add",
          path: "/fields/System.AssignedTo",
          value: assignedTo,
        });
      }
      if (state) {
        patchOps.push({
          op: "add",
          path: "/fields/System.State",
          value: state,
        });
      }
      if (areaPath) {
        patchOps.push({
          op: "add",
          path: "/fields/System.AreaPath",
          value: areaPath,
        });
      }
      if (iterationPath) {
        patchOps.push({
          op: "add",
          path: "/fields/System.IterationPath",
          value: iterationPath,
        });
      }
      if (priority !== undefined) {
        patchOps.push({
          op: "add",
          path: "/fields/Microsoft.VSTS.Common.Priority",
          value: priority,
        });
      }
      if (tags) {
        patchOps.push({
          op: "add",
          path: "/fields/System.Tags",
          value: tags,
        });
      }

      const encodedType = encodeURIComponent(type);
      const url = `https://dev.azure.com/${credsOrErr.org}/${project}/_apis/wit/workitems/$${encodedType}?api-version=7.1`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`:${credsOrErr.token}`).toString("base64")}`,
          "Content-Type": "application/json-patch+json",
          Accept: "application/json",
        },
        body: JSON.stringify(patchOps),
      });

      let responseData: unknown;
      try {
        responseData = await response.json();
      } catch {
        responseData = await response.text();
      }

      if (response.status !== 200) {
        return {
          success: false,
          error: `Failed to create work item (${response.status}): ${JSON.stringify(responseData)}`,
        };
      }

      const wi = responseData as Record<string, unknown>;
      const fields = wi.fields as Record<string, unknown> | undefined;
      return {
        success: true,
        data: {
          id: wi.id,
          rev: wi.rev,
          url: wi.url,
          title: fields?.["System.Title"],
          state: fields?.["System.State"],
          type: fields?.["System.WorkItemType"],
        },
      };
    }
  );

  // ---- azdo_list_work_items ----
  registry.register(
    {
      name: "azdo_list_work_items",
      adapter: "azure-devops",
      description: "List work items using a WIQL query in Azure DevOps",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          query: {
            type: "string",
            description:
              "WIQL query string, e.g. \"SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'\"",
          },
        },
        required: ["project", "query"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = requireCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const { project, query } = input as { project: string; query: string };

      const { status, data } = await azdoFetch(
        credsOrErr.org,
        `${project}/_apis/wit/wiql`,
        credsOrErr.token,
        { method: "POST", body: { query } }
      );

      if (status !== 200) {
        return {
          success: false,
          error: `WIQL query failed (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as {
        workItems: Array<{ id: number; url: string }>;
      };
      const workItems = result.workItems ?? [];

      // If there are results, fetch details for the first 50
      if (workItems.length === 0) {
        return { success: true, data: { workItems: [], count: 0 } };
      }

      const ids = workItems.slice(0, 50).map((wi) => wi.id);
      const detailsUrl = `${project}/_apis/wit/workitems?ids=${ids.join(",")}&$expand=none`;

      const { status: detailStatus, data: detailData } = await azdoFetch(
        credsOrErr.org,
        detailsUrl,
        credsOrErr.token
      );

      if (detailStatus !== 200) {
        // Return just the IDs if detail fetch fails
        return {
          success: true,
          data: {
            workItems: workItems.slice(0, 50),
            count: workItems.length,
          },
        };
      }

      const details = detailData as { value: Record<string, unknown>[] };
      const items = (details.value ?? []).map((wi) => {
        const fields = wi.fields as Record<string, unknown> | undefined;
        return {
          id: wi.id,
          title: fields?.["System.Title"],
          state: fields?.["System.State"],
          type: fields?.["System.WorkItemType"],
          assignedTo: (
            fields?.["System.AssignedTo"] as Record<string, unknown> | undefined
          )?.displayName,
          url: wi.url,
        };
      });

      return {
        success: true,
        data: { workItems: items, count: workItems.length },
      };
    }
  );

  // ---- azdo_update_work_item ----
  registry.register(
    {
      name: "azdo_update_work_item",
      adapter: "azure-devops",
      description: "Update a work item status or fields in Azure DevOps",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          workItemId: { type: "number", description: "Work item ID" },
          title: { type: "string" },
          state: { type: "string" },
          assignedTo: { type: "string" },
          description: { type: "string" },
          priority: { type: "number" },
          tags: { type: "string" },
        },
        required: ["project", "workItemId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = requireCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const {
        project,
        workItemId,
        title,
        state,
        assignedTo,
        description,
        priority,
        tags,
      } = input as {
        project: string;
        workItemId: number;
        title?: string;
        state?: string;
        assignedTo?: string;
        description?: string;
        priority?: number;
        tags?: string;
      };

      const patchOps: Array<{
        op: string;
        path: string;
        value: unknown;
      }> = [];

      if (title !== undefined) {
        patchOps.push({
          op: "replace",
          path: "/fields/System.Title",
          value: title,
        });
      }
      if (state !== undefined) {
        patchOps.push({
          op: "replace",
          path: "/fields/System.State",
          value: state,
        });
      }
      if (assignedTo !== undefined) {
        patchOps.push({
          op: "replace",
          path: "/fields/System.AssignedTo",
          value: assignedTo,
        });
      }
      if (description !== undefined) {
        patchOps.push({
          op: "replace",
          path: "/fields/System.Description",
          value: description,
        });
      }
      if (priority !== undefined) {
        patchOps.push({
          op: "replace",
          path: "/fields/Microsoft.VSTS.Common.Priority",
          value: priority,
        });
      }
      if (tags !== undefined) {
        patchOps.push({
          op: "replace",
          path: "/fields/System.Tags",
          value: tags,
        });
      }

      if (patchOps.length === 0) {
        return { success: false, error: "No fields to update" };
      }

      const url = `https://dev.azure.com/${credsOrErr.org}/${project}/_apis/wit/workitems/${workItemId}?api-version=7.1`;

      const response = await fetch(url, {
        method: "PATCH",
        headers: {
          Authorization: `Basic ${Buffer.from(`:${credsOrErr.token}`).toString("base64")}`,
          "Content-Type": "application/json-patch+json",
          Accept: "application/json",
        },
        body: JSON.stringify(patchOps),
      });

      let responseData: unknown;
      try {
        responseData = await response.json();
      } catch {
        responseData = await response.text();
      }

      if (response.status !== 200) {
        return {
          success: false,
          error: `Failed to update work item (${response.status}): ${JSON.stringify(responseData)}`,
        };
      }

      const wi = responseData as Record<string, unknown>;
      const fields = wi.fields as Record<string, unknown> | undefined;
      return {
        success: true,
        data: {
          id: wi.id,
          rev: wi.rev,
          title: fields?.["System.Title"],
          state: fields?.["System.State"],
        },
      };
    }
  );

  // ---- azdo_add_comment ----
  registry.register(
    {
      name: "azdo_add_comment",
      adapter: "azure-devops",
      description: "Add a comment to a PR or work item in Azure DevOps",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          repositoryId: {
            type: "string",
            description: "Repository ID (for PR comments)",
          },
          pullRequestId: {
            type: "number",
            description: "Pull request ID (for PR comments)",
          },
          workItemId: {
            type: "number",
            description: "Work item ID (for work item comments)",
          },
          content: { type: "string", description: "Comment text" },
        },
        required: ["project", "content"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = requireCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const { project, repositoryId, pullRequestId, workItemId, content } =
        input as {
          project: string;
          repositoryId?: string;
          pullRequestId?: number;
          workItemId?: number;
          content: string;
        };

      // PR comment
      if (repositoryId && pullRequestId !== undefined) {
        const { status, data } = await azdoFetch(
          credsOrErr.org,
          `${project}/_apis/git/repositories/${repositoryId}/pullRequests/${pullRequestId}/threads`,
          credsOrErr.token,
          {
            method: "POST",
            body: {
              comments: [{ content, commentType: 1 }],
              status: 1,
            },
          }
        );

        if (status !== 200 && status !== 201) {
          return {
            success: false,
            error: `Failed to add PR comment (${status}): ${JSON.stringify(data)}`,
          };
        }

        const thread = data as Record<string, unknown>;
        return {
          success: true,
          data: { threadId: thread.id, type: "pull_request" },
        };
      }

      // Work item comment
      if (workItemId !== undefined) {
        const { status, data } = await azdoFetch(
          credsOrErr.org,
          `${project}/_apis/wit/workItems/${workItemId}/comments`,
          credsOrErr.token,
          { method: "POST", body: { text: content } }
        );

        if (status !== 200 && status !== 201) {
          return {
            success: false,
            error: `Failed to add work item comment (${status}): ${JSON.stringify(data)}`,
          };
        }

        const comment = data as Record<string, unknown>;
        return {
          success: true,
          data: { commentId: comment.id, type: "work_item" },
        };
      }

      return {
        success: false,
        error:
          "Provide either (repositoryId + pullRequestId) for PR comments or workItemId for work item comments",
      };
    }
  );

  // ---- azdo_get_build_status ----
  registry.register(
    {
      name: "azdo_get_build_status",
      adapter: "azure-devops",
      description: "Get build pipeline status in Azure DevOps",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          buildId: { type: "number", description: "Specific build ID" },
          definitionId: {
            type: "number",
            description: "Pipeline definition ID (lists recent builds)",
          },
          top: { type: "number", description: "Max results" },
          branchName: {
            type: "string",
            description: "Filter by branch (refs/heads/...)",
          },
        },
        required: ["project"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = requireCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const { project, buildId, definitionId, top, branchName } = input as {
        project: string;
        buildId?: number;
        definitionId?: number;
        top?: number;
        branchName?: string;
      };

      // Get a specific build
      if (buildId !== undefined) {
        const { status, data } = await azdoFetch(
          credsOrErr.org,
          `${project}/_apis/build/builds/${buildId}`,
          credsOrErr.token
        );

        if (status !== 200) {
          return {
            success: false,
            error: `Azure DevOps API error (${status}): ${JSON.stringify(data)}`,
          };
        }

        const build = data as Record<string, unknown>;
        return {
          success: true,
          data: {
            id: build.id,
            buildNumber: build.buildNumber,
            status: build.status,
            result: build.result,
            sourceBranch: build.sourceBranch,
            sourceVersion: build.sourceVersion,
            startTime: build.startTime,
            finishTime: build.finishTime,
            url: (build._links as Record<string, unknown> | undefined)?.web,
          },
        };
      }

      // List builds
      const params = new URLSearchParams();
      if (definitionId !== undefined) {
        params.set("definitions", String(definitionId));
      }
      if (top) {
        params.set("$top", String(top));
      }
      if (branchName) {
        params.set("branchName", branchName);
      }

      const query = params.toString();
      const path = `${project}/_apis/build/builds${query ? `?${query}` : ""}`;

      const { status, data } = await azdoFetch(
        credsOrErr.org,
        path,
        credsOrErr.token
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Azure DevOps API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as { value: Record<string, unknown>[] };
      const builds = (result.value ?? []).map((build) => ({
        id: build.id,
        buildNumber: build.buildNumber,
        status: build.status,
        result: build.result,
        sourceBranch: build.sourceBranch,
        sourceVersion: build.sourceVersion,
        startTime: build.startTime,
        finishTime: build.finishTime,
        definition: (build.definition as Record<string, unknown> | undefined)
          ?.name,
      }));

      return { success: true, data: { builds, count: builds.length } };
    }
  );

  // ---- azdo_get_build_logs ----
  registry.register(
    {
      name: "azdo_get_build_logs",
      adapter: "azure-devops",
      description: "Get build logs from Azure DevOps",
      inputSchema: {
        type: "object",
        properties: {
          project: { type: "string" },
          buildId: { type: "number", description: "Build ID" },
          logId: {
            type: "number",
            description: "Specific log ID (omit for log list)",
          },
        },
        required: ["project", "buildId"],
      },
      requiresAuth: true,
    },
    async (input, credentials) => {
      const credsOrErr = requireCredentials(credentials);
      if ("success" in credsOrErr) {
        return credsOrErr;
      }

      const { project, buildId, logId } = input as {
        project: string;
        buildId: number;
        logId?: number;
      };

      // Get specific log content
      if (logId !== undefined) {
        const url = `https://dev.azure.com/${credsOrErr.org}/${project}/_apis/build/builds/${buildId}/logs/${logId}?api-version=7.1`;

        const response = await fetch(url, {
          headers: {
            Authorization: `Basic ${Buffer.from(`:${credsOrErr.token}`).toString("base64")}`,
            Accept: "text/plain",
          },
        });

        if (response.status !== 200) {
          return {
            success: false,
            error: `Failed to get log (${response.status})`,
          };
        }

        const logContent = await response.text();
        // Truncate if too long
        const truncated = logContent.length > 10_000;
        return {
          success: true,
          data: {
            logId,
            content: logContent.slice(0, 10_000),
            truncated,
            totalLength: logContent.length,
          },
        };
      }

      // List logs
      const { status, data } = await azdoFetch(
        credsOrErr.org,
        `${project}/_apis/build/builds/${buildId}/logs`,
        credsOrErr.token
      );

      if (status !== 200) {
        return {
          success: false,
          error: `Azure DevOps API error (${status}): ${JSON.stringify(data)}`,
        };
      }

      const result = data as { value: Record<string, unknown>[] };
      const logs = (result.value ?? []).map((log) => ({
        id: log.id,
        type: log.type,
        lineCount: log.lineCount,
        createdOn: log.createdOn,
        lastChangedOn: log.lastChangedOn,
        url: log.url,
      }));

      return { success: true, data: { logs, count: logs.length } };
    }
  );

  logger.info("Azure DevOps adapter registered with 10 tools");
}
