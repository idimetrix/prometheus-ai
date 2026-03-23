import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { modelConfigs, modelUsage } from "./models";

export const insertModelUsageSchema = createInsertSchema(modelUsage);
export const selectModelUsageSchema = createSelectSchema(modelUsage);
export type ModelUsage = typeof modelUsage.$inferSelect;
export type NewModelUsage = typeof modelUsage.$inferInsert;

export const insertModelConfigSchema = createInsertSchema(modelConfigs);
export const selectModelConfigSchema = createSelectSchema(modelConfigs);
export type ModelConfig = typeof modelConfigs.$inferSelect;
export type NewModelConfig = typeof modelConfigs.$inferInsert;
