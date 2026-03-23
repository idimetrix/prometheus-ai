import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { agents } from "./agents";

export const insertAgentSchema = createInsertSchema(agents);
export const selectAgentSchema = createSelectSchema(agents);
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
