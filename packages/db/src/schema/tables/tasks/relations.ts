import { relations } from "drizzle-orm";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";
import { fleetBatches } from "./fleet-batches";
import { taskSteps, tasks } from "./tasks";

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  session: one(sessions, {
    fields: [tasks.sessionId],
    references: [sessions.id],
  }),
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  steps: many(taskSteps),
}));

export const taskStepsRelations = relations(taskSteps, ({ one }) => ({
  task: one(tasks, {
    fields: [taskSteps.taskId],
    references: [tasks.id],
  }),
}));

export const fleetBatchesRelations = relations(fleetBatches, () => ({}));
