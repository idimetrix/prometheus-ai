import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { mcpConnections, mcpToolConfigs } from "./integrations";
import { oauthTokens } from "./oauth-tokens";
import { syncedIssues } from "./synced-issues";
import { syncedPullRequests } from "./synced-pull-requests";

export const insertMcpConnectionSchema = createInsertSchema(mcpConnections);
export const selectMcpConnectionSchema = createSelectSchema(mcpConnections);
export type McpConnection = typeof mcpConnections.$inferSelect;
export type NewMcpConnection = typeof mcpConnections.$inferInsert;

export const insertMcpToolConfigSchema = createInsertSchema(mcpToolConfigs);
export const selectMcpToolConfigSchema = createSelectSchema(mcpToolConfigs);
export type McpToolConfig = typeof mcpToolConfigs.$inferSelect;
export type NewMcpToolConfig = typeof mcpToolConfigs.$inferInsert;

export const insertOauthTokenSchema = createInsertSchema(oauthTokens);
export const selectOauthTokenSchema = createSelectSchema(oauthTokens);
export type OauthToken = typeof oauthTokens.$inferSelect;
export type NewOauthToken = typeof oauthTokens.$inferInsert;

export const insertSyncedIssueSchema = createInsertSchema(syncedIssues);
export const selectSyncedIssueSchema = createSelectSchema(syncedIssues);
export type SyncedIssue = typeof syncedIssues.$inferSelect;
export type NewSyncedIssue = typeof syncedIssues.$inferInsert;

export const insertSyncedPullRequestSchema =
  createInsertSchema(syncedPullRequests);
export const selectSyncedPullRequestSchema =
  createSelectSchema(syncedPullRequests);
export type SyncedPullRequest = typeof syncedPullRequests.$inferSelect;
export type NewSyncedPullRequest = typeof syncedPullRequests.$inferInsert;
