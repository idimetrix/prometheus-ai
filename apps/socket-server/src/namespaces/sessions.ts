import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import type { Namespace } from "socket.io";

const logger = createLogger("socket-server:sessions");

const SESSION_EVENTS_CHANNEL_RE = /^session:(.+):events$/;

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
