/**
 * CompoundLoop — Implements the Plan → Fan-out → Gather → Judge → Revise cycle.
 *
 * Flow:
 *   1. PlannerAgent decomposes task into DAG
 *   2. WorkerPool fans out subtasks respecting dependencies
 *   3. Results gathered from all workers
 *   4. JudgeAgent evaluates quality
 *   5. If verdict is "revise", loop back (max 3 cycles)
 *   6. If verdict is "approve" or max revisions reached, complete
 */
import { createLogger } from "@prometheus/logger";
import {
  JudgeAgent,
  type JudgmentResult,
  type WorkerResult,
} from "./judge-agent";
import { PlannerAgent, type TaskPlan } from "./planner-agent";
import { type Worker, WorkerPool } from "./worker-pool";

const logger = createLogger("orchestrator:compound:loop");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompoundContext {
  /** Optional architectural blueprint */
  blueprint?: string;
  /** Maximum revision cycles before forced completion */
  maxRevisions?: number;
  /** Organization ID for resource limits */
  orgId: string;
  /** Plan tier for worker pool sizing */
  planTier: string;
  /** Project context for the planner */
  projectContext?: string;
  /** Project ID */
  projectId: string;
  /** Session ID for event scoping */
  sessionId: string;
  /** High-level task to accomplish */
  taskDescription: string;
  /** User ID */
  userId: string;
}

export type CompoundEventType =
  | "plan_created"
  | "workers_dispatched"
  | "worker_started"
  | "worker_completed"
  | "worker_failed"
  | "gather_complete"
  | "judge_verdict"
  | "revision_requested"
  | "complete";

export interface CompoundEvent {
  data: Record<string, unknown>;
  sessionId: string;
  timestamp: string;
  type: CompoundEventType;
}

export interface CompoundResult {
  /** All events emitted during execution */
  events: CompoundEvent[];
  /** Final judgment from the last evaluation */
  finalJudgment: JudgmentResult | null;
  /** The generated plan */
  plan: TaskPlan;
  /** Number of revision cycles executed */
  revisionCount: number;
  /** Whether the loop completed successfully */
  success: boolean;
  /** All worker results from the final iteration */
  workerResults: WorkerResult[];
}

const DEFAULT_MAX_REVISIONS = 3;

// ---------------------------------------------------------------------------
// CompoundLoop
// ---------------------------------------------------------------------------

export class CompoundLoop {
  private readonly planner: PlannerAgent;
  private readonly judge: JudgeAgent;

  constructor() {
    this.planner = new PlannerAgent();
    this.judge = new JudgeAgent();
  }

  /**
   * Execute the compound loop as an async generator, yielding events
   * at each stage for real-time client updates.
   */
  async *execute(ctx: CompoundContext): AsyncGenerator<CompoundEvent> {
    const maxRevisions = ctx.maxRevisions ?? DEFAULT_MAX_REVISIONS;
    const events: CompoundEvent[] = [];

    // --- Step 1: Plan ---
    logger.info(
      { sessionId: ctx.sessionId, task: ctx.taskDescription.slice(0, 100) },
      "CompoundLoop: starting plan phase"
    );

    const plan = this.planner.plan(
      ctx.taskDescription,
      ctx.projectContext ?? "",
      ctx.blueprint
    );

    const planEvent = this.createEvent(ctx.sessionId, "plan_created", {
      planId: plan.id,
      subtaskCount: plan.subtasks.length,
      dependencyCount: plan.dependencies.length,
      estimatedCredits: plan.estimatedCredits,
    });
    events.push(planEvent);
    yield planEvent;

    // --- Steps 2-5: Execute → Gather → Judge → Revise loop ---
    let workerResults: WorkerResult[] = [];
    let finalJudgment: JudgmentResult | null = null;
    let revisionCount = 0;

    for (let cycle = 0; cycle <= maxRevisions; cycle++) {
      // Step 2: Fan-out workers
      const pool = new WorkerPool({
        sessionId: ctx.sessionId,
        orgId: ctx.orgId,
        planTier: ctx.planTier,
      });

      const dispatchEvent = this.createEvent(
        ctx.sessionId,
        "workers_dispatched",
        {
          cycle,
          subtaskCount: plan.subtasks.length,
          maxWorkers: pool.getUtilization().maxWorkers,
        }
      );
      events.push(dispatchEvent);
      yield dispatchEvent;

      // Execute subtasks respecting dependencies
      workerResults = await this.executeSubtasks(
        plan,
        pool,
        ctx,
        events,
        cycle
      );

      // Yield gather complete
      const gatherEvent = this.createEvent(ctx.sessionId, "gather_complete", {
        cycle,
        totalResults: workerResults.length,
        successCount: workerResults.filter((r) => r.success).length,
        failedCount: workerResults.filter((r) => !r.success).length,
      });
      events.push(gatherEvent);
      yield gatherEvent;

      // Step 3: Judge
      finalJudgment = this.judge.judge(workerResults, {
        taskDescription: ctx.taskDescription,
        blueprint: ctx.blueprint,
      });

      const judgeEvent = this.createEvent(ctx.sessionId, "judge_verdict", {
        cycle,
        judgmentId: finalJudgment.id,
        verdict: finalJudgment.verdict,
        score: finalJudgment.score,
        feedbackCount: finalJudgment.feedback.length,
      });
      events.push(judgeEvent);
      yield judgeEvent;

      // Step 4: Check verdict
      if (finalJudgment.verdict === "approve") {
        logger.info(
          { sessionId: ctx.sessionId, cycle, score: finalJudgment.score },
          "CompoundLoop: judge approved"
        );
        break;
      }

      if (finalJudgment.verdict === "reject") {
        logger.warn(
          { sessionId: ctx.sessionId, cycle, score: finalJudgment.score },
          "CompoundLoop: judge rejected"
        );
        // On reject, we still allow retries up to maxRevisions
      }

      // Step 5: Request revision (if not at max)
      if (cycle < maxRevisions) {
        revisionCount++;

        const revisionEvent = this.createEvent(
          ctx.sessionId,
          "revision_requested",
          {
            cycle,
            revisionCount,
            feedbackItems: finalJudgment.feedback.length,
            criticalIssues: finalJudgment.feedback.filter(
              (f) => f.severity === "critical"
            ).length,
          }
        );
        events.push(revisionEvent);
        yield revisionEvent;

        logger.info(
          { sessionId: ctx.sessionId, cycle, revisionCount },
          "CompoundLoop: requesting revision"
        );
      } else {
        logger.warn(
          { sessionId: ctx.sessionId, revisionCount: maxRevisions },
          "CompoundLoop: max revisions reached, forcing completion"
        );
      }

      // Drain the pool before next cycle
      pool.drain();
    }

    // --- Step 6: Complete ---
    const completeEvent = this.createEvent(ctx.sessionId, "complete", {
      success: finalJudgment?.verdict === "approve",
      revisionCount,
      finalScore: finalJudgment?.score ?? 0,
      totalWorkerResults: workerResults.length,
    });
    events.push(completeEvent);
    yield completeEvent;

    logger.info(
      {
        sessionId: ctx.sessionId,
        success: finalJudgment?.verdict === "approve",
        revisionCount,
        finalScore: finalJudgment?.score ?? 0,
      },
      "CompoundLoop: execution complete"
    );
  }

  /**
   * Execute a full compound loop and collect all results (non-streaming).
   */
  async run(ctx: CompoundContext): Promise<CompoundResult> {
    const events: CompoundEvent[] = [];
    let revisionCount = 0;
    let success = false;
    let finalScore = 0;

    for await (const event of this.execute(ctx)) {
      events.push(event);

      if (event.type === "complete") {
        revisionCount = (event.data.revisionCount as number) ?? 0;
        success = (event.data.success as boolean) ?? false;
        finalScore = (event.data.finalScore as number) ?? 0;
      }
    }

    // Generate plan for the result (the execute generator already used it internally)
    const plan = this.planner.plan(
      ctx.taskDescription,
      ctx.projectContext ?? "",
      ctx.blueprint
    );

    return {
      success,
      plan,
      workerResults: [],
      finalJudgment:
        finalScore > 0
          ? {
              id: "run-result",
              verdict: success ? "approve" : "reject",
              score: finalScore,
              dimensions: [],
              feedback: [],
            }
          : null,
      revisionCount,
      events,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Execute subtasks from the plan using the worker pool,
   * respecting dependency ordering.
   */
  private async executeSubtasks(
    plan: TaskPlan,
    pool: WorkerPool,
    ctx: CompoundContext,
    events: CompoundEvent[],
    cycle: number
  ): Promise<WorkerResult[]> {
    const results: WorkerResult[] = [];
    const completed = new Set<string>();

    // Build dependency map: subtaskId -> set of IDs it depends on (blocks only)
    const blockingDeps = new Map<string, Set<string>>();
    for (const subtask of plan.subtasks) {
      blockingDeps.set(subtask.id, new Set());
    }
    for (const dep of plan.dependencies) {
      if (dep.type === "blocks") {
        const deps = blockingDeps.get(dep.from);
        if (deps) {
          deps.add(dep.to);
        }
      }
    }

    // Process subtasks in waves (topological order)
    while (completed.size < plan.subtasks.length) {
      // Find ready subtasks (all blocking deps completed)
      const ready = plan.subtasks.filter((t) => {
        if (completed.has(t.id)) {
          return false;
        }
        const deps = blockingDeps.get(t.id);
        if (!deps) {
          return true;
        }
        for (const dep of deps) {
          if (!completed.has(dep)) {
            return false;
          }
        }
        return true;
      });

      if (ready.length === 0) {
        // All remaining tasks have unmet dependencies — possible cycle or all done
        logger.warn(
          { completed: completed.size, total: plan.subtasks.length },
          "No ready subtasks, breaking"
        );
        break;
      }

      // Execute ready subtasks in parallel
      const wavePromises = ready.map(async (subtask) => {
        const worker = await pool.acquireWorker(subtask.agentRole, subtask.id);

        const startEvent = this.createEvent(ctx.sessionId, "worker_started", {
          cycle,
          workerId: worker.id,
          taskId: subtask.id,
          agentRole: subtask.agentRole,
          title: subtask.title,
        });
        events.push(startEvent);

        pool.startWorker(worker.id);

        try {
          const result = await this.executeWorker(worker, subtask, ctx);
          pool.releaseWorker(worker.id);

          const completeEvent = this.createEvent(
            ctx.sessionId,
            "worker_completed",
            {
              cycle,
              workerId: worker.id,
              taskId: subtask.id,
              agentRole: subtask.agentRole,
              success: result.success,
              filesChanged: result.filesChanged.length,
            }
          );
          events.push(completeEvent);

          return result;
        } catch (error) {
          const errorMsg =
            error instanceof Error ? error.message : String(error);
          pool.failWorker(worker.id, errorMsg);

          const failEvent = this.createEvent(ctx.sessionId, "worker_failed", {
            cycle,
            workerId: worker.id,
            taskId: subtask.id,
            agentRole: subtask.agentRole,
            error: errorMsg,
          });
          events.push(failEvent);

          return {
            workerId: worker.id,
            taskId: subtask.id,
            agentRole: subtask.agentRole,
            success: false,
            output: "",
            filesChanged: [],
            error: errorMsg,
          } satisfies WorkerResult;
        }
      });

      const waveResults = await Promise.all(wavePromises);
      results.push(...waveResults);

      // Mark all ready subtasks as completed
      for (const subtask of ready) {
        completed.add(subtask.id);
      }
    }

    return results;
  }

  /**
   * Execute a single worker's subtask.
   * Executes a subtask in a dedicated AgentLoop with the assigned
   * role and task description.
   */
  private async executeWorker(
    worker: Worker,
    subtask: {
      id: string;
      title: string;
      description: string;
      agentRole: string;
    },
    ctx: CompoundContext
  ): Promise<WorkerResult> {
    try {
      // Create an AgentLoop for this worker's subtask execution
      const { AgentLoop } = await import("../agent-loop");
      const agentLoop = new AgentLoop(
        ctx.sessionId,
        ctx.projectId,
        ctx.orgId,
        ctx.userId
      );

      const result = await agentLoop.executeTask(
        subtask.description,
        subtask.agentRole
      );

      return {
        workerId: worker.id,
        taskId: subtask.id,
        agentRole: subtask.agentRole,
        success: result.success,
        output: result.output,
        filesChanged: result.filesChanged,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        { workerId: worker.id, taskId: subtask.id, error: msg },
        "Worker execution failed"
      );
      return {
        workerId: worker.id,
        taskId: subtask.id,
        agentRole: subtask.agentRole,
        success: false,
        output: `Worker failed: ${msg}`,
        filesChanged: [],
      };
    }
  }

  private createEvent(
    sessionId: string,
    type: CompoundEventType,
    data: Record<string, unknown>
  ): CompoundEvent {
    return {
      type,
      sessionId,
      data,
      timestamp: new Date().toISOString(),
    };
  }
}
