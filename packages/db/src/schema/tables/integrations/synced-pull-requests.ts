import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import {
  ciStatusEnum,
  issueSyncProviderEnum,
  prReviewStatusEnum,
} from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";

export const syncedPullRequests = pgTable(
  "synced_pull_requests",
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
    branch: text("branch"),
    baseBranch: text("base_branch"),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    ciStatus: ciStatusEnum("ci_status"),
    reviewStatus: prReviewStatusEnum("review_status"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    externalUpdatedAt: timestamp("external_updated_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (table) => [
    index("synced_prs_project_id_idx").on(table.projectId),
    index("synced_prs_org_id_idx").on(table.orgId),
    index("synced_prs_provider_idx").on(table.projectId, table.provider),
    index("synced_prs_external_id_idx").on(table.provider, table.externalId),
    index("synced_prs_session_id_idx").on(table.sessionId),
  ]
);
