import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../trpc";
import { submitTaskSchema } from "@prometheus/validators";
import { tasks, taskSteps, sessions, projects } from "@prometheus/db";
import { generateId } from "@prometheus/utils";
import { agentTaskQueue } from "@prometheus/queue";

export const tasksRouter = router({
  submit: protectedProcedure
    .input(submitTaskSchema)
    .mutation(async ({ input, ctx }) => {
      // Verify session access
      const session = await ctx.db.query.sessions.findFirst({
        where: eq(sessions.id, input.sessionId),
        with: { project: { columns: { id: true, orgId: true } } },
      });
      if (!session || session.project.orgId !== ctx.orgId) {
        throw new Error("Session not found");
      }

      const id = generateId("task");
      const created = await ctx.db.insert(tasks).values({
        id,
        sessionId: input.sessionId,
        projectId: session.projectId,
        title: input.title,
        description: input.description ?? null,
        status: "queued",
        priority: 50,
      }).returning();
      const task = created[0]!;

      // Add to queue
      const job = await agentTaskQueue.add("agent-task", {
        taskId: id,
        sessionId: input.sessionId,
        projectId: session.projectId,
        orgId: ctx.orgId,
        userId: ctx.auth.userId,
        title: input.title,
        description: input.description ?? null,
        mode: session.mode,
        agentRole: null,
        planTier: "hobby",
        creditsReserved: 0,
      }, {
        priority: 50,
        jobId: id,
      });

      const waiting = await agentTaskQueue.getWaitingCount();

      return {
        id: task.id,
        sessionId: task.sessionId,
        title: task.title,
        status: task.status,
        queuePosition: waiting,
        estimatedWait: waiting < 5 ? "< 1 minute" : `~${waiting} minutes`,
      };
    }),

  get: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ input, ctx }) => {
      const task = await ctx.db.query.tasks.findFirst({
        where: eq(tasks.id, input.taskId),
        with: {
          steps: { orderBy: [taskSteps.stepNumber] },
          session: { columns: { id: true, mode: true } },
        },
      });
      return task ?? null;
    }),

  list: protectedProcedure
    .input(z.object({
      sessionId: z.string().optional(),
      projectId: z.string().optional(),
      status: z.enum(["pending", "queued", "running", "paused", "completed", "failed", "cancelled"]).optional(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      const conditions = [];
      if (input.sessionId) {
        conditions.push(eq(tasks.sessionId, input.sessionId));
      }
      if (input.projectId) {
        conditions.push(eq(tasks.projectId, input.projectId));
      }
      if (input.status) {
        conditions.push(eq(tasks.status, input.status));
      }

      const results = await ctx.db.query.tasks.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        orderBy: [desc(tasks.createdAt)],
        limit: input.limit,
      });

      return { tasks: results };
    }),

  cancel: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const [updated] = await ctx.db.update(tasks)
        .set({ status: "cancelled" })
        .where(eq(tasks.id, input.taskId))
        .returning();

      // Remove from queue if still waiting
      try {
        const job = await agentTaskQueue.getJob(input.taskId);
        if (job) await job.remove();
      } catch {
        // Job may already be processing
      }

      return { success: !!updated };
    }),
});
