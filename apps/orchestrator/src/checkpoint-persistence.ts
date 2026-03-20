import { db, workflowCheckpoints } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { and, desc, eq } from "drizzle-orm";

const logger = createLogger("orchestrator:checkpoint-persistence");

export interface CheckpointState {
  agentState: Record<string, unknown>;
  completedSteps: Array<{
    stepId: string;
    output: string;
    success: boolean;
  }>;
  creditsConsumed: number;
  modifiedFiles: string[];
  phase: string;
  savedAt: string;
  tokensUsed: { input: number; output: number };
}

export class CheckpointPersistence {
  private readonly orgId: string;

  constructor(orgId: string) {
    this.orgId = orgId;
  }

  async save(
    sessionId: string,
    taskId: string,
    phase: string,
    state: CheckpointState,
    iteration?: number
  ): Promise<void> {
    try {
      await db.insert(workflowCheckpoints).values({
        id: generateId("ckpt"),
        sessionId,
        taskId,
        orgId: this.orgId,
        phase,
        iteration: iteration == null ? null : String(iteration),
        state,
        createdAt: new Date(),
      });

      logger.info({ sessionId, taskId, phase, iteration }, "Checkpoint saved");
    } catch (error) {
      logger.error(
        { error, sessionId, taskId, phase },
        "Failed to save checkpoint"
      );
      throw error;
    }
  }

  async restore(
    sessionId: string,
    taskId: string
  ): Promise<CheckpointState | null> {
    try {
      const rows = await db
        .select()
        .from(workflowCheckpoints)
        .where(
          and(
            eq(workflowCheckpoints.sessionId, sessionId),
            eq(workflowCheckpoints.taskId, taskId),
            eq(workflowCheckpoints.orgId, this.orgId)
          )
        )
        .orderBy(desc(workflowCheckpoints.createdAt))
        .limit(1);

      const checkpoint = rows[0];
      if (!checkpoint) {
        logger.debug({ sessionId, taskId }, "No checkpoint found");
        return null;
      }

      logger.info(
        { sessionId, taskId, phase: checkpoint.phase },
        "Checkpoint restored"
      );

      return checkpoint.state as CheckpointState;
    } catch (error) {
      logger.error(
        { error, sessionId, taskId },
        "Failed to restore checkpoint"
      );
      return null;
    }
  }

  static createState(opts: {
    phase: string;
    agentState: Record<string, unknown>;
    modifiedFiles: string[];
    tokensUsed: { input: number; output: number };
    creditsConsumed: number;
    completedSteps: Array<{
      stepId: string;
      output: string;
      success: boolean;
    }>;
  }): CheckpointState {
    return {
      phase: opts.phase,
      agentState: opts.agentState,
      modifiedFiles: opts.modifiedFiles,
      tokensUsed: opts.tokensUsed,
      creditsConsumed: opts.creditsConsumed,
      savedAt: new Date().toISOString(),
      completedSteps: opts.completedSteps,
    };
  }
}
