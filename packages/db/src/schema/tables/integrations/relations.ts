import { relations } from "drizzle-orm";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";
import { tasks } from "../tasks/tasks";
import { mcpConnections, mcpToolConfigs } from "./integrations";
import { oauthTokens } from "./oauth-tokens";
import { syncedIssues } from "./synced-issues";
import { syncedPullRequests } from "./synced-pull-requests";

export const mcpConnectionsRelations = relations(mcpConnections, ({ one }) => ({
  organization: one(organizations, {
    fields: [mcpConnections.orgId],
    references: [organizations.id],
  }),
}));

export const mcpToolConfigsRelations = relations(mcpToolConfigs, ({ one }) => ({
  project: one(projects, {
    fields: [mcpToolConfigs.projectId],
    references: [projects.id],
  }),
}));

export const oauthTokensRelations = relations(oauthTokens, ({ one }) => ({
  organization: one(organizations, {
    fields: [oauthTokens.orgId],
    references: [organizations.id],
  }),
}));

export const syncedIssuesRelations = relations(syncedIssues, ({ one }) => ({
  project: one(projects, {
    fields: [syncedIssues.projectId],
    references: [projects.id],
  }),
  organization: one(organizations, {
    fields: [syncedIssues.orgId],
    references: [organizations.id],
  }),
  task: one(tasks, {
    fields: [syncedIssues.taskId],
    references: [tasks.id],
  }),
  session: one(sessions, {
    fields: [syncedIssues.sessionId],
    references: [sessions.id],
  }),
}));

export const syncedPullRequestsRelations = relations(
  syncedPullRequests,
  ({ one }) => ({
    project: one(projects, {
      fields: [syncedPullRequests.projectId],
      references: [projects.id],
    }),
    organization: one(organizations, {
      fields: [syncedPullRequests.orgId],
      references: [organizations.id],
    }),
    session: one(sessions, {
      fields: [syncedPullRequests.sessionId],
      references: [sessions.id],
    }),
  })
);
