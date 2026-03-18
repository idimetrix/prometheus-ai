import type { Namespace } from "socket.io";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";

const logger = createLogger("socket-server:fleet");

export function setupFleetNamespace(namespace: Namespace) {
  const subscriber = createRedisConnection();

  namespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    const orgId = socket.data.orgId as string | null;
    logger.info({ userId, socketId: socket.id }, "Client connected to fleet namespace");

    // Join org room for fleet-wide updates
    if (orgId) {
      socket.join(`org:${orgId}:fleet`);
    }

    // Request fleet status
    socket.on("get_status", () => {
      // TODO: Query orchestrator for active agents
      socket.emit("fleet_status", {
        activeAgents: 0,
        queuedTasks: 0,
        totalCreditsUsed: 0,
        agents: [],
      });
    });

    socket.on("disconnect", () => {
      logger.debug({ userId, socketId: socket.id }, "Client disconnected from fleet");
    });
  });

  // Subscribe to fleet events channel
  subscriber.subscribe("fleet:events", (err) => {
    if (err) logger.error({ error: err.message }, "Failed to subscribe to fleet channel");
  });

  subscriber.on("message", (channel: string, message: string) => {
    if (channel === "fleet:events") {
      try {
        const event = JSON.parse(message);
        // Broadcast to all connected fleet clients in the relevant org
        if (event.orgId) {
          namespace.to(`org:${event.orgId}:fleet`).emit(event.type, event.data);
        }
      } catch (error) {
        logger.error({ channel, error }, "Failed to parse fleet event");
      }
    }
  });
}
