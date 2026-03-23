import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { taskSteps, tasks } from "./tasks";

export const insertTaskSchema = createInsertSchema(tasks);
export const selectTaskSchema = createSelectSchema(tasks);
export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export const insertTaskStepSchema = createInsertSchema(taskSteps);
export const selectTaskStepSchema = createSelectSchema(taskSteps);
export type TaskStep = typeof taskSteps.$inferSelect;
export type NewTaskStep = typeof taskSteps.$inferInsert;
