import { index, integer, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { hookActionEnum, hookEventEnum } from "../../enums";
import { timestamps } from "../../helpers";
import { organizations } from "../organizations/organizations";
import { projects } from "./projects";

export interface HookConfig {
  command?: string;
  enabled: boolean;
  pattern?: string;
  webhookUrl?: string;
}

export const projectHooks = pgTable(
  "project_hooks",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    event: hookEventEnum("event").notNull(),
    action: hookActionEnum("action").notNull(),
    config: jsonb("config").$type<HookConfig>().notNull(),
    priority: integer("priority").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    index("project_hooks_project_id_idx").on(table.projectId),
    index("project_hooks_org_id_idx").on(table.orgId),
    index("project_hooks_event_idx").on(table.projectId, table.event),
  ]
);
