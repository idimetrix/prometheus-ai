import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:handoff-protocol");

export interface HandoffRequest {
  context: Record<string, unknown>;
  id: string;
  requestingAgent: string;
  requestingRole: string;
  subtask: string;
  targetRole: string;
  timestamp: Date;
}

export interface HandoffResponse {
  acceptedAt?: Date;
  completedAt?: Date;
  error?: string;
  handoffId: string;
  result?: unknown;
  status: "pending" | "accepted" | "rejected" | "completed" | "failed";
  targetAgent?: string;
}

/**
 * Manages agent-to-agent handoff protocol for task delegation.
 * Enables one agent to delegate a subtask to another agent with a different role.
 */
export class HandoffProtocol {
  private readonly handoffs: Map<
    string,
    { request: HandoffRequest; response: HandoffResponse }
  > = new Map();
  private readonly pendingByRole: Map<string, string[]> = new Map();

  /**
   * Create a handoff request from one agent to another role.
   */
  requestHandoff(params: {
    context: Record<string, unknown>;
    requestingAgent: string;
    requestingRole: string;
    subtask: string;
    targetRole: string;
  }): HandoffRequest {
    const id = `ho_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const request: HandoffRequest = {
      id,
      requestingAgent: params.requestingAgent,
      requestingRole: params.requestingRole,
      targetRole: params.targetRole,
      subtask: params.subtask,
      context: params.context,
      timestamp: new Date(),
    };

    const response: HandoffResponse = {
      handoffId: id,
      status: "pending",
    };

    this.handoffs.set(id, { request, response });

    // Track pending handoffs by target role
    const pending = this.pendingByRole.get(params.targetRole) ?? [];
    pending.push(id);
    this.pendingByRole.set(params.targetRole, pending);

    logger.info(
      { handoffId: id, from: params.requestingRole, to: params.targetRole },
      "Handoff requested"
    );

    return request;
  }

  /**
   * Accept a handoff and begin working on the subtask.
   */
  acceptHandoff(handoffId: string, targetAgent: string): boolean {
    const entry = this.handoffs.get(handoffId);
    if (!entry || entry.response.status !== "pending") {
      return false;
    }

    entry.response.status = "accepted";
    entry.response.targetAgent = targetAgent;
    entry.response.acceptedAt = new Date();

    // Remove from pending queue
    const pending = this.pendingByRole.get(entry.request.targetRole) ?? [];
    const idx = pending.indexOf(handoffId);
    if (idx >= 0) {
      pending.splice(idx, 1);
    }

    logger.info(
      { handoffId, targetAgent, role: entry.request.targetRole },
      "Handoff accepted"
    );

    return true;
  }

  /**
   * Reject a handoff request.
   */
  rejectHandoff(handoffId: string, reason: string): boolean {
    const entry = this.handoffs.get(handoffId);
    if (!entry || entry.response.status !== "pending") {
      return false;
    }

    entry.response.status = "rejected";
    entry.response.error = reason;

    // Remove from pending queue
    const pending = this.pendingByRole.get(entry.request.targetRole) ?? [];
    const idx = pending.indexOf(handoffId);
    if (idx >= 0) {
      pending.splice(idx, 1);
    }

    logger.info({ handoffId, reason }, "Handoff rejected");

    return true;
  }

  /**
   * Complete a handoff with the result.
   */
  completeHandoff(handoffId: string, result: unknown): boolean {
    const entry = this.handoffs.get(handoffId);
    if (!entry || entry.response.status !== "accepted") {
      return false;
    }

    entry.response.status = "completed";
    entry.response.result = result;
    entry.response.completedAt = new Date();

    logger.info({ handoffId }, "Handoff completed");

    return true;
  }

  /**
   * Mark a handoff as failed.
   */
  failHandoff(handoffId: string, error: string): boolean {
    const entry = this.handoffs.get(handoffId);
    if (!entry) {
      return false;
    }

    entry.response.status = "failed";
    entry.response.error = error;

    logger.warn({ handoffId, error }, "Handoff failed");

    return true;
  }

  /**
   * Get pending handoffs for a specific agent role.
   */
  getPendingForRole(role: string): HandoffRequest[] {
    const ids = this.pendingByRole.get(role) ?? [];
    return ids
      .map((id) => this.handoffs.get(id)?.request)
      .filter((r): r is HandoffRequest => r !== undefined);
  }

  /**
   * Get the response/status for a handoff.
   */
  getHandoffStatus(handoffId: string): HandoffResponse | null {
    return this.handoffs.get(handoffId)?.response ?? null;
  }

  /**
   * Wait for a handoff to complete (polling-based).
   */
  async waitForCompletion(
    handoffId: string,
    timeoutMs = 300_000
  ): Promise<HandoffResponse> {
    const start = Date.now();
    const pollInterval = 1000;

    while (Date.now() - start < timeoutMs) {
      const entry = this.handoffs.get(handoffId);
      if (!entry) {
        throw new Error(`Handoff ${handoffId} not found`);
      }

      if (
        entry.response.status === "completed" ||
        entry.response.status === "failed" ||
        entry.response.status === "rejected"
      ) {
        return entry.response;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Handoff ${handoffId} timed out after ${timeoutMs}ms`);
  }
}
