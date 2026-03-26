import { z } from "zod";

// ---------- Enums ----------
export const oauthProviderSchema = z.enum(["github", "gitlab", "bitbucket"]);

export type OauthProvider = z.infer<typeof oauthProviderSchema>;

// ---------- OAuth Token ----------
export const oauthTokenSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  userId: z.string(),
  provider: oauthProviderSchema,
  accessToken: z.string().min(1),
  refreshToken: z.string().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  scopes: z.string().nullable().optional(),
  providerAccountId: z.string().nullable().optional(),
  providerUsername: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type OauthTokenOutput = z.infer<typeof oauthTokenSchema>;

// ---------- OAuth Authorize ----------
export const oauthAuthorizeInputSchema = z.object({
  provider: oauthProviderSchema,
  redirectUri: z.string().url().optional(),
});

export type OauthAuthorizeInput = z.infer<typeof oauthAuthorizeInputSchema>;

// ---------- OAuth Callback ----------
export const oauthCallbackInputSchema = z.object({
  code: z.string().min(1, "Authorization code is required"),
  state: z.string().min(1, "State parameter is required"),
});

export type OauthCallbackInput = z.infer<typeof oauthCallbackInputSchema>;

// ---------- OAuth Status ----------
export const oauthStatusSchema = z.object({
  provider: oauthProviderSchema,
  connected: z.boolean(),
  providerUsername: z.string().nullable(),
  expiresAt: z.string().datetime().nullable(),
});

export type OauthStatus = z.infer<typeof oauthStatusSchema>;

// ---------- List Repos ----------
export const listReposInputSchema = z.object({
  provider: oauthProviderSchema,
  search: z.string().optional(),
  page: z.number().int().positive().default(1),
  perPage: z.number().int().positive().max(100).default(30),
  sort: z.enum(["updated", "created", "name"]).default("updated"),
});

export type ListReposInput = z.infer<typeof listReposInputSchema>;

export const repoSchema = z.object({
  id: z.string(),
  name: z.string(),
  fullName: z.string(),
  description: z.string().nullable(),
  private: z.boolean(),
  defaultBranch: z.string(),
  language: z.string().nullable(),
  updatedAt: z.string(),
  htmlUrl: z.string(),
  cloneUrl: z.string(),
  owner: z.string(),
});

export type Repo = z.infer<typeof repoSchema>;

// ---------- Import Repo ----------
export const importRepoInputSchema = z.object({
  provider: oauthProviderSchema,
  repoFullName: z.string().min(1),
  branch: z.string().optional(),
  nameOverride: z.string().optional(),
  techStackPreset: z.string().optional(),
});

export type ImportRepoInput = z.infer<typeof importRepoInputSchema>;

// ---------- Disconnect ----------
export const oauthDisconnectInputSchema = z.object({
  provider: oauthProviderSchema,
});

export type OauthDisconnectInput = z.infer<typeof oauthDisconnectInputSchema>;
