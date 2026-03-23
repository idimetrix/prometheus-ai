import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { projects } from "../projects/projects";

export const blueprints = pgTable(
  "blueprints",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    content: text("content").notNull(),
    techStack: jsonb("tech_stack").notNull().default({}),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("blueprints_project_id_idx").on(table.projectId),
    index("blueprints_project_active_idx").on(table.projectId, table.isActive),
  ]
);

export const blueprintVersions = pgTable(
  "blueprint_versions",
  {
    id: text("id").primaryKey(),
    blueprintId: text("blueprint_id")
      .notNull()
      .references(() => blueprints.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    diff: text("diff").notNull(),
    changedBy: text("changed_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("blueprint_versions_blueprint_id_idx").on(table.blueprintId),
  ]
);

export const techStackPresets = pgTable("tech_stack_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  configJson: jsonb("config_json").notNull().default({}),
  icon: text("icon"),
});
