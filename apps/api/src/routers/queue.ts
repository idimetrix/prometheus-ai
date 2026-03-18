import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../trpc";

export const queueRouter = router({
  position: protectedProcedure
    .input(z.object({ taskId: z.string() }))
    .query(async ({ input }) => {
      // TODO: Get queue position from BullMQ
      return {
        taskId: input.taskId,
        position: 0,
        estimatedWaitSeconds: 0,
        totalInQueue: 0,
      };
    }),

  stats: publicProcedure.query(async () => {
    // TODO: Get queue stats from BullMQ
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
    };
  }),
});
