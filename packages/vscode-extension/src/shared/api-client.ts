/**
 * Shared HTTP API client for communicating with the Prometheus API.
 *
 * This module is IDE-agnostic -- it uses only the standard `fetch` API so it can
 * be consumed by both the VS Code extension and the JetBrains plugin (via a
 * thin Kotlin/JS bridge or as a reference implementation ported to OkHttp).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiClientConfig {
  apiKey: string;
  baseUrl: string;
}

export interface SessionResponse {
  id: string;
  status: string;
}

export interface TaskResponse {
  sessionId: string;
  taskId: string;
}

export interface TaskStatusResponse {
  error?: string;
  progress?: number;
  result?: unknown;
  status: string;
  taskId: string;
}

export interface SessionEvent {
  data: string;
  event: string;
}

export interface ChatStreamChunk {
  content?: string;
  done?: boolean;
  error?: string;
}

export interface InlineCompletionRequest {
  cursorOffset: number;
  fileContent: string;
  filePath: string;
  languageId: string;
  maxTokens?: number;
}

export interface InlineCompletionResponse {
  text: string;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
}

async function request<T>(
  config: ApiClientConfig,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${config.baseUrl}${path}`;
  const init: RequestInit = {
    method,
    headers: buildHeaders(config.apiKey),
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Create a new agent session. */
export function createSession(
  config: ApiClientConfig
): Promise<SessionResponse> {
  return request<SessionResponse>(config, "POST", "/api/v1/sessions");
}

/** Submit a task to an existing session. */
export function submitTask(
  config: ApiClientConfig,
  sessionId: string,
  description: string
): Promise<TaskResponse> {
  return request<TaskResponse>(config, "POST", "/api/v1/tasks", {
    sessionId,
    description,
  });
}

/** Poll the current status of a task. */
export function getTaskStatus(
  config: ApiClientConfig,
  taskId: string
): Promise<TaskStatusResponse> {
  return request<TaskStatusResponse>(config, "GET", `/api/v1/tasks/${taskId}`);
}

/** Cancel a running task. */
export function cancelTask(
  config: ApiClientConfig,
  taskId: string
): Promise<void> {
  return request<void>(config, "DELETE", `/api/v1/tasks/${taskId}`);
}

/** Request an inline completion from the model-router. */
export function getInlineCompletion(
  config: ApiClientConfig,
  req: InlineCompletionRequest,
  signal?: AbortSignal
): Promise<InlineCompletionResponse> {
  const url = `${config.baseUrl}/api/v1/completions/inline`;
  const init: RequestInit = {
    method: "POST",
    headers: buildHeaders(config.apiKey),
    body: JSON.stringify(req),
    signal,
  };

  return fetch(url, init).then(async (response) => {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Inline completion failed (${response.status}): ${text}`);
    }
    return response.json() as Promise<InlineCompletionResponse>;
  });
}

/**
 * Subscribe to Server-Sent Events for a session.
 *
 * Returns an `AbortController` -- call `.abort()` to disconnect.
 */
export function getSessionEvents(
  config: ApiClientConfig,
  sessionId: string,
  onMessage: (msg: SessionEvent) => void,
  onError?: (error: Error) => void
): AbortController {
  const controller = new AbortController();
  const url = `${config.baseUrl}/api/v1/sessions/${sessionId}/events`;

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
        headers: {
          ...buildHeaders(config.apiKey),
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

// ---------------------------------------------------------------------------
// Stream helpers
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

async function readChatStreamBody(
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

/**
 * Stream a chat response via SSE.
 * Returns an AbortController to cancel the stream.
 */
export function streamChat(
  config: ApiClientConfig,
  messages: Array<{ role: string; content: string }>,
  sessionId: string | undefined,
  onChunk: (chunk: ChatStreamChunk) => void,
  onError?: (error: Error) => void
): AbortController {
  const controller = new AbortController();
  const url = `${config.baseUrl}/api/v1/chat/stream`;

  const connect = async () => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          ...buildHeaders(config.apiKey),
          Accept: "text/event-stream",
        },
        body: JSON.stringify({ messages, sessionId }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "Unknown error");
        throw new Error(`Chat stream failed (${response.status}): ${text}`);
      }

      if (!response.body) {
        throw new Error("No response body for chat stream");
      }

      await readChatStreamBody(response, onChunk);
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
