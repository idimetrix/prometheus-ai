/**
 * Core Prometheus API client.
 *
 * Provides typed methods for all Prometheus REST API v1 endpoints,
 * including streaming support via SSE.
 */

import {
  PrometheusError,
  RateLimitError,
  TimeoutError,
  throwForStatus,
} from "./errors";
import { type SSEEvent, streamSSEEvents } from "./stream";
import type {
  ChatInput,
  ChatResponse,
  CreateApiKeyInput,
  CreateApiKeyResponse,
  CreateProjectInput,
  CreateSessionInput,
  ImportProjectInput,
  ImportProjectResponse,
  ListApiKeysResponse,
  ListProjectsParams,
  ListProjectsResponse,
  ListTasksParams,
  ListTasksResponse,
  Project,
  ProjectDetail,
  PrometheusClientOptions,
  RevokeApiKeyResponse,
  SendMessageInput,
  SendMessageResponse,
  Session,
  SessionActionResponse,
  SessionDetail,
  SubmitTaskInput,
  Task,
  TaskCancelResponse,
  TaskDetail,
  TaskResult,
} from "./types";

const DEFAULT_BASE_URL = "https://api.prometheus.dev";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY_MS = 500;
const TRAILING_SLASH_RE = /\/$/;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(
  status: number,
  attempt: number,
  maxRetries: number
): boolean {
  if (attempt >= maxRetries) {
    return false;
  }
  return status === 429 || status >= 500;
}

function getRetryDelay(response: Response, attempt: number): number {
  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    if (retryAfter) {
      return Number(retryAfter) * 1000;
    }
  }
  return INITIAL_RETRY_DELAY_MS * 2 ** attempt;
}

function handleFetchError(
  error: unknown,
  url: string,
  timeoutMs: number,
  attempt: number,
  maxRetries: number
): Error {
  if (error instanceof PrometheusError && !(error instanceof RateLimitError)) {
    throw error;
  }

  if (error instanceof DOMException && error.name === "AbortError") {
    const timeoutError = new TimeoutError(
      `Request to ${url} timed out after ${timeoutMs}ms`
    );
    if (attempt >= maxRetries) {
      throw timeoutError;
    }
    return timeoutError;
  }

  return error instanceof Error ? error : new Error(String(error));
}

/**
 * The main client for interacting with the Prometheus API.
 *
 * @example
 * ```typescript
 * import { PrometheusClient } from "@prometheus/sdk";
 *
 * const client = new PrometheusClient({ apiKey: "pk_live_..." });
 *
 * const { projects } = await client.projects.list();
 *
 * const task = await client.tasks.submit({
 *   projectId: projects[0].id,
 *   description: "Add dark mode support",
 * });
 *
 * const result = await client.tasks.waitForCompletion(task.id);
 * ```
 */
export class PrometheusClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;

  readonly projects: ProjectsResource;
  readonly sessions: SessionsResource;
  readonly tasks: TasksResource;
  readonly chat: ChatResource;
  readonly apiKeys: ApiKeysResource;

  constructor(options: PrometheusClientOptions) {
    if (!options.apiKey) {
      throw new PrometheusError(
        "apiKey is required. Get one at https://app.prometheus.dev/settings/api-keys",
        0,
        "missing_api_key"
      );
    }

    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(
      TRAILING_SLASH_RE,
      ""
    );
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;

    this.projects = new ProjectsResource(this);
    this.sessions = new SessionsResource(this);
    this.tasks = new TasksResource(this);
    this.chat = new ChatResource(this);
    this.apiKeys = new ApiKeysResource(this);
  }

  /** @internal */
  _headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /** @internal */
  _get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return this._request<T>("GET", url.toString());
  }

  /** @internal */
  _post<T>(path: string, body?: unknown): Promise<T> {
    return this._request<T>("POST", `${this.baseUrl}/api/v1${path}`, body);
  }

  /** @internal */
  _delete<T>(path: string): Promise<T> {
    return this._request<T>("DELETE", `${this.baseUrl}/api/v1${path}`);
  }

  /** @internal */
  _streamUrl(path: string): string {
    return `${this.baseUrl}/api/v1${path}`;
  }

  /** @internal */
  private async _request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          method,
          headers: this._headers(),
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          if (shouldRetry(response.status, attempt, this.maxRetries)) {
            await delay(getRetryDelay(response, attempt));
            continue;
          }
          await throwForStatus(response);
        }

        return (await response.json()) as T;
      } catch (error) {
        lastError = handleFetchError(
          error,
          url,
          this.timeoutMs,
          attempt,
          this.maxRetries
        );

        if (attempt < this.maxRetries) {
          await delay(INITIAL_RETRY_DELAY_MS * 2 ** attempt);
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw (
      lastError ??
      new PrometheusError("Request failed after retries", 0, "unknown")
    );
  }
}

// ── Resource Classes ────────────────────────────────────────────────────────

class ProjectsResource {
  private readonly client: PrometheusClient;

  constructor(client: PrometheusClient) {
    this.client = client;
  }

  list(params?: ListProjectsParams): Promise<ListProjectsResponse> {
    return this.client._get<ListProjectsResponse>("/projects", {
      status: params?.status,
      limit: params?.limit,
      offset: params?.offset,
    });
  }

  get(id: string): Promise<ProjectDetail> {
    return this.client._get<ProjectDetail>(
      `/projects/${encodeURIComponent(id)}`
    );
  }

  create(input: CreateProjectInput): Promise<Project> {
    return this.client._post<Project>("/projects", input);
  }

  triggerImport(
    id: string,
    input?: ImportProjectInput
  ): Promise<ImportProjectResponse> {
    return this.client._post<ImportProjectResponse>(
      `/projects/${encodeURIComponent(id)}/import`,
      input ?? {}
    );
  }
}

class SessionsResource {
  private readonly client: PrometheusClient;

  constructor(client: PrometheusClient) {
    this.client = client;
  }

  create(input: CreateSessionInput): Promise<Session> {
    return this.client._post<Session>("/sessions", input);
  }

  get(id: string): Promise<SessionDetail> {
    return this.client._get<SessionDetail>(
      `/sessions/${encodeURIComponent(id)}`
    );
  }

  sendMessage(
    sessionId: string,
    input: SendMessageInput
  ): Promise<SendMessageResponse> {
    return this.client._post<SendMessageResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      input
    );
  }

  pause(sessionId: string): Promise<SessionActionResponse> {
    return this.client._post<SessionActionResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/pause`
    );
  }

  resume(sessionId: string): Promise<SessionActionResponse> {
    return this.client._post<SessionActionResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/resume`
    );
  }

  cancel(sessionId: string): Promise<SessionActionResponse> {
    return this.client._post<SessionActionResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/cancel`
    );
  }

  stream(sessionId: string, signal?: AbortSignal): AsyncIterable<SSEEvent> {
    const url = this.client._streamUrl(
      `/sessions/${encodeURIComponent(sessionId)}/stream`
    );
    return streamSSEEvents({
      url,
      headers: this.client._headers(),
      signal,
    });
  }
}

class TasksResource {
  private readonly client: PrometheusClient;

  constructor(client: PrometheusClient) {
    this.client = client;
  }

  submit(input: SubmitTaskInput): Promise<Task> {
    return this.client._post<Task>("/tasks", input);
  }

  get(id: string): Promise<TaskDetail> {
    return this.client._get<TaskDetail>(`/tasks/${encodeURIComponent(id)}`);
  }

  list(params?: ListTasksParams): Promise<ListTasksResponse> {
    return this.client._get<ListTasksResponse>("/tasks", {
      projectId: params?.projectId,
      status: params?.status,
      limit: params?.limit,
      offset: params?.offset,
    });
  }

  cancel(id: string): Promise<TaskCancelResponse> {
    return this.client._post<TaskCancelResponse>(
      `/tasks/${encodeURIComponent(id)}/cancel`
    );
  }

  async waitForCompletion(
    id: string,
    timeoutMs = 300_000,
    pollIntervalMs = 3000
  ): Promise<TaskResult> {
    const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const task = await this.get(id);

      if (terminalStatuses.has(task.status)) {
        return task as TaskResult;
      }

      await delay(pollIntervalMs);
    }

    throw new TimeoutError(
      `Task ${id} did not complete within ${timeoutMs / 1000}s`
    );
  }

  stream(taskId: string, signal?: AbortSignal): AsyncIterable<SSEEvent> {
    const url = this.client._streamUrl(
      `/tasks/${encodeURIComponent(taskId)}/events`
    );
    return streamSSEEvents({
      url,
      headers: this.client._headers(),
      signal,
    });
  }
}

class ChatResource {
  private readonly client: PrometheusClient;

  constructor(client: PrometheusClient) {
    this.client = client;
  }

  send(input: Omit<ChatInput, "stream">): Promise<ChatResponse> {
    return this.client._post<ChatResponse>("/chat", {
      ...input,
      stream: false,
    });
  }

  async *stream(
    input: Omit<ChatInput, "stream">
  ): AsyncGenerator<SSEEvent, void, undefined> {
    const url = this.client._streamUrl("/chat");
    const response = await fetch(url, {
      method: "POST",
      headers: this.client._headers(),
      body: JSON.stringify({ ...input, stream: true }),
    });

    if (!response.ok) {
      await throwForStatus(response);
    }

    yield* readSSEFromBody(response.body);
  }
}

class ApiKeysResource {
  private readonly client: PrometheusClient;

  constructor(client: PrometheusClient) {
    this.client = client;
  }

  list(): Promise<ListApiKeysResponse> {
    return this.client._get<ListApiKeysResponse>("/api-keys");
  }

  create(input: CreateApiKeyInput): Promise<CreateApiKeyResponse> {
    return this.client._post<CreateApiKeyResponse>("/api-keys", input);
  }

  revoke(id: string): Promise<RevokeApiKeyResponse> {
    return this.client._delete<RevokeApiKeyResponse>(
      `/api-keys/${encodeURIComponent(id)}`
    );
  }
}

// ── SSE body reader ─────────────────────────────────────────────────────────

interface SSELineResult {
  data: string;
  event: string;
  id: string | undefined;
  yield?: SSEEvent;
}

function parseSSEField(line: string): { field: string; value: string } {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) {
    return { field: line, value: "" };
  }
  const field = line.slice(0, colonIdx);
  const value =
    line[colonIdx + 1] === " "
      ? line.slice(colonIdx + 2)
      : line.slice(colonIdx + 1);
  return { field, value };
}

function makeSSEEvent(
  id: string | undefined,
  event: string,
  data: string
): SSEEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    parsed = data;
  }
  return { id, event, data: parsed };
}

function processSSELine(
  line: string,
  currentId: string | undefined,
  currentEvent: string,
  currentData: string
): SSELineResult {
  if (line === "") {
    if (currentData) {
      return {
        id: undefined,
        event: "message",
        data: "",
        yield: makeSSEEvent(currentId, currentEvent, currentData),
      };
    }
    return { id: currentId, event: currentEvent, data: currentData };
  }

  if (line.startsWith(":")) {
    return { id: currentId, event: currentEvent, data: currentData };
  }

  const { field, value } = parseSSEField(line);

  switch (field) {
    case "id":
      return { id: value, event: currentEvent, data: currentData };
    case "event":
      return { id: currentId, event: value, data: currentData };
    case "data": {
      const newData = currentData ? `${currentData}\n${value}` : value;
      return { id: currentId, event: currentEvent, data: newData };
    }
    default:
      return { id: currentId, event: currentEvent, data: currentData };
  }
}

async function* readSSEFromBody(
  body: ReadableStream<Uint8Array> | null
): AsyncGenerator<SSEEvent, void, undefined> {
  if (!body) {
    throw new PrometheusError(
      "Response body is null; streaming is not supported in this environment.",
      0,
      "stream_unsupported"
    );
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();

  let buffer = "";
  let currentId: string | undefined;
  let currentEvent = "message";
  let currentData = "";

  try {
    let done = false;
    while (!done) {
      const result = await reader.read();
      done = result.done;
      if (done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const emitted = processSSELine(
          line,
          currentId,
          currentEvent,
          currentData
        );
        if (emitted.yield) {
          yield emitted.yield;
        }
        currentId = emitted.id;
        currentEvent = emitted.event;
        currentData = emitted.data;
      }
    }

    if (currentData) {
      yield makeSSEEvent(currentId, currentEvent, currentData);
    }
  } finally {
    reader.releaseLock();
  }
}
