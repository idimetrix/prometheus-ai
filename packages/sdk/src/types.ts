/**
 * Public types for the Prometheus SDK.
 */

// ── Client Configuration ────────────────────────────────────────────────────

export interface PrometheusClientOptions {
  /** API key for authentication (e.g. pk_live_...) */
  apiKey: string;
  /** Base URL for the Prometheus API. Defaults to https://api.prometheus.dev */
  baseUrl?: string;
  /** Maximum number of retries for rate-limited or transient errors. Defaults to 3. */
  maxRetries?: number;
  /** Request timeout in milliseconds. Defaults to 30000 (30s). */
  timeoutMs?: number;
}

// ── Projects ────────────────────────────────────────────────────────────────

export interface Project {
  createdAt: string;
  description: string | null;
  id: string;
  name: string;
  repoUrl: string | null;
  status: "active" | "archived" | "setup";
  techStackPreset: string | null;
  updatedAt: string;
}

export interface ProjectDetail extends Project {
  members: Array<{ userId: string; role: string }>;
  settings: Record<string, unknown> | null;
}

export interface CreateProjectInput {
  description?: string;
  name: string;
  repoUrl?: string;
  techStackPreset?: string;
}

export interface ListProjectsParams {
  /** Maximum number of results. Defaults to 50, max 100. */
  limit?: number;
  /** Offset for pagination. Defaults to 0. */
  offset?: number;
  /** Filter by project status */
  status?: "active" | "archived" | "setup";
}

export interface ListProjectsResponse {
  hasMore: boolean;
  projects: Project[];
}

export interface ImportProjectInput {
  fullReindex?: boolean;
  repoUrl?: string;
}

export interface ImportProjectResponse {
  id: string;
  message: string;
  repoUrl: string;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export type SessionMode = "task" | "ask" | "plan" | "design";
export type SessionStatus =
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export interface Session {
  createdAt: string;
  id: string;
  mode: SessionMode;
  projectId: string;
  status: SessionStatus;
}

export interface SessionDetail extends Session {
  endedAt: string | null;
  events: SessionEvent[];
  messages: SessionMessage[];
  startedAt: string;
}

export interface SessionMessage {
  content: string;
  createdAt: string;
  id: string;
  role: "user" | "assistant" | "system";
}

export interface CreateSessionInput {
  mode: SessionMode;
  projectId: string;
  /** If provided, automatically creates a task with this prompt. */
  prompt?: string;
}

export interface SendMessageInput {
  content: string;
}

export interface SendMessageResponse {
  content: string;
  createdAt: string;
  id: string;
  role: "user";
  taskId: string;
}

export interface SessionActionResponse {
  id: string;
  status: SessionStatus;
}

// ── Session Events (SSE) ────────────────────────────────────────────────────

export interface SessionEvent {
  data: unknown;
  id: string;
  timestamp: string;
  type: string;
}

export interface SessionEndedEvent {
  status: SessionStatus;
}

// ── Tasks ───────────────────────────────────────────────────────────────────

export type TaskStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface Task {
  createdAt: string;
  id: string;
  sessionId: string;
  status: TaskStatus;
}

export interface TaskDetail extends Task {
  completedAt: string | null;
  creditsConsumed: number;
  description: string;
  projectId: string;
  title: string;
}

export interface SubmitTaskInput {
  description: string;
  mode?: "task" | "plan";
  priority?: number;
  projectId: string;
}

export interface TaskResult extends TaskDetail {
  completedAt: string | null;
}

export interface ListTasksParams {
  /** Maximum number of results. Defaults to 50, max 100. */
  limit?: number;
  /** Offset for pagination. Defaults to 0. */
  offset?: number;
  /** Filter by project ID */
  projectId?: string;
  /** Filter by task status */
  status?: TaskStatus;
}

export interface ListTasksResponse {
  hasMore: boolean;
  tasks: Array<{
    id: string;
    sessionId: string;
    projectId: string;
    status: TaskStatus;
    title: string;
    creditsConsumed: number;
    createdAt: string;
    completedAt: string | null;
  }>;
  total: number;
}

export interface TaskCancelResponse {
  cancelledAt: string;
  id: string;
  status: "cancelled";
}

// ── Task Events (SSE) ──────────────────────────────────────────────────────

export interface TaskEvent {
  data: unknown;
  id: string;
  timestamp: string;
  type: string;
}

export interface TaskCompleteEvent {
  status: TaskStatus;
}

// ── Chat ────────────────────────────────────────────────────────────────────

export interface ChatInput {
  message: string;
  mode?: "ask" | "task" | "plan";
  model?: string;
  projectId: string;
  /** Reuse an existing session instead of creating a new one. */
  sessionId?: string;
  /** If true, returns an SSE stream. */
  stream?: boolean;
}

export interface ChatResponse {
  hint?: string;
  id: string;
  message: { role: "assistant"; content: string | null } | null;
  sessionId: string;
  status: TaskStatus;
}

export interface ChatStreamEvent {
  data: unknown;
  event: "chat_started" | "message" | "chat_complete";
}

// ── API Keys ────────────────────────────────────────────────────────────────

export interface ApiKey {
  createdAt: string;
  expiresAt: string | null;
  id: string;
  lastUsed: string | null;
  name: string;
  projectIds: string[] | null;
  requestCount: number;
  scopes: string[];
}

export interface CreateApiKeyInput {
  expiresAt?: string;
  name: string;
  projectIds?: string[];
  scopes: string[];
}

export interface CreateApiKeyResponse {
  createdAt: string;
  expiresAt: string | null;
  id: string;
  key: string;
  message: string;
  name: string;
  projectIds: string[] | null;
  scopes: string[];
}

export interface ListApiKeysResponse {
  keys: ApiKey[];
}

export interface RevokeApiKeyResponse {
  id: string;
  revoked: boolean;
}

// ── Error response shape from the API ───────────────────────────────────────

export interface ApiErrorResponse {
  error: string;
  message: string;
}
