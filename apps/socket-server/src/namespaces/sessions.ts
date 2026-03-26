import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
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

export function setupSessionNamespace(namespace: Namespace) {
  const subscriber = createRedisConnection();
  const publisher = createRedisConnection();

  // Track which session channels we've subscribed to
  const subscribedChannels = new Set<string>();

  // Re-subscribe to all tracked channels on Redis reconnect
  subscriber.on("ready", () => {
    if (subscribedChannels.size > 0) {
      logger.info(
        { channels: subscribedChannels.size },
        "Redis reconnected, re-subscribing to session channels"
      );
      for (const channel of subscribedChannels) {
        subscriber.subscribe(channel, (err) => {
          if (err) {
            logger.error(
              { channel, error: err.message },
              "Failed to re-subscribe on reconnect"
            );
          }
        });
      }
    }
  });

  subscriber.on("error", (err) => {
    logger.error(
      { error: err.message },
      "Redis subscriber error in sessions namespace"
    );
  });

  namespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    logger.info(
      { userId, socketId: socket.id },
      "Client connected to sessions namespace"
    );

    // ---- join: Join a session room to receive events ----
    socket.on("join_session", async (data: { sessionId: string }) => {
      const { sessionId } = data;
      await socket.join(`session:${sessionId}`);
      logger.debug({ userId, sessionId }, "Joined session room");

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
    });

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
        action: "approve" | "rollback" | "modify";
        modifications?: string;
      }) => {
        const channel = `session:${data.sessionId}:commands`;
        publisher.publish(
          channel,
          JSON.stringify({
            type: "checkpoint_response",
            userId,
            checkpointId: data.checkpointId,
            action: data.action,
            modifications: data.modifications,
            timestamp: new Date().toISOString(),
          })
        );

        namespace.to(`session:${data.sessionId}`).emit("checkpoint_resolved", {
          userId,
          checkpointId: data.checkpointId,
          action: data.action,
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
  subscriber.on("message", (channel: string, message: string) => {
    const match = channel.match(SESSION_EVENTS_CHANNEL_RE);
    if (match) {
      const sessionId = match[1];
      try {
        const event = JSON.parse(message);
        const eventType = event.type ?? "unknown";
        const eventData = event.data ?? event;

        // Relay the event to all clients in the session room
        namespace.to(`session:${sessionId}`).emit(eventType, eventData);

        // Also emit a generic 'session_event' for clients that want all events
        namespace.to(`session:${sessionId}`).emit("session_event", {
          type: eventType,
          data: eventData,
          agentRole: event.agentRole,
          timestamp: event.timestamp ?? new Date().toISOString(),
        });
      } catch (error) {
        logger.error({ channel, error }, "Failed to parse session event");
      }
    }
  });
}
