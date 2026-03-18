import { z } from "zod";

// ========== User Settings ==========

export const updateUserSettingsSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  defaultModel: z.string().max(100).nullable().optional(),
  notificationsEnabled: z.boolean().optional(),
});

export const getUserSettingsSchema = z.object({});

// ---------- Output ----------
export const userSettingsOutputSchema = z.object({
  userId: z.string(),
  theme: z.enum(["light", "dark", "system"]),
  defaultModel: z.string().nullable(),
  notificationsEnabled: z.boolean(),
});

// ========== Organization Settings ==========

export const updateOrgSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with dashes")
    .optional(),
});

// ---------- Org members ----------
export const inviteOrgMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]).default("member"),
});

export const updateOrgMemberRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(["owner", "admin", "member"]),
});

export const removeOrgMemberSchema = z.object({
  userId: z.string().min(1),
});

export const listOrgMembersSchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// ---------- API keys ----------
export const createApiKeySchema = z.object({
  name: z.string().min(1).max(100),
});

export const revokeApiKeySchema = z.object({
  keyId: z.string().min(1),
});

export const listApiKeysSchema = z.object({});

// ---------- Output ----------
export const orgOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  planTier: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const orgMemberOutputSchema = z.object({
  orgId: z.string(),
  userId: z.string(),
  role: z.enum(["owner", "admin", "member"]),
  name: z.string().nullable(),
  email: z.string(),
  joinedAt: z.string().datetime().nullable(),
});

export const orgMemberListOutputSchema = z.object({
  items: z.array(orgMemberOutputSchema),
  nextCursor: z.string().nullable(),
});

export const apiKeyOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  lastUsed: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable(),
});

export const apiKeyCreatedOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  createdAt: z.string().datetime(),
});

export const apiKeyListOutputSchema = z.object({
  items: z.array(apiKeyOutputSchema),
});

// ---------- Types ----------
export type UpdateUserSettingsInput = z.infer<typeof updateUserSettingsSchema>;
export type UserSettingsOutput = z.infer<typeof userSettingsOutputSchema>;
export type UpdateOrgInput = z.infer<typeof updateOrgSchema>;
export type InviteOrgMemberInput = z.infer<typeof inviteOrgMemberSchema>;
export type UpdateOrgMemberRoleInput = z.infer<
  typeof updateOrgMemberRoleSchema
>;
export type RemoveOrgMemberInput = z.infer<typeof removeOrgMemberSchema>;
export type ListOrgMembersInput = z.infer<typeof listOrgMembersSchema>;
export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type RevokeApiKeyInput = z.infer<typeof revokeApiKeySchema>;
export type OrgOutput = z.infer<typeof orgOutputSchema>;
export type OrgMemberOutput = z.infer<typeof orgMemberOutputSchema>;
export type OrgMemberListOutput = z.infer<typeof orgMemberListOutputSchema>;
export type ApiKeyOutput = z.infer<typeof apiKeyOutputSchema>;
export type ApiKeyCreatedOutput = z.infer<typeof apiKeyCreatedOutputSchema>;
export type ApiKeyListOutput = z.infer<typeof apiKeyListOutputSchema>;
