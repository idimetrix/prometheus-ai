import { createLogger } from "@prometheus/logger";

const logger = createLogger("sandbox-manager:auto-snapshot");

/** Maximum snapshots retained per session */
const MAX_SNAPSHOTS_PER_SESSION = 5;

/** Operations that trigger automatic snapshots */
const SNAPSHOT_TRIGGERS = new Set(["file_write", "terminal_exec"]);

interface SessionSnapshot {
  createdAt: Date;
  operation: string;
  sandboxId: string;
  snapshotId: string;
}

interface SnapshotProvider {
  restore(snapshotId: string): Promise<unknown>;
  snapshot(sandboxId: string): Promise<string>;
}

interface AutoSnapshotConfig {
  /** Maximum snapshots to keep per session (default: 5) */
  maxPerSession?: number;
  /** Whether to auto-rollback on test failure */
  rollbackOnTestFailure?: boolean;
}

/**
 * Automatic pre-change snapshot manager.
 *
 * Takes snapshots before file_write and terminal_exec operations,
 * enabling rollback when tests fail or operations go wrong.
 *
 * Features:
 * - Auto-snapshot before destructive operations
 * - Rollback on test failure
 * - Keeps last N snapshots per session (default: 5)
 * - Oldest snapshots automatically cleaned up
 */
export class AutoSnapshotManager {
  private readonly sessions = new Map<string, SessionSnapshot[]>();
  private readonly maxPerSession: number;
  private readonly rollbackOnTestFailure: boolean;
  private provider: SnapshotProvider | null = null;

  constructor(config?: AutoSnapshotConfig) {
    this.maxPerSession = config?.maxPerSession ?? MAX_SNAPSHOTS_PER_SESSION;
    this.rollbackOnTestFailure = config?.rollbackOnTestFailure ?? true;
  }

  /**
   * Set the snapshot provider.
   * This must be called before any snapshot operations.
   */
  setProvider(provider: SnapshotProvider): void {
    this.provider = provider;
  }

  /**
   * Called before an operation to potentially take a snapshot.
   * Returns the snapshot ID if a snapshot was taken.
   */
  async beforeOperation(
    sessionId: string,
    sandboxId: string,
    operation: string
  ): Promise<string | null> {
    if (!SNAPSHOT_TRIGGERS.has(operation)) {
      return null;
    }

    if (!this.provider) {
      logger.warn(
        { sessionId, operation },
        "No snapshot provider configured, skipping auto-snapshot"
      );
      return null;
    }

    try {
      logger.debug(
        { sessionId, sandboxId, operation },
        "Taking pre-change auto-snapshot"
      );

      const snapshotId = await this.provider.snapshot(sandboxId);

      const snapshot: SessionSnapshot = {
        snapshotId,
        sandboxId,
        operation,
        createdAt: new Date(),
      };

      let sessionSnapshots = this.sessions.get(sessionId);
      if (!sessionSnapshots) {
        sessionSnapshots = [];
        this.sessions.set(sessionId, sessionSnapshots);
      }

      sessionSnapshots.push(snapshot);

      // Trim to max snapshots per session (remove oldest)
      while (sessionSnapshots.length > this.maxPerSession) {
        const removed = sessionSnapshots.shift();
        if (removed) {
          logger.debug(
            { snapshotId: removed.snapshotId, sessionId },
            "Evicted oldest auto-snapshot"
          );
        }
      }

      logger.info(
        {
          sessionId,
          sandboxId,
          snapshotId,
          operation,
          totalSnapshots: sessionSnapshots.length,
        },
        "Auto-snapshot taken"
      );

      return snapshotId;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(
        { sessionId, sandboxId, operation, error: msg },
        "Auto-snapshot failed (continuing without snapshot)"
      );
      return null;
    }
  }

  /**
   * Called after a test execution to check for failures and potentially rollback.
   * Returns true if a rollback was performed.
   */
  async afterTestExecution(
    sessionId: string,
    sandboxId: string,
    testPassed: boolean
  ): Promise<boolean> {
    if (testPassed || !this.rollbackOnTestFailure) {
      return false;
    }

    const snapshots = this.sessions.get(sessionId);
    if (!snapshots || snapshots.length === 0) {
      logger.warn(
        { sessionId },
        "Test failed but no snapshots available for rollback"
      );
      return false;
    }

    // Get the most recent snapshot
    const latestSnapshot = snapshots.at(-1);
    if (!latestSnapshot) {
      return false;
    }

    logger.info(
      {
        sessionId,
        sandboxId,
        snapshotId: latestSnapshot.snapshotId,
      },
      "Test failed, rolling back to last snapshot"
    );

    return await this.rollback(sessionId, sandboxId);
  }

  /**
   * Rollback to a specific snapshot or the latest one.
   * Returns true if rollback was successful.
   */
  async rollback(
    sessionId: string,
    sandboxId: string,
    snapshotId?: string
  ): Promise<boolean> {
    if (!this.provider) {
      logger.error("No snapshot provider configured for rollback");
      return false;
    }

    const snapshots = this.sessions.get(sessionId);
    if (!snapshots || snapshots.length === 0) {
      logger.warn({ sessionId }, "No snapshots available for rollback");
      return false;
    }

    let targetSnapshot: SessionSnapshot | undefined;

    if (snapshotId) {
      // Find specific snapshot
      targetSnapshot = snapshots.find((s) => s.snapshotId === snapshotId);
      if (!targetSnapshot) {
        logger.warn(
          { sessionId, snapshotId },
          "Specified snapshot not found for rollback"
        );
        return false;
      }
    } else {
      // Use the latest snapshot
      targetSnapshot = snapshots.at(-1);
    }

    if (!targetSnapshot) {
      return false;
    }

    try {
      await this.provider.restore(targetSnapshot.snapshotId);

      // Remove snapshots after the rollback point
      if (snapshotId) {
        const targetIndex = snapshots.indexOf(targetSnapshot);
        snapshots.splice(targetIndex + 1);
      }

      logger.info(
        {
          sessionId,
          sandboxId,
          snapshotId: targetSnapshot.snapshotId,
          operation: targetSnapshot.operation,
        },
        "Rollback completed successfully"
      );

      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          sessionId,
          sandboxId,
          snapshotId: targetSnapshot.snapshotId,
          error: msg,
        },
        "Rollback failed"
      );
      return false;
    }
  }

  /**
   * Get all snapshots for a session.
   */
  getSessionSnapshots(sessionId: string): SessionSnapshot[] {
    return this.sessions.get(sessionId) ?? [];
  }

  /**
   * Get the latest snapshot for a session.
   */
  getLatestSnapshot(sessionId: string): SessionSnapshot | null {
    const snapshots = this.sessions.get(sessionId);
    if (!snapshots || snapshots.length === 0) {
      return null;
    }
    return snapshots.at(-1) ?? null;
  }

  /**
   * Clear all snapshots for a session (e.g., on session end).
   */
  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    logger.debug({ sessionId }, "Session snapshots cleared");
  }

  /**
   * Get snapshot counts across all sessions.
   */
  getStats(): { sessionCount: number; totalSnapshots: number } {
    let totalSnapshots = 0;
    for (const snapshots of this.sessions.values()) {
      totalSnapshots += snapshots.length;
    }

    return {
      sessionCount: this.sessions.size,
      totalSnapshots,
    };
  }
}
