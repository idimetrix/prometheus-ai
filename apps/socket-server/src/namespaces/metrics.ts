import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import type { Namespace } from "socket.io";

const logger = createLogger("socket-server:metrics");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Metrics broadcast interval (ms) — 1 update per second */
const METRICS_INTERVAL_MS = 1000;

/** Redis key for aggregated system metrics */
const METRICS_KEY = "system:metrics";

/** Redis channel for metrics push from other services */
const METRICS_CHANNEL = "metrics:updates";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SystemMetrics {
  activeAgents: number;
  activeSessions: number;
  avgLatencyMs: number;
  creditsConsumed: number;
  errorRate: number;
  queueDepth: number;
  requestsPerMinute: number;
  timestamp: number;
  tokensIn: number;
  tokensOut: number;
  uptime: number;
}

// ---------------------------------------------------------------------------
// In-memory metrics state (updated from Redis or direct pushes)
// ---------------------------------------------------------------------------

const currentMetrics: SystemMetrics = {
  activeSessions: 0,
  activeAgents: 0,
  queueDepth: 0,
  creditsConsumed: 0,
  tokensIn: 0,
  tokensOut: 0,
  requestsPerMinute: 0,
  errorRate: 0,
  avgLatencyMs: 0,
  uptime: 0,
  timestamp: Date.now(),
};

// ---------------------------------------------------------------------------
// Redis subscriber for metrics updates
// ---------------------------------------------------------------------------

function setupMetricsSubscriber(): void {
  try {
    const subscriber = createRedisConnection();
    const reader = createRedisConnection();

    // Subscribe to push-based metrics updates from other services
    subscriber.subscribe(METRICS_CHANNEL, (err) => {
      if (err) {
        logger.error(
          { error: err.message },
          "Failed to subscribe to metrics channel"
        );
      }
    });

    subscriber.on("message", (channel: string, message: string) => {
      if (channel !== METRICS_CHANNEL) {
        return;
      }

      try {
        const update = JSON.parse(message) as Partial<SystemMetrics>;
        applyMetricsUpdate(update);
      } catch (error) {
        logger.error({ error }, "Failed to parse metrics update");
      }
    });

    // Also poll Redis hash for aggregated metrics (services may write directly)
    const pollInterval = setInterval(async () => {
      try {
        const data = await reader.hgetall(METRICS_KEY);
        if (data && Object.keys(data).length > 0) {
          const update: Partial<SystemMetrics> = {};
          for (const [key, value] of Object.entries(data)) {
            const numValue = Number(value);
            if (!Number.isNaN(numValue)) {
              (update as Record<string, number>)[key] = numValue;
            }
          }
          applyMetricsUpdate(update);
        }
      } catch {
        // Redis may not be available — metrics will use local state
      }
    }, METRICS_INTERVAL_MS * 5); // Poll 5x slower than broadcast

    // Cleanup
    process.on("beforeExit", () => {
      clearInterval(pollInterval);
    });

    logger.info("Metrics Redis subscriber connected");
  } catch {
    logger.warn("Redis not available for metrics, using local state only");
  }
}

function applyMetricsUpdate(update: Partial<SystemMetrics>): void {
  if (update.activeSessions !== undefined) {
    currentMetrics.activeSessions = update.activeSessions;
  }
  if (update.activeAgents !== undefined) {
    currentMetrics.activeAgents = update.activeAgents;
  }
  if (update.queueDepth !== undefined) {
    currentMetrics.queueDepth = update.queueDepth;
  }
  if (update.creditsConsumed !== undefined) {
    currentMetrics.creditsConsumed = update.creditsConsumed;
  }
  if (update.tokensIn !== undefined) {
    currentMetrics.tokensIn = update.tokensIn;
  }
  if (update.tokensOut !== undefined) {
    currentMetrics.tokensOut = update.tokensOut;
  }
  if (update.requestsPerMinute !== undefined) {
    currentMetrics.requestsPerMinute = update.requestsPerMinute;
  }
  if (update.errorRate !== undefined) {
    currentMetrics.errorRate = update.errorRate;
  }
  if (update.avgLatencyMs !== undefined) {
    currentMetrics.avgLatencyMs = update.avgLatencyMs;
  }
  if (update.uptime !== undefined) {
    currentMetrics.uptime = update.uptime;
  }

  currentMetrics.timestamp = Date.now();
}

// ---------------------------------------------------------------------------
// Namespace setup
// ---------------------------------------------------------------------------

export function setupMetricsNamespace(namespace: Namespace): void {
  let connectedClients = 0;
  let broadcastTimer: ReturnType<typeof setInterval> | null = null;

  // Initialize Redis subscriber
  setupMetricsSubscriber();

  function startBroadcast(): void {
    if (broadcastTimer) {
      return;
    }

    broadcastTimer = setInterval(() => {
      if (connectedClients === 0) {
        stopBroadcast();
        return;
      }

      // Update uptime
      currentMetrics.uptime = process.uptime();
      currentMetrics.timestamp = Date.now();

      namespace.emit("metrics:update", currentMetrics);
    }, METRICS_INTERVAL_MS);

    logger.debug("Metrics broadcast started");
  }

  function stopBroadcast(): void {
    if (broadcastTimer) {
      clearInterval(broadcastTimer);
      broadcastTimer = null;
      logger.debug("Metrics broadcast stopped (no clients)");
    }
  }

  namespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    connectedClients++;

    logger.info(
      { userId, socketId: socket.id, clients: connectedClients },
      "Client connected to metrics namespace"
    );

    // Start broadcasting if this is the first client
    if (connectedClients === 1) {
      startBroadcast();
    }

    // Send current metrics snapshot immediately on connect
    socket.emit("metrics:update", {
      ...currentMetrics,
      uptime: process.uptime(),
      timestamp: Date.now(),
    });

    // Allow clients to request a specific metric
    socket.on("metrics:get", () => {
      socket.emit("metrics:update", {
        ...currentMetrics,
        uptime: process.uptime(),
        timestamp: Date.now(),
      });
    });

    // Allow services to push metrics updates via WebSocket as well
    socket.on("metrics:push", (data: Partial<SystemMetrics>) => {
      applyMetricsUpdate(data);
    });

    socket.on("disconnect", () => {
      connectedClients--;
      logger.debug(
        { userId, socketId: socket.id, clients: connectedClients },
        "Client disconnected from metrics"
      );

      if (connectedClients === 0) {
        stopBroadcast();
      }
    });
  });
}
