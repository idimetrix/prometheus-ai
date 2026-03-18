import { pgTable, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { projects } from "./projects";

export const blueprints = pgTable("blueprints", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  content: text("content").notNull(),
  techStack: jsonb("tech_stack").notNull().default({}),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const blueprintVersions = pgTable("blueprint_versions", {
  id: text("id").primaryKey(),
  blueprintId: text("blueprint_id").notNull().references(() => blueprints.id, { onDelete: "cascade" }),
  version: text("version").notNull(),
  diff: text("diff").notNull(),
  changedBy: text("changed_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const techStackPresets = pgTable("tech_stack_presets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  configJson: jsonb("config_json").notNull().default({}),
  icon: text("icon"),
});

export const blueprintsRelations = relations(blueprints, ({ one, many }) => ({
  project: one(projects, {
    fields: [blueprints.projectId],
    references: [projects.id],
  }),
  versions: many(blueprintVersions),
}));

export const blueprintVersionsRelations = relations(blueprintVersions, ({ one }) => ({
  blueprint: one(blueprints, {
    fields: [blueprintVersions.blueprintId],
    references: [blueprints.id],
  }),
}));
