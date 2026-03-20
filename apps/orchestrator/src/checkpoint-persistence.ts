import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";

const logger = createLogger("orchestrator:checkpoint-persistence");

/** State saved at a workflow checkpoint */
export interface CheckpointState {
  /** Serialized agent loop state */
  agentState: Record<string, unknown>;
  /** Partial results from completed steps */
  completedSteps: Array<{
    stepId: string;
    output: string;
    success: boolean;
  }>;
  /** Credits consumed so far */
  creditsConsumed: number;
  /** Files modified so far */
  modifiedFiles: string[];
  /** The current execution phase */
  phase: string;
  /** Timestamp of the checkpoint */
  savedAt: string;
  /** Tokens consumed so far */
  tokensUsed: { input: number; output: number };
}

/**
 * CheckpointPersistence saves and restores workflow state
 * to enable resumption after process restarts or failures.
 *
 * Checkpoints are saved before each LLM call so the agent loop
 * can resume from the exact point of failure.
 */
export class CheckpointPersistence {
  private readonly getDb: () => Promise<{
    insert: (table: unknown) => {
      values: (values: unknown) => Promise<void>;
    };
    select: (opts?: unknown) => {
      from: (table: unknown) => {
        where: (condition: unknown) => {
          orderBy: (order: unknown) => {
            limit: (
              n: number
            ) => Promise<Array<{ state: unknown; phase: string }>>;
          };
        };
      };
    };
  }>;

  constructor(
    getDb?: () => Promise<{
      insert: (table: unknown) => {
        values: (values: unknown) => Promise<void>;
      };
      select: (opts?: unknown) => {
        from: (table: unknown) => {
          where: (condition: unknown) => {
            orderBy: (order: unknown) => {
              limit: (
                n: number
              ) => Promise<Array<{ state: unknown; phase: string }>>;
            };
          };
        };
      };
    }>
  ) {
    this.getDb =
      getDb ??
      (() => {
        return Promise.reject(new Error("Database connection not configured"));
      });
  }

  /**
   * Save a checkpoint for the given session and task.
   */
  async save(
    sessionId: string,
    taskId: string,
    phase: string,
    state: CheckpointState
  ): Promise<void> {
    try {
      const db = await this.getDb();
      await db.insert("workflow_checkpoints" as unknown).values({
        id: generateId("ckpt"),
        sessionId,
        taskId,
        phase,
        state,
        createdAt: new Date(),
      });

      logger.info({ sessionId, taskId, phase }, "Checkpoint saved");
    } catch (error) {
      logger.error(
        { error, sessionId, taskId, phase },
        "Failed to save checkpoint"
      );
      throw error;
    }
  }

  /**
   * Restore the latest checkpoint for a session and task.
   * Returns null if no checkpoint exists.
   */
  async restore(
    sessionId: string,
    taskId: string
  ): Promise<CheckpointState | null> {
    try {
      const db = await this.getDb();
      const rows = await db
        .select()
        .from("workflow_checkpoints" as unknown)
        .where({ sessionId, taskId } as unknown)
        .orderBy({ createdAt: "desc" } as unknown)
        .limit(1);

      if (rows.length === 0) {
        logger.debug({ sessionId, taskId }, "No checkpoint found");
        return null;
      }

      const checkpoint = rows[0];
      if (!checkpoint) {
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

  /**
   * Create a checkpoint state from current execution context.
   * Call this before each LLM invocation for maximum recoverability.
   */
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
