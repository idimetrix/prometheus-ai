import { relations } from "drizzle-orm";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";
import { componentVersions } from "./component-versions";

export const componentVersionsRelations = relations(
  componentVersions,
  ({ one }) => ({
    session: one(sessions, {
      fields: [componentVersions.sessionId],
      references: [sessions.id],
    }),
    organization: one(organizations, {
      fields: [componentVersions.orgId],
      references: [organizations.id],
    }),
    project: one(projects, {
      fields: [componentVersions.projectId],
      references: [projects.id],
    }),
    parentVersion: one(componentVersions, {
      fields: [componentVersions.parentVersionId],
      references: [componentVersions.id],
    }),
  })
);
