import { boolean, index, integer, pgTable, text } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";

export const componentVersions = pgTable(
  "component_versions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    componentName: text("component_name").notNull(),
    code: text("code").notNull(),
    language: text("language").notNull().default("tsx"),
    screenshotUrl: text("screenshot_url"),
    version: integer("version").notNull(),
    parentVersionId: text("parent_version_id"),
    prompt: text("prompt"),
    approved: boolean("approved").notNull().default(false),
    exported: boolean("exported").notNull().default(false),
    ...timestamps,
  },
  (table) => [
    index("component_versions_session_id_idx").on(table.sessionId),
    index("component_versions_org_id_idx").on(table.orgId),
    index("component_versions_project_id_idx").on(table.projectId),
    index("component_versions_session_version_idx").on(
      table.sessionId,
      table.version
    ),
  ]
);
