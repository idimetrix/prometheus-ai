import { createLogger } from "@prometheus/logger";
import {
  createRedisConnection,
  EventPublisher,
  QueueEvents,
} from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import type IORedis from "ioredis";

const logger = createLogger("orchestrator:checkpoint");

export type CheckpointType =
  | "plan_confirmation"
  | "high_stakes"
  | "input_request"
  | "blocker";

export interface Checkpoint {
  createdAt: Date;
  data: Record<string, unknown>;
  description: string;
  id: string;
  resolvedAt: Date | null;
  response: CheckpointResponse | null;
  sessionId: string;
  timeoutMs: number;
  title: string;
  type: CheckpointType;
}

export interface CheckpointResponse {
  action: "approve" | "reject" | "modify" | "input";
  data?: Record<string, unknown>;
  message?: string;
  respondedAt: Date;
  respondedBy: string;
}

/** Redis channel used for checkpoint resolution pub/sub */
const CHECKPOINT_CHANNEL = "checkpoint:resolution";

/**
 * CheckpointManager handles human-in-the-loop interactions.
 * When an agent needs human approval or input, it creates a checkpoint
 * and pauses execution until a response is received or timeout occurs.
 *
 * Supports both in-process resolution (respondToCheckpoint) and
 * distributed resolution via Redis pub/sub so checkpoint responses
 * work across multiple orchestrator instances.
 */
export class CheckpointManager {
  private readonly pendingCheckpoints = new Map<
    string,
    {
      checkpoint: Checkpoint;
      resolve: (response: CheckpointResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly eventPublisher: EventPublisher;
  private subscriber: IORedis | null = null;

  constructor() {
    this.eventPublisher = new EventPublisher();
    this.initRedisSubscriber();
  }

  /**
   * Subscribe to Redis checkpoint resolution channel so responses
   * from other processes (API server, socket server) can resolve
   * checkpoints held in this orchestrator instance.
   */
  private initRedisSubscriber(): void {
    try {
      this.subscriber = createRedisConnection();
      this.subscriber.subscribe(CHECKPOINT_CHANNEL, (err) => {
        if (err) {
          logger.error(
            { error: err.message },
            "Failed to subscribe to checkpoint resolution channel"
          );
        } else {
          logger.info("Subscribed to checkpoint resolution channel");
        }
      });

      this.subscriber.on("message", (channel: string, message: string) => {
        if (channel !== CHECKPOINT_CHANNEL) {
          return;
        }
        try {
          const payload = JSON.parse(message) as {
            checkpointId: string;
            response: {
              action: CheckpointResponse["action"];
              data?: Record<string, unknown>;
              message?: string;
              respondedBy: string;
            };
          };

          this.respondToCheckpoint(payload.checkpointId, {
            ...payload.response,
            respondedAt: new Date(),
          });
        } catch (err) {
          logger.error(
            { error: String(err) },
            "Failed to process checkpoint resolution from Redis"
          );
        }
      });
    } catch (err) {
      logger.warn(
        { error: String(err) },
        "Redis unavailable for checkpoint pub/sub — using in-process only"
      );
    }
  }

  /**
   * Request a plan confirmation checkpoint.
   * Agent proposes a plan and waits for human approval.
   */
  async requestPlanConfirmation(
    sessionId: string,
    plan: {
      steps: Array<{
        id: string;
        title: string;
        description: string;
        estimatedCredits: number;
      }>;
    },
    timeoutMs = 300_000 // 5 minutes
  ): Promise<CheckpointResponse> {
    return await this.createCheckpoint({
      sessionId,
      type: "plan_confirmation",
      title: "Plan Confirmation Required",
      description:
        "Review and approve the proposed execution plan before proceeding.",
      data: { plan },
      timeoutMs,
    });
  }

  /**
   * Request approval for a high-stakes operation.
   */
  async requestHighStakesApproval(
    sessionId: string,
    operation: string,
    details: Record<string, unknown>,
    timeoutMs = 120_000 // 2 minutes
  ): Promise<CheckpointResponse> {
    return await this.createCheckpoint({
      sessionId,
      type: "high_stakes",
      title: "Approval Required",
      description: `Agent wants to perform a high-stakes operation: ${operation}`,
      data: { operation, ...details },
      timeoutMs,
    });
  }

  /**
   * Request input from the user when agent needs clarification.
   */
  async requestInput(
    sessionId: string,
    question: string,
    context: Record<string, unknown> = {},
    timeoutMs = 600_000 // 10 minutes
  ): Promise<CheckpointResponse> {
    return await this.createCheckpoint({
      sessionId,
      type: "input_request",
      title: "Input Needed",
      description: question,
      data: context,
      timeoutMs,
    });
  }

  /**
   * Create a checkpoint and wait for response.
   */
  private createCheckpoint(params: {
    sessionId: string;
    type: CheckpointType;
    title: string;
    description: string;
    data: Record<string, unknown>;
    timeoutMs: number;
  }): Promise<CheckpointResponse> {
    const checkpoint: Checkpoint = {
      id: generateId("ckpt"),
      sessionId: params.sessionId,
      type: params.type,
      title: params.title,
      description: params.description,
      data: params.data,
      createdAt: new Date(),
      resolvedAt: null,
      response: null,
      timeoutMs: params.timeoutMs,
    };

    logger.info(
      {
        checkpointId: checkpoint.id,
        type: checkpoint.type,
        sessionId: checkpoint.sessionId,
      },
      "Checkpoint created"
    );

    return new Promise<CheckpointResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCheckpoints.delete(checkpoint.id);
        logger.warn({ checkpointId: checkpoint.id }, "Checkpoint timed out");

        // Auto-reject on timeout
        const timeoutResponse: CheckpointResponse = {
          action: "reject",
          message: "Checkpoint timed out without response",
          respondedBy: "system",
          respondedAt: new Date(),
        };
        resolve(timeoutResponse);
      }, params.timeoutMs);

      this.pendingCheckpoints.set(checkpoint.id, {
        checkpoint,
        resolve,
        reject,
        timer,
      });

      // Publish checkpoint event to frontend via session events channel
      this.eventPublisher
        .publishSessionEvent(params.sessionId, {
          type: QueueEvents.CHECKPOINT,
          data: {
            checkpointId: checkpoint.id,
            type: checkpoint.type,
            title: checkpoint.title,
            description: checkpoint.description,
            data: checkpoint.data,
            timeoutMs: checkpoint.timeoutMs,
          },
          timestamp: new Date().toISOString(),
        })
        .catch((err) => {
          logger.error(
            { error: String(err) },
            "Failed to publish checkpoint event"
          );
        });
    });
  }

  /**
   * Respond to a pending checkpoint (called from HTTP handler, socket
   * server, or Redis pub/sub).
   */
  respondToCheckpoint(
    checkpointId: string,
    response: CheckpointResponse
  ): boolean {
    const pending = this.pendingCheckpoints.get(checkpointId);
    if (!pending) {
      logger.warn({ checkpointId }, "Checkpoint not found or already resolved");
      return false;
    }

    clearTimeout(pending.timer);
    pending.checkpoint.resolvedAt = new Date();
    pending.checkpoint.response = response;
    pending.resolve(response);
    this.pendingCheckpoints.delete(checkpointId);

    // Publish resolution event so the frontend knows the checkpoint is resolved
    this.eventPublisher
      .publishSessionEvent(pending.checkpoint.sessionId, {
        type: "checkpoint_resolved",
        data: {
          checkpointId,
          action: response.action,
          respondedBy: response.respondedBy,
          message: response.message ?? null,
        },
        timestamp: new Date().toISOString(),
      })
      .catch((err) => {
        logger.error(
          { error: String(err) },
          "Failed to publish checkpoint resolution event"
        );
      });

    logger.info(
      { checkpointId, action: response.action },
      "Checkpoint resolved"
    );
    return true;
  }

  /**
   * Publish a checkpoint resolution via Redis pub/sub so all orchestrator
   * instances can receive it. Called by the API when the user resolves
   * a checkpoint through the HTTP endpoint.
   */
  async publishResolution(
    checkpointId: string,
    response: Omit<CheckpointResponse, "respondedAt">
  ): Promise<void> {
    try {
      const publisher = createRedisConnection();
      await publisher.publish(
        CHECKPOINT_CHANNEL,
        JSON.stringify({ checkpointId, response })
      );
      await publisher.quit();
    } catch (err) {
      logger.error(
        { checkpointId, error: String(err) },
        "Failed to publish checkpoint resolution via Redis"
      );
    }
  }

  /**
   * Get all pending checkpoints for a session.
   */
  getPendingCheckpoints(sessionId: string): Checkpoint[] {
    return Array.from(this.pendingCheckpoints.values())
      .filter((p) => p.checkpoint.sessionId === sessionId)
      .map((p) => p.checkpoint);
  }

  /**
   * Cancel all pending checkpoints for a session (on session cancel).
   */
  cancelSessionCheckpoints(sessionId: string): void {
    for (const [id, pending] of this.pendingCheckpoints) {
      if (pending.checkpoint.sessionId === sessionId) {
        clearTimeout(pending.timer);
        pending.resolve({
          action: "reject",
          message: "Session cancelled",
          respondedBy: "system",
          respondedAt: new Date(),
        });
        this.pendingCheckpoints.delete(id);
      }
    }
  }

  /**
   * Clean up Redis subscriber on shutdown.
   */
  async destroy(): Promise<void> {
    if (this.subscriber) {
      try {
        await this.subscriber.unsubscribe(CHECKPOINT_CHANNEL);
        await this.subscriber.quit();
      } catch {
        // Best-effort cleanup
      }
    }
  }
}
