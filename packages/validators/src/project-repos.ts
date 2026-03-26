import { z } from "zod";

export const repoProviderSchema = z.enum(["github", "gitlab", "bitbucket"]);
export const workspaceTypeSchema = z.enum([
  "pnpm",
  "npm",
  "yarn",
  "nx",
  "turbo",
  "lerna",
  "rush",
  "cargo",
  "go",
]);
export const repoIndexStatusSchema = z.enum([
  "pending",
  "indexing",
  "indexed",
  "failed",
]);

export const addProjectRepoSchema = z.object({
  projectId: z.string().min(1),
  repoUrl: z.string().url(),
  provider: repoProviderSchema,
  defaultBranch: z.string().default("main"),
  isMonorepo: z.boolean().default(false),
  workspaceType: workspaceTypeSchema.nullable().default(null),
  rootPath: z.string().default("/"),
});

export const removeProjectRepoSchema = z.object({
  projectId: z.string().min(1),
  repoId: z.string().min(1),
});

export const reindexProjectRepoSchema = z.object({
  projectId: z.string().min(1),
  repoId: z.string().min(1),
});

export const setDefaultRepoSchema = z.object({
  projectId: z.string().min(1),
  repoId: z.string().min(1),
});

export const listProjectReposSchema = z.object({
  projectId: z.string().min(1),
});

export type AddProjectRepoInput = z.infer<typeof addProjectRepoSchema>;
export type RemoveProjectRepoInput = z.infer<typeof removeProjectRepoSchema>;
export type ReindexProjectRepoInput = z.infer<typeof reindexProjectRepoSchema>;
export type SetDefaultRepoInput = z.infer<typeof setDefaultRepoSchema>;
export type ListProjectReposInput = z.infer<typeof listProjectReposSchema>;
