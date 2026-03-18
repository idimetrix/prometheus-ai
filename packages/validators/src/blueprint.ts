import { z } from "zod";

// ---------- Tech stack ----------
export const techStackItemSchema = z.object({
  category: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  version: z.string().max(50).optional(),
});

// ---------- Create / Update ----------
export const createBlueprintSchema = z.object({
  projectId: z.string().min(1),
  content: z.string().min(1).max(500_000),
  techStack: z.array(techStackItemSchema).default([]),
  version: z.string().min(1).max(50).default("1.0.0"),
});

export const updateBlueprintSchema = z.object({
  blueprintId: z.string().min(1),
  content: z.string().min(1).max(500_000).optional(),
  techStack: z.array(techStackItemSchema).optional(),
  version: z.string().min(1).max(50).optional(),
  isActive: z.boolean().optional(),
});

// ---------- Versions ----------
export const getBlueprintVersionSchema = z.object({
  blueprintId: z.string().min(1),
  version: z.string().min(1).max(50).optional(),
});

export const listBlueprintVersionsSchema = z.object({
  blueprintId: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
});

// ---------- Query ----------
export const getBlueprintSchema = z.object({
  blueprintId: z.string().min(1),
});

export const getProjectBlueprintSchema = z.object({
  projectId: z.string().min(1),
});

// ---------- Output schemas ----------
export const blueprintOutputSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  version: z.string(),
  content: z.string(),
  techStack: z.unknown(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
});

export const blueprintVersionOutputSchema = z.object({
  id: z.string(),
  blueprintId: z.string(),
  version: z.string(),
  diff: z.string(),
  changedBy: z.string(),
  createdAt: z.string().datetime(),
});

export const blueprintVersionListOutputSchema = z.object({
  items: z.array(blueprintVersionOutputSchema),
  nextCursor: z.string().nullable(),
});

// ---------- Types ----------
export type CreateBlueprintInput = z.infer<typeof createBlueprintSchema>;
export type UpdateBlueprintInput = z.infer<typeof updateBlueprintSchema>;
export type GetBlueprintVersionInput = z.infer<
  typeof getBlueprintVersionSchema
>;
export type ListBlueprintVersionsInput = z.infer<
  typeof listBlueprintVersionsSchema
>;
export type GetBlueprintInput = z.infer<typeof getBlueprintSchema>;
export type GetProjectBlueprintInput = z.infer<
  typeof getProjectBlueprintSchema
>;
export type BlueprintOutput = z.infer<typeof blueprintOutputSchema>;
export type BlueprintVersionOutput = z.infer<
  typeof blueprintVersionOutputSchema
>;
export type BlueprintVersionListOutput = z.infer<
  typeof blueprintVersionListOutputSchema
>;
