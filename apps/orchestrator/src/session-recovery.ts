import type { Database } from "@prometheus/db";
import { sessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq, lt, sql } from "drizzle-orm";

const logger = createLogger("orchestrator:session-recovery");

/** Threshold for considering a session stale (no heartbeat in last 5 minutes) */
const HEARTBEAT_STALE_THRESHOLD_MS = 5 * 60 * 1000;

interface RecoveryResult {
  details: Array<{
    sessionId: string;
    status: "recovered" | "failed" | "skipped";
    reason?: string;
  }>;
  failed: number;
  recovered: number;
  skipped: number;
}

/**
 * SessionRecovery handles restoring sessions that were interrupted by a crash.
 *
 * On orchestrator startup:
 * 1. Query DB for sessions with status='active' that have no heartbeat in last 5 min
 * 2. For each, restore from latest checkpoint
 * 3. Re-enqueue the task to queue worker
 * 4. Log recovery actions
 */
export class SessionRecovery {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Run session recovery on startup.
   * Finds all stale active sessions and attempts to recover them.
   */
  async recover(): Promise<RecoveryResult> {
    const result: RecoveryResult = {
      recovered: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };

    const cutoff = new Date(Date.now() - HEARTBEAT_STALE_THRESHOLD_MS);

    // Find sessions that are marked active but have stale heartbeats
    const staleSessions = await this.db.query.sessions.findMany({
      where: and(
        eq(sessions.status, "active"),
        lt(sessions.lastHeartbeatAt, cutoff)
      ),
    });

    if (staleSessions.length === 0) {
      logger.info("No stale sessions found during recovery check");
      return result;
    }

    logger.info(
      { count: staleSessions.length },
      "Found stale active sessions, attempting recovery"
    );

    for (const session of staleSessions) {
      try {
        await this.recoverSession(session.id, session.projectId, result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          { sessionId: session.id, error: msg },
          "Failed to recover session"
        );
        result.failed++;
        result.details.push({
          sessionId: session.id,
          status: "failed",
          reason: msg,
        });
      }
    }

    logger.info(
      {
        recovered: result.recovered,
        failed: result.failed,
        skipped: result.skipped,
      },
      "Session recovery complete"
    );

    return result;
  }

  /**
   * Attempt to recover a single session.
   * Resets the heartbeat and re-enqueues the task for the queue worker.
   */
  private async recoverSession(
    sessionId: string,
    projectId: string,
    result: RecoveryResult
  ): Promise<void> {
    // Check if the session has been running too long (over 1 hour) — skip it
    const session = await this.db.query.sessions.findFirst({
      where: eq(sessions.id, sessionId),
    });

    if (!session) {
      result.skipped++;
      result.details.push({
        sessionId,
        status: "skipped",
        reason: "Session not found in DB",
      });
      return;
    }

    const sessionAgeMs = Date.now() - session.startedAt.getTime();
    const maxSessionAgeMs = 60 * 60 * 1000; // 1 hour

    if (sessionAgeMs > maxSessionAgeMs) {
      // Session is too old — mark as failed instead of recovering
      await this.db
        .update(sessions)
        .set({
          status: "failed",
          endedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));

      result.skipped++;
      result.details.push({
        sessionId,
        status: "skipped",
        reason: "Session exceeded max age (1 hour)",
      });
      return;
    }

    // Reset heartbeat to allow the watchdog to track it
    await this.db
      .update(sessions)
      .set({
        lastHeartbeatAt: new Date(),
        errorCount: sql`COALESCE(${sessions.errorCount}, 0) + 1`,
      })
      .where(eq(sessions.id, sessionId));

    // Re-enqueue the task for processing
    try {
      const { sessionContinuationQueue } = await import("@prometheus/queue");
      await sessionContinuationQueue.add("continue-session", {
        sessionId,
        checkpointId: "",
        iterationBudget: 10,
        orgId: session.userId,
        remainingCredits: 1000,
      });

      logger.info(
        { sessionId, projectId },
        "Session recovered and re-enqueued"
      );

      result.recovered++;
      result.details.push({ sessionId, status: "recovered" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { sessionId, error: msg },
        "Failed to re-enqueue recovered session"
      );

      // Mark as failed if we cannot re-enqueue
      await this.db
        .update(sessions)
        .set({
          status: "failed",
          endedAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));

      result.failed++;
      result.details.push({
        sessionId,
        status: "failed",
        reason: `Re-enqueue failed: ${msg}`,
      });
    }
  }
}
