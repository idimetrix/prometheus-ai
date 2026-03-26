/** Minimal HTTP + SSE client for communicating with the Prometheus API. */

import { type SecretStorage, window, workspace } from "vscode";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseSSEDataLine(
  data: string,
  onChunk: (chunk: ChatStreamChunk) => void
): boolean {
  if (data === "[DONE]") {
    onChunk({ done: true });
    return true;
  }
  try {
    const parsed = JSON.parse(data) as ChatStreamChunk;
    onChunk(parsed);
  } catch {
    onChunk({ content: data });
  }
  return false;
}

async function readStreamChunks(
  response: Response,
  onChunk: (chunk: ChatStreamChunk) => void
): Promise<void> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      onChunk({ done: true });
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const finished = parseSSEDataLine(line.slice(6), onChunk);
        if (finished) {
          return;
        }
      }
    }
  }
}

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
  activeSessions: number;
  creditBalance?: number;
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

interface ChatMessage {
  content: string;
  role: "user" | "assistant";
}

interface ChatStreamChunk {
  content?: string;
  done?: boolean;
  error?: string;
}

interface CompletionRequest {
  cursorOffset: number;
  fileContent: string;
  filePath: string;
  languageId: string;
  maxTokens?: number;
}

interface CompletionResponse {
  text: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class ApiClient {
  private baseUrl: string;
  private token: string;
  private readonly secretStorage: SecretStorage | undefined;
  private currentSessionId: string | undefined;

  constructor(baseUrl: string, token: string, secretStorage?: SecretStorage) {
    this.baseUrl = baseUrl;
    this.token = token;
    this.secretStorage = secretStorage;
  }

  // -------------------------------------------------------------------------
  // Configuration
  // -------------------------------------------------------------------------

  /**
   * Reload API URL and API key from VS Code settings and secret storage.
   */
  async reloadConfig(): Promise<void> {
    const config = workspace.getConfiguration("prometheus");
    this.baseUrl = config.get<string>("apiUrl", "http://localhost:4000");

    // Try secret storage first, then settings
    const secretKey = await this.secretStorage?.get("prometheus.apiKey");
    if (secretKey) {
      this.token = secretKey;
    } else {
      this.token = config.get<string>("apiKey", "");
    }
  }

  /**
   * Store an API key in VS Code secret storage.
   */
  async setApiKey(key: string): Promise<void> {
    if (this.secretStorage) {
      await this.secretStorage.store("prometheus.apiKey", key);
    }
    this.token = key;
  }

  updateConfig(baseUrl: string, token: string): void {
    this.baseUrl = baseUrl;
    this.token = token;
  }

  getBaseUrl(): string {
    return this.baseUrl;
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
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.headers,
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Network error";
      window.showErrorMessage(
        `Prometheus: Cannot reach API at ${this.baseUrl}. ${message}`
      );
      throw new Error(
        `Network error connecting to ${this.baseUrl}: ${message}`
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      const errorMsg = `API ${method} ${path} failed (${response.status}): ${text}`;

      if (response.status === 401) {
        window.showErrorMessage(
          "Prometheus: Authentication failed. Check your API key in settings."
        );
      } else if (response.status === 403) {
        window.showErrorMessage(
          "Prometheus: Access denied. You may not have permission for this action."
        );
      } else if (response.status >= 500) {
        window.showErrorMessage(
          "Prometheus: Server error. Please try again later."
        );
      }

      throw new Error(errorMsg);
    }

    return response.json() as Promise<T>;
  }

  // -------------------------------------------------------------------------
  // tRPC helpers
  // -------------------------------------------------------------------------

  /**
   * Call a tRPC query endpoint.
   */
  trpcQuery<T>(procedure: string, input?: unknown): Promise<T> {
    const params = input
      ? `?input=${encodeURIComponent(JSON.stringify(input))}`
      : "";
    return this.request<T>("GET", `/trpc/${procedure}${params}`);
  }

  /**
   * Call a tRPC mutation endpoint.
   */
  trpcMutation<T>(procedure: string, input?: unknown): Promise<T> {
    return this.request<T>("POST", `/trpc/${procedure}`, input);
  }

  // -------------------------------------------------------------------------
  // Session management
  // -------------------------------------------------------------------------

  async startSession(): Promise<SessionResponse> {
    const result = await this.request<SessionResponse>(
      "POST",
      "/api/v1/sessions"
    );
    this.currentSessionId = result.id;
    return result;
  }

  async stopSession(): Promise<void> {
    if (!this.currentSessionId) {
      throw new Error("No active session");
    }
    await this.request<void>(
      "DELETE",
      `/api/v1/sessions/${this.currentSessionId}`
    );
    this.currentSessionId = undefined;
  }

  getSessionId(): string | undefined {
    return this.currentSessionId;
  }

  // -------------------------------------------------------------------------
  // Task management
  // -------------------------------------------------------------------------

  assignTask(description: string): Promise<TaskResponse> {
    return this.request<TaskResponse>("POST", "/api/v1/tasks", {
      description,
      sessionId: this.currentSessionId,
    });
  }

  getStatus(): Promise<StatusResponse> {
    return this.request<StatusResponse>("GET", "/api/v1/status");
  }

  // -------------------------------------------------------------------------
  // Chat with streaming (SSE)
  // -------------------------------------------------------------------------

  /**
   * Send a chat message and stream the response via SSE.
   * The onChunk callback receives incremental text chunks.
   * Returns an AbortController to cancel the stream.
   */
  streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: ChatStreamChunk) => void,
    onError?: (error: Error) => void
  ): AbortController {
    const controller = new AbortController();
    const url = `${this.baseUrl}/api/v1/chat/stream`;

    const connect = async () => {
      try {
        const response = await this.fetchChatStream(
          url,
          messages,
          controller.signal
        );
        await readStreamChunks(response, onChunk);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        const err =
          error instanceof Error ? error : new Error("Chat stream error");
        onError?.(err);
        onChunk({ error: err.message, done: true });
      }
    };

    connect();
    return controller;
  }

  private async fetchChatStream(
    url: string,
    messages: ChatMessage[],
    signal: AbortSignal
  ): Promise<Response> {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        ...this.headers,
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        messages,
        sessionId: this.currentSessionId,
      }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "Unknown error");
      throw new Error(`Chat stream failed (${response.status}): ${text}`);
    }

    if (!response.body) {
      throw new Error("No response body for chat stream");
    }

    return response;
  }

  // -------------------------------------------------------------------------
  // Inline completions
  // -------------------------------------------------------------------------

  /**
   * Request an inline completion from the model-router.
   */
  async getInlineCompletion(
    req: CompletionRequest,
    signal?: AbortSignal
  ): Promise<CompletionResponse> {
    const url = `${this.baseUrl}/api/v1/completions/inline`;
    const init: RequestInit = {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(req),
      signal,
    };

    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Inline completion failed (${response.status}): ${text}`);
    }

    return response.json() as Promise<CompletionResponse>;
  }

  // -------------------------------------------------------------------------
  // SSE event subscription
  // -------------------------------------------------------------------------

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
    const url = `${this.baseUrl}/api/v1/sessions/${sessionId}/events`;

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
}

export type {
  ChatMessage,
  ChatStreamChunk,
  CompletionRequest,
  CompletionResponse,
  SessionResponse,
  SSEMessage,
  StatusResponse,
  TaskResponse,
};
