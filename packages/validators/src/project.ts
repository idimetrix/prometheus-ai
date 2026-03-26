import { z } from "zod";

// ---------- Create / Update ----------
export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(1000).optional(),
  techStackPreset: z.string().optional(),
  repoUrl: z.string().url().optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

// ---------- Settings ----------
export const projectSettingsSchema = z.object({
  agentAggressiveness: z
    .enum(["balanced", "full_auto", "supervised"])
    .default("balanced"),
  ciLoopMaxIterations: z.number().int().min(1).max(50).default(20),
  parallelAgentCount: z.number().int().min(1).max(25).default(1),
  blueprintEnforcement: z
    .enum(["strict", "flexible", "advisory"])
    .default("strict"),
  testCoverageTarget: z.number().int().min(0).max(100).default(80),
  securityScanLevel: z
    .enum(["basic", "standard", "thorough"])
    .default("standard"),
  deployTarget: z.enum(["staging", "production", "manual"]).default("manual"),
  modelCostBudget: z.number().positive().nullable().optional(),
});

export const updateProjectSettingsSchema = projectSettingsSchema.partial();

// ---------- Repo ----------
export const connectRepoSchema = z.object({
  projectId: z.string().min(1),
  repoUrl: z.string().url(),
  branch: z.string().default("main"),
  provider: z.enum(["github", "gitlab"]).default("github"),
});

// ---------- Members ----------
export const addProjectMemberSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["owner", "contributor", "viewer"]).default("contributor"),
});

export const updateProjectMemberSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["owner", "contributor", "viewer"]),
});

export const removeProjectMemberSchema = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1),
});

// ---------- List / Query ----------
export const listProjectsSchema = z.object({
  status: z.enum(["active", "archived", "setup"]).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const getProjectSchema = z.object({
  projectId: z.string().min(1),
});

// ---------- Archive ----------
export const archiveProjectSchema = z.object({
  projectId: z.string().min(1),
});

// ---------- Output schemas ----------
export const projectOutputSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  repoUrl: z.string().nullable(),
  techStackPreset: z.string().nullable(),
  status: z.enum(["active", "archived", "setup"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const projectListOutputSchema = z.object({
  items: z.array(projectOutputSchema),
  nextCursor: z.string().nullable(),
});

export const projectMemberOutputSchema = z.object({
  projectId: z.string(),
  userId: z.string(),
  role: z.enum(["owner", "contributor", "viewer"]),
  name: z.string().nullable(),
  email: z.string(),
});

// ---------- Share / Fork ----------
export const shareProjectSchema = z.object({
  projectId: z.string().min(1),
  slug: z
    .string()
    .min(3)
    .max(60)
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      "Slug must be lowercase alphanumeric with hyphens, min 3 chars"
    )
    .optional(),
});

export const unshareProjectSchema = z.object({
  projectId: z.string().min(1),
});

export const forkProjectSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
});

export const getSharedProjectSchema = z.object({
  slug: z.string().min(3).max(60),
});

// ---------- Scaffold ----------
export const scaffoldProjectSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(2000).optional(),
    /** Use a specific template ID */
    template: z.string().optional(),
    /** Natural language prompt (alternative to template) */
    prompt: z.string().max(5000).optional(),
  })
  .refine((data) => data.template ?? data.prompt, {
    message: "Either 'template' or 'prompt' must be provided",
  });

export type ScaffoldProjectInput = z.infer<typeof scaffoldProjectSchema>;

// ---------- Types ----------
export type ShareProjectInput = z.infer<typeof shareProjectSchema>;
export type UnshareProjectInput = z.infer<typeof unshareProjectSchema>;
export type ForkProjectInput = z.infer<typeof forkProjectSchema>;
export type GetSharedProjectInput = z.infer<typeof getSharedProjectSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type ProjectSettingsInput = z.infer<typeof projectSettingsSchema>;
export type UpdateProjectSettingsInput = z.infer<
  typeof updateProjectSettingsSchema
>;
export type ConnectRepoInput = z.infer<typeof connectRepoSchema>;
export type AddProjectMemberInput = z.infer<typeof addProjectMemberSchema>;
export type UpdateProjectMemberInput = z.infer<
  typeof updateProjectMemberSchema
>;
export type RemoveProjectMemberInput = z.infer<
  typeof removeProjectMemberSchema
>;
export type ListProjectsInput = z.infer<typeof listProjectsSchema>;
export type GetProjectInput = z.infer<typeof getProjectSchema>;
export type ArchiveProjectInput = z.infer<typeof archiveProjectSchema>;
export type ProjectOutput = z.infer<typeof projectOutputSchema>;
export type ProjectListOutput = z.infer<typeof projectListOutputSchema>;
export type ProjectMemberOutput = z.infer<typeof projectMemberOutputSchema>;
