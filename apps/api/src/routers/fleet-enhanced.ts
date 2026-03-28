import { fleetBatches, tasks } from "@prometheus/db";
import { createLogger } from "@prometheus/logger";
import { generateId } from "@prometheus/utils";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";

const logger = createLogger("fleet-enhanced-router");

export const fleetEnhancedRouter = router({
  /**
   * Submit a batch of tasks for parallel execution.
   */
  submitBatch: protectedProcedure
    .input(
      z.object({
        name: z.string().max(200).optional(),
        tasks: z
          .array(
            z.object({
              title: z.string().min(1).max(500),
              description: z.string().max(10_000).optional(),
              projectId: z.string().min(1),
            })
          )
          .min(1, "At least one task is required")
          .max(50, "Maximum 50 tasks per batch"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const batchId = generateId("fb");

      await ctx.db.insert(fleetBatches).values({
        id: batchId,
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        name: input.name ?? `Batch ${new Date().toISOString()}`,
        status: "pending",
        totalTasks: input.tasks.length,
        completedTasks: 0,
        failedTasks: 0,
      });

      const createdTasks: Array<{ id: string; title: string }> = [];

      for (const task of input.tasks) {
        const taskId = generateId("task");
        await ctx.db.insert(tasks).values({
          id: taskId,
          sessionId: batchId,
          projectId: task.projectId,
          orgId: ctx.orgId,
          title: task.title,
          description: task.description ?? null,
          status: "pending",
          priority: 50,
        });
        createdTasks.push({ id: taskId, title: task.title });
      }

      logger.info(
        { batchId, taskCount: input.tasks.length, orgId: ctx.orgId },
        "Fleet batch submitted"
      );

      return { batchId, tasks: createdTasks };
    }),

  /**
   * Get the status of all tasks in a batch.
   */
  getBatchStatus: protectedProcedure
    .input(z.object({ batchId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const batch = await ctx.db.query.fleetBatches.findFirst({
        where: and(
          eq(fleetBatches.id, input.batchId),
          eq(fleetBatches.orgId, ctx.orgId)
        ),
      });

      if (!batch) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Batch not found",
        });
      }

      const batchTasks = await ctx.db.query.tasks.findMany({
        where: eq(tasks.sessionId, input.batchId),
        orderBy: [desc(tasks.createdAt)],
      });

      return {
        batch: {
          id: batch.id,
          name: batch.name,
          status: batch.status,
          totalTasks: batch.totalTasks,
          completedTasks: batch.completedTasks,
          failedTasks: batch.failedTasks,
          createdAt: batch.createdAt.toISOString(),
          updatedAt: batch.updatedAt.toISOString(),
        },
        tasks: batchTasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          agentRole: t.agentRole,
          creditsConsumed: t.creditsConsumed,
          startedAt: t.startedAt?.toISOString() ?? null,
          completedAt: t.completedAt?.toISOString() ?? null,
        })),
      };
    }),

  /**
   * Cancel all pending/running tasks in a batch.
   */
  cancelBatch: protectedProcedure
    .input(z.object({ batchId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const batch = await ctx.db.query.fleetBatches.findFirst({
        where: and(
          eq(fleetBatches.id, input.batchId),
          eq(fleetBatches.orgId, ctx.orgId)
        ),
      });

      if (!batch) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Batch not found",
        });
      }

      // Cancel pending tasks
      await ctx.db
        .update(tasks)
        .set({ status: "failed", completedAt: new Date() })
        .where(
          and(eq(tasks.sessionId, input.batchId), eq(tasks.status, "pending"))
        );

      // Update batch status
      await ctx.db
        .update(fleetBatches)
        .set({ status: "failed" })
        .where(eq(fleetBatches.id, input.batchId));

      logger.info(
        { batchId: input.batchId, orgId: ctx.orgId },
        "Fleet batch cancelled"
      );

      return { success: true };
    }),

  /**
   * List all batches for the org.
   */
  listBatches: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(100).default(20),
          offset: z.number().int().min(0).default(0),
        })
        .optional()
        .default({ limit: 20, offset: 0 })
    )
    .query(async ({ input, ctx }) => {
      const batches = await ctx.db.query.fleetBatches.findMany({
        where: eq(fleetBatches.orgId, ctx.orgId),
        orderBy: [desc(fleetBatches.createdAt)],
        limit: input.limit,
        offset: input.offset,
      });

      return {
        items: batches.map((b) => ({
          id: b.id,
          name: b.name,
          status: b.status,
          totalTasks: b.totalTasks,
          completedTasks: b.completedTasks,
          failedTasks: b.failedTasks,
          createdAt: b.createdAt.toISOString(),
          updatedAt: b.updatedAt.toISOString(),
        })),
      };
    }),
});
