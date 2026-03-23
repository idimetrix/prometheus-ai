import { z } from "zod";

// ---------- Enums ----------
export const agentRoleEnum = z.enum([
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

export const agentStatusEnum = z.enum([
  "idle",
  "working",
  "error",
  "terminated",
]);

// ---------- Config ----------
export const agentConfigSchema = z.object({
  role: agentRoleEnum,
  model: z.string().min(1).max(100),
  systemPrompt: z.string().max(50_000).optional(),
  tools: z.array(z.string().min(1)).default([]),
  maxTokens: z.number().int().min(256).max(200_000).default(8192),
  temperature: z.number().min(0).max(2).default(0.7),
});

export const updateAgentConfigSchema = agentConfigSchema.partial().extend({
  role: agentRoleEnum,
});

// ---------- Role selection ----------
export const selectAgentRoleSchema = z.object({
  sessionId: z.string().min(1),
  role: agentRoleEnum,
  model: z.string().min(1).max(100).optional(),
});

// ---------- Agent control ----------
export const terminateAgentSchema = z.object({
  agentId: z.string().min(1),
  reason: z.string().max(500).optional(),
});

export const reassignAgentSchema = z.object({
  agentId: z.string().min(1),
  taskId: z.string().min(1),
});

// ---------- List / Query ----------
export const listAgentsSchema = z.object({
  sessionId: z.string().min(1).optional(),
  status: agentStatusEnum.optional(),
  role: agentRoleEnum.optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const getAgentSchema = z.object({
  agentId: z.string().min(1),
});

// ---------- Output schemas ----------
export const agentOutputSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: agentRoleEnum,
  status: agentStatusEnum,
  modelUsed: z.string().nullable(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  stepsCompleted: z.number(),
  currentTaskId: z.string().nullable(),
  startedAt: z.string().datetime(),
  lastActiveAt: z.string().datetime(),
  terminatedAt: z.string().datetime().nullable(),
});

export const agentListOutputSchema = z.object({
  items: z.array(agentOutputSchema),
});

// ---------- Types ----------
export type AgentConfigInput = z.infer<typeof agentConfigSchema>;
export type UpdateAgentConfigInput = z.infer<typeof updateAgentConfigSchema>;
export type SelectAgentRoleInput = z.infer<typeof selectAgentRoleSchema>;
export type TerminateAgentInput = z.infer<typeof terminateAgentSchema>;
export type ReassignAgentInput = z.infer<typeof reassignAgentSchema>;
export type ListAgentsInput = z.infer<typeof listAgentsSchema>;
export type GetAgentInput = z.infer<typeof getAgentSchema>;
export type AgentOutput = z.infer<typeof agentOutputSchema>;
export type AgentListOutput = z.infer<typeof agentListOutputSchema>;
