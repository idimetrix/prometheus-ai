import { createLogger } from "@prometheus/logger";
import { createRedisConnection } from "@prometheus/queue";
import type { Namespace } from "socket.io";

const logger = createLogger("socket-server:presence");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Redis key prefix for presence hash maps */
const PRESENCE_KEY_PREFIX = "presence:room:";

/** TTL for individual presence entries (seconds) */
const PRESENCE_TTL_SECONDS = 120;

/** How often to broadcast aggregated presence to room members (ms) */
const BROADCAST_INTERVAL_MS = 2000;

/** How often to refresh TTLs on active presence entries (ms) */
const TTL_REFRESH_INTERVAL_MS = 30_000;

/** Stale threshold — entries older than this are considered disconnected (ms) */
const STALE_THRESHOLD_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PresenceEntry {
  activeFile?: string;
  avatar?: string;
  cursorPosition?: { line: number; column: number };
  lastSeen: number;
  name?: string;
  socketId: string;
  status: "online" | "idle" | "away";
  userId: string;
}

// ---------------------------------------------------------------------------
// In-memory presence map (synced to Redis for cross-instance aggregation)
// ---------------------------------------------------------------------------

/** room -> userId -> PresenceEntry */
const localPresence = new Map<string, Map<string, PresenceEntry>>();

// ---------------------------------------------------------------------------
// Redis helpers
// ---------------------------------------------------------------------------

let publisher: ReturnType<typeof createRedisConnection> | null = null;

function getPublisher(): ReturnType<typeof createRedisConnection> | null {
  if (!publisher) {
    try {
      publisher = createRedisConnection();
    } catch {
      logger.warn("Redis not available for presence aggregation");
    }
  }
  return publisher;
}

async function persistPresenceToRedis(
  room: string,
  userId: string,
  entry: PresenceEntry
): Promise<void> {
  try {
    const redis = getPublisher();
    if (!redis) {
      return;
    }
    const key = `${PRESENCE_KEY_PREFIX}${room}`;
    await redis.hset(key, userId, JSON.stringify(entry));
    await redis.expire(key, PRESENCE_TTL_SECONDS);
  } catch (error) {
    logger.error(
      { room, userId, error },
      "Failed to persist presence to Redis"
    );
  }
}

async function removePresenceFromRedis(
  room: string,
  userId: string
): Promise<void> {
  try {
    const redis = getPublisher();
    if (!redis) {
      return;
    }
    await redis.hdel(`${PRESENCE_KEY_PREFIX}${room}`, userId);
  } catch {
    // Non-critical
  }
}

async function getAggregatedPresence(room: string): Promise<PresenceEntry[]> {
  try {
    const redis = getPublisher();
    if (!redis) {
      // Fall back to local presence only
      const local = localPresence.get(room);
      return local ? Array.from(local.values()) : [];
    }

    const key = `${PRESENCE_KEY_PREFIX}${room}`;
    const entries = await redis.hgetall(key);
    const now = Date.now();
    const result: PresenceEntry[] = [];

    for (const [, value] of Object.entries(entries)) {
      try {
        const entry = JSON.parse(value) as PresenceEntry;
        // Filter out stale entries
        if (now - entry.lastSeen < STALE_THRESHOLD_MS) {
          result.push(entry);
        }
      } catch {
        // Skip malformed entries
      }
    }

    return result;
  } catch (error) {
    logger.error({ room, error }, "Failed to get aggregated presence");
    const local = localPresence.get(room);
    return local ? Array.from(local.values()) : [];
  }
}

// ---------------------------------------------------------------------------
// Room management
// ---------------------------------------------------------------------------

function setPresence(room: string, userId: string, entry: PresenceEntry): void {
  if (!localPresence.has(room)) {
    localPresence.set(room, new Map());
  }
  const roomMap = localPresence.get(room) as Map<string, PresenceEntry>;
  roomMap.set(userId, entry);
  persistPresenceToRedis(room, userId, entry).catch(() => {
    // Non-critical — fire and forget
  });
}

function removePresence(room: string, userId: string): void {
  const roomMap = localPresence.get(room);
  if (roomMap) {
    roomMap.delete(userId);
    if (roomMap.size === 0) {
      localPresence.delete(room);
    }
  }
  removePresenceFromRedis(room, userId).catch(() => {
    // Non-critical — fire and forget
  });
}

// ---------------------------------------------------------------------------
// Namespace setup
// ---------------------------------------------------------------------------

export function setupPresenceNamespace(namespace: Namespace): void {
  // Track which rooms have active broadcast intervals
  const broadcastTimers = new Map<string, ReturnType<typeof setInterval>>();

  function ensureBroadcastTimer(room: string): void {
    if (broadcastTimers.has(room)) {
      return;
    }

    const timer = setInterval(async () => {
      const roomMap = localPresence.get(room);
      if (!roomMap || roomMap.size === 0) {
        clearInterval(timer);
        broadcastTimers.delete(room);
        return;
      }

      const aggregated = await getAggregatedPresence(room);
      namespace.to(`presence:${room}`).emit("presence:list", {
        room,
        users: aggregated,
        timestamp: Date.now(),
      });
    }, BROADCAST_INTERVAL_MS);

    broadcastTimers.set(room, timer);
  }

  // Periodic TTL refresh for Redis entries
  const ttlRefreshTimer = setInterval(() => {
    const redis = getPublisher();
    if (!redis) {
      return;
    }

    for (const [room] of localPresence) {
      const key = `${PRESENCE_KEY_PREFIX}${room}`;
      redis.expire(key, PRESENCE_TTL_SECONDS).catch(() => {
        // Non-critical — fire and forget
      });
    }
  }, TTL_REFRESH_INTERVAL_MS);

  namespace.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    const trackedRooms = new Set<string>();

    logger.info(
      { userId, socketId: socket.id },
      "Client connected to presence namespace"
    );

    // ---- Join a presence room ----
    socket.on(
      "presence:join",
      async (data: {
        room: string;
        name?: string;
        avatar?: string;
        activeFile?: string;
      }) => {
        const { room } = data;
        await socket.join(`presence:${room}`);
        trackedRooms.add(room);

        const entry: PresenceEntry = {
          userId,
          socketId: socket.id,
          status: "online",
          name: data.name,
          avatar: data.avatar,
          activeFile: data.activeFile,
          lastSeen: Date.now(),
        };

        setPresence(room, userId, entry);
        ensureBroadcastTimer(room);

        // Send current presence list to the joining client
        const aggregated = await getAggregatedPresence(room);
        socket.emit("presence:list", {
          room,
          users: aggregated,
          timestamp: Date.now(),
        });

        // Notify others
        socket.to(`presence:${room}`).emit("presence:user_update", {
          room,
          ...entry,
        });

        logger.debug({ userId, room }, "Joined presence room");
      }
    );

    // ---- Update presence (cursor, file, status) ----
    socket.on(
      "presence:update",
      (data: {
        room: string;
        status?: "online" | "idle" | "away";
        cursorPosition?: { line: number; column: number };
        activeFile?: string;
        name?: string;
        avatar?: string;
      }) => {
        const { room } = data;
        const roomMap = localPresence.get(room);
        const existing = roomMap?.get(userId);

        const entry: PresenceEntry = {
          userId,
          socketId: socket.id,
          status: data.status ?? existing?.status ?? "online",
          cursorPosition: data.cursorPosition ?? existing?.cursorPosition,
          activeFile: data.activeFile ?? existing?.activeFile,
          name: data.name ?? existing?.name,
          avatar: data.avatar ?? existing?.avatar,
          lastSeen: Date.now(),
        };

        setPresence(room, userId, entry);

        // Broadcast individual update immediately
        socket.to(`presence:${room}`).emit("presence:user_update", {
          room,
          ...entry,
        });
      }
    );

    // ---- Leave a presence room ----
    socket.on("presence:leave", (data: { room: string }) => {
      const { room } = data;
      trackedRooms.delete(room);
      removePresence(room, userId);
      socket.leave(`presence:${room}`);

      namespace.to(`presence:${room}`).emit("presence:user_leave", {
        room,
        userId,
        timestamp: Date.now(),
      });

      logger.debug({ userId, room }, "Left presence room");
    });

    // ---- Disconnect: clean up all tracked rooms ----
    socket.on("disconnect", () => {
      for (const room of trackedRooms) {
        removePresence(room, userId);
        namespace.to(`presence:${room}`).emit("presence:user_leave", {
          room,
          userId,
          timestamp: Date.now(),
        });
      }
      trackedRooms.clear();

      logger.debug(
        { userId, socketId: socket.id },
        "Client disconnected from presence"
      );
    });
  });

  // Cleanup on namespace close
  namespace.server.on("close" as string, () => {
    clearInterval(ttlRefreshTimer);
    for (const [, timer] of broadcastTimers) {
      clearInterval(timer);
    }
    broadcastTimers.clear();
  });
}
