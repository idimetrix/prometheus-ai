import { agentTaskQueue } from "@prometheus/queue";
import { z } from "zod";
import { protectedProcedure, publicProcedure, router } from "../trpc";

export const queueRouter = router({
  position: protectedProcedure
    .input(z.object({ taskId: z.string().min(1, "Task ID is required") }))
    .query(async ({ input }) => {
      const job = await agentTaskQueue.getJob(input.taskId);
      if (!job) {
        return {
          taskId: input.taskId,
          position: -1,
          estimatedWaitSeconds: 0,
          totalInQueue: 0,
        };
      }

      const waiting = await agentTaskQueue.getWaitingCount();
      const active = await agentTaskQueue.getActiveCount();

      // Estimate position based on job state
      const state = await job.getState();
      let position = 0;
      if (state === "waiting") {
        const waitingJobs = await agentTaskQueue.getWaiting(0, 100);
        position = waitingJobs.findIndex((j) => j.id === input.taskId) + 1;
      } else if (state === "active") {
        position = 0;
      }

      return {
        taskId: input.taskId,
        position,
        estimatedWaitSeconds: position * 60,
        totalInQueue: waiting + active,
      };
    }),

  stats: publicProcedure.query(async () => {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      agentTaskQueue.getWaitingCount(),
      agentTaskQueue.getActiveCount(),
      agentTaskQueue.getCompletedCount(),
      agentTaskQueue.getFailedCount(),
      agentTaskQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }),
});
