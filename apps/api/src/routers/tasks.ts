import type { Database } from "@prometheus/db";
import {
  creditBalances,
  creditReservations,
  creditTransactions,
  projects,
  sessions,
  taskSteps,
  tasks,
} from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { agentTaskQueue } from "@prometheus/queue";
import { generateId } from "@prometheus/utils";
import {
  CREDIT_COSTS,
  cancelTaskSchema,
  costEstimateSchema,
  getTaskSchema,
  listTasksSchema,
  submitTaskSchema,
  updateTaskSchema,
} from "@prometheus/validators";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("tasks-router");

/**
 * Verify that a task belongs to the caller's org via its project.
 * Returns the task row or throws TRPC NOT_FOUND.
 */
async function verifyTaskAccess(db: Database, taskId: string, orgId: string) {
  const task = await db.query.tasks.findFirst({
    where: eq(tasks.id, taskId),
    with: { project: { columns: { id: true, orgId: true } } },
  });

  if (!task || task.project.orgId !== orgId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
  }

  return task;
}

/**
 * Reserve credits for a task. Returns the reservation ID or throws if insufficient.
 * Uses SELECT ... FOR UPDATE to prevent concurrent over-booking.
 */
async function reserveCredits(
  database: Database,
  orgId: string,
  taskId: string,
  amount: number
): Promise<string> {
  const reservationId = generateId("cres");

  await database.transaction(async (tx) => {
    // Lock the balance row to prevent concurrent over-booking
    const [locked] = await tx
      .select()
      .from(creditBalances)
      .where(eq(creditBalances.orgId, orgId))
      .for("update");

    if (!locked) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "No credit balance found for this organization",
      });
    }

    const available = locked.balance - locked.reserved;
    if (available < amount) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Insufficient credits: need ${amount}, have ${available} available`,
      });
    }

    // Increment reserved amount
    await tx
      .update(creditBalances)
      .set({
        reserved: sql`${creditBalances.reserved} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(creditBalances.orgId, orgId));

    // Create reservation record
    await tx.insert(creditReservations).values({
      id: reservationId,
      orgId,
      taskId,
      amount,
      status: "active",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
    });
  });

  return reservationId;
}

/**
 * Release a credit reservation (refund on cancel).
 */
async function releaseCredits(
  db: Database,
  orgId: string,
  taskId: string
): Promise<number> {
  // Find active reservations for this task
  const reservation = await db.query.creditReservations.findFirst({
    where: and(
      eq(creditReservations.taskId, taskId),
      eq(creditReservations.orgId, orgId),
      eq(creditReservations.status, "active")
    ),
  });

  if (!reservation) {
    return 0;
  }

  // Release the reservation
  await db
    .update(creditReservations)
    .set({ status: "released" })
    .where(eq(creditReservations.id, reservation.id));

  // Decrease reserved on balance
  await db
    .update(creditBalances)
    .set({
      reserved: sql`GREATEST(${creditBalances.reserved} - ${reservation.amount}, 0)`,
      updatedAt: new Date(),
    })
    .where(eq(creditBalances.orgId, orgId));

  // Record refund transaction
  const balance = await db.query.creditBalances.findFirst({
    where: eq(creditBalances.orgId, orgId),
  });

  await db.insert(creditTransactions).values({
    id: generateId("ctx"),
    orgId,
    type: "refund",
    amount: reservation.amount,
    balanceAfter: balance?.balance ?? 0,
    taskId,
    description: `Credit reservation released for cancelled task ${taskId}`,
  });

  return reservation.amount;
}

export const tasksRouter = router({
  // ─── Submit Task (with credit reservation) ────────────────────────────
  submit: protectedProcedure
    .input(submitTaskSchema)
    .mutation(async ({ input, ctx }) => {
      // Verify session access via org
      const session = await ctx.db.query.sessions.findFirst({
        where: eq(sessions.id, input.sessionId),
        with: { project: { columns: { id: true, orgId: true } } },
      });
      if (!session || session.project.orgId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Session not found",
        });
      }

      if (session.status !== "active") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot submit task to a ${session.status} session`,
        });
      }

      const id = generateId("task");

      // Estimate credits needed and reserve
      const estimatedCredits = CREDIT_COSTS.medium_task; // default estimate
      let reservationId: string | null = null;
      try {
        reservationId = await reserveCredits(
          ctx.db,
          ctx.orgId,
          id,
          estimatedCredits
        );
      } catch (err) {
        if (err instanceof TRPCError) {
          throw err;
        }
        logger.warn(
          { taskId: id, error: err },
          "Credit reservation failed, proceeding without reservation"
        );
      }

      const [task] = await ctx.db
        .insert(tasks)
        .values({
          id,
          sessionId: input.sessionId,
          projectId: session.projectId,
          orgId: ctx.orgId,
          title: input.title,
          description: input.description ?? null,
          status: "queued",
          priority: input.priority ?? 50,
          agentRole: input.agentRole ?? null,
          creditsReserved: reservationId ? estimatedCredits : 0,
        })
        .returning();

      // Add to queue
      await agentTaskQueue.add(
        "agent-task",
        {
          taskId: id,
          sessionId: input.sessionId,
          projectId: session.projectId,
          orgId: ctx.orgId,
          userId: ctx.auth.userId,
          title: input.title,
          description: input.description ?? null,
          mode: session.mode,
          agentRole: input.agentRole ?? null,
          planTier: "hobby",
          creditsReserved: reservationId ? estimatedCredits : 0,
          dependsOn: input.dependsOn ?? [],
        },
        {
          priority: input.priority ?? 50,
          jobId: id,
        }
      );

      const waiting = await agentTaskQueue.getWaitingCount();

      logger.info(
        {
          taskId: id,
          sessionId: input.sessionId,
          creditsReserved: estimatedCredits,
        },
        "Task submitted"
      );

      return {
        id: task?.id,
        sessionId: task?.sessionId,
        projectId: task?.projectId,
        title: task?.title,
        status: task?.status,
        creditsReserved: task?.creditsReserved,
        queuePosition: waiting,
        estimatedWait: waiting < 5 ? "< 1 minute" : `~${waiting} minutes`,
      };
    }),

  // ─── Get Task with Steps ──────────────────────────────────────────────
  get: protectedProcedure.input(getTaskSchema).query(async ({ input, ctx }) => {
    await verifyTaskAccess(ctx.db, input.taskId, ctx.orgId);

    const task = await ctx.db.query.tasks.findFirst({
      where: eq(tasks.id, input.taskId),
      with: {
        steps: { orderBy: [taskSteps.stepNumber] },
        session: { columns: { id: true, mode: true, status: true } },
      },
    });

    return task ?? null;
  }),

  // ─── List Tasks (paginated with filters) ──────────────────────────────
  list: protectedProcedure
    .input(listTasksSchema)
    .query(async ({ input, ctx }) => {
      // RLS: always scope by orgId
      const conditions = [eq(tasks.orgId, ctx.orgId)];

      if (input.sessionId) {
        conditions.push(eq(tasks.sessionId, input.sessionId));
      }
      if (input.projectId) {
        // Verify project ownership
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            eq(projects.orgId, ctx.orgId)
          ),
          columns: { id: true },
        });
        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Project not found",
          });
        }
        conditions.push(eq(tasks.projectId, input.projectId));
      }
      if (input.status) {
        conditions.push(eq(tasks.status, input.status));
      }

      if (input.cursor) {
        const cursorTask = await ctx.db.query.tasks.findFirst({
          where: eq(tasks.id, input.cursor),
          columns: { createdAt: true },
        });
        if (cursorTask) {
          conditions.push(lt(tasks.createdAt, cursorTask.createdAt));
        }
      }

      const results = await ctx.db.query.tasks.findMany({
        where: and(...conditions),
        orderBy: [desc(tasks.createdAt)],
        limit: input.limit + 1,
        with: {
          session: { columns: { id: true, mode: true } },
        },
      });

      const hasMore = results.length > input.limit;
      const items = hasMore ? results.slice(0, input.limit) : results;

      return {
        tasks: items,
        nextCursor: hasMore ? items.at(-1)?.id : null,
      };
    }),

  // ─── Update Task Status ───────────────────────────────────────────────
  updateStatus: protectedProcedure
    .input(updateTaskSchema)
    .mutation(async ({ input, ctx }) => {
      await verifyTaskAccess(ctx.db, input.taskId, ctx.orgId);

      const updateData: Record<string, unknown> = {};
      if (input.title !== undefined) {
        updateData.title = input.title;
      }
      if (input.description !== undefined) {
        updateData.description = input.description;
      }
      if (input.priority !== undefined) {
        updateData.priority = input.priority;
      }

      if (input.status !== undefined) {
        updateData.status = input.status;

        // Set timestamp fields based on status transitions
        if (input.status === "running") {
          updateData.startedAt = new Date();
        } else if (input.status === "completed" || input.status === "failed") {
          updateData.completedAt = new Date();
        }
      }

      if (Object.keys(updateData).length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No fields to update",
        });
      }

      const [updated] = await ctx.db
        .update(tasks)
        .set(updateData)
        .where(and(eq(tasks.id, input.taskId), eq(tasks.orgId, ctx.orgId)))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
      }

      logger.info(
        { taskId: input.taskId, status: input.status },
        "Task updated"
      );
      return updated;
    }),

  // ─── Cancel Task (with credit refund) ─────────────────────────────────
  cancel: protectedProcedure
    .input(cancelTaskSchema)
    .mutation(async ({ input, ctx }) => {
      const task = await verifyTaskAccess(ctx.db, input.taskId, ctx.orgId);

      // Only allow cancelling tasks that aren't already completed/failed/cancelled
      const terminalStatuses = ["completed", "failed", "cancelled"];
      if (terminalStatuses.includes(task.status)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Task is already ${task.status} and cannot be cancelled`,
        });
      }

      // Cancel the task
      const [updated] = await ctx.db
        .update(tasks)
        .set({
          status: "cancelled",
          completedAt: new Date(),
        })
        .where(and(eq(tasks.id, input.taskId), eq(tasks.orgId, ctx.orgId)))
        .returning();

      // Release reserved credits
      let refundedCredits = 0;
      if (task.creditsReserved > 0) {
        refundedCredits = await releaseCredits(ctx.db, ctx.orgId, input.taskId);
      }

      // Remove from queue if still waiting
      try {
        const job = await agentTaskQueue.getJob(input.taskId);
        if (job) {
          await job.remove();
        }
      } catch {
        // Job may already be processing
      }

      logger.info(
        {
          taskId: input.taskId,
          refundedCredits,
          reason: input.reason,
        },
        "Task cancelled"
      );

      return {
        success: true,
        refundedCredits,
        task: updated as NonNullable<typeof updated>,
      };
    }),

  // ─── Task Cost Estimation ─────────────────────────────────────────────
  estimateCost: protectedProcedure
    .input(costEstimateSchema)
    .query(({ input }) => {
      const baseCostMap: Record<string, number> = {
        simple_fix: CREDIT_COSTS.simple_fix,
        medium_task: CREDIT_COSTS.medium_task,
        complex_task: CREDIT_COSTS.complex_task,
      };

      const modeAdjustmentMap: Record<string, number> = {
        ask: 0.4, // ask mode is cheaper
        plan: 0.8, // plan mode is slightly cheaper
        task: 1.0, // standard
        watch: 1.2, // watch mode uses more tokens
        fleet: 1.5, // fleet mode is more expensive
      };

      const baseCost =
        baseCostMap[input.complexity] ?? CREDIT_COSTS.medium_task;
      const modeAdjustment = modeAdjustmentMap[input.mode] ?? 1.0;
      const agentMultiplier = input.agentCount ?? 1;

      const estimatedCredits = Math.ceil(
        baseCost * modeAdjustment * agentMultiplier
      );
      // Assuming 1 credit ≈ $0.01
      const estimatedCostUsd = Number((estimatedCredits * 0.01).toFixed(2));

      return {
        estimatedCredits,
        estimatedCostUsd,
        breakdown: {
          baseCost,
          agentMultiplier,
          modeAdjustment,
        },
      };
    }),
});
