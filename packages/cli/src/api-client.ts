import { EventSource } from "eventsource";

const DEFAULT_API_URL = "http://localhost:4000";

export class APIClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options?: { apiUrl?: string; apiKey?: string }) {
    this.baseUrl =
      options?.apiUrl ?? process.env.PROMETHEUS_API_URL ?? DEFAULT_API_URL;
    this.apiKey = options?.apiKey ?? process.env.PROMETHEUS_API_KEY ?? "";
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      h.Authorization = `Bearer ${this.apiKey}`;
    }
    return h;
  }

  /**
   * Verify that the API key is valid by making an authenticated request.
   */
  async verifyAuth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: this.headers,
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async submitTask(params: {
    title: string;
    description?: string;
    projectId: string;
    mode?: string;
  }): Promise<{ taskId: string; sessionId: string }> {
    const response = await fetch(`${this.baseUrl}/api/trpc/tasks.submit`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({
        json: {
          title: params.title,
          description: params.description,
          projectId: params.projectId,
          mode: params.mode ?? "task",
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${await response.text()}`);
    }

    const data = (await response.json()) as {
      result: { data: { json: { taskId: string; sessionId: string } } };
    };
    return data.result.data.json;
  }

  async listProjects(): Promise<
    Array<{ id: string; name: string; status: string }>
  > {
    const response = await fetch(`${this.baseUrl}/api/trpc/projects.list`, {
      method: "GET",
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(
        `Failed to list projects: ${response.status} ${await response.text()}`
      );
    }

    const data = (await response.json()) as {
      result: {
        data: {
          json: {
            projects: Array<{ id: string; name: string; status: string }>;
          };
        };
      };
    };
    return data.result.data.json.projects;
  }

  streamSession(
    sessionId: string,
    onEvent: (event: { type: string; data: unknown }) => void
  ): { close: () => void } {
    const url = `${this.baseUrl}/api/sse/${sessionId}`;
    const authHeaders = this.headers;

    // Use custom fetch to inject auth headers into the SSE connection
    const authFetch: typeof globalThis.fetch = (input, init) =>
      globalThis.fetch(input, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers).entries()),
          ...authHeaders,
        },
      });

    const eventSource = new EventSource(url, { fetch: authFetch });

    eventSource.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string);
        onEvent(parsed);
      } catch {
        // Ignore malformed events
      }
    };

    eventSource.onerror = () => {
      // Reconnection is handled by EventSource
    };

    return {
      close: () => eventSource.close(),
    };
  }

  async getStatus(): Promise<{
    activeAgents: number;
    queueDepth: number;
    services: Record<string, boolean>;
  }> {
    const response = await fetch(`${this.baseUrl}/health`, {
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return (await response.json()) as {
      activeAgents: number;
      queueDepth: number;
      services: Record<string, boolean>;
    };
  }

  async getSessionStatus(sessionId: string): Promise<{
    id: string;
    status: string;
    mode: string;
    progress?: number;
  }> {
    const response = await fetch(
      `${this.baseUrl}/api/trpc/sessions.get?input=${encodeURIComponent(JSON.stringify({ json: { sessionId } }))}`,
      {
        method: "GET",
        headers: this.headers,
      }
    );

    if (!response.ok) {
      throw new Error(
        `Failed to get session: ${response.status} ${await response.text()}`
      );
    }

    const data = (await response.json()) as {
      result: {
        data: {
          json: { id: string; status: string; mode: string; progress?: number };
        };
      };
    };
    return data.result.data.json;
  }

  async listSessions(
    projectId?: string
  ): Promise<
    Array<{ id: string; status: string; mode: string; title?: string }>
  > {
    const input = projectId
      ? { json: { projectId, limit: 20 } }
      : { json: { limit: 20 } };
    const response = await fetch(
      `${this.baseUrl}/api/trpc/sessions.list?input=${encodeURIComponent(JSON.stringify(input))}`,
      { headers: this.headers }
    );
    if (!response.ok) {
      throw new Error(`Failed to list sessions: ${response.status}`);
    }
    const data = (await response.json()) as {
      result: {
        data: {
          json: {
            sessions: Array<{
              id: string;
              status: string;
              mode: string;
              title?: string;
            }>;
          };
        };
      };
    };
    return data.result.data.json.sessions;
  }

  async createSession(params: {
    projectId: string;
    title?: string;
    mode?: string;
  }): Promise<{ id: string; status: string }> {
    const response = await fetch(`${this.baseUrl}/api/trpc/sessions.create`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ json: params }),
    });
    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.status}`);
    }
    const data = (await response.json()) as {
      result: { data: { json: { id: string; status: string } } };
    };
    return data.result.data.json;
  }

  async triggerDeployment(params: {
    projectId: string;
    environment: string;
    provider: string;
  }): Promise<{ deploymentId: string }> {
    const response = await fetch(
      `${this.baseUrl}/api/trpc/deployments.trigger`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ json: params }),
      }
    );
    if (!response.ok) {
      throw new Error(
        `Failed to trigger deployment: ${response.status} ${await response.text()}`
      );
    }
    const data = (await response.json()) as {
      result: { data: { json: { deploymentId: string } } };
    };
    return data.result.data.json;
  }

  async getDeploymentStatus(deploymentId: string): Promise<{
    deploymentId: string;
    status: "queued" | "building" | "deploying" | "live" | "failed";
    url?: string;
    error?: string;
  }> {
    const response = await fetch(
      `${this.baseUrl}/api/trpc/deployments.getStatus?input=${encodeURIComponent(JSON.stringify({ json: { deploymentId } }))}`,
      { headers: this.headers }
    );
    if (!response.ok) {
      throw new Error(`Failed to get deployment status: ${response.status}`);
    }
    const data = (await response.json()) as {
      result: {
        data: {
          json: {
            deploymentId: string;
            status: "queued" | "building" | "deploying" | "live" | "failed";
            url?: string;
            error?: string;
          };
        };
      };
    };
    return data.result.data.json;
  }

  async listEnvVars(projectId: string): Promise<
    Array<{
      key: string;
      value: string;
      environment: string;
      updatedAt: string;
    }>
  > {
    const response = await fetch(
      `${this.baseUrl}/api/trpc/settings.listSecrets?input=${encodeURIComponent(JSON.stringify({ json: { projectId } }))}`,
      { headers: this.headers }
    );
    if (!response.ok) {
      throw new Error(`Failed to list env vars: ${response.status}`);
    }
    const data = (await response.json()) as {
      result: {
        data: {
          json: {
            secrets: Array<{
              key: string;
              value: string;
              environment: string;
              updatedAt: string;
            }>;
          };
        };
      };
    };
    return data.result.data.json.secrets;
  }

  async setEnvVar(
    projectId: string,
    key: string,
    value: string,
    environment: string
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/trpc/settings.setSecret`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          json: { projectId, key, value, environment },
        }),
      }
    );
    if (!response.ok) {
      throw new Error(
        `Failed to set env var: ${response.status} ${await response.text()}`
      );
    }
  }

  async deleteEnvVar(projectId: string, key: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/trpc/settings.deleteSecret`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ json: { projectId, key } }),
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to delete env var: ${response.status}`);
    }
  }

  async getLogs(params: {
    sessionId?: string;
    projectId?: string;
    limit: number;
  }): Promise<
    Array<{
      level: "debug" | "info" | "warn" | "error";
      message: string;
      timestamp: string;
    }>
  > {
    const response = await fetch(
      `${this.baseUrl}/api/trpc/sessions.logs?input=${encodeURIComponent(JSON.stringify({ json: params }))}`,
      { headers: this.headers }
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch logs: ${response.status}`);
    }
    const data = (await response.json()) as {
      result: {
        data: {
          json: {
            logs: Array<{
              level: "debug" | "info" | "warn" | "error";
              message: string;
              timestamp: string;
            }>;
          };
        };
      };
    };
    return data.result.data.json.logs;
  }

  async createPullRequest(params: {
    projectId: string;
    title: string;
    headBranch: string;
    baseBranch: string;
    draft: boolean;
  }): Promise<{ number: number; url: string }> {
    const response = await fetch(
      `${this.baseUrl}/api/trpc/integrations.createPullRequest`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ json: params }),
      }
    );
    if (!response.ok) {
      throw new Error(
        `Failed to create PR: ${response.status} ${await response.text()}`
      );
    }
    const data = (await response.json()) as {
      result: { data: { json: { number: number; url: string } } };
    };
    return data.result.data.json;
  }

  async listPullRequests(projectId: string): Promise<
    Array<{
      number: number;
      title: string;
      status: string;
      author: string;
      headBranch: string;
      baseBranch: string;
      draft: boolean;
      url: string;
    }>
  > {
    const response = await fetch(
      `${this.baseUrl}/api/trpc/integrations.listPullRequests?input=${encodeURIComponent(JSON.stringify({ json: { projectId } }))}`,
      { headers: this.headers }
    );
    if (!response.ok) {
      throw new Error(`Failed to list PRs: ${response.status}`);
    }
    const data = (await response.json()) as {
      result: {
        data: {
          json: {
            pullRequests: Array<{
              number: number;
              title: string;
              status: string;
              author: string;
              headBranch: string;
              baseBranch: string;
              draft: boolean;
              url: string;
            }>;
          };
        };
      };
    };
    return data.result.data.json.pullRequests;
  }

  async getPullRequestStatus(
    projectId: string,
    prNumber: number
  ): Promise<{
    number: number;
    title: string;
    status: string;
    author: string;
    headBranch: string;
    baseBranch: string;
    url: string;
    checks: Array<{
      name: string;
      status: "success" | "failure" | "pending" | "running";
    }>;
  }> {
    const response = await fetch(
      `${this.baseUrl}/api/trpc/integrations.getPullRequestStatus?input=${encodeURIComponent(JSON.stringify({ json: { projectId, prNumber } }))}`,
      { headers: this.headers }
    );
    if (!response.ok) {
      throw new Error(`Failed to get PR status: ${response.status}`);
    }
    const data = (await response.json()) as {
      result: {
        data: {
          json: {
            number: number;
            title: string;
            status: string;
            author: string;
            headBranch: string;
            baseBranch: string;
            url: string;
            checks: Array<{
              name: string;
              status: "success" | "failure" | "pending" | "running";
            }>;
          };
        };
      };
    };
    return data.result.data.json;
  }

  async sendMessage(params: {
    sessionId: string;
    content: string;
  }): Promise<{ messageId: string; taskId: string }> {
    const response = await fetch(
      `${this.baseUrl}/api/trpc/sessions.sendMessage`,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ json: params }),
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.status}`);
    }
    const data = (await response.json()) as {
      result: { data: { json: { message: { id: string }; taskId: string } } };
    };
    return {
      messageId: data.result.data.json.message.id,
      taskId: data.result.data.json.taskId,
    };
  }
}
