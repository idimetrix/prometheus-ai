import { db, sessions } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import {
  type ContinueSessionData,
  EventPublisher,
  QueueEvents,
  sessionContinuationQueue,
} from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import { eq } from "drizzle-orm";

const logger = createLogger("queue-worker:continue-session");
const publisher = new EventPublisher();

/** Maximum wall-clock time per continuation job (30 minutes) */
const MAX_DURATION_MS = 30 * 60 * 1000;

const ORCHESTRATOR_URL =
  process.env.ORCHESTRATOR_URL ?? "http://localhost:4002";

export interface ContinueSessionResult {
  checkpointId: string | null;
  completed: boolean;
  creditsConsumed: number;
  iterationsRun: number;
  reason: "completed" | "budget_exhausted" | "time_limit" | "error" | "paused";
}

/**
 * Process a session continuation job. Loads the checkpoint, resumes
 * the agent loop, and runs until completion, budget exhaustion, or
 * time limit. On completion, saves a new checkpoint and optionally
 * enqueues the next continuation job.
 */
export async function processContinueSession(
  data: ContinueSessionData
): Promise<ContinueSessionResult> {
  const { sessionId, checkpointId, remainingCredits, iterationBudget, orgId } =
    data;

  logger.info(
    {
      sessionId,
      checkpointId,
      remainingCredits,
      iterationBudget,
    },
    "Continuing session from checkpoint"
  );

  const startTime = Date.now();

  try {
    // Call orchestrator to resume the session from checkpoint
    const response = await fetch(
      `${ORCHESTRATOR_URL}/session/${sessionId}/resume`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkpointId,
          iterationBudget,
          remainingCredits,
          maxDurationMs: MAX_DURATION_MS,
        }),
        signal: AbortSignal.timeout(MAX_DURATION_MS + 60_000), // Extra minute for cleanup
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(
        { sessionId, status: response.status, error: errorText },
        "Orchestrator resume failed"
      );
      throw new Error(
        `Orchestrator resume failed: ${response.status} ${errorText}`
      );
    }

    const result = (await response.json()) as {
      checkpointId: string | null;
      completed: boolean;
      creditsConsumed: number;
      iterationsRun: number;
      reason: string;
    };

    const elapsed = Date.now() - startTime;

    logger.info(
      {
        sessionId,
        completed: result.completed,
        iterationsRun: result.iterationsRun,
        creditsConsumed: result.creditsConsumed,
        elapsed,
        reason: result.reason,
      },
      "Session continuation finished"
    );

    // If not completed, determine next steps
    if (!result.completed && result.checkpointId) {
      const newRemainingCredits = remainingCredits - result.creditsConsumed;
      const newIterationBudget = iterationBudget - result.iterationsRun;

      if (newRemainingCredits <= 0) {
        // Budget exhausted — notify user
        await notifyBudgetExhausted(sessionId, orgId);
        await markSessionPaused(sessionId);

        return {
          completed: false,
          iterationsRun: result.iterationsRun,
          creditsConsumed: result.creditsConsumed,
          checkpointId: result.checkpointId,
          reason: "budget_exhausted",
        };
      }

      if (newIterationBudget <= 0) {
        // Iteration budget exhausted — notify user
        await notifyBudgetExhausted(sessionId, orgId);
        await markSessionPaused(sessionId);

        return {
          completed: false,
          iterationsRun: result.iterationsRun,
          creditsConsumed: result.creditsConsumed,
          checkpointId: result.checkpointId,
          reason: "budget_exhausted",
        };
      }

      // Enqueue next continuation job
      await sessionContinuationQueue.add(
        `continue-${sessionId}-${generateId("job")}`,
        {
          sessionId,
          checkpointId: result.checkpointId,
          remainingCredits: newRemainingCredits,
          iterationBudget: newIterationBudget,
          orgId,
        },
        {
          delay: 1000, // Small delay to allow cleanup
        }
      );

      logger.info(
        {
          sessionId,
          newCheckpointId: result.checkpointId,
          newRemainingCredits,
          newIterationBudget,
        },
        "Next continuation job enqueued"
      );

      return {
        completed: false,
        iterationsRun: result.iterationsRun,
        creditsConsumed: result.creditsConsumed,
        checkpointId: result.checkpointId,
        reason: "time_limit",
      };
    }

    return {
      completed: result.completed,
      iterationsRun: result.iterationsRun,
      creditsConsumed: result.creditsConsumed,
      checkpointId: result.checkpointId,
      reason: result.completed ? "completed" : "error",
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(
      { sessionId, checkpointId, error: msg },
      "Session continuation failed"
    );

    // Attempt to save error state
    await publisher
      .publishSessionEvent(sessionId, {
        type: QueueEvents.ERROR,
        data: {
          message: `Session continuation failed: ${msg}`,
          checkpointId,
        },
        timestamp: new Date().toISOString(),
      })
      .catch(() => {
        /* fire-and-forget */
      });

    return {
      completed: false,
      iterationsRun: 0,
      creditsConsumed: 0,
      checkpointId,
      reason: "error",
    };
  }
}

async function notifyBudgetExhausted(
  sessionId: string,
  _orgId: string
): Promise<void> {
  await publisher.publishSessionEvent(sessionId, {
    type: QueueEvents.AGENT_STATUS,
    data: {
      status: "paused",
      reason: "budget_exhausted",
      message:
        "Session paused: credit or iteration budget exhausted. Resume to continue.",
    },
    timestamp: new Date().toISOString(),
  });
}

async function markSessionPaused(sessionId: string): Promise<void> {
  try {
    await db
      .update(sessions)
      .set({ status: "paused" })
      .where(eq(sessions.id, sessionId));
  } catch (error) {
    logger.warn(
      { sessionId, error: String(error) },
      "Failed to mark session as paused"
    );
  }
}
