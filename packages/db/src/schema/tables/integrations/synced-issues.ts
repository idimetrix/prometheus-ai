import { boolean, index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { issueSyncProviderEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";
import { tasks } from "../tasks/tasks";

export const syncedIssues = pgTable(
  "synced_issues",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: issueSyncProviderEnum("provider").notNull(),
    externalId: text("external_id").notNull(),
    externalUrl: text("external_url"),
    title: text("title"),
    body: text("body"),
    externalStatus: text("external_status"),
    taskId: text("task_id").references(() => tasks.id, {
      onDelete: "set null",
    }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    assignedToAgent: boolean("assigned_to_agent").notNull().default(false),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    externalUpdatedAt: timestamp("external_updated_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (table) => [
    index("synced_issues_project_id_idx").on(table.projectId),
    index("synced_issues_org_id_idx").on(table.orgId),
    index("synced_issues_provider_idx").on(table.projectId, table.provider),
    index("synced_issues_external_id_idx").on(table.provider, table.externalId),
    index("synced_issues_assigned_idx").on(
      table.projectId,
      table.assignedToAgent
    ),
  ]
);
