import { pgTable, text, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { sessions } from "./sessions";

export const agentStatusEnum = pgEnum("agent_status", [
  "idle", "working", "error", "terminated",
]);

export const agents = pgTable("agents", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  status: agentStatusEnum("status").notNull().default("idle"),
  modelUsed: text("model_used"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  stepsCompleted: integer("steps_completed").notNull().default(0),
  currentTaskId: text("current_task_id"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }).notNull().defaultNow(),
  terminatedAt: timestamp("terminated_at", { withTimezone: true }),
});

export const agentsRelations = relations(agents, ({ one }) => ({
  session: one(sessions, {
    fields: [agents.sessionId],
    references: [sessions.id],
  }),
}));
