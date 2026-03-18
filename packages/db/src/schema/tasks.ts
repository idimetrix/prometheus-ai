import { pgTable, text, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { sessions } from "./sessions";
import { projects } from "./projects";

export const taskStatusEnum = pgEnum("task_status", [
  "pending", "queued", "running", "paused", "completed", "failed", "cancelled",
]);

export const tasks = pgTable("tasks", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  projectId: text("project_id").notNull().references(() => projects.id),
  title: text("title").notNull(),
  description: text("description"),
  status: taskStatusEnum("status").notNull().default("pending"),
  priority: integer("priority").notNull().default(50),
  agentRole: text("agent_role"),
  creditsReserved: integer("credits_reserved").notNull().default(0),
  creditsConsumed: integer("credits_consumed").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const taskSteps = pgTable("task_steps", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
  stepNumber: integer("step_number").notNull(),
  description: text("description").notNull(),
  status: taskStatusEnum("status").notNull().default("pending"),
  output: text("output"),
});

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
