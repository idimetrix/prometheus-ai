import { z } from "zod";

export const createSessionSchema = z.object({
  projectId: z.string().min(1),
  mode: z.enum(["task", "ask", "plan", "watch", "fleet"]).default("task"),
  prompt: z.string().min(1).max(10000).optional(),
});

export const sessionActionSchema = z.object({
  sessionId: z.string().min(1),
});

export const sendMessageSchema = z.object({
  sessionId: z.string().min(1),
  content: z.string().min(1).max(10000),
});

export const approvePlanSchema = z.object({
  sessionId: z.string().min(1),
  stepId: z.string().optional(),
  approved: z.boolean().default(true),
  feedback: z.string().max(2000).optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type SessionActionInput = z.infer<typeof sessionActionSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ApprovePlanInput = z.infer<typeof approvePlanSchema>;
