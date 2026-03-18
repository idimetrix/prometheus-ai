import type { Namespace } from "socket.io";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";

const logger = createLogger("socket-server:notifications");

export function setupNotificationNamespace(namespace: Namespace) {
  const subscriber = createRedisConnection();

  namespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    logger.info({ userId, socketId: socket.id }, "Client connected to notifications");

    // Join user-specific notification room
    socket.join(`user:${userId}:notifications`);

    // Mark notification as read
    socket.on("mark_read", (data: { notificationId: string }) => {
      logger.debug({ userId, notificationId: data.notificationId }, "Notification marked as read");
      // Broadcast read status to other user sessions
      socket.to(`user:${userId}:notifications`).emit("notification_read", {
        notificationId: data.notificationId,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("disconnect", () => {
      logger.debug({ userId, socketId: socket.id }, "Client disconnected from notifications");
    });
  });

  // Subscribe to notification events
  subscriber.psubscribe("user:*:notifications", (err) => {
    if (err) logger.error({ error: err.message }, "Failed to subscribe to notification channels");
  });

  subscriber.on("pmessage", (_pattern: string, channel: string, message: string) => {
    // Channel format: user:{userId}:notifications
    const match = channel.match(/^user:(.+):notifications$/);
    if (match) {
      const userId = match[1];
      try {
        const event = JSON.parse(message);
        namespace.to(`user:${userId}:notifications`).emit("notification", event);
      } catch (error) {
        logger.error({ channel, error }, "Failed to parse notification event");
      }
    }
  });
}
