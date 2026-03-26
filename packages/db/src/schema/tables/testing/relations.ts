import { relations } from "drizzle-orm";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { users } from "../users/users";
import { visualBaselines } from "./visual-baselines";

export const visualBaselinesRelations = relations(
  visualBaselines,
  ({ one }) => ({
    project: one(projects, {
      fields: [visualBaselines.projectId],
      references: [projects.id],
    }),
    organization: one(organizations, {
      fields: [visualBaselines.orgId],
      references: [organizations.id],
    }),
    approver: one(users, {
      fields: [visualBaselines.approvedBy],
      references: [users.id],
    }),
  })
);
