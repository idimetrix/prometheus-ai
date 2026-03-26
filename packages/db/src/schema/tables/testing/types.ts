import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { visualBaselines } from "./visual-baselines";

export const insertVisualBaselineSchema = createInsertSchema(visualBaselines);
export const selectVisualBaselineSchema = createSelectSchema(visualBaselines);
export type VisualBaseline = typeof visualBaselines.$inferSelect;
export type NewVisualBaseline = typeof visualBaselines.$inferInsert;
