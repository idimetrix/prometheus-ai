import { z } from "zod";

export const createSessionSchema = z.object({
  projectId: z.string().min(1),
  mode: z.enum(["task", "ask", "plan", "watch", "fleet"]).default("task"),
  prompt: z.string().min(1).max(10000).optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
