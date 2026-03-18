import { z } from "zod";

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  techStackPreset: z.string().optional(),
  repoUrl: z.string().url().optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

export const projectSettingsSchema = z.object({
  agentAggressiveness: z.enum(["balanced", "full_auto", "supervised"]).default("balanced"),
  ciLoopMaxIterations: z.number().int().min(1).max(50).default(20),
  parallelAgentCount: z.number().int().min(1).max(25).default(1),
  blueprintEnforcement: z.enum(["strict", "flexible", "advisory"]).default("strict"),
  testCoverageTarget: z.number().int().min(0).max(100).default(80),
  securityScanLevel: z.enum(["basic", "standard", "thorough"]).default("standard"),
  deployTarget: z.enum(["staging", "production", "manual"]).default("manual"),
  modelCostBudget: z.number().positive().nullable().optional(),
});

export const connectRepoSchema = z.object({
  projectId: z.string().min(1),
  repoUrl: z.string().url(),
  branch: z.string().default("main"),
  provider: z.enum(["github", "gitlab"]).default("github"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProjectSettingsInput = z.infer<typeof projectSettingsSchema>;
export type ConnectRepoInput = z.infer<typeof connectRepoSchema>;
