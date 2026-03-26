/**
 * @prometheus/sdk - TypeScript client SDK for the Prometheus AI Engineering Platform.
 *
 * @example
 * ```typescript
 * import { PrometheusClient } from "@prometheus/sdk";
 *
 * const client = new PrometheusClient({
 *   apiKey: "pk_live_...",
 *   baseUrl: "https://api.prometheus.dev", // optional
 * });
 *
 * // List projects
 * const { projects } = await client.projects.list();
 *
 * // Submit a task
 * const task = await client.tasks.submit({
 *   projectId: projects[0].id,
 *   description: "Implement user authentication",
 * });
 *
 * // Wait for the task to complete
 * const result = await client.tasks.waitForCompletion(task.id);
 * console.log("Task completed:", result.status);
 *
 * // Stream session events
 * for await (const event of client.sessions.stream(task.sessionId)) {
 *   console.log(event.event, event.data);
 * }
 * ```
 *
 * @packageDocumentation
 */

export { PrometheusClient } from "./client";
export {
  AuthError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PrometheusError,
  RateLimitError,
  ServerError,
  TimeoutError,
  ValidationError,
} from "./errors";
export type { SSEEvent } from "./stream";
export type {
  ApiErrorResponse,
  ApiKey,
  ChatInput,
  ChatResponse,
  ChatStreamEvent,
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
  SessionEvent,
  SessionMessage,
  SessionMode,
  SessionStatus,
  SubmitTaskInput,
  Task,
  TaskCancelResponse,
  TaskDetail,
  TaskEvent,
  TaskResult,
  TaskStatus,
} from "./types";
