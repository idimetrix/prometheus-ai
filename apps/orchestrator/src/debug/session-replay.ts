/**
 * Agent session replay infrastructure (GAP-103).
 *
 * Records the full sequence of events in an agent session (tool calls,
 * model responses, decisions) and supports replaying them for debugging,
 * auditing, and training-data generation.
 */

import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:session-replay");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReplayEventKind =
  | "session_start"
  | "tool_call"
  | "tool_result"
  | "model_request"
  | "model_response"
  | "decision"
  | "human_input"
  | "error"
  | "session_end";

export interface ReplayEvent {
  /** Unique event identifier */
  id: string;
  /** Event kind */
  kind: ReplayEventKind;
  /** Milliseconds since session start */
  offsetMs: number;
  /** Event payload */
  payload: Record<string, unknown>;
  /** Session identifier */
  sessionId: string;
  /** ISO timestamp */
  timestamp: string;
}

export interface SessionRecording {
  /** Agent role that ran the session */
  agentRole: string;
  /** Total duration in milliseconds */
  durationMs: number;
  /** Ordered list of events */
  events: ReplayEvent[];
  /** Project identifier */
  projectId: string;
  /** Session identifier */
  sessionId: string;
  /** ISO timestamp of recording start */
  startedAt: string;
}

export interface ReplayOptions {
  /** Callback invoked for each event during replay */
  onEvent?: (event: ReplayEvent) => void | Promise<void>;
  /** Playback speed multiplier (1 = real-time, 0 = instant) */
  speed: number;
}

// ---------------------------------------------------------------------------
// SessionRecorder
// ---------------------------------------------------------------------------

export class SessionRecorder {
  private readonly events: ReplayEvent[] = [];
  private readonly sessionId: string;
  private readonly projectId: string;
  private readonly agentRole: string;
  private readonly startedAt: Date;

  constructor(sessionId: string, projectId: string, agentRole: string) {
    this.sessionId = sessionId;
    this.projectId = projectId;
    this.agentRole = agentRole;
    this.startedAt = new Date();

    this.addEvent("session_start", {
      sessionId,
      projectId,
      agentRole,
    });
  }

  /**
   * Record an event in the session timeline.
   */
  addEvent(
    kind: ReplayEventKind,
    payload: Record<string, unknown>
  ): ReplayEvent {
    const now = new Date();
    const event: ReplayEvent = {
      id: generateId("rev"),
      sessionId: this.sessionId,
      kind,
      timestamp: now.toISOString(),
      offsetMs: now.getTime() - this.startedAt.getTime(),
      payload,
    };

    this.events.push(event);

    logger.debug(
      {
        eventId: event.id,
        kind,
        offsetMs: event.offsetMs,
      },
      "Recorded replay event"
    );

    return event;
  }

  /**
   * Record a tool call event.
   */
  recordToolCall(toolName: string, args: Record<string, unknown>): ReplayEvent {
    return this.addEvent("tool_call", { tool: toolName, args });
  }

  /**
   * Record a tool result event.
   */
  recordToolResult(
    toolName: string,
    result: unknown,
    durationMs: number
  ): ReplayEvent {
    return this.addEvent("tool_result", {
      tool: toolName,
      result,
      durationMs,
    });
  }

  /**
   * Record a model request event.
   */
  recordModelRequest(
    model: string,
    tokenCount: number,
    slot: string
  ): ReplayEvent {
    return this.addEvent("model_request", { model, tokenCount, slot });
  }

  /**
   * Record a model response event.
   */
  recordModelResponse(
    model: string,
    tokensIn: number,
    tokensOut: number,
    durationMs: number
  ): ReplayEvent {
    return this.addEvent("model_response", {
      model,
      tokensIn,
      tokensOut,
      durationMs,
    });
  }

  /**
   * Record a decision event (agent planning, branching, etc.).
   */
  recordDecision(decision: string, reasoning: string): ReplayEvent {
    return this.addEvent("decision", { decision, reasoning });
  }

  /**
   * Record an error event.
   */
  recordError(error: string, context?: string): ReplayEvent {
    return this.addEvent("error", { error, context: context ?? "" });
  }

  /**
   * Finalize the recording and return the complete session recording.
   */
  finalize(outcome: string): SessionRecording {
    this.addEvent("session_end", { outcome });

    const durationMs = Date.now() - this.startedAt.getTime();

    logger.info(
      {
        sessionId: this.sessionId,
        eventCount: this.events.length,
        durationMs,
        outcome,
      },
      "Session recording finalized"
    );

    return {
      sessionId: this.sessionId,
      projectId: this.projectId,
      agentRole: this.agentRole,
      startedAt: this.startedAt.toISOString(),
      durationMs,
      events: [...this.events],
    };
  }

  /**
   * Get the number of recorded events so far.
   */
  getEventCount(): number {
    return this.events.length;
  }
}

// ---------------------------------------------------------------------------
// SessionReplayer
// ---------------------------------------------------------------------------

export class SessionReplayer {
  /**
   * Replay a recorded session, invoking the callback for each event.
   * When speed > 0, events are delayed proportionally to their real-time
   * offsets. When speed is 0, events fire instantly.
   */
  async replay(
    recording: SessionRecording,
    options: ReplayOptions
  ): Promise<{ eventsReplayed: number; durationMs: number }> {
    const startTime = Date.now();
    let previousOffset = 0;
    let eventsReplayed = 0;

    logger.info(
      {
        sessionId: recording.sessionId,
        eventCount: recording.events.length,
        speed: options.speed,
      },
      "Starting session replay"
    );

    for (const event of recording.events) {
      // Calculate inter-event delay
      if (options.speed > 0 && event.offsetMs > previousOffset) {
        const delay = (event.offsetMs - previousOffset) / options.speed;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, delay);
        });
      }
      previousOffset = event.offsetMs;

      if (options.onEvent) {
        await options.onEvent(event);
      }
      eventsReplayed++;
    }

    const durationMs = Date.now() - startTime;

    logger.info(
      {
        sessionId: recording.sessionId,
        eventsReplayed,
        durationMs,
      },
      "Session replay completed"
    );

    return { eventsReplayed, durationMs };
  }

  /**
   * Filter events from a recording by kind.
   */
  filterEvents(
    recording: SessionRecording,
    kinds: ReplayEventKind[]
  ): ReplayEvent[] {
    const kindSet = new Set(kinds);
    return recording.events.filter((e) => kindSet.has(e.kind));
  }

  /**
   * Generate a timeline summary of a session recording.
   */
  summarize(recording: SessionRecording): {
    durationMs: number;
    eventCounts: Record<string, number>;
    sessionId: string;
    toolCalls: Array<{ durationMs: number; tool: string }>;
  } {
    const eventCounts: Record<string, number> = {};
    const toolCalls: Array<{ tool: string; durationMs: number }> = [];

    for (const event of recording.events) {
      eventCounts[event.kind] = (eventCounts[event.kind] ?? 0) + 1;

      if (event.kind === "tool_result") {
        toolCalls.push({
          tool: String(event.payload.tool ?? "unknown"),
          durationMs: Number(event.payload.durationMs ?? 0),
        });
      }
    }

    return {
      sessionId: recording.sessionId,
      durationMs: recording.durationMs,
      eventCounts,
      toolCalls,
    };
  }
}
