import type { Database } from "@prometheus/db";
import { sessionApprovalGates } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { and, eq } from "drizzle-orm";
import type IORedis from "ioredis";

const logger = createLogger("orchestrator:approval-gate");

/** Channel prefix for approval gate Socket.IO events via Redis pub/sub */
const APPROVAL_CHANNEL_PREFIX = "approval-gate:";

/** Auto-expire pending gates after 30 minutes */
const GATE_TIMEOUT_MS = 30 * 60 * 1000;

type GateStatus = "approved" | "expired" | "pending" | "rejected";

/**
 * ApprovalGateManager handles human-in-the-loop approval gates for
 * long-running sessions. When an agent wants to perform a risky action
 * (deployment, destructive change, etc.), it creates an approval gate
 * that pauses execution until a human approves or rejects it.
 */
export class ApprovalGateManager {
  private readonly db: Database;
  private readonly redis: IORedis;
  private readonly pendingResolvers = new Map<
    string,
    {
      reject: (err: Error) => void;
      resolve: (status: GateStatus) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(db: Database, redis: IORedis) {
    this.db = db;
    this.redis = redis;
  }

  /**
   * Create an approval gate and wait for it to be resolved.
   * Publishes a Socket.IO event via Redis so connected clients
   * are notified of the pending approval.
   *
   * Returns a Promise that resolves when the gate is approved or rejected.
   */
  async requestApproval(
    sessionId: string,
    gateType: string,
    description: string,
    context: Record<string, unknown> = {}
  ): Promise<GateStatus> {
    // Insert the gate row
    const [gate] = await this.db
      .insert(sessionApprovalGates)
      .values({
        sessionId,
        gateType,
        description,
        context,
        status: "pending",
      })
      .returning();

    if (!gate) {
      throw new Error("Failed to create approval gate");
    }

    logger.info(
      { gateId: gate.id, sessionId, gateType },
      "Approval gate created — waiting for human decision"
    );

    // Publish event to Redis for Socket.IO notification
    await this.redis.publish(
      `${APPROVAL_CHANNEL_PREFIX}${sessionId}`,
      JSON.stringify({
        type: "approval_requested",
        gateId: gate.id,
        sessionId,
        gateType,
        description,
        context,
        createdAt: gate.createdAt.toISOString(),
      })
    );

    // Return a promise that resolves when the gate is resolved
    return new Promise<GateStatus>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingResolvers.delete(gate.id);

        // Auto-expire the gate
        this.db
          .update(sessionApprovalGates)
          .set({ status: "expired", resolvedAt: new Date() })
          .where(eq(sessionApprovalGates.id, gate.id))
          .then(() => {
            logger.warn(
              { gateId: gate.id, sessionId },
              "Approval gate expired due to timeout"
            );
            resolve("expired");
          })
          .catch((err) => {
            logger.error(
              { gateId: gate.id, error: String(err) },
              "Failed to expire approval gate"
            );
            reject(err as Error);
          });
      }, GATE_TIMEOUT_MS);

      this.pendingResolvers.set(gate.id, { resolve, reject, timer });
    });
  }

  /**
   * Resolve a pending approval gate (approve or reject).
   */
  async resolveGate(
    gateId: string,
    status: "approved" | "rejected",
    resolvedBy: string,
    rejectionReason?: string
  ): Promise<void> {
    await this.db
      .update(sessionApprovalGates)
      .set({
        status,
        resolvedBy,
        rejectionReason: rejectionReason ?? null,
        resolvedAt: new Date(),
      })
      .where(eq(sessionApprovalGates.id, gateId));

    logger.info({ gateId, status, resolvedBy }, "Approval gate resolved");

    // Resolve the pending promise if one exists
    const pending = this.pendingResolvers.get(gateId);
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve(status);
      this.pendingResolvers.delete(gateId);
    }

    // Publish resolution event via Redis
    const [gate] = await this.db
      .select()
      .from(sessionApprovalGates)
      .where(eq(sessionApprovalGates.id, gateId))
      .limit(1);

    if (gate) {
      await this.redis.publish(
        `${APPROVAL_CHANNEL_PREFIX}${gate.sessionId}`,
        JSON.stringify({
          type: "approval_resolved",
          gateId,
          sessionId: gate.sessionId,
          status,
          resolvedBy,
          rejectionReason,
        })
      );
    }
  }

  /**
   * List all pending approval gates for a session.
   */
  async getPendingGates(sessionId: string) {
    return await this.db
      .select()
      .from(sessionApprovalGates)
      .where(
        and(
          eq(sessionApprovalGates.sessionId, sessionId),
          eq(sessionApprovalGates.status, "pending")
        )
      );
  }
}
