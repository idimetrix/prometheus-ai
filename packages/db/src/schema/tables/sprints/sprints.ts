import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { projects } from "../projects/projects";
import { sessions } from "../sessions/sessions";

export const sprintPlans = pgTable(
  "sprint_plans",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    goals: jsonb("goals").notNull().default([]),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("sprint_plans_project_id_idx").on(table.projectId)]
);

export const sprintTasks = pgTable(
  "sprint_tasks",
  {
    id: text("id").primaryKey(),
    sprintId: text("sprint_id")
      .notNull()
      .references(() => sprintPlans.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    agentRole: text("agent_role").notNull(),
    dependencies: jsonb("dependencies").notNull().default([]),
    effort: text("effort").notNull().default("medium"),
    status: text("status").notNull().default("pending"),
    order: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("sprint_tasks_sprint_id_idx").on(table.sprintId)]
);
