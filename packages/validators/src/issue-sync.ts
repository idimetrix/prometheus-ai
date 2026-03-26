import { z } from "zod";

// ---------- Enums ----------
export const issueSyncProviderSchema = z.enum([
  "github",
  "gitlab",
  "bitbucket",
  "linear",
  "jira",
]);

export const ciStatusSchema = z.enum([
  "pending",
  "running",
  "passed",
  "failed",
]);

export const prReviewStatusSchema = z.enum([
  "pending",
  "approved",
  "changes_requested",
]);

// ---------- List Synced Issues ----------
export const listSyncedIssuesSchema = z.object({
  projectId: z.string().min(1),
  provider: issueSyncProviderSchema.optional(),
  status: z.string().optional(),
  assignedToAgent: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// ---------- List Synced PRs ----------
export const listSyncedPRsSchema = z.object({
  projectId: z.string().min(1),
  provider: issueSyncProviderSchema.optional(),
  ciStatus: ciStatusSchema.optional(),
  reviewStatus: prReviewStatusSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// ---------- Sync Issues ----------
export const syncIssuesSchema = z.object({
  projectId: z.string().min(1),
  provider: issueSyncProviderSchema,
});

// ---------- Sync PRs ----------
export const syncPRsSchema = z.object({
  projectId: z.string().min(1),
  provider: issueSyncProviderSchema,
});

// ---------- Assign to Agent ----------
export const assignToAgentSchema = z.object({
  issueId: z.string().min(1),
});

// ---------- Unlink Issue ----------
export const unlinkIssueSchema = z.object({
  issueId: z.string().min(1),
});

// ---------- Get Sync Status ----------
export const getSyncStatusSchema = z.object({
  projectId: z.string().min(1),
});

// ---------- Push Status Update ----------
export const pushStatusUpdateSchema = z.object({
  issueId: z.string().min(1),
  status: z.string().min(1),
});

// ---------- Push Comment ----------
export const pushCommentSchema = z.object({
  issueId: z.string().min(1),
  comment: z.string().min(1).max(10_000),
});

// ---------- Push PR Link ----------
export const pushPRLinkSchema = z.object({
  issueId: z.string().min(1),
  prUrl: z.string().url(),
  prTitle: z.string().optional(),
});

// ---------- Types ----------
export type ListSyncedIssuesInput = z.infer<typeof listSyncedIssuesSchema>;
export type ListSyncedPRsInput = z.infer<typeof listSyncedPRsSchema>;
export type SyncIssuesInput = z.infer<typeof syncIssuesSchema>;
export type SyncPRsInput = z.infer<typeof syncPRsSchema>;
export type AssignToAgentInput = z.infer<typeof assignToAgentSchema>;
export type UnlinkIssueInput = z.infer<typeof unlinkIssueSchema>;
export type GetSyncStatusInput = z.infer<typeof getSyncStatusSchema>;
export type PushStatusUpdateInput = z.infer<typeof pushStatusUpdateSchema>;
export type PushCommentInput = z.infer<typeof pushCommentSchema>;
export type PushPRLinkInput = z.infer<typeof pushPRLinkSchema>;
