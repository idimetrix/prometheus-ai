import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import type { Namespace } from "socket.io";

const logger = createLogger("socket-server:notifications");

const USER_NOTIFICATION_CHANNEL_RE = /^user:(.+):notifications$/;
const ORG_NOTIFICATION_CHANNEL_RE = /^org:(.+):notifications$/;

export function setupNotificationNamespace(namespace: Namespace) {
  const subscriber = createRedisConnection();

  namespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    const orgId = socket.data.orgId as string | null;
    logger.info(
      { userId, socketId: socket.id },
      "Client connected to notifications"
    );

    // Join user-specific notification room
    socket.join(`user:${userId}:notifications`);

    // Also join org-level notification room if applicable
    if (orgId) {
      socket.join(`org:${orgId}:notifications`);
    }

    // Mark notification as read
    socket.on("mark_read", (data: { notificationId: string }) => {
      logger.debug(
        { userId, notificationId: data.notificationId },
        "Notification marked as read"
      );
      // Broadcast read status to other user sessions
      socket.to(`user:${userId}:notifications`).emit("notification_read", {
        notificationId: data.notificationId,
        timestamp: new Date().toISOString(),
      });
    });

    // Mark all notifications as read
    socket.on("mark_all_read", () => {
      logger.debug({ userId }, "All notifications marked as read");
      socket.to(`user:${userId}:notifications`).emit("all_notifications_read", {
        timestamp: new Date().toISOString(),
      });
    });

    // Dismiss notification
    socket.on("dismiss", (data: { notificationId: string }) => {
      socket.to(`user:${userId}:notifications`).emit("notification_dismissed", {
        notificationId: data.notificationId,
        timestamp: new Date().toISOString(),
      });
    });

    socket.on("disconnect", () => {
      logger.debug(
        { userId, socketId: socket.id },
        "Client disconnected from notifications"
      );
    });
  });

  // Subscribe to user notification events
  subscriber.psubscribe("user:*:notifications", (err) => {
    if (err) {
      logger.error(
        { error: err.message },
        "Failed to subscribe to user notification channels"
      );
    }
  });

  // Subscribe to org notification events
  subscriber.psubscribe("org:*:notifications", (err) => {
    if (err) {
      logger.error(
        { error: err.message },
        "Failed to subscribe to org notification channels"
      );
    }
  });

  subscriber.on(
    "pmessage",
    (_pattern: string, channel: string, message: string) => {
      // User notification: user:{userId}:notifications
      const userMatch = channel.match(USER_NOTIFICATION_CHANNEL_RE);
      if (userMatch) {
        const userId = userMatch[1];
        try {
          const event = JSON.parse(message);
          namespace
            .to(`user:${userId}:notifications`)
            .emit("notification", event);
        } catch (error) {
          logger.error(
            { channel, error },
            "Failed to parse user notification event"
          );
        }
        return;
      }

      // Org notification: org:{orgId}:notifications
      const orgMatch = channel.match(ORG_NOTIFICATION_CHANNEL_RE);
      if (orgMatch) {
        const orgId = orgMatch[1];
        try {
          const event = JSON.parse(message);
          namespace
            .to(`org:${orgId}:notifications`)
            .emit("org_notification", event);
        } catch (error) {
          logger.error(
            { channel, error },
            "Failed to parse org notification event"
          );
        }
      }
    }
  );
}
