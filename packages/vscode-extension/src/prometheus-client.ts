/**
 * Unified HTTP + WebSocket client for communicating with the Prometheus
 * API server and socket-server.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

interface AgentStatus {
  filesChanged: number;
  id: string;
  progress: number;
  role: string;
  status: "pending" | "running" | "completed" | "failed";
  tokensUsed: number;
}

interface CheckpointInfo {
  phase: string;
  summary: string;
  taskId: string;
}

interface SSEMessage {
  data: string;
  event: string;
}

type WebSocketEventHandler = (event: string, data: unknown) => void;

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class PrometheusClient {
  private apiUrl: string;
  private socketUrl: string;
  private token: string;
  private currentSessionId: string | undefined;
  private ws: WebSocket | undefined;
  private readonly eventHandlers: Set<WebSocketEventHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(apiUrl: string, socketUrl: string, token: string) {
    this.apiUrl = apiUrl;
    this.socketUrl = socketUrl;
    this.token = token;
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  updateCredentials(apiUrl: string, socketUrl: string, token: string): void {
    this.apiUrl = apiUrl;
    this.socketUrl = socketUrl;
    this.token = token;
    // Reconnect WS if active
    if (this.ws) {
      this.disconnectWebSocket();
      this.connectWebSocket();
    }
  }

  // -------------------------------------------------------------------------
  // HTTP helpers
  // -------------------------------------------------------------------------

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
    const url = `${this.apiUrl}${path}`;
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

  // -------------------------------------------------------------------------
  // Session management
  // -------------------------------------------------------------------------

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

  getSessionId(): string | undefined {
    return this.currentSessionId;
  }

  // -------------------------------------------------------------------------
  // Task management
  // -------------------------------------------------------------------------

  submitTask(description: string, priority?: string): Promise<TaskResponse> {
    return this.request<TaskResponse>("POST", "/api/tasks", {
      description,
      priority,
      sessionId: this.currentSessionId,
    });
  }

  getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>("GET", "/api/status");
  }

  getAgents(): Promise<AgentStatus[]> {
    return this.request<AgentStatus[]>(
      "GET",
      `/api/sessions/${this.currentSessionId}/agents`
    );
  }

  // -------------------------------------------------------------------------
  // Checkpoint approval
  // -------------------------------------------------------------------------

  getPendingCheckpoints(): Promise<CheckpointInfo[]> {
    if (!this.currentSessionId) {
      return Promise.resolve([]);
    }
    return this.request<CheckpointInfo[]>(
      "GET",
      `/api/sessions/${this.currentSessionId}/checkpoints`
    );
  }

  async approveCheckpoint(taskId: string): Promise<void> {
    await this.request<void>("POST", `/api/tasks/${taskId}/approve`, {
      action: "approve",
    });
  }

  async rejectCheckpoint(taskId: string, reason: string): Promise<void> {
    await this.request<void>("POST", `/api/tasks/${taskId}/approve`, {
      action: "reject",
      reason,
    });
  }

  // -------------------------------------------------------------------------
  // WebSocket connection
  // -------------------------------------------------------------------------

  connectWebSocket(): void {
    if (this.ws) {
      return;
    }

    const url = this.token
      ? `${this.socketUrl}?token=${encodeURIComponent(this.token)}`
      : this.socketUrl;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.notifyHandlers("connected", {});
      // Join session room if we have one
      if (this.currentSessionId) {
        this.ws?.send(
          JSON.stringify({
            type: "join",
            room: `session:${this.currentSessionId}`,
          })
        );
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event.data)) as {
          event: string;
          data: unknown;
        };
        this.notifyHandlers(parsed.event, parsed.data);
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.ws = undefined;
      this.notifyHandlers("disconnected", {});
      // Auto-reconnect after 3 seconds
      this.reconnectTimer = setTimeout(() => {
        this.connectWebSocket();
      }, 3000);
    };

    this.ws.onerror = () => {
      this.notifyHandlers("error", { message: "WebSocket error" });
      this.ws?.close();
    };
  }

  disconnectWebSocket(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = undefined;
    }
  }

  onEvent(handler: WebSocketEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  private notifyHandlers(event: string, data: unknown): void {
    for (const handler of this.eventHandlers) {
      handler(event, data);
    }
  }

  // -------------------------------------------------------------------------
  // SSE subscription (alternative to WebSocket)
  // -------------------------------------------------------------------------

  subscribeToEvents(
    sessionId: string,
    onMessage: (msg: SSEMessage) => void,
    onError?: (error: Error) => void
  ): AbortController {
    const controller = new AbortController();
    const url = `${this.apiUrl}/api/sessions/${sessionId}/events`;

    const parseSSELines = (
      lines: string[],
      state: { event: string; data: string }
    ): void => {
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          state.event = line.slice(7).trim();
        } else if (line.startsWith("data: ")) {
          state.data = line.slice(6);
        } else if (line === "" && state.data) {
          onMessage({ event: state.event, data: state.data });
          state.event = "message";
          state.data = "";
        }
      }
    };

    const connect = async () => {
      try {
        const response = await fetch(url, {
          headers: { ...this.headers, Accept: "text/event-stream" },
          signal: controller.signal,
        });

        if (!(response.ok && response.body)) {
          throw new Error(`SSE connection failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const state = { event: "message", data: "" };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          parseSSELines(lines, state);
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

  // -------------------------------------------------------------------------
  // Cleanup
  // -------------------------------------------------------------------------

  dispose(): void {
    this.disconnectWebSocket();
    this.eventHandlers.clear();
  }
}

export type {
  AgentStatus,
  CheckpointInfo,
  SessionResponse,
  SSEMessage,
  StatusResponse,
  TaskResponse,
  WebSocketEventHandler,
};
