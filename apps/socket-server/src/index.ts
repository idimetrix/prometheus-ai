import { createServer } from "node:http";
import { Server } from "socket.io";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import { createAdapter } from "@socket.io/redis-adapter";
import { setupSessionNamespace } from "./namespaces/sessions";
import { setupFleetNamespace } from "./namespaces/fleet";
import { setupNotificationNamespace } from "./namespaces/notifications";
import { authMiddleware } from "./auth";

const logger = createLogger("socket-server");
const httpServer = createServer();

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// Redis adapter for multi-instance scaling
async function setupRedisAdapter() {
  try {
    const pubClient = createRedisConnection();
    const subClient = pubClient.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    logger.info("Redis adapter connected");
  } catch (error) {
    logger.warn("Redis adapter not available, running single-instance mode");
  }
}

// Auth middleware
io.use(authMiddleware);

// Set up namespaces
const sessionsNs = io.of("/sessions");
sessionsNs.use(authMiddleware);
setupSessionNamespace(sessionsNs);

const fleetNs = io.of("/fleet");
fleetNs.use(authMiddleware);
setupFleetNamespace(fleetNs);

const notificationsNs = io.of("/notifications");
notificationsNs.use(authMiddleware);
setupNotificationNamespace(notificationsNs);

const port = Number(process.env.SOCKET_PORT ?? 4001);

setupRedisAdapter().then(() => {
  httpServer.listen(port, () => {
    logger.info(`Socket.io server running on port ${port}`);
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
