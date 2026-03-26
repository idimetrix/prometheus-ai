import { relations } from "drizzle-orm";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";
import { playbookRuns } from "./playbook-runs";
import { playbooks } from "./playbooks";

export const playbooksRelations = relations(playbooks, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [playbooks.orgId],
    references: [organizations.id],
  }),
  runs: many(playbookRuns),
}));

export const playbookRunsRelations = relations(playbookRuns, ({ one }) => ({
  playbook: one(playbooks, {
    fields: [playbookRuns.playbookId],
    references: [playbooks.id],
  }),
  project: one(projects, {
    fields: [playbookRuns.projectId],
    references: [projects.id],
  }),
  session: one(sessions, {
    fields: [playbookRuns.sessionId],
    references: [sessions.id],
  }),
  organization: one(organizations, {
    fields: [playbookRuns.orgId],
    references: [organizations.id],
  }),
}));
