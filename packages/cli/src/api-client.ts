import type { CLIConfig } from "./config";
import { resolveConfig } from "./config";

interface SubmitTaskParams {
  description?: string;
  mode?: string;
  projectId: string;
  rules?: Array<{ type: string; rule: string }>;
  title: string;
}

interface SubmitTaskResult {
  sessionId: string;
  taskId: string;
}

interface CreateSessionParams {
  mode: string;
  projectId: string;
  prompt?: string;
}

interface CreateSessionResult {
  id: string;
  mode: string;
  projectId: string;
  status: string;
}

interface SessionInfo {
  endedAt: string | null;
  id: string;
  mode: string;
  project?: { id: string; name: string };
  projectId: string;
  startedAt: string;
  status: string;
}

interface SessionEvent {
  data: unknown;
  type: string;
}

interface PlatformStatus {
  activeAgents: number;
  queueDepth: number;
  services: Record<string, boolean>;
}

interface TaskInfo {
  completedAt: string | null;
  createdAt: string;
  id: string;
  priority: number;
  sessionId: string;
  status: string;
  title: string;
}

interface CreateProjectParams {
  description?: string;
  name: string;
  repoUrl?: string;
}

interface CreateProjectResult {
  id: string;
  name: string;
  status: string;
}

export class APIClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config?: CLIConfig) {
    const resolved = config ?? resolveConfig();
    this.baseUrl = resolved.apiUrl;
    this.apiKey = resolved.apiKey;
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
   * Make an authenticated tRPC mutation call.
   */
  private async trpcMutation<T>(procedure: string, input: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}/api/trpc/${procedure}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ json: input }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`API error (${response.status}): ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      result: { data: { json: T } };
    };
    return data.result.data.json;
  }

  /**
   * Make an authenticated tRPC query call.
   */
  private async trpcQuery<T>(procedure: string, input: unknown): Promise<T> {
    const encoded = encodeURIComponent(JSON.stringify({ json: input }));
    const response = await fetch(
      `${this.baseUrl}/api/trpc/${procedure}?input=${encoded}`,
      {
        method: "GET",
        headers: this.headers,
      }
    );

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`API error (${response.status}): ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      result: { data: { json: T } };
    };
    return data.result.data.json;
  }

  /**
   * Create a new session.
   */
  async createSession(
    params: CreateSessionParams
  ): Promise<CreateSessionResult> {
    return await this.trpcMutation<CreateSessionResult>(
      "sessions.create",
      params
    );
  }

  /**
   * Submit a task to an existing session.
   */
  async submitTask(params: SubmitTaskParams): Promise<SubmitTaskResult> {
    // First create a session, then use it to submit the task
    const session = await this.createSession({
      projectId: params.projectId,
      mode: params.mode ?? "task",
      prompt: params.description ?? params.title,
    });

    return {
      taskId: session.id,
      sessionId: session.id,
    };
  }

  /**
   * Create a project via the API.
   */
  async createProject(
    params: CreateProjectParams
  ): Promise<CreateProjectResult> {
    return await this.trpcMutation<CreateProjectResult>(
      "projects.create",
      params
    );
  }

  /**
   * Get session details.
   */
  async getSession(sessionId: string): Promise<SessionInfo> {
    return await this.trpcQuery<SessionInfo>("sessions.get", { sessionId });
  }

  /**
   * List sessions, optionally filtered by project.
   */
  async listSessions(params?: {
    projectId?: string;
    status?: string;
    limit?: number;
  }): Promise<{ sessions: SessionInfo[]; nextCursor: string | null }> {
    return await this.trpcQuery("sessions.list", {
      projectId: params?.projectId,
      status: params?.status,
      limit: params?.limit ?? 20,
    });
  }

  /**
   * List tasks, optionally filtered by session or project.
   */
  async listTasks(params?: {
    sessionId?: string;
    projectId?: string;
    status?: string;
    limit?: number;
  }): Promise<{ tasks: TaskInfo[]; nextCursor: string | null }> {
    return await this.trpcQuery("tasks.list", {
      sessionId: params?.sessionId,
      projectId: params?.projectId,
      status: params?.status,
      limit: params?.limit ?? 20,
    });
  }

  /**
   * Send a message to a session.
   */
  async sendMessage(
    sessionId: string,
    content: string
  ): Promise<{ taskId: string }> {
    return await this.trpcMutation("sessions.sendMessage", {
      sessionId,
      content,
    });
  }

  /**
   * Approve a plan checkpoint.
   */
  async approvePlan(
    sessionId: string,
    checkpointId: string
  ): Promise<{ success: boolean }> {
    return await this.trpcMutation("sessions.approvePlan", {
      sessionId,
      checkpointId,
    });
  }

  /**
   * Stream session events via SSE. Returns a cleanup handle.
   */
  streamSession(
    sessionId: string,
    onEvent: (event: SessionEvent) => void,
    onError?: (error: Error) => void
  ): { close: () => void } {
    const url = `${this.baseUrl}/api/sse/${sessionId}`;
    let closed = false;

    const connect = (): EventSource => {
      const eventSource = new EventSource(url);

      eventSource.onmessage = (event: MessageEvent) => {
        if (closed) {
          return;
        }
        try {
          const parsed = JSON.parse(String(event.data)) as SessionEvent;
          onEvent(parsed);
        } catch {
          // Ignore malformed events
        }
      };

      eventSource.onerror = () => {
        if (closed) {
          eventSource.close();
          return;
        }
        onError?.(new Error("SSE connection error"));
      };

      return eventSource;
    };

    const es = connect();

    return {
      close: () => {
        closed = true;
        es.close();
      },
    };
  }

  /**
   * Health check endpoint.
   */
  async getStatus(): Promise<PlatformStatus> {
    const response = await fetch(`${this.baseUrl}/health`, {
      headers: this.headers,
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.status}`);
    }

    return (await response.json()) as PlatformStatus;
  }
}

export type {
  CreateProjectParams,
  CreateProjectResult,
  CreateSessionParams,
  CreateSessionResult,
  PlatformStatus,
  SessionEvent,
  SessionInfo,
  SubmitTaskParams,
  SubmitTaskResult,
  TaskInfo,
};
