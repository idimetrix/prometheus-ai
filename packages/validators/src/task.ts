import { z } from "zod";

// ---------- Enums ----------
export const taskStatusSchema = z.enum([
  "pending",
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const agentRoleSchema = z.enum([
  "orchestrator",
  "discovery",
  "architect",
  "planner",
  "frontend_coder",
  "backend_coder",
  "integration_coder",
  "test_engineer",
  "ci_loop",
  "security_auditor",
  "deploy_engineer",
  "project_brain",
]);

export const taskComplexitySchema = z.enum([
  "simple_fix",
  "medium_task",
  "complex_task",
]);

// ---------- Submit / Update / Cancel ----------
export const submitTaskSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  priority: z.number().int().min(0).max(10).default(5),
  agentRole: agentRoleSchema.optional(),
});

export const updateTaskSchema = z.object({
  taskId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  priority: z.number().int().min(0).max(10).optional(),
  status: taskStatusSchema.optional(),
});

export const cancelTaskSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

// ---------- Fleet dispatch ----------
export const fleetDispatchSchema = z.object({
  sessionId: z.string().min(1),
  tasks: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(5000).optional(),
        agentRole: agentRoleSchema.optional(),
        priority: z.number().int().min(0).max(10).default(5),
      })
    )
    .min(1)
    .max(10),
});

// ---------- Cost estimation ----------
export const costEstimateSchema = z.object({
  complexity: taskComplexitySchema,
  mode: z.enum(["task", "ask", "plan", "watch", "fleet"]),
  agentCount: z.number().int().min(1).max(25).default(1),
});

export const costEstimateOutputSchema = z.object({
  estimatedCredits: z.number(),
  estimatedCostUsd: z.number(),
  breakdown: z.object({
    baseCost: z.number(),
    agentMultiplier: z.number(),
    modeAdjustment: z.number(),
  }),
});

// ---------- Task step ----------
export const taskStepSchema = z.object({
  taskId: z.string().min(1),
  stepNumber: z.number().int().min(1),
  description: z.string().max(5000),
  status: taskStatusSchema.default("pending"),
});

// ---------- List / Query ----------
export const listTasksSchema = z.object({
  sessionId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  status: taskStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const getTaskSchema = z.object({
  taskId: z.string().min(1),
});

// ---------- Output schemas ----------
export const taskOutputSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  projectId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: taskStatusSchema,
  priority: z.number(),
  agentRole: agentRoleSchema.nullable(),
  creditsReserved: z.number(),
  creditsConsumed: z.number(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

export const taskListOutputSchema = z.object({
  items: z.array(taskOutputSchema),
  nextCursor: z.string().nullable(),
});

// ---------- Types ----------
export type SubmitTaskInput = z.infer<typeof submitTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type CancelTaskInput = z.infer<typeof cancelTaskSchema>;
export type FleetDispatchInput = z.infer<typeof fleetDispatchSchema>;
export type CostEstimateInput = z.infer<typeof costEstimateSchema>;
export type CostEstimateOutput = z.infer<typeof costEstimateOutputSchema>;
export type TaskStepInput = z.infer<typeof taskStepSchema>;
export type ListTasksInput = z.infer<typeof listTasksSchema>;
export type GetTaskInput = z.infer<typeof getTaskSchema>;
export type TaskOutput = z.infer<typeof taskOutputSchema>;
export type TaskListOutput = z.infer<typeof taskListOutputSchema>;
