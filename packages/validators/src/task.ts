import { z } from "zod";

export const submitTaskSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
});

export type SubmitTaskInput = z.infer<typeof submitTaskSchema>;
