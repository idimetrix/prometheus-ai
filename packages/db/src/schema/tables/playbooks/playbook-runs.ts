import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { playbookRunStatusEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";
import { playbooks } from "./playbooks";

export const playbookRuns = pgTable(
  "playbook_runs",
  {
    id: text("id").primaryKey(),
    playbookId: text("playbook_id")
      .notNull()
      .references(() => playbooks.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    parameters: jsonb("parameters").notNull().default({}),
    status: playbookRunStatusEnum("status").notNull().default("pending"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    result: jsonb("result"),
    ...timestamps,
  },
  (table) => [
    index("playbook_runs_playbook_id_idx").on(table.playbookId),
    index("playbook_runs_project_id_idx").on(table.projectId),
    index("playbook_runs_org_id_idx").on(table.orgId),
    index("playbook_runs_status_idx").on(table.status),
  ]
);
