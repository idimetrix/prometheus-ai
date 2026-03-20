import { createLogger } from "@prometheus/logger";

const logger = createLogger("orchestrator:workflow:cancellation");

/** Result of a workflow cancellation */
export interface CancellationResult {
  /** Whether a checkpoint was saved */
  checkpointSaved: boolean;
  /** Credits released back to the org */
  creditsReleased: number;
  /** Reason for cancellation */
  reason: string;
  /** The session that was cancelled */
  sessionId: string;
  /** Whether the cancellation was successful */
  success: boolean;
}

/**
 * Cancel a running workflow, saving its checkpoint and releasing
 * reserved credits.
 *
 * This function:
 * 1. Signals the agent loop to stop
 * 2. Saves the current state as a checkpoint
 * 3. Releases any reserved credits
 * 4. Emits a cancellation event
 */
export async function cancelWorkflow(
  sessionId: string,
  reason: string,
  opts?: {
    /** Function to stop the agent loop */
    stopAgentLoop?: (sessionId: string) => Promise<void>;
    /** Function to save a checkpoint */
    saveCheckpoint?: (sessionId: string, reason: string) => Promise<boolean>;
    /** Function to release reserved credits */
    releaseCredits?: (sessionId: string) => Promise<number>;
    /** Function to emit a cancellation event */
    emitEvent?: (event: {
      name: string;
      data: Record<string, unknown>;
    }) => Promise<void>;
  }
): Promise<CancellationResult> {
  logger.info({ sessionId, reason }, "Cancelling workflow");

  let checkpointSaved = false;
  let creditsReleased = 0;

  try {
    // 1. Stop the agent loop
    if (opts?.stopAgentLoop) {
      await opts.stopAgentLoop(sessionId);
      logger.info({ sessionId }, "Agent loop stopped");
    }

    // 2. Save checkpoint
    if (opts?.saveCheckpoint) {
      checkpointSaved = await opts.saveCheckpoint(sessionId, reason);
      logger.info({ sessionId, checkpointSaved }, "Checkpoint saved on cancel");
    }

    // 3. Release reserved credits
    if (opts?.releaseCredits) {
      creditsReleased = await opts.releaseCredits(sessionId);
      logger.info({ sessionId, creditsReleased }, "Reserved credits released");
    }

    // 4. Emit cancellation event
    if (opts?.emitEvent) {
      await opts.emitEvent({
        name: "prometheus/agent.execution.cancelled",
        data: {
          sessionId,
          reason,
          checkpointSaved,
          creditsReleased,
        },
      });
    }

    logger.info(
      { sessionId, reason, checkpointSaved, creditsReleased },
      "Workflow cancelled successfully"
    );

    return {
      success: true,
      sessionId,
      reason,
      checkpointSaved,
      creditsReleased,
    };
  } catch (error) {
    logger.error({ error, sessionId, reason }, "Failed to cancel workflow");

    return {
      success: false,
      sessionId,
      reason: `Cancellation failed: ${error instanceof Error ? error.message : String(error)}`,
      checkpointSaved,
      creditsReleased,
    };
  }
}
