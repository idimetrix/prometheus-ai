import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { usageRollups } from "./usage-rollups";

export const insertUsageRollupSchema = createInsertSchema(usageRollups);
export const selectUsageRollupSchema = createSelectSchema(usageRollups);
export type UsageRollup = typeof usageRollups.$inferSelect;
export type NewUsageRollup = typeof usageRollups.$inferInsert;
