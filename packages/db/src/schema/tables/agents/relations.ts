import { relations } from "drizzle-orm";
import { sessions } from "../sessions/sessions";
import { agents } from "./agents";

export const agentsRelations = relations(agents, ({ one }) => ({
  session: one(sessions, {
    fields: [agents.sessionId],
    references: [sessions.id],
  }),
}));
