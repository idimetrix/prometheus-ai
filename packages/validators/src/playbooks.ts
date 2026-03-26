import { z } from "zod";

// ---------- Enums ----------
export const playbookCategorySchema = z.enum([
  "code_quality",
  "feature",
  "devops",
  "testing",
  "security",
  "refactoring",
  "custom",
]);

export const playbookRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);

// ---------- Step & Parameter Definitions ----------
export const playbookStepSchema = z.object({
  order: z.number().int().min(1),
  title: z.string().min(1).max(200),
  description: z.string().max(2000),
  agentRole: z.string().optional(),
  expectedOutput: z.string().max(500).optional(),
});

export const playbookParameterSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(["string", "number", "boolean", "select"]),
  description: z.string().max(500).optional(),
  required: z.boolean().default(true),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.string()).optional(),
});

// ---------- Create / Update ----------
export const createPlaybookSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: playbookCategorySchema.default("custom"),
  steps: z.array(playbookStepSchema).min(1).max(50),
  parameters: z.array(playbookParameterSchema).max(20).default([]),
  isPublic: z.boolean().default(false),
  tags: z.array(z.string().min(1).max(50)).max(10).default([]),
});

export const updatePlaybookSchema = z.object({
  playbookId: z.string().min(1),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  category: playbookCategorySchema.optional(),
  steps: z.array(playbookStepSchema).min(1).max(50).optional(),
  parameters: z.array(playbookParameterSchema).max(20).optional(),
  isPublic: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(50)).max(10).optional(),
});

// ---------- Run ----------
export const runPlaybookSchema = z.object({
  playbookId: z.string().min(1),
  projectId: z.string().min(1),
  parameters: z.record(z.string(), z.unknown()).default({}),
});

// ---------- List / Query ----------
export const listPlaybooksSchema = z.object({
  category: playbookCategorySchema.optional(),
  search: z.string().max(200).optional(),
  builtinOnly: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const getPlaybookSchema = z.object({
  playbookId: z.string().min(1),
});

export const deletePlaybookSchema = z.object({
  playbookId: z.string().min(1),
});

export const listPlaybookRunsSchema = z.object({
  playbookId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  status: playbookRunStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

// ---------- Types ----------
export type CreatePlaybookInput = z.infer<typeof createPlaybookSchema>;
export type UpdatePlaybookInput = z.infer<typeof updatePlaybookSchema>;
export type RunPlaybookInput = z.infer<typeof runPlaybookSchema>;
export type ListPlaybooksInput = z.infer<typeof listPlaybooksSchema>;
export type GetPlaybookInput = z.infer<typeof getPlaybookSchema>;
export type DeletePlaybookInput = z.infer<typeof deletePlaybookSchema>;
export type ListPlaybookRunsInput = z.infer<typeof listPlaybookRunsSchema>;
export type PlaybookStep = z.infer<typeof playbookStepSchema>;
export type PlaybookParameter = z.infer<typeof playbookParameterSchema>;
