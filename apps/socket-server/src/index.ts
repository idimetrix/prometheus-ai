import { createServer } from "node:http";
import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import {
  initSentry,
  initTelemetry,
  metricsRegistry,
} from "@prometheus/telemetry";
import {
  installShutdownHandlers,
  isProcessShuttingDown,
  registerShutdownHandler,
} from "@prometheus/utils";
import { createAdapter } from "@socket.io/redis-adapter";
// MessagePack binary protocol for improved WebSocket performance (Phase 5.3)
// Reduces payload size by ~30-40% compared to JSON for typical messages.
// Install: pnpm add @socket.io/msgpack-parser
// import { createParser } from "@socket.io/msgpack-parser";
import { Server } from "socket.io";
import { authMiddleware } from "./auth";
import { setupFleetNamespace } from "./namespaces/fleet";
import { setupNotificationNamespace } from "./namespaces/notifications";
import { setupSessionNamespace } from "./namespaces/sessions";
import { mountYjsServer } from "./yjs-server";

await initTelemetry({ serviceName: "socket-server" });
initSentry({ serviceName: "socket-server" });
installShutdownHandlers();

const logger = createLogger("socket-server");
const healthRedis = createRedisConnection();
const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    if (isProcessShuttingDown()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "draining" }));
      return;
    }
    // Async health check with Redis dependency verification
    (async () => {
      const dependencies: Record<string, string> = {};
      try {
        await healthRedis.ping();
        dependencies.redis = "ok";
      } catch {
        dependencies.redis = "unavailable";
      }
      const allHealthy = Object.values(dependencies).every((v) => v === "ok");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: allHealthy ? "ok" : "degraded",
          service: "socket-server",
          version: process.env.APP_VERSION ?? "0.0.0",
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
          dependencies,
        })
      );
    })();
    return;
  }
  if (req.url === "/live") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (req.url === "/ready") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ready" }));
    return;
  }
  if (req.url === "/metrics") {
    metricsRegistry
      .render()
      .then((body) => {
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(500);
        res.end("Failed to render metrics");
      });
    return;
  }
});

const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
    credentials: true,
  },
  transports: ["websocket", "polling"],
  pingInterval: 25_000,
  pingTimeout: 20_000,
  maxHttpBufferSize: 1_048_576, // 1MB
  // Enable MessagePack binary protocol for reduced payload size.
  // Requires @socket.io/msgpack-parser on both server and client.
  // Client must also use: import { createParser } from "@socket.io/msgpack-parser";
  //   const socket = io({ parser: createParser() });
  // parser: createParser(),
});

// Per-user connection tracking (max 5 connections per user)
const MAX_CONNECTIONS_PER_USER = 5;
const userConnections = new Map<string, Set<string>>();

function trackConnection(userId: string, socketId: string): boolean {
  if (!userConnections.has(userId)) {
    userConnections.set(userId, new Set());
  }
  const connections = userConnections.get(userId) ?? new Set<string>();
  if (connections.size >= MAX_CONNECTIONS_PER_USER) {
    return false;
  }
  connections.add(socketId);
  return true;
}

function untrackConnection(userId: string, socketId: string): void {
  const connections = userConnections.get(userId);
  if (connections) {
    connections.delete(socketId);
    if (connections.size === 0) {
      userConnections.delete(userId);
    }
  }
}

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

  // Enforce per-user connection limit
  if (!trackConnection(userId, socket.id)) {
    logger.warn(
      { userId, socketId: socket.id, limit: MAX_CONNECTIONS_PER_USER },
      "Connection limit exceeded, disconnecting"
    );
    socket.emit("error", { message: "Too many connections" });
    socket.disconnect(true);
    return;
  }

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
    untrackConnection(userId, socket.id);
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
  // Mount Yjs CRDT collaboration WebSocket server on /yjs/:docId
  mountYjsServer(httpServer);

  httpServer.listen(port, () => {
    logger.info(`Socket.io server running on port ${port}`);
    logger.info("Namespaces: /sessions, /fleet, /notifications");
    logger.info("Yjs collaboration server mounted on /yjs/:docId");
  });
});

// Register custom cleanup with the centralized shutdown handler
registerShutdownHandler("socket-server", () => {
  logger.info("Shutting down socket server...");
  io.close();
  httpServer.close();
  return Promise.resolve();
});
