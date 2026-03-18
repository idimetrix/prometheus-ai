import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { submitTaskSchema } from "@prometheus/validators";

export const tasksRouter = router({
  submit: protectedProcedure
    .input(submitTaskSchema)
    .mutation(async ({ input, ctx }) => {
      // TODO: Submit task to BullMQ queue with priority
      return {
        id: `task_placeholder_${Date.now()}`,
        sessionId: input.sessionId,
        title: input.title,
        status: "queued" as const,
        queuePosition: 1,
        estimatedWait: "< 1 minute",
      };
    }),

  get: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ input }) => {
      // TODO: Get task from DB
      return {
        id: input.taskId,
        status: "pending" as const,
      };
    }),

  list: protectedProcedure
    .input(z.object({
      sessionId: z.string().optional(),
      projectId: z.string().optional(),
      status: z.enum(["pending", "queued", "running", "paused", "completed", "failed", "cancelled"]).optional(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ input, ctx }) => {
      // TODO: Query tasks from DB
      return { tasks: [] };
    }),

  cancel: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ input }) => {
      // TODO: Cancel task
      return { success: true };
    }),
});
