import { relations } from "drizzle-orm";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";
import { chatConversations } from "./conversations";
import { chatMessages } from "./messages";

export const chatConversationsRelations = relations(
  chatConversations,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [chatConversations.projectId],
      references: [projects.id],
    }),
    organization: one(organizations, {
      fields: [chatConversations.orgId],
      references: [organizations.id],
    }),
    messages: many(chatMessages),
  })
);

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  conversation: one(chatConversations, {
    fields: [chatMessages.conversationId],
    references: [chatConversations.id],
  }),
}));
