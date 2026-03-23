import { z } from "zod";

// ---------- Enums ----------
export const modelProviderSchema = z.enum([
  "anthropic",
  "openai",
  "google",
  "mistral",
  "groq",
  "together",
  "openrouter",
]);

// ---------- Add / Update provider ----------
export const addModelProviderSchema = z.object({
  provider: modelProviderSchema,
  modelId: z.string().min(1).max(100),
  apiKey: z.string().min(1),
  isDefault: z.boolean().default(false),
  priority: z.number().int().min(0).max(100).default(0),
});

export const updateModelConfigSchema = z.object({
  configId: z.string().min(1),
  apiKey: z.string().min(1).optional(),
  isDefault: z.boolean().optional(),
  priority: z.number().int().min(0).max(100).optional(),
});

export const removeModelConfigSchema = z.object({
  configId: z.string().min(1),
});

// ---------- Priority ----------
export const setModelPrioritySchema = z.object({
  configId: z.string().min(1),
  priority: z.number().int().min(0).max(100),
});

export const setDefaultModelSchema = z.object({
  configId: z.string().min(1),
});

// ---------- List / Query ----------
export const listModelConfigsSchema = z.object({
  provider: modelProviderSchema.optional(),
});

export const getModelConfigSchema = z.object({
  configId: z.string().min(1),
});

// ---------- Usage query ----------
export const getModelUsageSchema = z.object({
  sessionId: z.string().optional(),
  taskId: z.string().optional(),
  provider: modelProviderSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

// ---------- Output schemas ----------
export const modelConfigOutputSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  provider: z.string(),
  modelId: z.string(),
  isDefault: z.boolean(),
  priority: z.number(),
  hasApiKey: z.boolean(),
});

export const modelConfigListOutputSchema = z.object({
  items: z.array(modelConfigOutputSchema),
});

export const modelUsageOutputSchema = z.object({
  id: z.string(),
  provider: z.string(),
  model: z.string(),
  tokensIn: z.number(),
  tokensOut: z.number(),
  costUsd: z.number(),
  createdAt: z.string().datetime(),
});

export const modelUsageListOutputSchema = z.object({
  items: z.array(modelUsageOutputSchema),
  totalCostUsd: z.number(),
  totalTokensIn: z.number(),
  totalTokensOut: z.number(),
});

// ---------- Types ----------
export type AddModelProviderInput = z.infer<typeof addModelProviderSchema>;
export type UpdateModelConfigInput = z.infer<typeof updateModelConfigSchema>;
export type RemoveModelConfigInput = z.infer<typeof removeModelConfigSchema>;
export type SetModelPriorityInput = z.infer<typeof setModelPrioritySchema>;
export type SetDefaultModelInput = z.infer<typeof setDefaultModelSchema>;
export type ListModelConfigsInput = z.infer<typeof listModelConfigsSchema>;
export type GetModelConfigInput = z.infer<typeof getModelConfigSchema>;
export type GetModelUsageInput = z.infer<typeof getModelUsageSchema>;
export type ModelConfigOutput = z.infer<typeof modelConfigOutputSchema>;
export type ModelConfigListOutput = z.infer<typeof modelConfigListOutputSchema>;
export type ModelUsageOutput = z.infer<typeof modelUsageOutputSchema>;
export type ModelUsageListOutput = z.infer<typeof modelUsageListOutputSchema>;
