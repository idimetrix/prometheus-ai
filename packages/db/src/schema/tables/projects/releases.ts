import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { releaseStatusEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { users } from "../users/users";
import { projects } from "./projects";

export const releases = pgTable(
  "releases",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    status: releaseStatusEnum("status").notNull().default("draft"),
    tagName: text("tag_name"),
    targetBranch: text("target_branch"),
    publishedAt: timestamp("published_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdBy: text("created_by").references(() => users.id),
    ...timestamps,
  },
  (table) => [
    index("releases_project_id_idx").on(table.projectId),
    index("releases_org_id_idx").on(table.orgId),
    index("releases_status_idx").on(table.status),
  ]
);
