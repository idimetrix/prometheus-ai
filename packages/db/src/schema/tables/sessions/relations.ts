import { relations } from "drizzle-orm";
import { agents } from "../agents/agents";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { tasks } from "../tasks/tasks";
import { users } from "../users/users";
import { sessionCheckpoints } from "./session-checkpoints";
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
  checkpoints: many(sessionCheckpoints),
}));

export const sessionCheckpointsRelations = relations(
  sessionCheckpoints,
  ({ one }) => ({
    session: one(sessions, {
      fields: [sessionCheckpoints.sessionId],
      references: [sessions.id],
    }),
    organization: one(organizations, {
      fields: [sessionCheckpoints.orgId],
      references: [organizations.id],
    }),
  })
);

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
