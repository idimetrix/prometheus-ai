import { relations } from "drizzle-orm";
import { agents } from "../agents/agents";
import { projects } from "../projects/projects";
import { tasks } from "../tasks/tasks";
import { users } from "../users/users";
import { sessionEvents, sessionMessages, sessions } from "./sessions";

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
  tasks: many(tasks),
  agents: many(agents),
}));

export const sessionEventsRelations = relations(sessionEvents, ({ one }) => ({
  session: one(sessions, {
    fields: [sessionEvents.sessionId],
    references: [sessions.id],
  }),
}));

export const sessionMessagesRelations = relations(
  sessionMessages,
  ({ one }) => ({
    session: one(sessions, {
      fields: [sessionMessages.sessionId],
      references: [sessions.id],
    }),
  })
);
