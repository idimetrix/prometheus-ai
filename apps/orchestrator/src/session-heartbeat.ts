import { createLogger } from "@prometheus/logger";
import { redis } from "@prometheus/queue";

const logger = createLogger("orchestrator:session-heartbeat");

/** Heartbeat interval in milliseconds */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** TTL for heartbeat keys in seconds — 2 missed heartbeats = stale */
const HEARTBEAT_TTL_SECONDS = 120;

/** Redis key pattern for session heartbeats */
const HEARTBEAT_KEY_PREFIX = "session:heartbeat:";

export interface HeartbeatMetadata {
  currentTool: string | null;
  iterationCount: number;
  memoryUsageMb: number;
  sessionId: string;
  startedAt: string;
  tokensConsumed: number;
  updatedAt: string;
}

/**
 * SessionHeartbeat sends periodic heartbeats to Redis for a running session.
 * If heartbeats stop (e.g., process crash), the health watchdog can detect
 * the stale session and attempt recovery from the last checkpoint.
 */
export class SessionHeartbeat {
  private readonly sessionId: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly metadata: HeartbeatMetadata;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.metadata = {
      sessionId,
      iterationCount: 0,
      currentTool: null,
      memoryUsageMb: 0,
      tokensConsumed: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Start sending heartbeats at the configured interval.
   */
  start(): void {
    if (this.timer) {
      return;
    }

    // Send initial heartbeat immediately
    this.sendHeartbeat().catch((err) => {
      logger.warn(
        { sessionId: this.sessionId, error: String(err) },
        "Failed to send initial heartbeat"
      );
    });

    this.timer = setInterval(() => {
      this.sendHeartbeat().catch((err) => {
        logger.warn(
          { sessionId: this.sessionId, error: String(err) },
          "Failed to send heartbeat"
        );
      });
    }, HEARTBEAT_INTERVAL_MS);

    logger.debug({ sessionId: this.sessionId }, "Heartbeat started");
  }

  /**
   * Stop sending heartbeats and remove the Redis key.
   */
  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    try {
      await redis.del(this.getKey());
    } catch (error) {
      logger.warn(
        { sessionId: this.sessionId, error: String(error) },
        "Failed to remove heartbeat key"
      );
    }

    logger.debug({ sessionId: this.sessionId }, "Heartbeat stopped");
  }

  /**
   * Update the heartbeat metadata with current session state.
   */
  updateMetadata(update: Partial<Omit<HeartbeatMetadata, "sessionId">>): void {
    Object.assign(this.metadata, update);
  }

  /**
   * Check if a session has an active heartbeat.
   */
  static async isAlive(sessionId: string): Promise<boolean> {
    try {
      const key = `${HEARTBEAT_KEY_PREFIX}${sessionId}`;
      const exists = await redis.exists(key);
      return exists === 1;
    } catch {
      return false;
    }
  }

  /**
   * Get heartbeat metadata for a session. Returns null if no heartbeat exists.
   */
  static async getMetadata(
    sessionId: string
  ): Promise<HeartbeatMetadata | null> {
    try {
      const key = `${HEARTBEAT_KEY_PREFIX}${sessionId}`;
      const data = await redis.get(key);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as HeartbeatMetadata;
    } catch {
      return null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    this.metadata.updatedAt = new Date().toISOString();
    this.metadata.memoryUsageMb = Math.round(
      process.memoryUsage.rss() / 1024 / 1024
    );

    const key = this.getKey();
    const value = JSON.stringify(this.metadata);

    await redis.set(key, value, "EX", HEARTBEAT_TTL_SECONDS);
  }

  private getKey(): string {
    return `${HEARTBEAT_KEY_PREFIX}${this.sessionId}`;
  }
}
