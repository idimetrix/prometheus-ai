import { relations } from "drizzle-orm";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { mcpConnections, mcpToolConfigs } from "./integrations";

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
