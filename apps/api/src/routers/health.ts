import { router, publicProcedure } from "../trpc";

export const healthRouter = router({
  check: publicProcedure.query(() => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    version: "0.0.1",
  })),
});
