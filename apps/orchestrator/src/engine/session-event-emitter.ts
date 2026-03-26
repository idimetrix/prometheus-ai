import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";

const logger = createLogger("orchestrator:event-emitter");

/**
 * Socket server URL for HTTP-based event ingestion.
 * Used as fallback when direct Redis pub/sub is not available,
 * or for explicit HTTP POST from services that don't share the
 * Redis connection.
 */
const SOCKET_SERVER_URL =
  process.env.SOCKET_SERVER_URL ?? "http://localhost:4001";

const INTERNAL_SECRET = process.env.INTERNAL_SERVICE_SECRET;

/**
 * Canonical agent streaming event types matching the UI contract.
 */
export type AgentStreamingEventType =
  | "agent:thinking"
  | "agent:terminal"
  | "agent:file-change"
  | "agent:progress"
  | "task:complete"
  | "task:created"
  | "session:checkpoint"
  | "session:error";

export interface AgentThinkingPayload {
  agentRole?: string;
  content: string;
  streaming?: boolean;
}

export interface AgentTerminalPayload {
  command: string;
  output: string;
  success: boolean;
}

export interface AgentFileChangePayload {
  agentRole?: string;
  diff?: string;
  filePath: string;
  tool: string;
}

export interface AgentProgressPayload {
  agentRole?: string;
  confidence?: number;
  status?: string;
  step: number;
  totalSteps?: number;
}

export interface TaskCompletePayload {
  agentRole?: string;
  filesChanged?: string[];
  output?: string;
  status: string;
  steps?: number;
  success: boolean;
  tokensUsed?: { input: number; output: number };
  toolCalls?: number;
}

export interface TaskCreatedPayload {
  status: string;
  taskId: string;
}

export interface SessionCheckpointPayload {
  affectedFiles?: string[];
  agentRole?: string;
  checkpointType: string;
  reason: string;
}

export interface SessionErrorPayload {
  agentRole?: string;
  error: string;
  recoverable?: boolean;
}

interface EventPayloadMap {
  "agent:file-change": AgentFileChangePayload;
  "agent:progress": AgentProgressPayload;
  "agent:terminal": AgentTerminalPayload;
  "agent:thinking": AgentThinkingPayload;
  "session:checkpoint": SessionCheckpointPayload;
  "session:error": SessionErrorPayload;
  "task:complete": TaskCompletePayload;
  "task:created": TaskCreatedPayload;
}

/**
 * SessionEventEmitter provides a unified interface for the orchestrator
 * and other services to emit real-time events to the UI.
 *
 * It supports two transport modes:
 * 1. **Redis pub/sub** (primary) — uses EventPublisher to publish directly
 *    to the `session:{id}:events` channel. This is the fastest path when
 *    the service shares the Redis connection.
 * 2. **HTTP POST** (fallback) — POSTs events to the socket server's
 *    `/api/sessions/:id/events` endpoint. Used when the service cannot
 *    access Redis directly (e.g., sandbox environments).
 */
export class SessionEventEmitter {
  private readonly publisher: EventPublisher;
  private readonly useHttpFallback: boolean;

  constructor(options?: { useHttpFallback?: boolean }) {
    this.publisher = new EventPublisher();
    this.useHttpFallback = options?.useHttpFallback ?? false;
  }

  /**
   * Emit a canonical agent streaming event to a session.
   *
   * Uses Redis pub/sub by default. Falls back to HTTP POST if
   * `useHttpFallback` is enabled or Redis publish fails.
   */
  async emit<T extends AgentStreamingEventType>(
    sessionId: string,
    type: T,
    payload: EventPayloadMap[T]
  ): Promise<void> {
    const timestamp = new Date().toISOString();

    if (this.useHttpFallback) {
      await this.emitViaHttp(sessionId, type, payload, timestamp);
      return;
    }

    try {
      await this.publisher.publishSessionEvent(sessionId, {
        type,
        data: payload as unknown as Record<string, unknown>,
        timestamp,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { sessionId, type, error: msg },
        "Redis publish failed, falling back to HTTP"
      );
      await this.emitViaHttp(sessionId, type, payload, timestamp);
    }
  }

  /**
   * Emit a legacy event type (for backward compatibility with existing code).
   */
  async emitLegacy(
    sessionId: string,
    type: string,
    data: Record<string, unknown>,
    agentRole?: string
  ): Promise<void> {
    const timestamp = new Date().toISOString();

    if (this.useHttpFallback) {
      await this.emitViaHttp(sessionId, type, data, timestamp);
      return;
    }

    try {
      await this.publisher.publishSessionEvent(sessionId, {
        type,
        data,
        agentRole,
        timestamp,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { sessionId, type, error: msg },
        "Redis publish failed, falling back to HTTP"
      );
      await this.emitViaHttp(sessionId, type, data, timestamp);
    }
  }

  /**
   * Emit multiple events in a single batch via HTTP POST.
   * More efficient when many events need to be sent at once.
   */
  async emitBatch(
    sessionId: string,
    events: Array<{ type: string; data: Record<string, unknown> }>
  ): Promise<void> {
    const url = `${SOCKET_SERVER_URL}/api/sessions/${sessionId}/events/batch`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(INTERNAL_SECRET ? { "x-internal-secret": INTERNAL_SECRET } : {}),
        },
        body: JSON.stringify({ events }),
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error(
          { sessionId, status: response.status, body: text },
          "Batch HTTP event emit failed"
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { sessionId, error: msg },
        "Batch HTTP event emit network error"
      );
    }
  }

  /**
   * Convenience methods for each canonical event type.
   */
  async thinking(
    sessionId: string,
    content: string,
    agentRole?: string
  ): Promise<void> {
    await this.emit(sessionId, "agent:thinking", {
      content,
      agentRole,
      streaming: true,
    });
  }

  async terminal(
    sessionId: string,
    command: string,
    output: string,
    success: boolean
  ): Promise<void> {
    await this.emit(sessionId, "agent:terminal", {
      command,
      output,
      success,
    });
  }

  async fileChange(
    sessionId: string,
    filePath: string,
    tool: string,
    options?: { diff?: string; agentRole?: string }
  ): Promise<void> {
    await this.emit(sessionId, "agent:file-change", {
      filePath,
      tool,
      diff: options?.diff,
      agentRole: options?.agentRole,
    });
  }

  async progress(
    sessionId: string,
    step: number,
    totalSteps?: number,
    options?: { status?: string; agentRole?: string; confidence?: number }
  ): Promise<void> {
    await this.emit(sessionId, "agent:progress", {
      step,
      totalSteps,
      status: options?.status,
      agentRole: options?.agentRole,
      confidence: options?.confidence,
    });
  }

  async taskComplete(
    sessionId: string,
    payload: TaskCompletePayload
  ): Promise<void> {
    await this.emit(sessionId, "task:complete", payload);
  }

  async taskCreated(
    sessionId: string,
    taskId: string,
    status = "queued"
  ): Promise<void> {
    await this.emit(sessionId, "task:created", { taskId, status });
  }

  async checkpoint(
    sessionId: string,
    payload: SessionCheckpointPayload
  ): Promise<void> {
    await this.emit(sessionId, "session:checkpoint", payload);
  }

  async error(
    sessionId: string,
    error: string,
    options?: { recoverable?: boolean; agentRole?: string }
  ): Promise<void> {
    await this.emit(sessionId, "session:error", {
      error,
      recoverable: options?.recoverable,
      agentRole: options?.agentRole,
    });
  }

  private async emitViaHttp(
    sessionId: string,
    type: string,
    data: unknown,
    timestamp: string
  ): Promise<void> {
    const url = `${SOCKET_SERVER_URL}/api/sessions/${sessionId}/events`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(INTERNAL_SECRET ? { "x-internal-secret": INTERNAL_SECRET } : {}),
        },
        body: JSON.stringify({ type, data, timestamp }),
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error(
          { sessionId, type, status: response.status, body: text },
          "HTTP event emit failed"
        );
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        { sessionId, type, error: msg },
        "HTTP event emit network error"
      );
    }
  }
}

/**
 * Maps ExecutionEngine event types to canonical streaming events
 * and publishes them. Used by the AgentLoop to bridge between
 * the internal execution engine and the UI streaming contract.
 */
export function mapExecutionEventToStreamingEvent(
  eventType: string,
  eventData: Record<string, unknown>,
  agentRole: string
): { type: string; data: Record<string, unknown> } | null {
  switch (eventType) {
    case "token":
      return {
        type: QueueEvents.AGENT_OUTPUT,
        data: {
          content: eventData.content,
          agentRole,
          streaming: true,
        },
      };
    case "tool_call":
      return {
        type: QueueEvents.AGENT_OUTPUT,
        data: {
          type: "tool_call",
          tool: eventData.toolName,
          args: eventData.args,
          agentRole,
        },
      };
    case "tool_result":
      return {
        type: QueueEvents.AGENT_OUTPUT,
        data: {
          type: "tool_result",
          tool: eventData.toolName,
          success: eventData.success,
          output:
            typeof eventData.output === "string"
              ? eventData.output.slice(0, 2000)
              : "",
          agentRole,
        },
      };
    case "file_change":
      return {
        type: QueueEvents.FILE_CHANGE,
        data: {
          filePath: eventData.filePath,
          tool: eventData.tool,
          agentRole,
        },
      };
    case "terminal_output":
      return {
        type: QueueEvents.TERMINAL_OUTPUT,
        data: {
          command: eventData.command,
          output: eventData.output,
          success: eventData.success,
        },
      };
    case "checkpoint":
      return {
        type: QueueEvents.CHECKPOINT,
        data: {
          checkpointType: eventData.checkpointType,
          reason: eventData.reason,
          affectedFiles: eventData.affectedFiles,
          agentRole,
        },
      };
    case "error":
      return {
        type: QueueEvents.ERROR,
        data: {
          error: eventData.error,
          recoverable: eventData.recoverable,
          agentRole,
        },
      };
    case "complete":
      return {
        type: "session_complete",
        data: {
          success: eventData.success,
          output:
            typeof eventData.output === "string"
              ? eventData.output.slice(0, 2000)
              : "",
          filesChanged: eventData.filesChanged,
          tokensUsed: eventData.tokensUsed,
          toolCalls: eventData.toolCalls,
          steps: eventData.steps,
          status: eventData.success ? "completed" : "failed",
          agentRole,
        },
      };
    default:
      return null;
  }
}
