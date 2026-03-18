import { relations } from "drizzle-orm";
import { projects } from "../projects/projects";
import { blueprints, blueprintVersions } from "./blueprints";

export const blueprintsRelations = relations(blueprints, ({ one, many }) => ({
  project: one(projects, {
    fields: [blueprints.projectId],
    references: [projects.id],
  }),
  versions: many(blueprintVersions),
}));

export const blueprintVersionsRelations = relations(
  blueprintVersions,
  ({ one }) => ({
    blueprint: one(blueprints, {
      fields: [blueprintVersions.blueprintId],
      references: [blueprints.id],
    }),
  })
);
