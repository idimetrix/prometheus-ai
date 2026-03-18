import { createServer } from "node:http";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import { createAdapter } from "@socket.io/redis-adapter";
import { Server } from "socket.io";
import { authMiddleware } from "./auth";
import { setupFleetNamespace } from "./namespaces/fleet";
import { setupNotificationNamespace } from "./namespaces/notifications";
import { setupSessionNamespace } from "./namespaces/sessions";

const logger = createLogger("socket-server");
const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingInterval: 25_000,
  pingTimeout: 20_000,
});

// Redis adapter for multi-instance scaling
function setupRedisAdapter() {
  try {
    const pubClient = createRedisConnection();
    const subClient = pubClient.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    logger.info("Redis adapter connected");
  } catch (_error) {
    logger.warn("Redis adapter not available, running single-instance mode");
  }
}

// Auth middleware on default namespace
io.use(authMiddleware);

// Set up namespaces with auth
const sessionsNs = io.of("/sessions");
sessionsNs.use(authMiddleware);
setupSessionNamespace(sessionsNs);

const fleetNs = io.of("/fleet");
fleetNs.use(authMiddleware);
setupFleetNamespace(fleetNs);

const notificationsNs = io.of("/notifications");
notificationsNs.use(authMiddleware);
setupNotificationNamespace(notificationsNs);

// Default namespace: connection status and global broadcasts
io.on("connection", (socket) => {
  const userId = socket.data.userId as string;
  logger.info(
    { userId, socketId: socket.id },
    "Client connected to default namespace"
  );

  // Join user's personal room for cross-namespace events
  socket.join(`user:${userId}`);

  socket.on("ping_server", () => {
    socket.emit("pong_server", { timestamp: new Date().toISOString() });
  });

  socket.on("disconnect", (reason) => {
    logger.debug(
      { userId, socketId: socket.id, reason },
      "Client disconnected from default namespace"
    );
  });
});

// Global Redis subscriber for cross-namespace events
function setupGlobalSubscriber() {
  try {
    const globalSub = createRedisConnection();

    // Subscribe to global broadcast channel
    globalSub.subscribe("global:broadcasts", (err) => {
      if (err) {
        logger.error(
          { error: err.message },
          "Failed to subscribe to global broadcasts"
        );
      }
    });

    globalSub.on("message", (channel: string, message: string) => {
      if (channel === "global:broadcasts") {
        try {
          const event = JSON.parse(message);
          // Broadcast to all connected clients
          io.emit(event.type ?? "broadcast", event.data ?? event);
        } catch (error) {
          logger.error({ channel, error }, "Failed to parse global broadcast");
        }
      }
    });

    logger.info("Global Redis subscriber connected");
  } catch (_error) {
    logger.warn("Global Redis subscriber not available");
  }
}

const port = Number(process.env.SOCKET_PORT ?? 4001);

Promise.all([setupRedisAdapter(), setupGlobalSubscriber()]).then(() => {
  httpServer.listen(port, () => {
    logger.info(`Socket.io server running on port ${port}`);
    logger.info("Namespaces: /sessions, /fleet, /notifications");
  });
});

// Graceful shutdown
const shutdown = () => {
  logger.info("Shutting down socket server...");
  io.close();
  httpServer.close();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
