import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { blueprints, blueprintVersions, techStackPresets } from "./blueprints";

export const insertBlueprintSchema = createInsertSchema(blueprints);
export const selectBlueprintSchema = createSelectSchema(blueprints);
export type Blueprint = typeof blueprints.$inferSelect;
export type NewBlueprint = typeof blueprints.$inferInsert;

export const insertBlueprintVersionSchema =
  createInsertSchema(blueprintVersions);
export const selectBlueprintVersionSchema =
  createSelectSchema(blueprintVersions);
export type BlueprintVersion = typeof blueprintVersions.$inferSelect;
export type NewBlueprintVersion = typeof blueprintVersions.$inferInsert;

export const insertTechStackPresetSchema = createInsertSchema(techStackPresets);
export const selectTechStackPresetSchema = createSelectSchema(techStackPresets);
export type TechStackPreset = typeof techStackPresets.$inferSelect;
export type NewTechStackPreset = typeof techStackPresets.$inferInsert;
