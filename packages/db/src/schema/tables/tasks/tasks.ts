import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { taskStatusEnum } from "../../enums";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    orgId: text("org_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: taskStatusEnum("status").notNull().default("pending"),
    priority: integer("priority").notNull().default(50),
    agentRole: text("agent_role"),
    creditsReserved: integer("credits_reserved").notNull().default(0),
    creditsConsumed: integer("credits_consumed").notNull().default(0),
    dependencies: jsonb("dependencies").$type<string[]>().default([]),
    assignedUserId: text("assigned_user_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("tasks_session_id_idx").on(table.sessionId),
    index("tasks_project_id_idx").on(table.projectId),
    index("tasks_org_id_status_idx").on(table.orgId, table.status),
    index("tasks_project_status_idx").on(table.projectId, table.status),
    index("tasks_session_status_idx").on(table.sessionId, table.status),
  ]
);

export const taskSteps = pgTable(
  "task_steps",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    stepNumber: integer("step_number").notNull(),
    description: text("description").notNull(),
    status: taskStatusEnum("status").notNull().default("pending"),
    output: text("output"),
  },
  (table) => [index("task_steps_task_id_idx").on(table.taskId)]
);
