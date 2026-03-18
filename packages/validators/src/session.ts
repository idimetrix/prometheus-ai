import { z } from "zod";

// ---------- Enums ----------
export const sessionModeSchema = z.enum([
  "task",
  "ask",
  "plan",
  "watch",
  "fleet",
]);
export const sessionStatusSchema = z.enum([
  "active",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
export const sessionEventTypeSchema = z.enum([
  "agent_output",
  "file_change",
  "plan_update",
  "task_status",
  "queue_position",
  "credit_update",
  "checkpoint",
  "error",
  "reasoning",
  "terminal_output",
  "browser_screenshot",
]);

// ---------- Create / Update ----------
export const createSessionSchema = z.object({
  projectId: z.string().min(1),
  mode: sessionModeSchema.default("task"),
  prompt: z.string().min(1).max(10_000).optional(),
});

export const updateSessionSchema = z.object({
  sessionId: z.string().min(1),
  status: sessionStatusSchema.optional(),
  mode: sessionModeSchema.optional(),
});

// ---------- Actions ----------
export const sessionActionSchema = z.object({
  sessionId: z.string().min(1),
});

export const sendMessageSchema = z.object({
  sessionId: z.string().min(1),
  content: z.string().min(1).max(10_000),
});

export const approvePlanSchema = z.object({
  sessionId: z.string().min(1),
  stepId: z.string().optional(),
  approved: z.boolean().default(true),
  feedback: z.string().max(2000).optional(),
});

export const resumeSessionSchema = z.object({
  sessionId: z.string().min(1),
  prompt: z.string().max(10_000).optional(),
});

export const pauseSessionSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export const cancelSessionSchema = z.object({
  sessionId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

// ---------- Session events ----------
export const sessionEventSchema = z.object({
  type: sessionEventTypeSchema,
  data: z.record(z.string(), z.unknown()),
  agentRole: z.string().optional(),
  timestamp: z.string().datetime(),
});

// ---------- List / Query ----------
export const listSessionsSchema = z.object({
  projectId: z.string().min(1).optional(),
  status: sessionStatusSchema.optional(),
  mode: sessionModeSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const getSessionSchema = z.object({
  sessionId: z.string().min(1),
});

// ---------- Output schemas ----------
export const sessionOutputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  userId: z.string(),
  status: sessionStatusSchema,
  mode: sessionModeSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().nullable(),
});

export const sessionListOutputSchema = z.object({
  items: z.array(sessionOutputSchema),
  nextCursor: z.string().nullable(),
});

// ---------- Types ----------
export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type SessionActionInput = z.infer<typeof sessionActionSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type ApprovePlanInput = z.infer<typeof approvePlanSchema>;
export type ResumeSessionInput = z.infer<typeof resumeSessionSchema>;
export type PauseSessionInput = z.infer<typeof pauseSessionSchema>;
export type CancelSessionInput = z.infer<typeof cancelSessionSchema>;
export type SessionEventInput = z.infer<typeof sessionEventSchema>;
export type ListSessionsInput = z.infer<typeof listSessionsSchema>;
export type GetSessionInput = z.infer<typeof getSessionSchema>;
export type SessionOutput = z.infer<typeof sessionOutputSchema>;
export type SessionListOutput = z.infer<typeof sessionListOutputSchema>;
