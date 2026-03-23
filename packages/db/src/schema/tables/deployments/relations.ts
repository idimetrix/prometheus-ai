import { relations } from "drizzle-orm";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";
import { deployments } from "./deployments";

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  project: one(projects, {
    fields: [deployments.projectId],
    references: [projects.id],
  }),
  session: one(sessions, {
    fields: [deployments.sessionId],
    references: [sessions.id],
  }),
  organization: one(organizations, {
    fields: [deployments.orgId],
    references: [organizations.id],
  }),
}));
