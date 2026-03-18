import type { Namespace } from "socket.io";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";

const logger = createLogger("socket-server:sessions");

export function setupSessionNamespace(namespace: Namespace) {
  const subscriber = createRedisConnection();
  const publisher = createRedisConnection();

  namespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    logger.info({ userId, socketId: socket.id }, "Client connected to sessions namespace");

    // Join a session room to receive events
    socket.on("join_session", async (data: { sessionId: string }) => {
      const { sessionId } = data;
      await socket.join(`session:${sessionId}`);
      logger.debug({ userId, sessionId }, "Joined session room");

      // Subscribe to Redis channel for this session
      const channel = `session:${sessionId}:events`;
      subscriber.subscribe(channel, (err) => {
        if (err) {
          logger.error({ sessionId, error: err.message }, "Failed to subscribe to session channel");
        }
      });

      // Notify others in the session
      socket.to(`session:${sessionId}`).emit("user_joined", {
        userId,
        timestamp: new Date().toISOString(),
      });
    });

    // Leave a session room
    socket.on("leave_session", async (data: { sessionId: string }) => {
      const { sessionId } = data;
      await socket.leave(`session:${sessionId}`);
      socket.to(`session:${sessionId}`).emit("user_left", {
        userId,
        timestamp: new Date().toISOString(),
      });
      logger.debug({ userId, sessionId }, "Left session room");
    });

    // Send a message/command to the agent
    socket.on("send_message", (data: { sessionId: string; content: string }) => {
      const channel = `session:${data.sessionId}:commands`;
      const message = JSON.stringify({
        type: "user_message",
        userId,
        content: data.content,
        timestamp: new Date().toISOString(),
      });
      publisher.publish(channel, message);
    });

    // Override: send terminal command to agent
    socket.on("terminal_command", (data: { sessionId: string; command: string }) => {
      const channel = `session:${data.sessionId}:commands`;
      publisher.publish(channel, JSON.stringify({
        type: "terminal_command",
        userId,
        command: data.command,
        timestamp: new Date().toISOString(),
      }));
      logger.info({ userId, sessionId: data.sessionId }, "Terminal command override sent");
    });

    // Takeover: user takes control, agent pauses
    socket.on("takeover", (data: { sessionId: string }) => {
      const channel = `session:${data.sessionId}:commands`;
      publisher.publish(channel, JSON.stringify({
        type: "takeover",
        userId,
        timestamp: new Date().toISOString(),
      }));
      namespace.to(`session:${data.sessionId}`).emit("session_takeover", {
        userId,
        timestamp: new Date().toISOString(),
      });
      logger.info({ userId, sessionId: data.sessionId }, "Session takeover initiated");
    });

    // Release: return control to agent
    socket.on("release", (data: { sessionId: string }) => {
      const channel = `session:${data.sessionId}:commands`;
      publisher.publish(channel, JSON.stringify({
        type: "release",
        userId,
        timestamp: new Date().toISOString(),
      }));
      namespace.to(`session:${data.sessionId}`).emit("session_released", {
        userId,
        timestamp: new Date().toISOString(),
      });
    });

    // Approve plan step
    socket.on("approve_plan", (data: { sessionId: string; stepId?: string }) => {
      const channel = `session:${data.sessionId}:commands`;
      publisher.publish(channel, JSON.stringify({
        type: "approve_plan",
        userId,
        stepId: data.stepId,
        timestamp: new Date().toISOString(),
      }));
    });

    // Request checkpoint
    socket.on("checkpoint", (data: { sessionId: string }) => {
      const channel = `session:${data.sessionId}:commands`;
      publisher.publish(channel, JSON.stringify({
        type: "checkpoint",
        userId,
        timestamp: new Date().toISOString(),
      }));
    });

    // Pause session
    socket.on("pause_session", (data: { sessionId: string }) => {
      const channel = `session:${data.sessionId}:commands`;
      publisher.publish(channel, JSON.stringify({
        type: "pause",
        userId,
        timestamp: new Date().toISOString(),
      }));
    });

    // Resume session
    socket.on("resume_session", (data: { sessionId: string }) => {
      const channel = `session:${data.sessionId}:commands`;
      publisher.publish(channel, JSON.stringify({
        type: "resume",
        userId,
        timestamp: new Date().toISOString(),
      }));
    });

    socket.on("disconnect", () => {
      logger.debug({ userId, socketId: socket.id }, "Client disconnected from sessions");
    });
  });

  // Relay Redis pub/sub events to Socket.io rooms
  subscriber.on("message", (channel: string, message: string) => {
    const match = channel.match(/^session:(.+):events$/);
    if (match) {
      const sessionId = match[1];
      try {
        const event = JSON.parse(message);
        namespace.to(`session:${sessionId}`).emit(event.type, event.data ?? event);
      } catch (error) {
        logger.error({ channel, error }, "Failed to parse session event");
      }
    }
  });
}
