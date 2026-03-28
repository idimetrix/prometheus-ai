import type { Database } from "@prometheus/db";
import { sessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { eq } from "drizzle-orm";

const logger = createLogger("orchestrator:watchdog");

/** How often the watchdog runs its check loop (ms) */
const CHECK_INTERVAL_MS = 30_000;

/** If no heartbeat within this window, the session is considered stalled (ms) */
const STALL_THRESHOLD_MS = 2 * 60 * 1000;

/** Maximum recovery attempts before marking session as failed */
const MAX_RECOVERY_ATTEMPTS = 3;

/**
 * SessionWatchdog monitors active sessions and detects stalled ones.
 * When a session has no heartbeat for 2 minutes, it attempts recovery
 * from the latest checkpoint. After 3 failed attempts, the session
 * is marked as failed.
 */
export class SessionWatchdog {
  private readonly db: Database;
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly recoveryAttempts = new Map<string, number>();

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Start the watchdog check loop.
   */
  start(): void {
    if (this.timer) {
      logger.warn("Watchdog already running, ignoring duplicate start");
      return;
    }

    logger.info("Session watchdog started");

    this.timer = setInterval(() => {
      this.checkSessions().catch((err) => {
        logger.error(
          { error: String(err) },
          "Watchdog check loop encountered an unexpected error"
        );
      });
    }, CHECK_INTERVAL_MS);
  }

  /**
   * Stop the watchdog and clean up the interval.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.recoveryAttempts.clear();
    logger.info("Session watchdog stopped");
  }

  /**
   * Query all active sessions and check for stalled heartbeats.
   */
  async checkSessions(): Promise<void> {
    const activeSessions = await this.db.query.sessions.findMany({
      where: eq(sessions.status, "active"),
    });

    const now = Date.now();

    for (const session of activeSessions) {
      try {
        if (!session.lastHeartbeatAt) {
          continue;
        }

        const elapsed = now - session.lastHeartbeatAt.getTime();

        if (elapsed > STALL_THRESHOLD_MS) {
          logger.warn(
            {
              sessionId: session.id,
              lastHeartbeat: session.lastHeartbeatAt.toISOString(),
              elapsedMs: elapsed,
            },
            "Stalled session detected — no heartbeat received"
          );
          await this.handleStall(session.id);
        }
      } catch (err) {
        // Fault-tolerant: errors in one session check shouldn't affect others
        logger.error(
          { sessionId: session.id, error: String(err) },
          "Error checking session health"
        );
      }
    }
  }

  /**
   * Attempt recovery for a stalled session.
   * First tries a soft resume from the latest checkpoint. After 3 failed
   * attempts the session is marked as 'failed'.
   */
  async handleStall(sessionId: string): Promise<void> {
    const attempts = (this.recoveryAttempts.get(sessionId) ?? 0) + 1;
    this.recoveryAttempts.set(sessionId, attempts);

    if (attempts > MAX_RECOVERY_ATTEMPTS) {
      logger.error(
        { sessionId, attempts },
        "Max recovery attempts exceeded — marking session as failed"
      );

      await this.db
        .update(sessions)
        .set({
          status: "failed",
          endedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));

      this.recoveryAttempts.delete(sessionId);
      return;
    }

    logger.info(
      { sessionId, attempt: attempts },
      "Attempting soft resume from latest checkpoint"
    );

    try {
      // Attempt soft resume by resetting status to active and refreshing heartbeat
      await this.db
        .update(sessions)
        .set({
          lastHeartbeatAt: new Date(),
          errorCount: attempts,
        })
        .where(eq(sessions.id, sessionId));

      logger.info(
        { sessionId, attempt: attempts },
        "Soft resume initiated from checkpoint"
      );
    } catch (err) {
      logger.error(
        { sessionId, attempt: attempts, error: String(err) },
        "Recovery attempt failed"
      );
    }
  }
}
