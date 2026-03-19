/** Minimal HTTP + SSE client for communicating with the Prometheus API. */

interface SessionResponse {
  id: string;
  status: string;
}

interface TaskResponse {
  sessionId: string;
  taskId: string;
}

interface StatusResponse {
  sessions: Array<{
    id: string;
    status: string;
    currentTask?: string;
  }>;
}

interface SSEMessage {
  data: string;
  event: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private currentSessionId: string | undefined;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  private get headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.token) {
      h.Authorization = `Bearer ${this.token}`;
    }
    return h;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.headers,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      throw new Error(
        `API ${method} ${path} failed (${response.status}): ${text}`
      );
    }

    return response.json() as Promise<T>;
  }

  async startSession(): Promise<SessionResponse> {
    const result = await this.request<SessionResponse>("POST", "/api/sessions");
    this.currentSessionId = result.id;
    return result;
  }

  async stopSession(): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error("No active session");
    }
    await this.request<void>(
      "DELETE",
      `/api/sessions/${this.currentSessionId}`
    );
    this.currentSessionId = undefined;
  }

  assignTask(description: string): Promise<TaskResponse> {
    return this.request<TaskResponse>("POST", "/api/tasks", {
      description,
      sessionId: this.currentSessionId,
    });
  }

  getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>("GET", "/api/status");
  }

  /**
   * Subscribe to SSE events from the API.
   * Returns an AbortController that can be used to cancel the subscription.
   */
  subscribeToEvents(
    sessionId: string,
    onMessage: (msg: SSEMessage) => void,
    onError?: (error: Error) => void
  ): AbortController {
    const controller = new AbortController();
    const url = `${this.baseUrl}/api/sessions/${sessionId}/events`;

    const connect = async () => {
      try {
        const response = await fetch(url, {
          headers: {
            ...this.headers,
            Accept: "text/event-stream",
          },
          signal: controller.signal,
        });

        if (!(response.ok && response.body)) {
          throw new Error(`SSE connection failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          let currentEvent = "message";
          let currentData = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEvent = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              currentData = line.slice(6);
            } else if (line === "" && currentData) {
              onMessage({ event: currentEvent, data: currentData });
              currentEvent = "message";
              currentData = "";
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        onError?.(
          error instanceof Error ? error : new Error("SSE connection error")
        );
      }
    };

    connect();
    return controller;
  }
}

export type { SessionResponse, SSEMessage, StatusResponse, TaskResponse };
