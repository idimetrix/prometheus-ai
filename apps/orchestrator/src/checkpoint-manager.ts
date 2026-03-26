import { getInternalAuthHeaders } from "@prometheus/auth";
import { db, sessionCheckpoints, sessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { redis } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { and, desc, eq, lt } from "drizzle-orm";

const logger = createLogger("orchestrator:checkpoint-manager");

/** Size threshold (bytes) above which agent state is stored in MinIO */
const LARGE_BLOB_THRESHOLD = 512 * 1024; // 512KB

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT ?? "http://localhost:9000";
const MINIO_BUCKET = process.env.MINIO_CHECKPOINT_BUCKET ?? "checkpoints";

export interface CheckpointData {
  agentState: Record<string, unknown>;
  creditsConsumed?: number;
  filesModified?: string[];
  iteration: number;
  planProgress?: Record<string, unknown>;
  tokensConsumed?: number;
  toolCallCount?: number;
}

export interface StoredCheckpoint {
  agentState: Record<string, unknown>;
  artifactUrl: string | null;
  createdAt: Date;
  creditsConsumed: number | null;
  filesModified: string[] | null;
  id: string;
  iteration: number;
  orgId: string;
  planProgress: Record<string, unknown> | null;
  sessionId: string;
  tokensConsumed: number | null;
  toolCallCount: number | null;
}

/**
 * CheckpointStateManager handles saving and restoring session checkpoints
 * for long-running sessions. State is stored in PostgreSQL, with large
 * blobs offloaded to MinIO object storage.
 */
export class CheckpointStateManager {
  private readonly orgId: string;
  private readonly autoCheckpointInterval: number;

  constructor(orgId: string, autoCheckpointInterval = 10) {
    this.orgId = orgId;
    this.autoCheckpointInterval = autoCheckpointInterval;
  }

  /**
   * Save a checkpoint for the given session. Serializes state to DB
   * and offloads large blobs to MinIO if necessary.
   */
  async saveCheckpoint(
    sessionId: string,
    data: CheckpointData
  ): Promise<string> {
    const checkpointId = generateId("sckpt");

    let artifactUrl: string | null = null;
    let agentState = data.agentState;

    // Offload large state blobs to MinIO
    const serialized = JSON.stringify(data.agentState);
    if (serialized.length > LARGE_BLOB_THRESHOLD) {
      try {
        artifactUrl = await this.uploadToMinIO(
          sessionId,
          checkpointId,
          serialized
        );
        // Store a reference instead of the full state
        agentState = { _artifactRef: artifactUrl };
        logger.info(
          { sessionId, checkpointId, size: serialized.length },
          "Large state offloaded to MinIO"
        );
      } catch (error) {
        logger.warn(
          { sessionId, checkpointId, error: String(error) },
          "Failed to offload to MinIO, storing in DB"
        );
      }
    }

    try {
      await db.insert(sessionCheckpoints).values({
        id: checkpointId,
        sessionId,
        orgId: this.orgId,
        iteration: data.iteration,
        agentState,
        filesModified: data.filesModified ?? [],
        planProgress: data.planProgress ?? {},
        toolCallCount: data.toolCallCount ?? 0,
        tokensConsumed: data.tokensConsumed ?? 0,
        creditsConsumed: data.creditsConsumed ?? 0,
        artifactUrl,
      });

      // Update session checkpoint metadata
      await db
        .update(sessions)
        .set({
          checkpointCount: data.iteration,
          lastCheckpointAt: new Date(),
        })
        .where(eq(sessions.id, sessionId));

      // Cache latest checkpoint ID in Redis for fast access
      await redis.set(
        `session:checkpoint:latest:${sessionId}`,
        checkpointId,
        "EX",
        86_400 // 24 hours TTL
      );

      logger.info(
        {
          sessionId,
          checkpointId,
          iteration: data.iteration,
          hasArtifact: artifactUrl !== null,
        },
        "Checkpoint saved"
      );

      return checkpointId;
    } catch (error) {
      logger.error(
        { sessionId, checkpointId, error: String(error) },
        "Failed to save checkpoint"
      );
      throw error;
    }
  }

  /**
   * Restore a checkpoint. If checkpointId is not provided, restores the
   * latest checkpoint for the session.
   */
  async restoreCheckpoint(
    sessionId: string,
    checkpointId?: string
  ): Promise<StoredCheckpoint | null> {
    try {
      let rows: (typeof sessionCheckpoints.$inferSelect)[];

      if (checkpointId) {
        rows = await db
          .select()
          .from(sessionCheckpoints)
          .where(
            and(
              eq(sessionCheckpoints.id, checkpointId),
              eq(sessionCheckpoints.sessionId, sessionId),
              eq(sessionCheckpoints.orgId, this.orgId)
            )
          )
          .limit(1);
      } else {
        rows = await db
          .select()
          .from(sessionCheckpoints)
          .where(
            and(
              eq(sessionCheckpoints.sessionId, sessionId),
              eq(sessionCheckpoints.orgId, this.orgId)
            )
          )
          .orderBy(desc(sessionCheckpoints.iteration))
          .limit(1);
      }

      const row = rows[0];
      if (!row) {
        logger.debug({ sessionId, checkpointId }, "No checkpoint found");
        return null;
      }

      // If state was offloaded, fetch from MinIO
      let agentState = row.agentState as Record<string, unknown>;
      if (
        agentState._artifactRef &&
        typeof agentState._artifactRef === "string"
      ) {
        try {
          const fetchedState = await this.downloadFromMinIO(
            agentState._artifactRef
          );
          agentState = JSON.parse(fetchedState) as Record<string, unknown>;
        } catch (error) {
          logger.error(
            {
              sessionId,
              artifactUrl: agentState._artifactRef,
              error: String(error),
            },
            "Failed to fetch state from MinIO"
          );
          return null;
        }
      }

      logger.info(
        { sessionId, checkpointId: row.id, iteration: row.iteration },
        "Checkpoint restored"
      );

      return {
        id: row.id,
        sessionId: row.sessionId,
        orgId: row.orgId,
        iteration: row.iteration,
        agentState,
        filesModified: row.filesModified as string[] | null,
        planProgress: row.planProgress as Record<string, unknown> | null,
        toolCallCount: row.toolCallCount,
        tokensConsumed: row.tokensConsumed,
        creditsConsumed: row.creditsConsumed,
        artifactUrl: row.artifactUrl,
        createdAt: row.createdAt,
      };
    } catch (error) {
      logger.error(
        { sessionId, checkpointId, error: String(error) },
        "Failed to restore checkpoint"
      );
      return null;
    }
  }

  /**
   * List all checkpoints for a session, ordered by iteration descending.
   */
  async listCheckpoints(sessionId: string): Promise<
    Array<{
      id: string;
      iteration: number;
      toolCallCount: number | null;
      tokensConsumed: number | null;
      creditsConsumed: number | null;
      createdAt: Date;
    }>
  > {
    try {
      const rows = await db
        .select({
          id: sessionCheckpoints.id,
          iteration: sessionCheckpoints.iteration,
          toolCallCount: sessionCheckpoints.toolCallCount,
          tokensConsumed: sessionCheckpoints.tokensConsumed,
          creditsConsumed: sessionCheckpoints.creditsConsumed,
          createdAt: sessionCheckpoints.createdAt,
        })
        .from(sessionCheckpoints)
        .where(
          and(
            eq(sessionCheckpoints.sessionId, sessionId),
            eq(sessionCheckpoints.orgId, this.orgId)
          )
        )
        .orderBy(desc(sessionCheckpoints.iteration));

      return rows;
    } catch (error) {
      logger.error(
        { sessionId, error: String(error) },
        "Failed to list checkpoints"
      );
      return [];
    }
  }

  /**
   * Delete old checkpoints, keeping the most recent `keepLast` checkpoints.
   */
  async deleteOldCheckpoints(
    sessionId: string,
    keepLast: number
  ): Promise<number> {
    try {
      const latest = await db
        .select({ iteration: sessionCheckpoints.iteration })
        .from(sessionCheckpoints)
        .where(
          and(
            eq(sessionCheckpoints.sessionId, sessionId),
            eq(sessionCheckpoints.orgId, this.orgId)
          )
        )
        .orderBy(desc(sessionCheckpoints.iteration))
        .limit(keepLast);

      if (latest.length < keepLast) {
        return 0; // Not enough checkpoints to delete
      }

      const minIteration = latest.at(-1)?.iteration;
      if (minIteration === undefined) {
        return 0;
      }

      const deleted = await db
        .delete(sessionCheckpoints)
        .where(
          and(
            eq(sessionCheckpoints.sessionId, sessionId),
            eq(sessionCheckpoints.orgId, this.orgId),
            lt(sessionCheckpoints.iteration, minIteration)
          )
        )
        .returning({ id: sessionCheckpoints.id });

      logger.info(
        { sessionId, deletedCount: deleted.length, keepLast },
        "Old checkpoints deleted"
      );

      return deleted.length;
    } catch (error) {
      logger.error(
        { sessionId, error: String(error) },
        "Failed to delete old checkpoints"
      );
      return 0;
    }
  }

  /**
   * Check if an auto-checkpoint should be taken based on the iteration count.
   */
  shouldAutoCheckpoint(iteration: number): boolean {
    return iteration > 0 && iteration % this.autoCheckpointInterval === 0;
  }

  private async uploadToMinIO(
    sessionId: string,
    checkpointId: string,
    data: string
  ): Promise<string> {
    const key = `${this.orgId}/${sessionId}/${checkpointId}.json`;
    const url = `${MINIO_ENDPOINT}/${MINIO_BUCKET}/${key}`;

    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...getInternalAuthHeaders(),
      },
      body: data,
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`MinIO upload failed: ${response.status}`);
    }

    return url;
  }

  private async downloadFromMinIO(url: string): Promise<string> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`MinIO download failed: ${response.status}`);
    }

    return await response.text();
  }
}
