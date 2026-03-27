import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";

/**
 * Persistent sandbox environments for long-running development sessions.
 *
 * Unlike ephemeral sandboxes that are destroyed after each task, persistent
 * sandboxes maintain state across sessions and can be suspended/resumed.
 * Useful for dev, test, and staging environments.
 */
export const persistentSandboxes = pgTable(
  "persistent_sandboxes",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(
        () => `psb_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`
      ),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    sessionId: text("session_id"),
    containerId: text("container_id"),
    hostWorkDir: text("host_work_dir"),
    /** Status: active, suspended, terminated */
    status: text("status").notNull().default("active"),
    /** Purpose: dev, test, staging */
    purpose: text("purpose").default("dev"),
    snapshotUrl: text("snapshot_url"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    ...timestamps,
  },
  (table) => [
    index("persistent_sandboxes_org_id_idx").on(table.orgId),
    index("persistent_sandboxes_project_id_idx").on(table.projectId),
    index("persistent_sandboxes_session_id_idx").on(table.sessionId),
    index("persistent_sandboxes_status_idx").on(table.orgId, table.status),
    index("persistent_sandboxes_purpose_idx").on(table.orgId, table.purpose),
  ]
);

export type PersistentSandbox = typeof persistentSandboxes.$inferSelect;
export type NewPersistentSandbox = typeof persistentSandboxes.$inferInsert;
