import { pgTable, text, timestamp, integer, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { projects } from "./projects";
import { users } from "./users";

export const sessionStatusEnum = pgEnum("session_status", [
  "active", "paused", "completed", "failed", "cancelled",
]);

export const agentModeEnum = pgEnum("agent_mode", [
  "task", "ask", "plan", "watch", "fleet",
]);

export const sessionEventTypeEnum = pgEnum("session_event_type", [
  "agent_output", "file_change", "plan_update", "task_status",
  "queue_position", "credit_update", "checkpoint", "error",
  "reasoning", "terminal_output", "browser_screenshot",
]);

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id),
  status: sessionStatusEnum("status").notNull().default("active"),
  mode: agentModeEnum("mode").notNull().default("task"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});

export const sessionEvents = pgTable("session_events", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  type: sessionEventTypeEnum("type").notNull(),
  data: jsonb("data").notNull().default({}),
  agentRole: text("agent_role"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});

export const sessionMessages = pgTable("session_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => sessions.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  modelUsed: text("model_used"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  project: one(projects, {
    fields: [sessions.projectId],
    references: [projects.id],
  }),
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
  events: many(sessionEvents),
  messages: many(sessionMessages),
}));

export const sessionEventsRelations = relations(sessionEvents, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionEvents.sessionId],
    references: [sessions.id],
  }),
}));

export const sessionMessagesRelations = relations(sessionMessages, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionMessages.sessionId],
    references: [sessions.id],
  }),
}));
