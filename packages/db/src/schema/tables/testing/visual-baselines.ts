import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { id, timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { users } from "../users/users";

export const viewportEnum = pgEnum("viewport", ["desktop", "tablet", "mobile"]);

export const visualBaselines = pgTable(
  "visual_baselines",
  {
    id,
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pagePath: text("page_path").notNull(),
    viewport: viewportEnum("viewport").notNull(),
    screenshotUrl: text("screenshot_url").notNull(),
    width: integer("width"),
    height: integer("height"),
    hash: text("hash"),
    approvedBy: text("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("visual_baselines_project_id_idx").on(table.projectId),
    index("visual_baselines_org_id_idx").on(table.orgId),
    index("visual_baselines_project_viewport_idx").on(
      table.projectId,
      table.viewport
    ),
    index("visual_baselines_project_path_idx").on(
      table.projectId,
      table.pagePath
    ),
  ]
);
