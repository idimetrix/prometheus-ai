import { createLogger } from "@prometheus/logger";
import { EventPublisher, QueueEvents } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";

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

/**
 * CheckpointManager handles human-in-the-loop interactions.
 * When an agent needs human approval or input, it creates a checkpoint
 * and pauses execution until a response is received or timeout occurs.
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

  constructor() {
    this.eventPublisher = new EventPublisher();
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
    return this.createCheckpoint({
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
    return this.createCheckpoint({
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
    return this.createCheckpoint({
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

      // Publish checkpoint event to frontend
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
   * Respond to a pending checkpoint (called from socket server or API).
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

    logger.info(
      { checkpointId, action: response.action },
      "Checkpoint resolved"
    );
    return true;
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
}
