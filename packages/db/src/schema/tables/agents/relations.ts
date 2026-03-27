import { relations } from "drizzle-orm";
import { sessions } from "../sessions/sessions";
import { agents } from "./agents";
import { customAgents, customAgentVersions } from "./custom-agents";

export const agentsRelations = relations(agents, ({ one }) => ({
  session: one(sessions, {
    fields: [agents.sessionId],
    references: [sessions.id],
  }),
}));

export const customAgentsRelations = relations(customAgents, ({ many }) => ({
  versions: many(customAgentVersions),
}));

export const customAgentVersionsRelations = relations(
  customAgentVersions,
  ({ one }) => ({
    agent: one(customAgents, {
      fields: [customAgentVersions.agentId],
      references: [customAgents.id],
    }),
  })
);
