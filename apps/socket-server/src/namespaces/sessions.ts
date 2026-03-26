import { createLogger } from "@prometheus/logger";
import { createRedisConnection, EventStream } from "@prometheus/queue";
import type { Namespace } from "socket.io";

const logger = createLogger("socket-server:sessions");

const SESSION_EVENTS_CHANNEL_RE = /^session:(.+):events$/;

// ---------------------------------------------------------------------------
// Per-socket message rate limiter (sliding window, 1-second granularity)
// ---------------------------------------------------------------------------
const MAX_MESSAGES_PER_SECOND = 50;

interface RateWindow {
  count: number;
  windowStart: number;
}

const socketRateMap = new Map<string, RateWindow>();

/**
 * Check whether a socket has exceeded the message rate limit.
 * Uses a simple sliding window counter per socket per second.
 * Returns `true` if the message should be allowed, `false` if it should be dropped.
 */
function checkSocketRateLimit(socketId: string): boolean {
  const now = Date.now();
  const window = socketRateMap.get(socketId);

  if (!window || now - window.windowStart >= 1000) {
    // New window
    socketRateMap.set(socketId, { count: 1, windowStart: now });
    return true;
  }

  window.count++;
  if (window.count > MAX_MESSAGES_PER_SECOND) {
    return false;
  }
  return true;
}

/** Clean up rate tracking state for a disconnected socket */
function cleanupSocketRate(socketId: string): void {
  socketRateMap.delete(socketId);
}

/**
 * Replay missed events from Redis Streams to a specific socket.
 * Called when a client reconnects with a lastEventId.
 */
async function replayMissedEvents(
  socket: { emit: (event: string, data: unknown) => void },
  sessionId: string,
  lastEventId: string
): Promise<void> {
  const eventStream = new EventStream();
  const missedEvents = await eventStream.readAfter(sessionId, lastEventId);
  logger.info(
    { sessionId, lastEventId, replayed: missedEvents.length },
    "Replaying missed WebSocket events"
  );
  for (const missed of missedEvents) {
    const eventType = missed.type ?? "message";
    const eventData = missed.data ?? missed;
    socket.emit("session_event", {
      type: eventType,
      data: eventData,
      sequence: missed.sequence,
      timestamp: missed.timestamp ?? new Date().toISOString(),
      replayed: true,
    });
  }
}

export function setupSessionNamespace(namespace: Namespace) {
  const subscriber = createRedisConnection();
  const publisher = createRedisConnection();

  // Track which session channels we've subscribed to
  const subscribedChannels = new Set<string>();

  namespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    logger.info(
      { userId, socketId: socket.id },
      "Client connected to sessions namespace"
    );

    // ---- join: Join a session room to receive events ----
    socket.on(
      "join_session",
      async (data: { sessionId: string; lastEventId?: string }) => {
        const { sessionId, lastEventId } = data;
        await socket.join(`session:${sessionId}`);
        logger.debug({ userId, sessionId, lastEventId }, "Joined session room");

        // Subscribe to Redis channels for this session (events + commands relay)
        const eventsChannel = `session:${sessionId}:events`;
        if (!subscribedChannels.has(eventsChannel)) {
          subscriber.subscribe(eventsChannel, (err) => {
            if (err) {
              logger.error(
                { sessionId, error: err.message },
                "Failed to subscribe to session events channel"
              );
            } else {
              subscribedChannels.add(eventsChannel);
            }
          });
        }

        // Replay missed events from Redis Streams if lastEventId is provided
        if (lastEventId && lastEventId !== "0") {
          try {
            await replayMissedEvents(socket, sessionId, lastEventId);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error(
              { sessionId, lastEventId, error: msg },
              "Failed to replay missed WebSocket events"
            );
          }
        }

        // Notify others in the session
        socket.to(`session:${sessionId}`).emit("user_joined", {
          userId,
          timestamp: new Date().toISOString(),
        });

        // Acknowledge join
        socket.emit("session_joined", {
          sessionId,
          timestamp: new Date().toISOString(),
        });
      }
    );

    // ---- leave: Leave a session room ----
    socket.on("leave_session", async (data: { sessionId: string }) => {
      const { sessionId } = data;
      await socket.leave(`session:${sessionId}`);
      socket.to(`session:${sessionId}`).emit("user_left", {
        userId,
        timestamp: new Date().toISOString(),
      });
      logger.debug({ userId, sessionId }, "Left session room");
    });

    // ---- message: Send a message/command to the agent ----
    socket.on(
      "send_message",
      (data: {
        sessionId: string;
        content: string;
        metadata?: Record<string, unknown>;
      }) => {
        if (!checkSocketRateLimit(socket.id)) {
          socket.emit("rate_limit_warning", {
            message: `Message rate limit exceeded (${MAX_MESSAGES_PER_SECOND} msg/s). Message dropped.`,
            timestamp: new Date().toISOString(),
          });
          logger.warn(
            { userId, socketId: socket.id },
            "Socket message rate limit exceeded, dropping message"
          );
          return;
        }

        const channel = `session:${data.sessionId}:commands`;
        const message = JSON.stringify({
          type: "user_message",
          userId,
          content: data.content,
          metadata: data.metadata,
          timestamp: new Date().toISOString(),
        });
        publisher.publish(channel, message);

        // Also broadcast to other users watching the session
        socket.to(`session:${data.sessionId}`).emit("user_message", {
          userId,
          content: data.content,
          timestamp: new Date().toISOString(),
        });
      }
    );

    // ---- terminal_command: Send terminal command to agent ----
    socket.on(
      "terminal_command",
      (data: { sessionId: string; command: string }) => {
        if (!checkSocketRateLimit(socket.id)) {
          socket.emit("rate_limit_warning", {
            message: `Message rate limit exceeded (${MAX_MESSAGES_PER_SECOND} msg/s). Message dropped.`,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        const channel = `session:${data.sessionId}:commands`;
        publisher.publish(
          channel,
          JSON.stringify({
            type: "terminal_command",
            userId,
            command: data.command,
            timestamp: new Date().toISOString(),
          })
        );

        // Notify room
        namespace
          .to(`session:${data.sessionId}`)
          .emit("terminal_command_sent", {
            userId,
            command: data.command,
            timestamp: new Date().toISOString(),
          });

        logger.info(
          { userId, sessionId: data.sessionId },
          "Terminal command override sent"
        );
      }
    );

    // ---- takeover: User takes control, agent pauses ----
    socket.on("takeover", (data: { sessionId: string }) => {
      const channel = `session:${data.sessionId}:commands`;
      publisher.publish(
        channel,
        JSON.stringify({
          type: "takeover",
          userId,
          timestamp: new Date().toISOString(),
        })
      );
      namespace.to(`session:${data.sessionId}`).emit("session_takeover", {
        userId,
        timestamp: new Date().toISOString(),
      });
      logger.info(
        { userId, sessionId: data.sessionId },
        "Session takeover initiated"
      );
    });

    // ---- release: Return control to agent ----
    socket.on("release", (data: { sessionId: string }) => {
      const channel = `session:${data.sessionId}:commands`;
      publisher.publish(
        channel,
        JSON.stringify({
          type: "release",
          userId,
          timestamp: new Date().toISOString(),
        })
      );
      namespace.to(`session:${data.sessionId}`).emit("session_released", {
        userId,
        timestamp: new Date().toISOString(),
      });
      logger.info({ userId, sessionId: data.sessionId }, "Session released");
    });

    // ---- approve_plan: Approve a plan step ----
    socket.on(
      "approve_plan",
      (data: { sessionId: string; stepId?: string; approved: boolean }) => {
        const channel = `session:${data.sessionId}:commands`;
        publisher.publish(
          channel,
          JSON.stringify({
            type: "approve_plan",
            userId,
            stepId: data.stepId,
            approved: data.approved ?? true,
            timestamp: new Date().toISOString(),
          })
        );

        namespace.to(`session:${data.sessionId}`).emit("plan_approval", {
          userId,
          stepId: data.stepId,
          approved: data.approved ?? true,
          timestamp: new Date().toISOString(),
        });
      }
    );

    // ---- checkpoint_response: Respond to a checkpoint request ----
    socket.on(
      "checkpoint_response",
      (data: {
        sessionId: string;
        checkpointId: string;
        action: "approve" | "reject" | "modify";
        message?: string;
        modifications?: string;
      }) => {
        // Normalize action: "rollback" was an old alias for "reject"
        const normalizedAction =
          data.action === "reject" ? "reject" : data.action;

        const channel = `session:${data.sessionId}:commands`;
        publisher.publish(
          channel,
          JSON.stringify({
            type: "checkpoint_response",
            userId,
            checkpointId: data.checkpointId,
            action: normalizedAction,
            message: data.message,
            modifications: data.modifications,
            timestamp: new Date().toISOString(),
          })
        );

        // Publish to dedicated checkpoint resolution channel so the
        // CheckpointManager in the orchestrator can resolve the pending
        // promise and resume the agent loop.
        publisher.publish(
          "checkpoint:resolution",
          JSON.stringify({
            checkpointId: data.checkpointId,
            response: {
              action: normalizedAction,
              message: data.message ?? data.modifications,
              respondedBy: userId,
            },
          })
        );

        namespace.to(`session:${data.sessionId}`).emit("checkpoint_resolved", {
          userId,
          checkpointId: data.checkpointId,
          action: normalizedAction,
          timestamp: new Date().toISOString(),
        });
      }
    );

    // ---- pause: Pause the session/agent ----
    socket.on("pause_session", (data: { sessionId: string }) => {
      const channel = `session:${data.sessionId}:commands`;
      publisher.publish(
        channel,
        JSON.stringify({
          type: "pause",
          userId,
          timestamp: new Date().toISOString(),
        })
      );

      namespace.to(`session:${data.sessionId}`).emit("session_paused", {
        userId,
        timestamp: new Date().toISOString(),
      });
      logger.info({ userId, sessionId: data.sessionId }, "Session paused");
    });

    // ---- resume: Resume the session/agent ----
    socket.on("resume_session", (data: { sessionId: string }) => {
      const channel = `session:${data.sessionId}:commands`;
      publisher.publish(
        channel,
        JSON.stringify({
          type: "resume",
          userId,
          timestamp: new Date().toISOString(),
        })
      );

      namespace.to(`session:${data.sessionId}`).emit("session_resumed", {
        userId,
        timestamp: new Date().toISOString(),
      });
      logger.info({ userId, sessionId: data.sessionId }, "Session resumed");
    });

    // ---- human_input_response: Respond to agent's human-input request ----
    socket.on(
      "agent:human-input-response",
      (data: {
        sessionId: string;
        requestId: string;
        action: "approve" | "reject" | "respond";
        message: string;
      }) => {
        const channel = `session:${data.sessionId}:commands`;
        publisher.publish(
          channel,
          JSON.stringify({
            type: "human_input_response",
            userId,
            requestId: data.requestId,
            action: data.action,
            message: data.message,
            timestamp: new Date().toISOString(),
          })
        );

        namespace.to(`session:${data.sessionId}`).emit("human_input_resolved", {
          userId,
          requestId: data.requestId,
          action: data.action,
          timestamp: new Date().toISOString(),
        });

        logger.info(
          {
            userId,
            sessionId: data.sessionId,
            action: data.action,
          },
          "Human input response sent"
        );
      }
    );

    // ---- typing: Typing indicator ----
    socket.on("typing", (data: { sessionId: string; isTyping: boolean }) => {
      socket.to(`session:${data.sessionId}`).emit("user_typing", {
        userId,
        isTyping: data.isTyping,
        timestamp: new Date().toISOString(),
      });
    });

    // ---- disconnect: Cleanup ----
    socket.on("disconnect", () => {
      cleanupSocketRate(socket.id);
      logger.debug(
        { userId, socketId: socket.id },
        "Client disconnected from sessions"
      );
    });
  });

  // ---- Relay Redis pub/sub events to Socket.io rooms ----
  // All known agent streaming event types for structured handling
  const AGENT_EVENT_TYPES = new Set([
    "agent_output",
    "agent_status",
    "agent:thinking",
    "agent:terminal",
    "agent:file-change",
    "agent:progress",
    "task:complete",
    "task:created",
    "session:checkpoint",
    "session:error",
    "file_change",
    "file_diff",
    "code_change",
    "plan_update",
    "plan_step_update",
    "task_status",
    "task_progress",
    "queue_position",
    "credit_update",
    "checkpoint",
    "checkpoint_resolved",
    "error",
    "reasoning",
    "terminal_output",
    "session_complete",
    "session_resume",
    "tool_call",
    "tool_result",
    "browser_screenshot",
    "pr_created",
    "human_input_request",
    "human_input_resolved",
  ]);

  /**
   * Emit canonical agent streaming events based on the internal event type.
   * Extracted to a standalone function to reduce cognitive complexity.
   */
  function emitCanonicalEvent(
    room: string,
    eventType: string,
    eventData: Record<string, unknown>,
    event: Record<string, unknown>
  ): void {
    const ts = (event.timestamp as string) ?? new Date().toISOString();
    const seq = event.sequence;
    const role = (eventData.agentRole as string) ?? (event.agentRole as string);

    switch (eventType) {
      case "agent_output":
        if (eventData.streaming) {
          namespace.to(room).emit("agent:thinking", {
            content: eventData.content,
            agentRole: role,
            streaming: true,
            sequence: seq,
            timestamp: ts,
          });
        }
        break;
      case "terminal_output":
        namespace.to(room).emit("agent:terminal", {
          command: eventData.command,
          output: eventData.output,
          success: eventData.success,
          sequence: seq,
          timestamp: ts,
        });
        break;
      case "file_change":
        namespace.to(room).emit("agent:file-change", {
          filePath: eventData.filePath,
          tool: eventData.tool,
          diff: eventData.diff,
          agentRole: role,
          sequence: seq,
          timestamp: ts,
        });
        break;
      case "task_progress":
      case "agent_status":
        if (eventData.iteration !== undefined || eventData.step !== undefined) {
          namespace.to(room).emit("agent:progress", {
            step: eventData.step ?? eventData.iteration,
            totalSteps: eventData.totalSteps,
            status: eventData.status,
            agentRole: role,
            confidence: eventData.confidence,
            sequence: seq,
            timestamp: ts,
          });
        }
        break;
      case "session_complete":
        namespace.to(room).emit("task:complete", {
          success: eventData.success,
          output: eventData.output,
          filesChanged: eventData.filesChanged,
          tokensUsed: eventData.tokensUsed,
          toolCalls: eventData.toolCalls,
          steps: eventData.steps,
          status: eventData.status,
          agentRole: role,
          sequence: seq,
          timestamp: ts,
        });
        break;
      case "task_status":
        if (eventData.status === "queued" || eventData.status === "created") {
          namespace.to(room).emit("task:created", {
            taskId: eventData.taskId,
            status: eventData.status,
            sequence: seq,
            timestamp: ts,
          });
        }
        break;
      case "checkpoint":
        namespace.to(room).emit("session:checkpoint", {
          checkpointType: eventData.checkpointType,
          reason: eventData.reason,
          affectedFiles: eventData.affectedFiles,
          agentRole: role,
          sequence: seq,
          timestamp: ts,
        });
        break;
      case "error":
        namespace.to(room).emit("session:error", {
          error: eventData.error ?? eventData.reason ?? eventData.message,
          recoverable: eventData.recoverable,
          agentRole: role,
          sequence: seq,
          timestamp: ts,
        });
        break;
      default:
        break;
    }
  }

  subscriber.on("message", (channel: string, message: string) => {
    const match = channel.match(SESSION_EVENTS_CHANNEL_RE);
    if (!match) {
      return;
    }

    const sessionId = match[1];
    try {
      const event = JSON.parse(message);
      const eventType = event.type ?? "unknown";
      const eventData = event.data ?? event;
      const room = `session:${sessionId}`;

      // Emit canonical agent streaming event (if applicable)
      emitCanonicalEvent(room, eventType, eventData, event);

      // Relay the raw event for backward compat
      namespace.to(room).emit(eventType, eventData);

      // Always emit a generic 'session_event' for clients that want all events
      namespace.to(room).emit("session_event", {
        type: eventType,
        data: eventData,
        agentRole: event.agentRole,
        sequence: event.sequence,
        timestamp: event.timestamp ?? new Date().toISOString(),
      });

      if (!AGENT_EVENT_TYPES.has(eventType)) {
        logger.debug(
          { sessionId, eventType },
          "Relayed unrecognized event type"
        );
      }
    } catch (error) {
      logger.error({ channel, error }, "Failed to parse session event");
    }
  });
}
