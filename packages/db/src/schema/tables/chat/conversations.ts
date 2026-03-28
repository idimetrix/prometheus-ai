import { index, pgTable, text } from "drizzle-orm/pg-core";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "../projects/projects";

export const chatConversations = pgTable(
  "chat_conversations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").notNull(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull().default("New Chat"),
    model: text("model"),
    ...timestamps,
  },
  (table) => [
    index("chat_conversations_user_id_idx").on(table.userId),
    index("chat_conversations_org_id_idx").on(table.orgId),
    index("chat_conversations_project_id_idx").on(table.projectId),
    index("chat_conversations_org_created_idx").on(
      table.orgId,
      table.createdAt
    ),
  ]
);
